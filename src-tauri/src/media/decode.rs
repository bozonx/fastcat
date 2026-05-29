//! Декодер видео. Скелет — реальная реализация в следующем этапе.
//!
//! Контракт:
//!   - открыть медиафайл и проинспектировать (длительность, fps, codec, размер, sample_aspect)
//!   - на запрос кадра в момент `t` — отдать декодированный кадр (YUV/RGBA) с минимальным re-decode
//!   - hw-acceleration по возможности (VAAPI на Linux, NVDEC, VideoToolbox, D3D11VA)

use anyhow::Result;
use std::path::Path;

pub struct MediaInfo {
    pub duration_sec: f64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub codec: String,
    pub has_audio: bool,
}

pub struct VideoFrame {
    pub width: u32,
    pub height: u32,
    /// RGBA8 в линейном порядке (после конверсии из YUV, пока что).
    pub pixels: Vec<u8>,
    pub pts_sec: f64,
}

pub trait VideoDecoder: Send {
    fn info(&self) -> &MediaInfo;
    fn seek(&mut self, time_sec: f64) -> Result<()>;
    fn next_frame(&mut self) -> Result<Option<VideoFrame>>;
}

pub fn open(_path: &Path) -> Result<Box<dyn VideoDecoder>> {
    anyhow::bail!("media decoder not implemented yet")
}
