use std::sync::Arc;

#[derive(Debug, Clone)]
pub struct MediaInfo {
    pub duration_sec: f64,
    pub width: u32,
    pub height: u32,
    pub rotation: i32,
    pub fps: f64,
    pub codec: String,
    pub has_audio: bool,
    /// Stream start PTS in seconds (0 when the demuxer exposes none). Non-zero for
    /// MPEG-TS or edit-list MP4 sources; the decode path normalises it internally, so
    /// callers that bypass the decoder (e.g. the direct-transcode export) need it to
    /// stay consistent.
    pub start_time_sec: f64,
    /// True when the source signals HDR / wide gamut (PQ or HLG transfer, or BT.2020
    /// primaries). Such sources are not colour-equivalent through the direct-transcode
    /// fast path, which preserves source tags while the vello path forces BT.709.
    pub is_hdr: bool,
}

impl MediaInfo {
    /// FPS used for every frame-timing computation (seek tolerance, preroll frame
    /// counts, warm-up thresholds): a source with missing/zero/non-finite metadata
    /// fps (some streamed/WebM sources) falls back to 30. Single source of truth so
    /// callers never disagree on the fallback (previously some used `.max(1.0)`,
    /// others `> 0.0 → 30.0`, producing inconsistent thresholds across the same
    /// decoder).
    pub fn effective_fps(&self) -> f64 {
        if self.fps.is_finite() && self.fps > 0.0 {
            self.fps
        } else {
            30.0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info_with_fps(fps: f64) -> MediaInfo {
        MediaInfo {
            duration_sec: 1.0,
            width: 2,
            height: 2,
            rotation: 0,
            fps,
            codec: "mock".into(),
            has_audio: false,
            start_time_sec: 0.0,
            is_hdr: false,
        }
    }

    #[test]
    fn effective_fps_passes_through_valid_fps() {
        assert_eq!(info_with_fps(24.0).effective_fps(), 24.0);
        assert_eq!(info_with_fps(59.94).effective_fps(), 59.94);
    }

    #[test]
    fn effective_fps_falls_back_to_30_on_invalid() {
        assert_eq!(info_with_fps(0.0).effective_fps(), 30.0);
        assert_eq!(info_with_fps(-5.0).effective_fps(), 30.0);
        assert_eq!(info_with_fps(f64::NAN).effective_fps(), 30.0);
        assert_eq!(info_with_fps(f64::INFINITY).effective_fps(), 30.0);
    }
}

#[derive(Debug)]
pub enum TextureSource {
    Owned(wgpu::Texture),
    Shared(Arc<wgpu::Texture>),
}

pub struct SharedTexture {
    pub source: Option<TextureSource>,
    pub pool: Option<crate::media::GpuTexturePool>,
}

impl std::fmt::Debug for SharedTexture {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SharedTexture")
            .field("source", &self.source)
            .finish()
    }
}

impl SharedTexture {
    pub fn new_owned(texture: wgpu::Texture, pool: crate::media::GpuTexturePool) -> Self {
        Self {
            source: Some(TextureSource::Owned(texture)),
            pool: Some(pool),
        }
    }

    pub fn new_shared(texture: Arc<wgpu::Texture>) -> Self {
        Self {
            source: Some(TextureSource::Shared(texture)),
            pool: None,
        }
    }
}

impl std::ops::Deref for SharedTexture {
    type Target = wgpu::Texture;
    fn deref(&self) -> &Self::Target {
        // `source` is `Some` for the entire life of a `SharedTexture` (both constructors
        // set it); it is only `take()`n in `Drop`, after which `deref` is unreachable.
        match self
            .source
            .as_ref()
            .expect("SharedTexture::source is taken only in Drop")
        {
            TextureSource::Owned(ref tex) => tex,
            TextureSource::Shared(ref arc) => arc.as_ref(),
        }
    }
}

pub(crate) const MAX_TEXTURES_PER_SIZE: usize = 4;

impl Drop for SharedTexture {
    fn drop(&mut self) {
        if let Some(TextureSource::Owned(tex)) = self.source.take() {
            if let Some(ref pool) = self.pool {
                let size = tex.size();
                let mut p = pool.lock();
                let slot = p.entry((size.width, size.height)).or_default();
                if slot.len() >= MAX_TEXTURES_PER_SIZE {
                    slot.remove(0);
                }
                slot.push(tex);
            }
        }
    }
}

pub struct VideoFrame {
    pub width: u32,
    pub height: u32,
    /// RGBA8, dense layout (`width * height * 4`).
    pub pixels: Vec<u8>,
    pub yuv: Option<YuvFrame>,
    pub pts_sec: f64,
    pub texture: Option<Arc<SharedTexture>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum YuvColorMatrix {
    Bt601,
    Bt709,
    Bt2020,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum YuvColorRange {
    Limited,
    Full,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct YuvColor {
    pub matrix: YuvColorMatrix,
    pub range: YuvColorRange,
}

#[derive(Debug, Clone)]
pub struct YuvFrame {
    pub y: Vec<u8>,
    /// Interleaved UV plane, equivalent to NV12 plane 1.
    pub uv: Vec<u8>,
    pub y_stride: u32,
    pub uv_stride: u32,
    pub uv_width: u32,
    pub uv_height: u32,
    pub color: YuvColor,
}
