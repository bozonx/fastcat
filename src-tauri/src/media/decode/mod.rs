//! Video decoder for the native monitor / preview.
//!
//! The primary backend is `ffmpeg-next` over libav*: it does not respawn an external process on
//! seek and gives direct access to PTS/timebase. The system `ffmpeg` CLI remains a fallback only
//! for preview decode; export, proxy, and conversion still use the CLI separately.
//!
//! Contract: always returns dense RGBA8 (`width * height * 4`) and PTS in seconds.

mod ffmpeg_next;
mod types;
mod utils;

pub use types::{
    MediaInfo, SharedTexture, TextureSource, VideoFrame, YuvColor, YuvColorMatrix, YuvColorRange,
    YuvFrame,
};
pub use ffmpeg_next::{FfmpegNextDecoder, FfmpegNextDecoderFactory};
pub(crate) use types::MAX_TEXTURES_PER_SIZE;
pub(crate) use utils::probe_rotation;

use anyhow::Result;
use std::path::Path;

use crate::media::types::HwAccelMode;

pub trait VideoDecoder {
    fn info(&self) -> &MediaInfo;
    fn seek(&mut self, time_sec: f64) -> Result<()>;
    fn next_frame(&mut self) -> Result<Option<VideoFrame>>;
    fn next_frame_for_gpu(&mut self) -> Result<Option<VideoFrame>> {
        self.next_frame()
    }
    /// Like `next_frame`, but when a seek is active, intra-GOP frames that
    /// would normally be silently skipped are emitted **before** the seek
    /// target. Use during paused warm-up to opportunistically fill the
    /// `VideoFrameCache` with GOP-interior frames so backward scrubbing
    /// within the same GOP is served from cache instead of triggering a
    /// re-seek + re-decode.
    fn next_frame_keep_preseek(&mut self) -> Result<Option<VideoFrame>> {
        self.next_frame()
    }
    fn next_frame_keep_preseek_for_gpu(&mut self) -> Result<Option<VideoFrame>> {
        self.next_frame_for_gpu()
    }
}

/// Factory for creating `VideoDecoder` instances. Abstracted so tests and
/// alternative backends can be injected without hard-coding `ffmpeg-next`.
pub trait VideoDecoderFactory: Send + Sync {
    fn open(
        &self,
        path: &Path,
        max_output_long_edge: Option<u32>,
        hw_mode: HwAccelMode,
        vaapi_device: Option<&str>,
    ) -> Result<Box<dyn VideoDecoder>>;
}

/// Opens a video decoder for preview / thumbnail / export.
///
/// The only backend is `ffmpeg-next` over libav*: direct access to PTS/timebase,
/// frame-accurate seek without respawning a process. The CLI fallback was intentionally
/// removed — it produced divergent behaviour (different seek/rotation/PTS) and silently
/// masked ffmpeg-next issues. Where the CLI is actually needed (HW encode export, single
/// extract command), it is invoked directly rather than as a hidden replacement for this decoder.
pub fn open(
    path: &Path,
    max_output_long_edge: Option<u32>,
    hw_mode: HwAccelMode,
    vaapi_device: Option<&str>,
) -> Result<Box<dyn VideoDecoder>> {
    FfmpegNextDecoderFactory.open(path, max_output_long_edge, hw_mode, vaapi_device)
}

#[cfg(test)]
mod tests;
