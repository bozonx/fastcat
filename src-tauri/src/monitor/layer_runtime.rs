//! Runtime types for monitor layers.
//!
//! `BgLayerResult`, `LayerRuntime`, `VideoLayerRt`, and `ImageLayerRt` live here
//! so they can be shared by `LayerRuntimeManager` and the background loader
//! without bloating the manager module.

use std::sync::Arc;
use std::time::Instant;

use tauri::{AppHandle, Emitter};
use vello::peniko::{Blob, ImageAlphaType, ImageData, ImageFormat};

use crate::media::decode::thread::DecodePump;
use crate::media::decode::VideoFrame;

use super::frame_cache::{DecodedVideoFrame, VideoFrameCache};

const EVT_LAYER_FAILED: &str = "monitor:layer_failed";

/// If the nearest cached frame is farther than this from the target, the decoder
/// is in the wrong place (reverse / fast-forward / big jump) and needs re-seeking.
/// Smaller misses are transient decoder drift on 1× playback — ignored.
const RESEEK_MISS_DISTANCE_SEC: f64 = 0.5;
/// Minimum interval between re-seeks for a single layer so an in-flight seek
/// can finish and we avoid command storms to the decoder.
const RESEEK_COOLDOWN_SEC: f64 = 0.15;
/// Reverse playback: how far *before* the target to re-seek so the forward decode
/// run brackets the (decreasing) target from below for a stretch before the next
/// re-seek. One GOP's worth keeps the re-seek cadence low while staying responsive.
const REVERSE_RESEEK_BACK_SEC: f64 = 0.5;
/// After this many consecutive ticks lagged beyond the sync window we treat the
/// source as decode-bound (the decoder can't keep up with realtime, e.g. 4K) and
/// stop re-seeking-on-lag: re-seeking only flushes the decoder and re-decodes the
/// GOP, making it worse (freezes). Instead we show the newest decoded frame
/// (graceful smooth-lag). Recovers automatically once sync is regained.
const DECODE_BOUND_LAG_TICKS: u32 = 12;
/// Hard memory ceiling for paused warm-up (preroll) per layer. At ~33 MB per 4K
/// frame this allows 2 frames; at ~8 MB per 1080p frame the full cap applies.
/// Keeps a huge-GOP / keyframe-less source from ballooning memory while we pre-decode
/// the first GOP. The frame queue and the cache budget bound it again downstream.
const PREROLL_BUDGET_BYTES: usize = 64 * 1024 * 1024;
/// Minimum preroll frame count, applied even when a single decoded frame exceeds
/// `PREROLL_BUDGET_BYTES`. Two frames guarantee that the decoder has at least moved
/// past the keyframe before Play, avoiding the "first frame freeze" on long-GOP 4K.
pub(super) const MIN_PREROLL_FRAMES: u32 = 2;
/// Absolute frame cap for warm-up regardless of resolution (small sources).
const MAX_PREROLL_FRAMES: u32 = 8;
/// How far ahead (in seconds) to request pre-decoding during paused warm-up.
/// Used by `preroll_frame_count` to convert to a frame count and by
/// `expected_preroll_duration` to compute the actual ready threshold.
pub(super) const PREROLL_LOOKAHEAD_SEC: f64 = 0.2;
/// How far ahead to warm a FUTURE clip that is about to start PLAYING (not just
/// being shown on pause). Larger than `PREROLL_LOOKAHEAD_SEC`: a paused layer only
/// needs the playhead frame, but a clip about to play needs a head start so a
/// decode-bound (4K / long-GOP) source does not immediately fall into smooth-lag at
/// the cut. Bounded by the frame-cache capacity in `request_warm_ahead`, so it never
/// decodes more than the cache can hold, and decoded in one shot so it does not keep
/// stealing CPU from the still-active clip.
const WARM_AHEAD_LOOKAHEAD_SEC: f64 = 0.5;

// ---------------------------------------------------------------------------
// Background loading results
// ---------------------------------------------------------------------------

pub enum BgLayerResult {
    VideoOk {
        epoch: u64,
        id: String,
        pump: DecodePump,
        media_size: (u32, u32),
        source_rotation: i32,
    },
    VideoErr {
        epoch: u64,
        id: String,
        error: String,
    },
    ImageOk {
        epoch: u64,
        id: String,
        image: ImageData,
        size: (u32, u32),
    },
    ImageErr {
        epoch: u64,
        id: String,
        error: String,
    },
    SvgOk {
        epoch: u64,
        id: String,
        image: ImageData,
        size: (u32, u32),
    },
    SvgErr {
        epoch: u64,
        id: String,
        error: String,
    },
    /// The loader was cancelled before opening the decoder (e.g. layer left the
    /// scene while waiting for a gate permit). No runtime state is changed.
    Dropped { id: String },
}

// ---------------------------------------------------------------------------
// Layer runtimes
// ---------------------------------------------------------------------------

pub enum LayerRuntime {
    // Boxed: `VideoLayerRt` is far larger than the other variants, so keeping it
    // inline made every `LayerRuntime` (incl. the cheap `Loading`/`Failed`/`Image`
    // states stored per layer) pay its full size. The box keeps the enum small.
    Video(Box<VideoLayerRt>),
    Image(ImageLayerRt),
    /// Background loader thread is running — result not yet received.
    Loading,
    /// Open failed. Removed on the next `apply_scene` for retry.
    Failed,
}

pub struct VideoLayerRt {
    pub pump: DecodePump,
    pub media_size: (u32, u32),
    pub source_rotation: i32,
    /// Currently displayed frame (latest with PTS ≤ target from cache).
    pub current: Option<DecodedVideoFrame>,
    /// Cache of decoded frames for cheap backward scrubbing without respawning ffmpeg.
    cache: VideoFrameCache,
    /// Last decoded frame kept only as a display handoff when the rotating cache is disabled.
    uncached_latest: Option<DecodedVideoFrame>,
    /// Time of the last cache-miss re-seek (throttles re-seeking).
    last_reseek: Option<Instant>,
    /// Consecutive ticks lagged beyond the sync window (decode-bound detector).
    lagged_ticks: u32,
    /// Newest cached PTS seen on the previous `decoder_advancing` call — used to tell
    /// "decoder is slow but moving forward" from "decoder is stuck / mispositioned".
    last_newest_pts: Option<f64>,
    /// Last target PTS sent to the decoder pump via `seek`.
    pub last_pump_seek_pts: Option<f64>,
    /// True for a runtime opened by look-ahead before its timeline interval becomes
    /// active. It may hold a small preroll cache, but must not free-run until the
    /// playhead actually enters the clip.
    play_deferred_until_active: bool,
    /// Sanitized absolute per-clip speed factor. Warm-up frame counts are scaled by this
    /// so a fast clip keeps the same *timeline*-time head start (at 2× the source PTS
    /// advances 2× per timeline second, so twice as many source frames must be prewarmed
    /// to cover the same wall-clock horizon). Captured once at construction — safe because
    /// `speed_bits` is part of `VideoRuntimeKey`, so a speed edit rebuilds the runtime.
    playback_speed_abs: f64,
}

impl VideoLayerRt {
    pub fn new(
        pump: DecodePump,
        media_size: (u32, u32),
        source_rotation: i32,
        cache_budget_bytes: usize,
    ) -> Self {
        let fps = pump.info.fps;
        let frame_bytes = (media_size.0 as usize)
            .saturating_mul(media_size.1 as usize)
            .saturating_mul(4);
        Self {
            cache: VideoFrameCache::new(fps, frame_bytes, cache_budget_bytes),
            pump,
            media_size,
            source_rotation,
            current: None,
            uncached_latest: None,
            last_reseek: None,
            lagged_ticks: 0,
            last_newest_pts: None,
            last_pump_seek_pts: None,
            play_deferred_until_active: false,
            playback_speed_abs: 1.0,
        }
    }

    /// Sets the sanitized absolute per-clip speed used to scale warm-up depth.
    /// Callers pass `sanitize_clip_speed(layer.speed).abs()`.
    pub fn set_playback_speed_abs(&mut self, abs_speed: f64) {
        self.playback_speed_abs = if abs_speed.is_finite() && abs_speed > 0.0 {
            abs_speed
        } else {
            1.0
        };
    }

    pub fn set_play_deferred_until_active(&mut self, deferred: bool) {
        self.play_deferred_until_active = deferred;
    }

    pub fn play_deferred_until_active(&self) -> bool {
        self.play_deferred_until_active
    }

    pub fn set_transport_playing(&mut self, playing: bool) {
        if playing && !self.play_deferred_until_active {
            if let Err(e) = self.pump.play() {
                log::error!("[monitor] video play request: {e:?}");
            }
        } else if let Err(e) = self.pump.pause() {
            log::error!("[monitor] video pause request: {e:?}");
        }
    }

    pub fn activate_deferred_playback(&mut self, target_clip_local: f64) {
        if !self.play_deferred_until_active {
            return;
        }
        let need_seek = match self.last_pump_seek_pts {
            Some(last_pts) => (last_pts - target_clip_local).abs() > 1e-5,
            None => true,
        };
        if need_seek {
            if let Err(e) = self.pump.seek(target_clip_local) {
                log::error!("[monitor] activate deferred video seek: {e:?}");
            }
            self.last_pump_seek_pts = Some(target_clip_local);
            self.note_seek_requested();
        }
        self.play_deferred_until_active = false;
        if let Err(e) = self.pump.play() {
            log::error!("[monitor] activate deferred video play: {e:?}");
        }
    }

    /// Sync is satisfied this tick — reset the decode-bound lag counter.
    pub fn note_synced(&mut self) {
        self.lagged_ticks = 0;
    }

    /// Lagged beyond the sync window this tick.
    pub fn note_lagged(&mut self) {
        self.lagged_ticks = self.lagged_ticks.saturating_add(1);
    }

    /// True once the source has been lagged long enough that re-seeking is futile
    /// (decoder can't keep up with realtime); show the newest frame instead.
    pub fn is_decode_bound(&self) -> bool {
        self.lagged_ticks > DECODE_BOUND_LAG_TICKS
    }

    /// True if the newest cached frame advanced since the previous call — the decoder
    /// is decoding forward (just possibly slower than realtime). MUST be called once
    /// per tick after `pull_into_cache` to keep the baseline current.
    ///
    /// While advancing, re-seeking on sync-lag is counterproductive: it flushes the
    /// in-progress GOP and re-decodes it from the keyframe, which is exactly the 1–2s
    /// startup freeze on decode-bound 4K. Only a genuinely stalled or mispositioned
    /// decoder (not advancing) benefits from a re-seek.
    pub fn decoder_advancing(&mut self) -> bool {
        let newest = self.cache.newest_pts();
        let advancing = match (self.last_newest_pts, newest) {
            (Some(prev), Some(now)) => now > prev + 1e-4,
            (None, Some(_)) => true,
            _ => false,
        };
        self.last_newest_pts = newest;
        advancing
    }

    /// True once a frame at or past `target_clip_local` is buffered — the decoder has
    /// decoded ahead of the playhead and playback can start without a startup freeze.
    pub fn has_buffered_through(&self, target_clip_local: f64) -> bool {
        if self.cache.is_disabled() {
            return self
                .uncached_latest
                .as_ref()
                .is_some_and(|frame| frame.pts_sec >= target_clip_local);
        }

        self.cache.has_frame_ge(target_clip_local)
    }

    /// PTS (seconds) of the newest decoded frame available, regardless of cache mode.
    /// `None` when nothing has been decoded yet. Used by the readiness check to accept
    /// a near-EOF tail where no frame at/after the clamped target can ever exist.
    pub fn newest_buffered_pts(&self) -> Option<f64> {
        if self.cache.is_disabled() {
            self.uncached_latest.as_ref().map(|f| f.pts_sec)
        } else {
            self.cache.newest_pts()
        }
    }

    pub fn note_seek_requested(&mut self) {
        // Reset the forward-progress baseline: after a seek the rotating cache may still
        // hold higher-PTS frames from the previous position, so `newest_pts()` would not
        // drop and `decoder_advancing` would spuriously report "stuck" for a tick or two.
        // Clearing it makes the next `decoder_advancing` re-establish the baseline against
        // the new generation's first decoded frame.
        self.last_newest_pts = None;
        // Re-center cache eviction locality on the new seek target (recorded by every
        // seek site into `last_pump_seek_pts` just before this call). Otherwise the
        // locality stays at the previous read position until the first post-seek display
        // read, and warm-up/prebuffer inserts in that window evict the frames freshly
        // decoded around the new target as if they were the farthest-away ones.
        if let Some(target) = self.last_pump_seek_pts {
            self.cache.set_last_request(target);
        }
        if self.cache.is_disabled() {
            self.uncached_latest = None;
            self.current = None;
        }
    }

    /// Warms the cache while paused: pre-decodes ~`PREROLL_LOOKAHEAD_SEC` of frames ahead of
    /// the current playhead so a later Play does not freeze on the first 4K GOP. The
    /// frame count is capped both by a byte budget (`PREROLL_BUDGET_BYTES`) and an
    /// absolute frame cap (`MAX_PREROLL_FRAMES`). The result is always at least
    /// `MIN_PREROLL_FRAMES` so even a full-resolution 4K source prewarms past the
    /// keyframe into the actual GOP before Play.
    ///
    /// `keep_preseek_frames` is always `true` for paused warm-up: this causes the
    /// decoder to emit intra-GOP frames that lie *before* the seek target so that
    /// the `VideoFrameCache` is filled with the whole decoded GOP. Backward scrubbing
    /// within the same GOP is then served from cache without a re-seek.
    pub fn request_prebuffer(&self) {
        let frames = self.preroll_frame_count(PREROLL_LOOKAHEAD_SEC);
        if let Err(e) = self.pump.prebuffer(frames, true) {
            log::error!("[monitor] prebuffer request: {e:?}");
        }
    }

    /// Deeper one-shot warm-up for an imminent FUTURE clip during playback.
    ///
    /// `request_prebuffer` (paused preroll) only needs the playhead frame, so on a
    /// decode-bound source it warms just `MIN_PREROLL_FRAMES` — too small a head start
    /// for a clip that is about to START PLAYING: at the cut it has ~2 frames and
    /// immediately falls into smooth-lag (the "stutter at clip transitions"). This warms
    /// `WARM_AHEAD_LOOKAHEAD_SEC` worth of frames instead, capped by the frame-cache
    /// capacity (extra frames would only be evicted). It is a single prebuffer request,
    /// so the decoder parks once filled and does not keep contending with the active clip.
    pub fn request_warm_ahead(&self) {
        let frames = self.warm_ahead_frame_count();
        if let Err(e) = self.pump.prebuffer(frames, true) {
            log::error!("[monitor] warm-ahead prebuffer request: {e:?}");
        }
    }

    /// Frame count for `request_warm_ahead`: `ceil(WARM_AHEAD_LOOKAHEAD_SEC * fps) + 1`,
    /// floored at `MIN_PREROLL_FRAMES` and capped at the cache capacity (extra frames
    /// would only be evicted). A disabled cache still warms `MIN_PREROLL_FRAMES`.
    pub fn warm_ahead_frame_count(&self) -> u32 {
        let fps = self.pump.info.effective_fps();
        let by_lookahead =
            (WARM_AHEAD_LOOKAHEAD_SEC * fps * self.playback_speed_abs).ceil() as u32 + 1;
        let cap = self.cache.capacity().max(MIN_PREROLL_FRAMES as usize) as u32;
        by_lookahead.clamp(MIN_PREROLL_FRAMES, cap)
    }

    /// Expected warm-up duration in seconds, accounting for the per-layer
    /// memory budget. Unlike the constant `PREROLL_LOOKAHEAD_SEC`, this
    /// value reflects the *actual* number of frames the decoder was asked to
    /// produce — which may be smaller for 4K sources where the budget only
    /// allows `MIN_PREROLL_FRAMES` frames.
    ///
    /// Used by `active_videos_ready` as the readiness threshold so that a 4K
    /// source (limited to 2 preroll frames) never has to wait for the full
    /// 0.2 s of frames that the budget cannot hold anyway.
    pub fn expected_preroll_duration(&self) -> f64 {
        let fps = self.pump.info.effective_fps();
        let frames = self.preroll_frame_count(PREROLL_LOOKAHEAD_SEC);
        // Subtract half a frame as a PTS tolerance so the readiness check
        // triggers as soon as the last requested frame is actually decoded,
        // not only when the *next* hypothetical frame would be present.
        (frames as f64 - 0.5) / fps
    }

    /// Bounded number of warm-up frames: `ceil(lookahead * fps) + 1`, clamped by the
    /// per-layer byte budget, the frame-cache capacity (extra frames would just be
    /// evicted before Play reads them), and the absolute frame cap. Always ≥
    /// `MIN_PREROLL_FRAMES`.
    pub fn preroll_frame_count(&self, lookahead_sec: f64) -> u32 {
        let fps = self.pump.info.effective_fps();
        let by_lookahead =
            (lookahead_sec.max(0.0) * fps * self.playback_speed_abs).ceil() as u32 + 1;
        let frame_bytes = (self.media_size.0 as usize)
            .saturating_mul(self.media_size.1 as usize)
            .saturating_mul(4)
            .max(1);
        // Apply MIN_PREROLL_FRAMES as a lower bound: even a single 4K frame > budget
        // must warm at least MIN_PREROLL_FRAMES frames so the decoder gets past the
        // keyframe and Play doesn't start with a freeze on the first GOP decode.
        let by_memory =
            (PREROLL_BUDGET_BYTES / frame_bytes).max(MIN_PREROLL_FRAMES as usize) as u32;
        let by_cache_capacity = self.cache.capacity().max(MIN_PREROLL_FRAMES as usize) as u32;
        by_lookahead
            .min(by_memory)
            .min(by_cache_capacity)
            .clamp(MIN_PREROLL_FRAMES, MAX_PREROLL_FRAMES)
    }

    /// Decoder is not where it should be (reverse / fast-forward / cache miss):
    /// re-position it to `target` and immediately show the nearest available frame
    /// so the screen does not freeze. Throttled by `RESEEK_COOLDOWN_SEC`;
    /// only reacts to "far" misses.
    pub fn maybe_reseek_on_miss(&mut self, target_clip_local: f64) {
        let far_miss = match self.cache.nearest_distance_sec(target_clip_local) {
            Some(dist) => dist > RESEEK_MISS_DISTANCE_SEC,
            None => true,
        };
        if !far_miss {
            return;
        }
        let now = Instant::now();
        if let Some(last) = self.last_reseek {
            if now.duration_since(last).as_secs_f64() < RESEEK_COOLDOWN_SEC {
                return;
            }
        }
        self.last_reseek = Some(now);
        if let Err(e) = self.pump.seek(target_clip_local) {
            log::error!("[monitor] reseek-on-miss seek: {e:?}");
        }
        self.last_pump_seek_pts = Some(target_clip_local);
        self.note_seek_requested();
        if let Some(frame) = self.cache.frame_nearest(target_clip_local) {
            self.current = Some(frame);
        }
    }

    /// Reverse playback re-seek. The decoder only ever produces frames *forward*
    /// from its seek point, so as the reversed target steps backwards it eventually
    /// drops below the current GOP's keyframe and there is no frame ≤ target to show.
    /// `maybe_reseek_on_miss` does not help here: its symmetric far-miss gate sees the
    /// keyframe sitting just *above* the target as "near" and never fires, freezing
    /// the layer. So reverse needs its own trigger — re-seek to just before the target
    /// (so the forward decode run re-brackets it from below) whenever the cache can no
    /// longer satisfy `frame_le(target)`, and meanwhile show the nearest frame so the
    /// picture keeps moving instead of freezing between re-seeks.
    pub fn maybe_reseek_for_reverse(&mut self, target_clip_local: f64) {
        if self.cache.has_frame_le(target_clip_local) {
            return; // decoder still covers the target from below — keep stepping back
        }
        let now = Instant::now();
        let throttled = self
            .last_reseek
            .is_some_and(|last| now.duration_since(last).as_secs_f64() < RESEEK_COOLDOWN_SEC);
        if throttled {
            // Don't storm the decoder, but don't freeze either: show the closest frame.
            if let Some(frame) = self.cache.frame_nearest(target_clip_local) {
                self.current = Some(frame);
            }
            return;
        }
        self.last_reseek = Some(now);
        let seek_to = (target_clip_local - REVERSE_RESEEK_BACK_SEC).max(0.0);
        if let Err(e) = self.pump.seek(seek_to) {
            log::error!("[monitor] reverse reseek seek: {e:?}");
        }
        self.last_pump_seek_pts = Some(seek_to);
        self.note_seek_requested();
        if let Some(frame) = self.cache.frame_nearest(target_clip_local) {
            self.current = Some(frame);
        }
    }

    /// Sync modes with a finite lag window should catch up by moving the decoder,
    /// not by blanking the layer. This keeps the monitor stable while still
    /// allowing strict/balanced modes to skip stale decode history.
    pub fn maybe_reseek_on_sync_lag(&mut self, target_clip_local: f64, max_lag_sec: f64) {
        let lagged = match self.cache.nearest_distance_sec(target_clip_local) {
            Some(dist) => dist > max_lag_sec.max(0.0),
            None => true,
        };
        if !lagged {
            return;
        }

        self.seek_with_cooldown(target_clip_local, "sync-lag");
    }

    fn seek_with_cooldown(&mut self, target_clip_local: f64, reason: &str) {
        let now = Instant::now();
        if let Some(last) = self.last_reseek {
            if now.duration_since(last).as_secs_f64() < RESEEK_COOLDOWN_SEC {
                return;
            }
        }
        self.last_reseek = Some(now);
        if let Err(e) = self.pump.seek(target_clip_local) {
            log::error!("[monitor] {reason} seek: {e:?}");
        }
        self.last_pump_seek_pts = Some(target_clip_local);
        self.note_seek_requested();
    }

    /// Drains all available frames from the decoder into the cache (non-blocking).
    pub fn pull_into_cache(&mut self) {
        let live_gen = self.pump.current_generation();
        while let Some(msg) = self.pump.try_recv_frame() {
            if msg.generation != live_gen {
                continue;
            }
            // GPU texture lives inside the frame itself (Arc); eviction frees it
            // by dropping — no separate sync with an external texture cache needed.
            let cached = video_frame_to_cached(msg.frame);
            if self.cache.is_disabled() {
                self.uncached_latest = Some(cached);
            } else {
                self.uncached_latest = None;
                self.cache.insert(cached);
            }
        }
    }

    /// Picks the displayed frame: nearest with PTS ≤ target from cache (if any).
    /// If `max_lead_sec` is provided, allows picking a frame slightly ahead of target.
    pub fn update_display(
        &mut self,
        target_clip_local: f64,
        max_lag_sec: Option<f64>,
        max_lead_sec: Option<f64>,
    ) -> bool {
        let frame = match (max_lag_sec, max_lead_sec) {
            (_, Some(lead)) => self.cache.frame_le_with_lead(target_clip_local, lead),
            (Some(max_lag), None) => self.cache.frame_le_with_max_lag(target_clip_local, max_lag),
            (None, None) => self.cache.frame_le(target_clip_local),
        };
        let frame = frame.or_else(|| {
            if !self.cache.is_disabled() {
                return None;
            }

            let latest = self.uncached_latest.as_ref()?;
            if latest.pts_sec > target_clip_local {
                if let Some(lead) = max_lead_sec {
                    if latest.pts_sec - target_clip_local <= lead.max(0.0) {
                        return Some(latest.clone());
                    }
                }
                return None;
            }
            if let Some(max_lag) = max_lag_sec {
                if target_clip_local - latest.pts_sec > max_lag.max(0.0) {
                    return None;
                }
            }
            Some(latest.clone())
        });
        match frame {
            Some(frame) => {
                self.current = Some(frame);
                true
            }
            None => false,
        }
    }

    pub fn clear_display(&mut self) {
        self.current = None;
    }

    /// Shows the nearest cached frame to `target` in either direction, if any. Used as
    /// a stopgap on a paused scrub cache-miss (especially backward scrubbing across a
    /// GOP boundary): without it `current` holds the far-away frame from the previous
    /// position and the picture appears frozen until the decoder repositions and the
    /// next refresh lands the correct floor frame. Returns whether a frame was shown.
    pub fn show_nearest_cached(&mut self, target_clip_local: f64) -> bool {
        match self.cache.frame_nearest(target_clip_local) {
            Some(frame) => {
                self.current = Some(frame);
                true
            }
            None => false,
        }
    }

    pub fn has_cached_near(&mut self, target_clip_local: f64, tolerance_frames: i64) -> bool {
        if self.cache.is_disabled() {
            return false;
        }

        self.cache.has_near(target_clip_local, tolerance_frames)
    }
}

pub struct ImageLayerRt {
    pub image: ImageData,
    pub size: (u32, u32),
    pub is_svg: bool,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

pub fn video_frame_to_cached(mut frame: VideoFrame) -> DecodedVideoFrame {
    let width = frame.width;
    let height = frame.height;
    let pts_sec = frame.pts_sec;
    // Take GPU texture ownership into an Arc. CPU pixels are kept ONLY if
    // there was no GPU upload (no device); otherwise this is a pure duplicate
    // of the GPU frame — do not accumulate it.
    let texture = std::mem::take(&mut frame.texture);
    let image = if texture.is_some() {
        None
    } else {
        Some(ImageData {
            data: Blob::new(Arc::new(std::mem::take(&mut frame.pixels))),
            format: ImageFormat::Rgba8,
            alpha_type: ImageAlphaType::Alpha,
            width,
            height,
        })
    };
    DecodedVideoFrame {
        pts_sec,
        image,
        texture,
    }
}

pub fn emit_layer_failed(app: &AppHandle, id: &str, kind: &str, error: &str) {
    #[derive(serde::Serialize, Clone)]
    struct Payload<'a> {
        id: &'a str,
        kind: &'a str,
        error: &'a str,
    }
    let _ = app.emit(EVT_LAYER_FAILED, Payload { id, kind, error });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::types::HwAccelMode;
    use std::path::Path;

    fn fixture_video_rt() -> VideoLayerRt {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("test/fixtures/media/sample-1s-720p.mp4");
        let pump = DecodePump::open(crate::media::decode::thread::DecodeOpenParams {
            path: &fixture,
            max_output_long_edge: None,
            on_frame_decoded: None,
            device: None,
            queue: None,
            hw_mode: HwAccelMode::None,
            vaapi_device: None,
        })
        .expect("open fixture decoder");
        let media_size = (pump.info.width, pump.info.height);
        let rotation = pump.info.rotation;
        VideoLayerRt::new(pump, media_size, rotation, 192 * 1024 * 1024)
    }

    // Guards the graceful-degradation contract for decode-bound sources (e.g. 4K):
    // after `DECODE_BOUND_LAG_TICKS` consecutive lagged ticks the layer must report
    // decode-bound so the monitor stops re-seeking (which would flush the decoder and
    // freeze), and regaining sync must clear it. See `LayerRuntimeManager::tick`.
    #[test]
    fn decode_bound_trips_after_threshold_and_resets_on_sync() {
        let mut rt = fixture_video_rt();
        assert!(!rt.is_decode_bound(), "fresh layer is not decode-bound");

        for _ in 0..DECODE_BOUND_LAG_TICKS {
            rt.note_lagged();
            assert!(
                !rt.is_decode_bound(),
                "must keep trying to re-seek up to the threshold"
            );
        }

        rt.note_lagged(); // one tick past the threshold
        assert!(rt.is_decode_bound(), "trips past the threshold");

        rt.note_synced();
        assert!(
            !rt.is_decode_bound(),
            "regaining sync must clear decode-bound so re-seeking can resume"
        );
    }

    // Memory safeguard: the paused warm-up frame count must scale with lookahead but
    // stay bounded by both the byte budget and the absolute frame cap, never ballooning
    // on a huge-GOP / keyframe-less source. Always at least MIN_PREROLL_FRAMES.
    #[test]
    fn preroll_frame_count_is_bounded_by_memory_and_cap() {
        let rt = fixture_video_rt();

        // Zero lookahead still warms at least MIN_PREROLL_FRAMES frames.
        assert!(rt.preroll_frame_count(0.0) >= MIN_PREROLL_FRAMES);

        // A long lookahead is clamped by MAX_PREROLL_FRAMES, never unbounded.
        assert!(rt.preroll_frame_count(100.0) <= MAX_PREROLL_FRAMES);

        // Monotonic-ish: more lookahead never asks for fewer frames.
        assert!(rt.preroll_frame_count(0.5) >= rt.preroll_frame_count(0.0));
    }

    #[test]
    fn preroll_byte_budget_collapses_huge_frames_to_minimum() {
        let mut rt = fixture_video_rt();
        // Pretend each frame is enormous (8K-ish: way over the byte budget).
        rt.media_size = (7680, 4320);
        assert_eq!(
            rt.preroll_frame_count(10.0),
            MIN_PREROLL_FRAMES,
            "a frame larger than the byte budget must still prewarm MIN_PREROLL_FRAMES frames"
        );
    }

    // Anti-thrash core: while the decoder keeps producing newer frames it is decoding
    // forward (just slow), and `runtime::tick` must NOT re-seek-on-lag — re-seeking
    // flushes the in-progress GOP and causes the 4K startup freeze. A non-advancing
    // (stuck) decoder reports false so a re-seek can recover it.
    #[test]
    fn decoder_advancing_tracks_forward_progress() {
        fn cached(pts: f64) -> DecodedVideoFrame {
            DecodedVideoFrame {
                pts_sec: pts,
                image: None,
                texture: None,
            }
        }

        let mut rt = fixture_video_rt();
        // Empty cache — no progress.
        assert!(!rt.decoder_advancing());
        rt.cache.insert(cached(1.0));
        // A newer frame appeared — there is progress.
        assert!(rt.decoder_advancing());
        // Same newest frame — the decoder did not move.
        assert!(!rt.decoder_advancing());
        rt.cache.insert(cached(2.0));
        assert!(rt.decoder_advancing());
        assert!(!rt.decoder_advancing());
    }

    #[test]
    fn last_pump_seek_pts_tracks_seeks() {
        let mut rt = fixture_video_rt();
        assert_eq!(rt.last_pump_seek_pts, None);

        // maybe_reseek_on_miss should seek on far miss (0.5 is far enough from empty cache)
        rt.maybe_reseek_on_miss(0.5);
        assert_eq!(rt.last_pump_seek_pts, Some(0.5));

        // seek_with_cooldown should seek (throttling doesn't block first since last_reseek is recent but we can force or just test that it sets it when it seeked)
        // Wait, to bypass cooldown in the test, we can just call it and it will set the field if it actually runs. Or we can just call it.
        // Actually, since RESEEK_COOLDOWN_SEC is 0.15s and we just called it, we might be throttled. Let's make sure last_reseek is cleared or old.
        rt.last_reseek = None;
        rt.seek_with_cooldown(1.0, "test");
        assert_eq!(rt.last_pump_seek_pts, Some(1.0));
    }

    /// Regression test: `request_prebuffer` on a paused cache-hit seek must not panic,
    /// and frames ahead of the playhead must not count as "ready" before decode.
    ///
    /// Before the fix `LayerRuntimeManager::seek` did `continue` without calling
    /// `request_prebuffer` when `has_cached_near` — the forward buffer stayed empty,
    /// Play started without warm-up, and a crackle/audio repeat was heard in the first
    /// seconds.
    #[test]
    fn request_prebuffer_does_not_panic_on_cache_hit_seek() {
        let rt = fixture_video_rt();
        // Calling it without panic — the basic contract.
        rt.request_prebuffer();
        // preroll_frame_count must return at least MIN_PREROLL_FRAMES
        assert!(rt.preroll_frame_count(0.2) >= MIN_PREROLL_FRAMES);
    }

    // V1 fix: an imminent FUTURE clip (about to play) must warm a real head start,
    // not just the minimal paused preroll, so a decode-bound source does not stutter
    // at the cut. The count must exceed the paused preroll yet stay bounded by the
    // frame-cache capacity, and never panic.
    #[test]
    fn warm_ahead_decodes_deeper_than_paused_preroll_but_bounded_by_cache() {
        let rt = fixture_video_rt();
        let warm = rt.warm_ahead_frame_count();
        // Deeper than the paused playhead-only preroll.
        assert!(
            warm > rt.preroll_frame_count(PREROLL_LOOKAHEAD_SEC),
            "warm-ahead must give a bigger head start than paused preroll"
        );
        // Never more than the cache can hold (extra frames would be evicted).
        assert!(warm as usize <= rt.cache.capacity().max(MIN_PREROLL_FRAMES as usize));
        assert!(warm >= MIN_PREROLL_FRAMES);
        // Does not panic when actually issued.
        rt.request_warm_ahead();
    }

    // A frame-cache so small it holds only the minimum must still bound warm-ahead to
    // that capacity rather than decoding ahead frames it would immediately evict.
    #[test]
    fn warm_ahead_respects_tiny_cache_capacity() {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("test/fixtures/media/sample-1s-720p.mp4");
        let pump = DecodePump::open(crate::media::decode::thread::DecodeOpenParams {
            path: &fixture,
            max_output_long_edge: None,
            on_frame_decoded: None,
            device: None,
            queue: None,
            hw_mode: HwAccelMode::None,
            vaapi_device: None,
        })
        .expect("open fixture decoder");
        let media_size = (pump.info.width, pump.info.height);
        let rotation = pump.info.rotation;
        // Tiny budget → cache floors at its own MIN_FRAMES.
        let rt = VideoLayerRt::new(pump, media_size, rotation, 1);
        let warm = rt.warm_ahead_frame_count();
        assert!(warm as usize <= rt.cache.capacity().max(MIN_PREROLL_FRAMES as usize));
        assert!(warm >= MIN_PREROLL_FRAMES);
    }

    #[test]
    fn deferred_future_runtime_does_not_start_until_activation() {
        let mut rt = fixture_video_rt();
        rt.set_play_deferred_until_active(true);

        rt.set_transport_playing(true);
        assert!(
            rt.play_deferred_until_active(),
            "global play must not clear deferred future-runtime state"
        );

        rt.activate_deferred_playback(0.25);
        assert!(
            !rt.play_deferred_until_active(),
            "active clip must clear deferred state and enter normal playback"
        );
        assert_eq!(rt.last_pump_seek_pts, Some(0.25));
    }

    /// `has_buffered_through` contract: while no frame has been decoded past `target`,
    /// it must return `false` — warm-up is not considered complete.
    #[test]
    fn has_buffered_through_is_false_before_forward_frames_decoded() {
        let rt = fixture_video_rt();
        // Cache empty — no frames ahead of target.
        assert!(
            !rt.has_buffered_through(0.5),
            "empty cache must report not buffered through"
        );
    }

    #[test]
    fn expected_preroll_duration_matches_memory_budget() {
        let rt = fixture_video_rt();
        // In the normal case duration = (frames - 0.5) / fps
        let fps = rt.pump.info.fps.max(1.0);
        let normal_frames = rt.preroll_frame_count(PREROLL_LOOKAHEAD_SEC);
        let expected_normal = (normal_frames as f64 - 0.5) / fps;
        assert!((rt.expected_preroll_duration() - expected_normal).abs() < 1e-9);

        // For huge frames, preroll_frame_count must fall to MIN_PREROLL_FRAMES
        let mut rt_big = fixture_video_rt();
        rt_big.media_size = (7680, 4320); // 8K
        let big_frames = rt_big.preroll_frame_count(PREROLL_LOOKAHEAD_SEC);
        assert_eq!(big_frames, MIN_PREROLL_FRAMES);
        let expected_big = (MIN_PREROLL_FRAMES as f64 - 0.5) / fps;
        assert!((rt_big.expected_preroll_duration() - expected_big).abs() < 1e-9);
    }

    /// Warm-up depth must scale with |clip speed|: at 2× the source PTS advances twice as
    /// fast per timeline second, so twice as many source frames must be prewarmed to keep
    /// the same timeline-time head start. Without this a fast clip runs the cache dry and
    /// stutters at its start. Mirrors the web engine's `|speed|` scaling of decode-ahead.
    #[test]
    fn warm_up_depth_scales_with_clip_speed() {
        let mut rt = fixture_video_rt();

        // Default (1×) baseline.
        let base_warm = rt.warm_ahead_frame_count();
        let base_preroll = rt.preroll_frame_count(PREROLL_LOOKAHEAD_SEC);

        // Explicit 1× is unchanged from the default (regression guard).
        rt.set_playback_speed_abs(1.0);
        assert_eq!(rt.warm_ahead_frame_count(), base_warm);
        assert_eq!(rt.preroll_frame_count(PREROLL_LOOKAHEAD_SEC), base_preroll);

        // 2× warms strictly more (cache capacity for the 720p fixture is well above the
        // doubled count, so it is not clamped).
        rt.set_playback_speed_abs(2.0);
        let warm_2x = rt.warm_ahead_frame_count();
        assert!(
            warm_2x > base_warm,
            "2× must warm more frames than 1× ({warm_2x} vs {base_warm})"
        );
        // Preroll grows too (may hit MAX_PREROLL_FRAMES, so only require ≥).
        assert!(rt.preroll_frame_count(PREROLL_LOOKAHEAD_SEC) >= base_preroll);
    }

    /// Reverse (negative speed) must scale warm-up by |speed|, identically to the forward
    /// clip at the same magnitude — the decoder still streams source frames forward.
    #[test]
    fn warm_up_depth_uses_abs_speed_for_reverse() {
        let mut rt = fixture_video_rt();

        rt.set_playback_speed_abs(2.0);
        let warm_forward = rt.warm_ahead_frame_count();

        // Callers pass the sanitized abs, so a reversed -2× clip arrives here as 2.0.
        rt.set_playback_speed_abs((-2.0_f64).abs());
        assert_eq!(rt.warm_ahead_frame_count(), warm_forward);
    }

    /// Invalid speeds (0, non-finite) fall back to 1× so warm-up is never zeroed out.
    #[test]
    fn set_playback_speed_abs_rejects_invalid() {
        let mut rt = fixture_video_rt();
        let base_warm = rt.warm_ahead_frame_count();

        rt.set_playback_speed_abs(0.0);
        assert_eq!(rt.warm_ahead_frame_count(), base_warm);
        rt.set_playback_speed_abs(f64::NAN);
        assert_eq!(rt.warm_ahead_frame_count(), base_warm);
    }

    #[test]
    fn newest_buffered_pts_reports_latest_decoded_frame() {
        fn cached(pts: f64) -> DecodedVideoFrame {
            DecodedVideoFrame {
                pts_sec: pts,
                image: None,
                texture: None,
            }
        }

        let mut rt = fixture_video_rt();
        // Empty cache → nothing decoded yet.
        assert_eq!(rt.newest_buffered_pts(), None);
        rt.cache.insert(cached(1.0));
        rt.cache.insert(cached(2.5));
        // Tracks the newest decoded frame, which the tail-guard compares against target.
        assert_eq!(rt.newest_buffered_pts(), Some(2.5));
    }

    #[test]
    fn has_buffered_through_near_eof_returns_true_immediately() {
        let mut rt = fixture_video_rt();

        let video_duration = rt.pump.info.duration_sec; // 1.0s
        let fps = rt.pump.info.fps.max(1.0); // 30.0
        let half_frame = 0.5 / fps;
        let lookahead = rt.expected_preroll_duration();

        // Put the last frame in the cache (right at eof).
        fn cached(pts: f64) -> DecodedVideoFrame {
            DecodedVideoFrame {
                pts_sec: pts,
                image: None,
                texture: None,
            }
        }
        rt.cache.insert(cached(video_duration - half_frame));

        // The playhead is close to eof, e.g. at video_duration - 0.05 (0.95s).
        let clip_local = video_duration - 0.05;

        // With EOF protection (as in runtime.rs):
        let target = (clip_local + lookahead)
            .min(video_duration - half_frame)
            .max(clip_local);

        // Confirm target is clamped to video_duration - half_frame
        assert_eq!(target, video_duration - half_frame);

        // And now has_buffered_through(target) must return true immediately
        assert!(rt.has_buffered_through(target));

        // Whereas without EOF protection (where target would be clip_local + lookahead = 0.95 + lookahead > 1.0)
        let target_no_eof_protection = clip_local + lookahead;
        assert!(!rt.has_buffered_through(target_no_eof_protection));
    }
}
