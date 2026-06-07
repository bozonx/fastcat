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
        }
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
