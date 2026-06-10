//! Video decoder for the native monitor / preview.
//!
//! The primary backend is `ffmpeg-next` over libav*: it does not respawn an external process on
//! seek and gives direct access to PTS/timebase. The system `ffmpeg` CLI remains a fallback only
//! for preview decode; export, proxy, and conversion still use the CLI separately.
//!
//! Contract: always returns dense RGBA8 (`width * height * 4`) and PTS in seconds.

use anyhow::{anyhow, Context, Result};
use ffmpeg_next as ffmpeg;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use super::ffmpeg_utils::is_quarter_turn;
use super::hwaccel::{init_hwaccel_context, try_transfer_to_cpu, HwAccelContext};
use super::types::HwAccelMode;

#[derive(Debug, Clone)]
pub struct MediaInfo {
    pub duration_sec: f64,
    pub width: u32,
    pub height: u32,
    pub rotation: i32,
    pub fps: f64,
    pub codec: String,
    pub has_audio: bool,
}

#[derive(Debug)]
pub enum TextureSource {
    Owned(wgpu::Texture),
    Shared(Arc<wgpu::Texture>),
}

pub struct SharedTexture {
    pub source: Option<TextureSource>,
    pub pool: Option<super::GpuTexturePool>,
}

impl std::fmt::Debug for SharedTexture {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SharedTexture")
            .field("source", &self.source)
            .finish()
    }
}

impl SharedTexture {
    pub fn new_owned(texture: wgpu::Texture, pool: super::GpuTexturePool) -> Self {
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
        match self.source.as_ref().unwrap() {
            TextureSource::Owned(ref tex) => tex,
            TextureSource::Shared(ref arc) => arc.as_ref(),
        }
    }
}

const MAX_TEXTURES_PER_SIZE: usize = 4;

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

pub trait VideoDecoder {
    fn info(&self) -> &MediaInfo;
    fn seek(&mut self, time_sec: f64) -> Result<()>;
    fn next_frame(&mut self) -> Result<Option<VideoFrame>>;
    fn next_frame_for_gpu(&mut self) -> Result<Option<VideoFrame>> {
        self.next_frame()
    }
}

static FFMPEG_INIT: OnceLock<Result<(), String>> = OnceLock::new();
pub struct FfmpegNextDecoder {
    path: PathBuf,
    info: MediaInfo,
    ictx: ffmpeg::format::context::Input,
    decoder: ffmpeg::decoder::Video,
    scaler: Option<ffmpeg::software::scaling::Context>,
    scaler_input_format: ffmpeg::format::Pixel,
    scaler_input_width: u32,
    scaler_input_height: u32,
    yuv_scaler: Option<ffmpeg::software::scaling::Context>,
    yuv_scaler_input_format: ffmpeg::format::Pixel,
    yuv_scaler_input_width: u32,
    yuv_scaler_input_height: u32,
    stream_index: usize,
    stream_time_base: ffmpeg::Rational,
    /// Stream start PTS in seconds. Containers like MPEG-TS, or MP4s with an edit
    /// list, begin at a non-zero PTS; we subtract it so reported `pts_sec` is
    /// 0-based (timeline-relative) and add it back when seeking. Without this the
    /// export/monitor would request frame `t` but the decoder, reporting raw PTS
    /// `start + t`, would think it had already passed every target and freeze on
    /// the first frame for `start` seconds.
    start_time_sec: f64,
    eof_sent: bool,
    /// Frame-accurate seek target (stream-time seconds). After `seek`, libav lands on
    /// the nearest key frame ≤ target; `next_frame` drops frames with PTS noticeably
    /// less than target until the requested position is reached. `None` = no active seek.
    seek_target: Option<f64>,
    hwaccel: Option<HwAccelContext>,
}

impl FfmpegNextDecoder {
    pub fn open(
        path: &Path,
        max_output_long_edge: Option<u32>,
        hw_mode: HwAccelMode,
        vaapi_device: Option<&str>,
    ) -> Result<Self> {
        init_ffmpeg()?;

        let ictx = ffmpeg::format::input(path).with_context(|| {
            format!(
                "failed to open media through ffmpeg-next: {}",
                path.display()
            )
        })?;
        let input = ictx
            .streams()
            .best(ffmpeg::media::Type::Video)
            .ok_or_else(|| anyhow!("no video stream"))?;
        let stream_index = input.index();
        let stream_time_base = input.time_base();
        let start_time_sec = stream_start_time_sec(&input, stream_time_base);
        let fps = rational_to_f64(input.avg_frame_rate())
            .or_else(|| rational_to_f64(input.rate()))
            .unwrap_or(0.0);
        let duration_sec = input_duration_sec(&ictx, &input);
        let rotation = metadata_rotation(&input);
        let has_audio = ictx
            .streams()
            .any(|stream| stream.parameters().medium() == ffmpeg::media::Type::Audio);
        let parameters = input.parameters();
        let codec = parameters.id().name().to_string();

        let mut context_decoder = ffmpeg::codec::context::Context::from_parameters(parameters)
            .context("failed to create ffmpeg-next decoder context")?;
        let hwaccel = {
            // SAFETY: `context_decoder` owns a live `AVCodecContext*`. We only attach
            // the hw device before opening the codec, which is the libav-required point.
            let codec_ctx = unsafe { context_decoder.as_mut_ptr() };
            init_hwaccel_context(codec_ctx, hw_mode, vaapi_device)
        };
        let decoder = if codec == "vp9" && hwaccel.is_none() {
            if let Some(libvpx) = ffmpeg::decoder::find_by_name("libvpx-vp9") {
                context_decoder
                    .decoder()
                    .open_as(libvpx)
                    .context("failed to open ffmpeg-next libvpx-vp9 video decoder")?
                    .video()
                    .context("failed to open libvpx-vp9 as video decoder")?
            } else {
                context_decoder
                    .decoder()
                    .video()
                    .context("failed to open ffmpeg-next video decoder")?
            }
        } else {
            context_decoder
                .decoder()
                .video()
                .context("failed to open ffmpeg-next video decoder")?
        };

        let (visual_w, visual_h) = visual_dimensions(decoder.width(), decoder.height(), rotation);
        let (out_w, out_h) = compute_output_dims(visual_w, visual_h, max_output_long_edge);
        let (scaled_coded_w, scaled_coded_h) = coded_output_dimensions(out_w, out_h, rotation);
        let scaler_input_format = decoder.format();
        let scaler_input_width = decoder.width();
        let scaler_input_height = decoder.height();

        if hwaccel.is_some() {
            log::info!("[native-media] hwaccel enabled for {}", path.display());
        }

        Ok(Self {
            path: path.to_path_buf(),
            info: MediaInfo {
                duration_sec,
                width: scaled_coded_w,
                height: scaled_coded_h,
                rotation,
                fps,
                codec,
                has_audio,
            },
            ictx,
            decoder,
            scaler: None,
            scaler_input_format,
            scaler_input_width,
            scaler_input_height,
            yuv_scaler: None,
            yuv_scaler_input_format: ffmpeg::format::Pixel::None,
            yuv_scaler_input_width: 0,
            yuv_scaler_input_height: 0,
            stream_index,
            stream_time_base,
            start_time_sec,
            eof_sent: false,
            seek_target: None,
            hwaccel,
        })
    }

    /// FPS used to compute the frame-accurate seek tolerance; guarded against zero/invalid values.
    fn effective_fps(&self) -> f64 {
        if self.info.fps.is_finite() && self.info.fps > 0.0 {
            self.info.fps
        } else {
            30.0
        }
    }

    /// PTS of the decoded frame in 0-based (timeline-relative) seconds. The
    /// container's stream start time is subtracted so a file that begins at a
    /// non-zero PTS still reports its first frame at ~0s.
    fn frame_pts_sec(&self, decoded: &ffmpeg::util::frame::Video) -> f64 {
        decoded
            .timestamp()
            .or_else(|| decoded.pts())
            .map(|pts| pts as f64 * rational_as_f64(self.stream_time_base) - self.start_time_sec)
            .unwrap_or(0.0)
    }

    fn decode_frame(&mut self, decoded: &mut ffmpeg::util::frame::Video) -> Result<VideoFrame> {
        // If the decoder produced a hardware frame, download it to system memory first.
        let sw_frame = if let Some(ref ctx) = self.hwaccel {
            try_transfer_to_cpu(decoded, ctx)?
        } else {
            None
        };
        let decoded = if let Some(ref sw) = sw_frame {
            sw
        } else {
            decoded
        };

        if self.scaler.is_none()
            || decoded.format() != self.scaler_input_format
            || decoded.width() != self.scaler_input_width
            || decoded.height() != self.scaler_input_height
        {
            log::info!(
                "[native-media] scaler input parameters changed ({:?}, {}x{}) -> ({:?}, {}x{}); recreating scaler",
                self.scaler_input_format,
                self.scaler_input_width,
                self.scaler_input_height,
                decoded.format(),
                decoded.width(),
                decoded.height()
            );
            self.scaler = Some(
                ffmpeg::software::scaling::Context::get(
                    decoded.format(),
                    decoded.width(),
                    decoded.height(),
                    ffmpeg::format::Pixel::RGBA,
                    self.info.width,
                    self.info.height,
                    ffmpeg::software::scaling::flag::Flags::BILINEAR,
                )
                .context("failed to recreate ffmpeg-next scaler")?,
            );
            self.scaler_input_format = decoded.format();
            self.scaler_input_width = decoded.width();
            self.scaler_input_height = decoded.height();
        }

        let mut rgba = ffmpeg::util::frame::Video::empty();
        self.scaler
            .as_mut()
            .context("RGBA scaler missing")?
            .run(decoded, &mut rgba)
            .context("failed to scale decoded video frame to RGBA")?;

        let coded_width = rgba.width();
        let coded_height = rgba.height();
        let row_bytes = coded_width as usize * 4;
        let mut pixels = vec![0u8; row_bytes * coded_height as usize];
        for row in 0..coded_height as usize {
            let src_start = row * rgba.stride(0);
            let dst_start = row * row_bytes;
            pixels[dst_start..dst_start + row_bytes]
                .copy_from_slice(&rgba.data(0)[src_start..src_start + row_bytes]);
        }

        let pts_sec = self.frame_pts_sec(decoded);

        Ok(VideoFrame {
            width: coded_width,
            height: coded_height,
            pixels,
            yuv: None,
            pts_sec,
            texture: None,
        })
    }

    fn decode_frame_for_gpu(
        &mut self,
        decoded_frame: &mut ffmpeg::util::frame::Video,
    ) -> Result<VideoFrame> {
        let sw_frame = if let Some(ref ctx) = self.hwaccel {
            try_transfer_to_cpu(decoded_frame, ctx)?
        } else {
            None
        };
        let decoded: &ffmpeg::util::frame::Video = if let Some(ref sw) = sw_frame {
            sw
        } else {
            &*decoded_frame
        };

        if !is_supported_yuv_fast_path(decoded.format()) {
            return self.decode_frame(decoded_frame);
        }

        let color = yuv_color(decoded);
        let (width, height, yuv) =
            if decoded.width() == self.info.width && decoded.height() == self.info.height {
                match decoded.format() {
                    ffmpeg::format::Pixel::NV12 => (
                        decoded.width(),
                        decoded.height(),
                        copy_nv12_frame(decoded, color),
                    ),
                    ffmpeg::format::Pixel::YUV420P | ffmpeg::format::Pixel::YUVJ420P => (
                        decoded.width(),
                        decoded.height(),
                        copy_yuv420p_as_nv12_frame(decoded, color),
                    ),
                    _ => return self.decode_frame(decoded_frame),
                }
            } else {
                let mut scaled = ffmpeg::util::frame::Video::empty();
                if self.yuv_scaler.is_none()
                    || decoded.format() != self.yuv_scaler_input_format
                    || decoded.width() != self.yuv_scaler_input_width
                    || decoded.height() != self.yuv_scaler_input_height
                {
                    self.yuv_scaler = Some(
                        ffmpeg::software::scaling::Context::get(
                            decoded.format(),
                            decoded.width(),
                            decoded.height(),
                            ffmpeg::format::Pixel::NV12,
                            self.info.width,
                            self.info.height,
                            ffmpeg::software::scaling::flag::Flags::BILINEAR,
                        )
                        .context("failed to create ffmpeg-next YUV scaler")?,
                    );
                    self.yuv_scaler_input_format = decoded.format();
                    self.yuv_scaler_input_width = decoded.width();
                    self.yuv_scaler_input_height = decoded.height();
                }
                self.yuv_scaler
                    .as_mut()
                    .context("YUV scaler missing")?
                    .run(decoded, &mut scaled)
                    .context("failed to scale decoded video frame to NV12")?;
                if scaled.format() != ffmpeg::format::Pixel::NV12 {
                    return self.decode_frame(decoded_frame);
                }
                (
                    scaled.width(),
                    scaled.height(),
                    copy_nv12_frame(&scaled, color),
                )
            };

        Ok(VideoFrame {
            width,
            height,
            pixels: Vec::new(),
            yuv: Some(yuv),
            pts_sec: self.frame_pts_sec(decoded),
            texture: None,
        })
    }

    fn next_frame_with_mode(&mut self, prefer_yuv: bool) -> Result<Option<VideoFrame>> {
        loop {
            let mut decoded = ffmpeg::util::frame::Video::empty();
            match self.decoder.receive_frame(&mut decoded) {
                Ok(()) => {
                    // Frame-accurate seek: after jumping to the key frame, skip frames that
                    // lag behind the target by more than half a frame, avoiding wasted CPU on
                    // scaling them to RGBA.
                    if let Some(target) = self.seek_target {
                        let tolerance = 0.5 / self.effective_fps();
                        if self.frame_pts_sec(&decoded) < target - tolerance {
                            continue;
                        }
                        self.seek_target = None;
                    }
                    return if prefer_yuv {
                        self.decode_frame_for_gpu(&mut decoded).map(Some)
                    } else {
                        self.decode_frame(&mut decoded).map(Some)
                    };
                }
                Err(ffmpeg::Error::Other { errno }) if errno == ffmpeg::error::EAGAIN => {}
                Err(ffmpeg::Error::Eof) => {
                    self.seek_target = None;
                    return Ok(None);
                }
                Err(error) => return Err(error).context("failed to receive ffmpeg-next frame"),
            }

            if self.eof_sent {
                return Ok(None);
            }

            let mut packet = None;
            for (stream, next_packet) in self.ictx.packets() {
                if stream.index() == self.stream_index {
                    packet = Some(next_packet);
                    break;
                }
            }

            if let Some(packet) = packet {
                self.decoder
                    .send_packet(&packet)
                    .context("failed to send packet to ffmpeg-next decoder")?;
            } else {
                self.decoder
                    .send_eof()
                    .context("failed to send EOF to ffmpeg-next decoder")?;
                self.eof_sent = true;
            }
        }
    }
}

impl VideoDecoder for FfmpegNextDecoder {
    fn info(&self) -> &MediaInfo {
        &self.info
    }

    fn seek(&mut self, time_sec: f64) -> Result<()> {
        let target = time_sec.max(0.0);
        // `avformat_seek_file` (stream index -1) takes an absolute timestamp in
        // AV_TIME_BASE units, so add the stream start offset back: the caller works
        // in 0-based seconds but the container's frames live at `start + target`.
        let absolute = target + self.start_time_sec;
        let ts = (absolute * 1_000_000.0).round() as i64;
        self.ictx.seek(ts, ..ts).with_context(|| {
            format!(
                "failed to seek ffmpeg-next decoder for {}",
                self.path.display()
            )
        })?;
        self.decoder.flush();
        self.eof_sent = false;
        // libav lands on the nearest key frame ≤ target; remember the target so that
        // `next_frame` decodes and discards intra-GOP frames until the requested position.
        self.seek_target = Some(target);
        Ok(())
    }

    fn next_frame(&mut self) -> Result<Option<VideoFrame>> {
        self.next_frame_with_mode(false)
    }

    fn next_frame_for_gpu(&mut self) -> Result<Option<VideoFrame>> {
        self.next_frame_with_mode(true)
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

/// Real implementation backed by `ffmpeg-next`.
pub struct FfmpegNextDecoderFactory;

impl VideoDecoderFactory for FfmpegNextDecoderFactory {
    fn open(
        &self,
        path: &Path,
        max_output_long_edge: Option<u32>,
        hw_mode: HwAccelMode,
        vaapi_device: Option<&str>,
    ) -> Result<Box<dyn VideoDecoder>> {
        Ok(Box::new(FfmpegNextDecoder::open(
            path,
            max_output_long_edge,
            hw_mode,
            vaapi_device,
        )?))
    }
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

fn init_ffmpeg() -> Result<()> {
    let result = FFMPEG_INIT.get_or_init(|| ffmpeg::init().map_err(|e| format!("{e}")));
    match result {
        Ok(()) => Ok(()),
        Err(e) => Err(anyhow!("failed to initialize ffmpeg-next: {e}")),
    }
}

/// Stream start time in seconds, or 0 when unset. `start_time` is `AV_NOPTS_VALUE`
/// (`i64::MIN`) when the demuxer doesn't expose one; a negative start (some edit
/// lists) is treated as 0 so seeking never targets before the file begins.
fn stream_start_time_sec(stream: &ffmpeg::Stream<'_>, time_base: ffmpeg::Rational) -> f64 {
    let start = stream.start_time();
    if start == i64::MIN || start <= 0 {
        0.0
    } else {
        start as f64 * rational_as_f64(time_base)
    }
}

fn input_duration_sec(ictx: &ffmpeg::format::context::Input, stream: &ffmpeg::Stream<'_>) -> f64 {
    if stream.duration() > 0 {
        stream.duration() as f64 * rational_as_f64(stream.time_base())
    } else if ictx.duration() > 0 {
        ictx.duration() as f64 / 1_000_000.0
    } else {
        0.0
    }
}

fn metadata_rotation(stream: &ffmpeg::Stream<'_>) -> i32 {
    stream
        .metadata()
        .get("rotate")
        .and_then(|rotation| rotation.trim().parse::<f64>().ok())
        .map(|rotation| rotation.round() as i32)
        .or_else(|| {
            stream.side_data().find_map(|item| {
                if item.kind() == ffmpeg::packet::side_data::Type::DisplayMatrix {
                    display_matrix_rotation(item.data())
                } else {
                    None
                }
            })
        })
        .unwrap_or(0)
}

fn display_matrix_rotation(data: &[u8]) -> Option<i32> {
    if data.len() < 9 * std::mem::size_of::<i32>() {
        return None;
    }

    let read_i32 = |index: usize| -> Option<i32> {
        let start = index * std::mem::size_of::<i32>();
        // ffmpeg converts container big-endian values to native endian when
        // building side data, so native-endian read is correct.
        Some(i32::from_ne_bytes(data[start..start + 4].try_into().ok()?))
    };
    let a = read_i32(0)? as f64;
    let b = read_i32(1)? as f64;
    if a == 0.0 && b == 0.0 {
        return None;
    }

    let degrees = (b.atan2(a).to_degrees()).round() as i32;
    Some(((degrees % 360) + 360) % 360)
}

fn rational_to_f64(value: ffmpeg::Rational) -> Option<f64> {
    if value.denominator() == 0 || value.numerator() == 0 {
        None
    } else {
        Some(rational_as_f64(value))
    }
}

fn rational_as_f64(value: ffmpeg::Rational) -> f64 {
    value.numerator() as f64 / value.denominator() as f64
}

fn coded_output_dimensions(visual_w: u32, visual_h: u32, rotation: i32) -> (u32, u32) {
    if is_quarter_turn(rotation as f64) {
        (visual_h, visual_w)
    } else {
        (visual_w, visual_h)
    }
}

/// Computes decode target dimensions while preserving aspect ratio and NEVER upscaling.
fn compute_output_dims(src_w: u32, src_h: u32, max_long_edge: Option<u32>) -> (u32, u32) {
    let Some(max) = max_long_edge else {
        return (src_w, src_h);
    };
    if max == 0 {
        return (src_w, src_h);
    }
    let long = src_w.max(src_h);
    if long <= max {
        return (src_w, src_h);
    }
    let scale = max as f64 / long as f64;
    // Even dimensions — ffmpeg requires even sizes for YUV target formats; we use RGBA,
    // but keeping them even still avoids rare scaler-filter artefacts.
    let w = ((src_w as f64 * scale).round() as u32).max(2) & !1;
    let h = ((src_h as f64 * scale).round() as u32).max(2) & !1;
    (w, h)
}

fn visual_dimensions(width: u32, height: u32, rotation: i32) -> (u32, u32) {
    if is_quarter_turn(rotation as f64) {
        (height, width)
    } else {
        (width, height)
    }
}

fn is_supported_yuv_fast_path(format: ffmpeg::format::Pixel) -> bool {
    matches!(
        format,
        ffmpeg::format::Pixel::NV12
            | ffmpeg::format::Pixel::YUV420P
            | ffmpeg::format::Pixel::YUVJ420P
    )
}

fn yuv_color(frame: &ffmpeg::util::frame::Video) -> YuvColor {
    let matrix = match frame.color_space() {
        ffmpeg::util::color::Space::BT709 => YuvColorMatrix::Bt709,
        ffmpeg::util::color::Space::BT2020NCL | ffmpeg::util::color::Space::BT2020CL => {
            YuvColorMatrix::Bt2020
        }
        ffmpeg::util::color::Space::BT470BG
        | ffmpeg::util::color::Space::SMPTE170M
        | ffmpeg::util::color::Space::FCC
        | ffmpeg::util::color::Space::SMPTE240M => YuvColorMatrix::Bt601,
        _ => {
            if frame.width() >= 1280 || frame.height() > 576 {
                YuvColorMatrix::Bt709
            } else {
                YuvColorMatrix::Bt601
            }
        }
    };
    let range = if frame.color_range() == ffmpeg::util::color::Range::JPEG
        || frame.format() == ffmpeg::format::Pixel::YUVJ420P
    {
        YuvColorRange::Full
    } else {
        YuvColorRange::Limited
    };
    YuvColor { matrix, range }
}

fn copy_nv12_frame(frame: &ffmpeg::util::frame::Video, color: YuvColor) -> YuvFrame {
    let width = frame.width() as usize;
    let height = frame.height() as usize;
    let uv_width = width.div_ceil(2);
    let uv_height = height.div_ceil(2);
    let y = copy_plane_rows(frame.data(0), frame.stride(0), width, height);
    let uv = copy_plane_rows(frame.data(1), frame.stride(1), uv_width * 2, uv_height);
    YuvFrame {
        y,
        uv,
        y_stride: width as u32,
        uv_stride: (uv_width * 2) as u32,
        uv_width: uv_width as u32,
        uv_height: uv_height as u32,
        color,
    }
}

fn copy_yuv420p_as_nv12_frame(frame: &ffmpeg::util::frame::Video, color: YuvColor) -> YuvFrame {
    let width = frame.width() as usize;
    let height = frame.height() as usize;
    let uv_width = width.div_ceil(2);
    let uv_height = height.div_ceil(2);
    let y = copy_plane_rows(frame.data(0), frame.stride(0), width, height);
    let mut uv = vec![0u8; uv_width * 2 * uv_height];
    for row in 0..uv_height {
        let u_start = row * frame.stride(1);
        let v_start = row * frame.stride(2);
        let dst_start = row * uv_width * 2;
        for col in 0..uv_width {
            uv[dst_start + col * 2] = frame.data(1)[u_start + col];
            uv[dst_start + col * 2 + 1] = frame.data(2)[v_start + col];
        }
    }
    YuvFrame {
        y,
        uv,
        y_stride: width as u32,
        uv_stride: (uv_width * 2) as u32,
        uv_width: uv_width as u32,
        uv_height: uv_height as u32,
        color,
    }
}

fn copy_plane_rows(src: &[u8], stride: usize, row_bytes: usize, rows: usize) -> Vec<u8> {
    let mut out = vec![0u8; row_bytes * rows];
    for row in 0..rows {
        let src_start = row * stride;
        let dst_start = row * row_bytes;
        out[dst_start..dst_start + row_bytes]
            .copy_from_slice(&src[src_start..src_start + row_bytes]);
    }
    out
}

pub(crate) fn probe_rotation(video: &serde_json::Value) -> i32 {
    video
        .get("tags")
        .and_then(|tags| tags.get("rotate"))
        .and_then(parse_rotation_value)
        .or_else(|| {
            video
                .get("side_data_list")
                .and_then(|items| items.as_array())
                .and_then(|items| {
                    items
                        .iter()
                        .find_map(|item| item.get("rotation").and_then(parse_rotation_value))
                        .map(|r| -r)
                })
        })
        .unwrap_or(0)
}

pub(crate) fn parse_rotation_value(value: &serde_json::Value) -> Option<i32> {
    if let Some(rotation) = value.as_i64() {
        return Some(rotation as i32);
    }
    value
        .as_str()
        .and_then(|s| s.trim().parse::<f64>().ok())
        .map(|rotation| rotation.round() as i32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::ffmpeg_utils::{format_fps, parse_rational};

    #[test]
    fn compute_output_dims_no_cap_returns_source() {
        assert_eq!(compute_output_dims(1920, 1080, None), (1920, 1080));
        assert_eq!(compute_output_dims(1920, 1080, Some(0)), (1920, 1080));
    }

    #[test]
    fn compute_output_dims_no_upscale() {
        assert_eq!(compute_output_dims(640, 480, Some(4096)), (640, 480));
    }

    #[test]
    fn compute_output_dims_downscale_keeps_aspect_and_even() {
        let (w, h) = compute_output_dims(3840, 2160, Some(1920));
        assert_eq!(w, 1920);
        assert_eq!(h, 1080);
        assert_eq!(w & 1, 0);
        assert_eq!(h & 1, 0);
    }

    #[test]
    fn compute_output_dims_portrait() {
        let (w, h) = compute_output_dims(1080, 1920, Some(960));
        assert_eq!(h, 960);
        assert_eq!(w, 540);
        assert_eq!(w & 1, 0);
    }

    #[test]
    fn visual_dimensions_swaps_quarter_turn_rotation() {
        assert_eq!(visual_dimensions(1920, 1080, 90), (1080, 1920));
        assert_eq!(visual_dimensions(1920, 1080, -90), (1080, 1920));
        assert_eq!(visual_dimensions(1920, 1080, 270), (1080, 1920));
    }

    #[test]
    fn visual_dimensions_keeps_unrotated_and_half_turn_sources() {
        assert_eq!(visual_dimensions(1920, 1080, 0), (1920, 1080));
        assert_eq!(visual_dimensions(1920, 1080, 180), (1920, 1080));
    }

    #[test]
    fn coded_output_dimensions_swap_quarter_turn_rotation() {
        assert_eq!(coded_output_dimensions(1080, 1920, 90), (1920, 1080));
        assert_eq!(coded_output_dimensions(1080, 1920, 270), (1920, 1080));
        assert_eq!(coded_output_dimensions(1920, 1080, 0), (1920, 1080));
    }

    #[test]
    fn yuv_color_uses_frame_metadata() {
        let mut frame = ffmpeg::util::frame::Video::new(ffmpeg::format::Pixel::NV12, 1920, 1080);
        frame.set_color_space(ffmpeg::util::color::Space::BT709);
        frame.set_color_range(ffmpeg::util::color::Range::JPEG);

        assert_eq!(
            yuv_color(&frame),
            YuvColor {
                matrix: YuvColorMatrix::Bt709,
                range: YuvColorRange::Full,
            }
        );
    }

    #[test]
    fn yuv_color_defaults_sd_unspecified_to_bt601_limited() {
        let frame = ffmpeg::util::frame::Video::new(ffmpeg::format::Pixel::NV12, 720, 576);

        assert_eq!(
            yuv_color(&frame),
            YuvColor {
                matrix: YuvColorMatrix::Bt601,
                range: YuvColorRange::Limited,
            }
        );
    }

    #[test]
    fn copy_plane_rows_removes_stride_padding() {
        let src = [1, 2, 3, 9, 4, 5, 6, 9];

        assert_eq!(copy_plane_rows(&src, 4, 3, 2), vec![1, 2, 3, 4, 5, 6]);
    }

    #[test]
    fn copy_yuv420p_as_nv12_interleaves_uv() {
        let mut frame = ffmpeg::util::frame::Video::new(ffmpeg::format::Pixel::YUV420P, 4, 2);
        let y_stride = frame.stride(0);
        let u_stride = frame.stride(1);
        let v_stride = frame.stride(2);
        frame.data_mut(0)[..4].copy_from_slice(&[1, 2, 3, 4]);
        frame.data_mut(0)[y_stride..y_stride + 4].copy_from_slice(&[5, 6, 7, 8]);
        frame.data_mut(1)[..2].copy_from_slice(&[10, 11]);
        frame.data_mut(2)[..2].copy_from_slice(&[20, 21]);

        let yuv = copy_yuv420p_as_nv12_frame(
            &frame,
            YuvColor {
                matrix: YuvColorMatrix::Bt709,
                range: YuvColorRange::Limited,
            },
        );

        assert_eq!(u_stride, frame.stride(1));
        assert_eq!(v_stride, frame.stride(2));
        assert_eq!(yuv.y, vec![1, 2, 3, 4, 5, 6, 7, 8]);
        assert_eq!(yuv.uv, vec![10, 20, 11, 21]);
    }

    #[test]
    fn probe_rotation_reads_tags_rotate() {
        let video = serde_json::json!({
            "tags": {
                "rotate": "90"
            }
        });

        assert_eq!(probe_rotation(&video), 90);
    }

    #[test]
    fn probe_rotation_reads_side_data_rotation() {
        let video = serde_json::json!({
            "side_data_list": [
                {
                    "side_data_type": "Display Matrix",
                    "rotation": -90
                }
            ]
        });

        assert_eq!(probe_rotation(&video), 90);
    }

    #[test]
    fn display_matrix_rotation_reads_quarter_turn() {
        let mut matrix = [0i32; 9];
        matrix[1] = 1 << 16;
        let data: Vec<u8> = matrix
            .iter()
            .flat_map(|value| value.to_ne_bytes())
            .collect();

        assert_eq!(display_matrix_rotation(&data), Some(90));
    }

    #[test]
    fn display_matrix_rotation_reads_identity() {
        let mut matrix = [0i32; 9];
        matrix[0] = 1 << 16;
        matrix[4] = 1 << 16;
        matrix[8] = 1 << 30;
        let data: Vec<u8> = matrix
            .iter()
            .flat_map(|value| value.to_ne_bytes())
            .collect();

        assert_eq!(display_matrix_rotation(&data), Some(0));
    }

    #[test]
    fn compute_output_dims_floors_to_even_and_min_two() {
        let (w, h) = compute_output_dims(3, 5, Some(2));
        assert!(w >= 2 && h >= 2);
        assert_eq!(w & 1, 0);
        assert_eq!(h & 1, 0);
    }

    #[test]
    fn parse_rational_basic() {
        assert_eq!(parse_rational("30000/1001"), Some(30000.0 / 1001.0));
        assert_eq!(parse_rational("25"), Some(25.0));
        assert_eq!(parse_rational("0/0"), None);
        assert_eq!(parse_rational("abc"), None);
    }

    #[test]
    fn format_fps_handles_invalid() {
        assert_eq!(format_fps(0.0), "30.000000");
        assert_eq!(format_fps(f64::NAN), "30.000000");
        assert_eq!(format_fps(23.976), "23.976000");
    }

    #[test]
    fn ffmpeg_next_decoder_reads_fixture_first_frame() {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("test/fixtures/media/sample-1s-720p.mp4");
        let mut decoder = FfmpegNextDecoder::open(&fixture, None, HwAccelMode::None, None).unwrap();
        let frame = decoder.next_frame().unwrap().unwrap();

        assert_eq!(decoder.info().width, 1280);
        assert_eq!(decoder.info().height, 720);
        assert_eq!(frame.width, 1280);
        assert_eq!(frame.height, 720);
        assert_eq!(frame.pixels.len(), 1280 * 720 * 4);
        assert!(frame.pts_sec >= 0.0);
    }

    #[test]
    fn ffmpeg_next_decoder_reads_alpha_webm() {
        init_ffmpeg().unwrap();
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("test/fixtures/media/test_alpha_simple.webm");
        let mut decoder = FfmpegNextDecoder::open(&fixture, None, HwAccelMode::None, None).unwrap();
        let frame = decoder.next_frame().unwrap().unwrap();

        assert_eq!(decoder.info().codec, "vp9");
        assert_eq!(frame.width, 200);
        assert_eq!(frame.height, 200);
        assert_eq!(frame.pixels.len(), 200 * 200 * 4);

        // Verify that the video contains transparency (at least one pixel has alpha < 255)
        let mut has_transparency = false;
        for i in 0..(frame.pixels.len() / 4) {
            let alpha = frame.pixels[i * 4 + 3];
            if alpha < 255 {
                has_transparency = true;
                break;
            }
        }
        assert!(
            has_transparency,
            "Expected some transparent pixels in alpha webm"
        );
    }

    #[test]
    fn ffmpeg_next_decoder_hwaccel_graceful_fallback() {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("test/fixtures/media/sample-1s-720p.mp4");
        // Requesting VAAPI on a build without a driver should still open and
        // decode frames because we fall back to software decode.
        let mut decoder =
            FfmpegNextDecoder::open(&fixture, None, HwAccelMode::Vaapi, None).unwrap();
        let frame = decoder.next_frame().unwrap().unwrap();
        assert_eq!(frame.width, 1280);
        assert_eq!(frame.height, 720);
        assert_eq!(frame.pixels.len(), 1280 * 720 * 4);
    }

    #[test]
    fn ffmpeg_next_decoder_seek_is_frame_accurate() {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("test/fixtures/media/sample-1s-720p.mp4");
        let mut decoder = FfmpegNextDecoder::open(&fixture, None, HwAccelMode::None, None).unwrap();
        let fps = decoder.effective_fps();

        // A seek to the middle of the clip must return the frame AT the requested position
        // (frame-accurate), not the preceding key frame. Tolerance is half a frame.
        let target = 0.5;
        decoder.seek(target).unwrap();
        let frame = decoder
            .next_frame()
            .unwrap()
            .expect("frame after mid-clip seek");
        assert!(
            (frame.pts_sec - target).abs() <= 0.5 / fps + 1e-6,
            "seek not frame-accurate: target={target}, got pts={}",
            frame.pts_sec
        );
    }

    #[test]
    fn ffmpeg_next_decoder_factory_opens_fixture_via_trait() {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("test/fixtures/media/sample-1s-720p.mp4");
        let factory = FfmpegNextDecoderFactory;
        let mut decoder = factory
            .open(&fixture, None, HwAccelMode::None, None)
            .unwrap();
        let frame = decoder.next_frame().unwrap().unwrap();

        assert_eq!(decoder.info().width, 1280);
        assert_eq!(decoder.info().height, 720);
        assert_eq!(frame.width, 1280);
        assert_eq!(frame.height, 720);
    }

    #[test]
    fn test_shared_texture_drop_recycles_to_pool() {
        let instance = wgpu::Instance::default();
        let adapter = match pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions::default())) {
            Ok(adapter) => adapter,
            Err(_) => return,
        };
        let (device, _queue) = match pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default())) {
            Ok(res) => res,
            Err(_) => return,
        };

        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("test-recycle"),
            size: wgpu::Extent3d {
                width: 128,
                height: 128,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });

        let pool = Arc::new(parking_lot::Mutex::new(std::collections::HashMap::new()));
        
        {
            let shared = SharedTexture::new_owned(texture, pool.clone());
            assert_eq!(shared.size().width, 128);
            assert_eq!(shared.size().height, 128);
            assert!(pool.lock().is_empty());
        }

        let p = pool.lock();
        let textures = p.get(&(128, 128)).expect("expected slot for 128x128");
        assert_eq!(textures.len(), 1);
    }
}
