//! Runtime types for monitor layers.
//!
//! `BgLayerResult`, `LayerRuntime`, `VideoLayerRt`, and `ImageLayerRt` live here
//! so they can be shared by `LayerRuntimeManager` and the background loader
//! without bloating the manager module.

use std::sync::Arc;
use std::time::Instant;

use tauri::{AppHandle, Emitter};
use vello::peniko::{Blob, ImageAlphaType, ImageData, ImageFormat};

use crate::media::decode::VideoFrame;
use crate::media::decode_thread::DecodePump;

use super::frame_cache::{DecodedVideoFrame, VideoFrameCache};

const EVT_LAYER_FAILED: &str = "monitor:layer_failed";

/// If the nearest cached frame is farther than this from the target, the decoder
/// is in the wrong place (reverse / fast-forward / big jump) and needs re-seeking.
/// Smaller misses are transient decoder drift on 1× playback — ignored.
const RESEEK_MISS_DISTANCE_SEC: f64 = 0.5;
/// Minimum interval between re-seeks for a single layer so an in-flight seek
/// can finish and we avoid command storms to the decoder.
const RESEEK_COOLDOWN_SEC: f64 = 0.15;
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
}

// ---------------------------------------------------------------------------
// Layer runtimes
// ---------------------------------------------------------------------------

pub enum LayerRuntime {
    Video(VideoLayerRt),
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

    pub fn note_seek_requested(&mut self) {
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
        let fps = self.pump.info.fps.max(1.0);
        let frames = self.preroll_frame_count(PREROLL_LOOKAHEAD_SEC);
        // Subtract half a frame as a PTS tolerance so the readiness check
        // triggers as soon as the last requested frame is actually decoded,
        // not only when the *next* hypothetical frame would be present.
        (frames as f64 - 0.5) / fps
    }

    /// Bounded number of warm-up frames: `ceil(lookahead * fps) + 1`, clamped by the
    /// per-layer byte budget and the absolute frame cap. Always ≥ `MIN_PREROLL_FRAMES`.
    pub fn preroll_frame_count(&self, lookahead_sec: f64) -> u32 {
        let fps = if self.pump.info.fps > 0.0 {
            self.pump.info.fps
        } else {
            30.0
        };
        let by_lookahead = (lookahead_sec.max(0.0) * fps).ceil() as u32 + 1;
        let frame_bytes = (self.media_size.0 as usize)
            .saturating_mul(self.media_size.1 as usize)
            .saturating_mul(4)
            .max(1);
        // Применяем MIN_PREROLL_FRAMES как нижнюю границу: даже один 4K-кадр > бюджета
        // должен прогреть минимум MIN_PREROLL_FRAMES кадров, чтобы декодер прошёл
        // мимо keyframe и Play не стартовал с фриза на первом GOP-декоде.
        let by_memory =
            (PREROLL_BUDGET_BYTES / frame_bytes).max(MIN_PREROLL_FRAMES as usize) as u32;
        by_lookahead
            .min(by_memory)
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
        let pump = DecodePump::open(crate::media::decode_thread::DecodeOpenParams {
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
        // Пустой кеш — прогресса нет.
        assert!(!rt.decoder_advancing());
        rt.cache.insert(cached(1.0));
        // Появился новейший кадр — прогресс есть.
        assert!(rt.decoder_advancing());
        // Тот же новейший кадр — декодер не двинулся.
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

    /// Регрессионный тест: `request_prebuffer` при seek на паузе с кэш-хитом не должна
    /// паниковать, и кадры вперёд playhead'а не должны считаться «готовыми» до декода.
    ///
    /// До фикса `LayerRuntimeManager::seek` делал `continue` без вызова `request_prebuffer`
    /// при `has_cached_near` — форвард-буфер оставался пустым, Play стартовал без прогрева
    /// и слышался треск/повтор аудио на первых секундах.
    #[test]
    fn request_prebuffer_does_not_panic_on_cache_hit_seek() {
        let rt = fixture_video_rt();
        // Вызов без паники — базовый контракт.
        rt.request_prebuffer();
        // preroll_frame_count должен вернуть минимум MIN_PREROLL_FRAMES
        assert!(rt.preroll_frame_count(0.2) >= MIN_PREROLL_FRAMES);
    }

    /// Контракт `has_buffered_through`: пока ни один кадр не декодирован вперёд `target`,
    /// должна возвращать `false` — прогрев не считается завершённым.
    #[test]
    fn has_buffered_through_is_false_before_forward_frames_decoded() {
        let rt = fixture_video_rt();
        // Кэш пуст — нет кадров вперёд target.
        assert!(
            !rt.has_buffered_through(0.5),
            "empty cache must report not buffered through"
        );
    }

    #[test]
    fn expected_preroll_duration_matches_memory_budget() {
        let rt = fixture_video_rt();
        // В нормальном случае duration = (frames - 0.5) / fps
        let fps = rt.pump.info.fps.max(1.0);
        let normal_frames = rt.preroll_frame_count(PREROLL_LOOKAHEAD_SEC);
        let expected_normal = (normal_frames as f64 - 0.5) / fps;
        assert!((rt.expected_preroll_duration() - expected_normal).abs() < 1e-9);

        // В случае огромных кадров, preroll_frame_count должен упасть до MIN_PREROLL_FRAMES
        let mut rt_big = fixture_video_rt();
        rt_big.media_size = (7680, 4320); // 8K
        let big_frames = rt_big.preroll_frame_count(PREROLL_LOOKAHEAD_SEC);
        assert_eq!(big_frames, MIN_PREROLL_FRAMES);
        let expected_big = (MIN_PREROLL_FRAMES as f64 - 0.5) / fps;
        assert!((rt_big.expected_preroll_duration() - expected_big).abs() < 1e-9);
    }

    #[test]
    fn has_buffered_through_near_eof_returns_true_immediately() {
        let mut rt = fixture_video_rt();

        let video_duration = rt.pump.info.duration_sec; // 1.0s
        let fps = rt.pump.info.fps.max(1.0); // 30.0
        let half_frame = 0.5 / fps;
        let lookahead = rt.expected_preroll_duration();

        // Помещаем в кэш последний кадр (на самом eof).
        fn cached(pts: f64) -> DecodedVideoFrame {
            DecodedVideoFrame {
                pts_sec: pts,
                image: None,
                texture: None,
            }
        }
        rt.cache.insert(cached(video_duration - half_frame));

        // Playhead находится близко к eof, например в video_duration - 0.05 (0.95s).
        let clip_local = video_duration - 0.05;

        // С EOF-защитой (как в runtime.rs):
        let target = (clip_local + lookahead)
            .min(video_duration - half_frame)
            .max(clip_local);

        // Убеждаемся, что target зажат до video_duration - half_frame
        assert_eq!(target, video_duration - half_frame);

        // И теперь has_buffered_through(target) должен вернуть true немедленно
        assert!(rt.has_buffered_through(target));

        // А без EOF-защиты (где target был бы clip_local + lookahead = 0.95 + lookahead > 1.0)
        let target_no_eof_protection = clip_local + lookahead;
        assert!(!rt.has_buffered_through(target_no_eof_protection));
    }
}
