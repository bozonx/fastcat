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

// ---------------------------------------------------------------------------
// Background loading results
// ---------------------------------------------------------------------------

pub enum BgLayerResult {
    VideoOk {
        id: String,
        pump: DecodePump,
        media_size: (u32, u32),
        source_rotation: i32,
    },
    VideoErr {
        id: String,
        error: String,
    },
    ImageOk {
        id: String,
        image: ImageData,
        size: (u32, u32),
    },
    ImageErr {
        id: String,
        error: String,
    },
    SvgOk {
        id: String,
        image: ImageData,
        size: (u32, u32),
    },
    SvgErr {
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
    /// Time of the last cache-miss re-seek (throttles re-seeking).
    last_reseek: Option<Instant>,
    /// Consecutive ticks lagged beyond the sync window (decode-bound detector).
    lagged_ticks: u32,
}

impl VideoLayerRt {
    pub fn new(pump: DecodePump, media_size: (u32, u32), source_rotation: i32) -> Self {
        let fps = pump.info.fps;
        let frame_bytes = (media_size.0 as usize)
            .saturating_mul(media_size.1 as usize)
            .saturating_mul(4);
        Self {
            cache: VideoFrameCache::new(fps, frame_bytes),
            pump,
            media_size,
            source_rotation,
            current: None,
            last_reseek: None,
            lagged_ticks: 0,
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
            self.cache.insert(video_frame_to_cached(msg.frame));
        }
    }

    /// Picks the displayed frame: nearest with PTS ≤ target from cache (if any).
    pub fn update_display(&mut self, target_clip_local: f64, max_lag_sec: Option<f64>) -> bool {
        let frame = match max_lag_sec {
            Some(max_lag) => self.cache.frame_le_with_max_lag(target_clip_local, max_lag),
            None => self.cache.frame_le(target_clip_local),
        };
        match frame {
            Some(frame) => {
                self.current = Some(frame);
                true
            }
            None => false,
        }
    }

    pub fn has_cached_near(&mut self, target_clip_local: f64, tolerance_frames: i64) -> bool {
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
    let texture = std::mem::take(&mut frame.texture).map(Arc::new);
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
        let pump = DecodePump::open(&fixture, None, None, None, None, HwAccelMode::None, None)
            .expect("open fixture decoder");
        let media_size = (pump.info.width, pump.info.height);
        let rotation = pump.info.rotation;
        VideoLayerRt::new(pump, media_size, rotation)
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
}
