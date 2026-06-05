//! Видео-декодер для нативного monitor/preview.
//!
//! Основной backend — `ffmpeg-next` поверх libav*: он не респаунит внешний процесс на seek
//! и даёт прямой доступ к PTS/timebase. Системный `ffmpeg` CLI остаётся fallback'ом только
//! для preview-декода; экспорт, прокси и конвертация по-прежнему используют CLI отдельно.
//!
//! Контракт: наружу всегда отдаём плотный RGBA8 (`width * height * 4`) и PTS в секундах.

use anyhow::{anyhow, Context, Result};
use ffmpeg_next as ffmpeg;
use once_cell::sync::OnceCell;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

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

pub struct VideoFrame {
    pub width: u32,
    pub height: u32,
    /// RGBA8, плотная упаковка (`width * height * 4`).
    pub pixels: Vec<u8>,
    pub pts_sec: f64,
    pub texture: Option<wgpu::Texture>,
    #[allow(dead_code)]
    pub texture_pool: Option<Arc<Mutex<HashMap<(u32, u32), Vec<wgpu::Texture>>>>>,
}

impl Drop for VideoFrame {
    fn drop(&mut self) {
        if let (Some(tex), Some(pool)) = (self.texture.take(), self.texture_pool.take()) {
            if let Ok(mut p) = pool.lock() {
                p.entry((tex.size().width, tex.size().height)).or_default().push(tex);
            }
        }
    }
}

pub trait VideoDecoder: Send {
    fn info(&self) -> &MediaInfo;
    fn seek(&mut self, time_sec: f64) -> Result<()>;
    fn next_frame(&mut self) -> Result<Option<VideoFrame>>;
}

static FFMPEG_INIT: OnceCell<()> = OnceCell::new();

pub struct FfmpegNextDecoder {
    path: PathBuf,
    info: MediaInfo,
    ictx: ffmpeg::format::context::Input,
    decoder: ffmpeg::decoder::Video,
    scaler: ffmpeg::software::scaling::Context,
    scaler_input_format: ffmpeg::format::Pixel,
    scaler_input_width: u32,
    scaler_input_height: u32,
    stream_index: usize,
    stream_time_base: ffmpeg::Rational,
    eof_sent: bool,
    /// Цель frame-accurate seek (секунды stream-time). После `seek` libav становится
    /// на ближайший ключевой кадр ≤ target; `next_frame` отбрасывает кадры с PTS заметно
    /// меньше target, пока не дойдёт до запрошенного. `None` — нет активного seek.
    seek_target: Option<f64>,
}

// SAFETY: FfmpegNextDecoder owns all libav* objects (AVCodecContext, SwsContext,
// AVFormatContext). These pointers are never shared across threads; the decoder
// is created on one thread and then moved as a whole into a single decode thread.
// We never access decoder state concurrently or from multiple threads.
unsafe impl Send for FfmpegNextDecoder {}

impl FfmpegNextDecoder {
    pub fn open(path: &Path, max_output_long_edge: Option<u32>) -> Result<Self> {
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

        let context_decoder = ffmpeg::codec::context::Context::from_parameters(parameters)
            .context("failed to create ffmpeg-next decoder context")?;
        let decoder = if codec == "vp9" {
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
        let scaler = ffmpeg::software::scaling::Context::get(
            decoder.format(),
            decoder.width(),
            decoder.height(),
            ffmpeg::format::Pixel::RGBA,
            scaled_coded_w,
            scaled_coded_h,
            ffmpeg::software::scaling::flag::Flags::BILINEAR,
        )
        .context("failed to create ffmpeg-next scaler")?;

        let scaler_input_format = decoder.format();
        let scaler_input_width = decoder.width();
        let scaler_input_height = decoder.height();

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
            scaler,
            scaler_input_format,
            scaler_input_width,
            scaler_input_height,
            stream_index,
            stream_time_base,
            eof_sent: false,
            seek_target: None,
        })
    }

    /// FPS для расчёта допуска frame-accurate seek; защищён от нулевого/невалидного значения.
    fn effective_fps(&self) -> f64 {
        if self.info.fps.is_finite() && self.info.fps > 0.0 {
            self.info.fps
        } else {
            30.0
        }
    }

    /// PTS декодированного кадра в секундах stream-time.
    fn frame_pts_sec(&self, decoded: &ffmpeg::util::frame::Video) -> f64 {
        decoded
            .timestamp()
            .or_else(|| decoded.pts())
            .map(|pts| pts as f64 * rational_as_f64(self.stream_time_base))
            .unwrap_or(0.0)
    }

    fn decode_frame(&mut self, decoded: &ffmpeg::util::frame::Video) -> Result<VideoFrame> {
        if decoded.format() != self.scaler_input_format
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
            self.scaler = ffmpeg::software::scaling::Context::get(
                decoded.format(),
                decoded.width(),
                decoded.height(),
                ffmpeg::format::Pixel::RGBA,
                self.info.width,
                self.info.height,
                ffmpeg::software::scaling::flag::Flags::BILINEAR,
            )
            .context("failed to recreate ffmpeg-next scaler")?;
            self.scaler_input_format = decoded.format();
            self.scaler_input_width = decoded.width();
            self.scaler_input_height = decoded.height();
        }

        let mut rgba = ffmpeg::util::frame::Video::empty();
        self.scaler
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
            pts_sec,
            texture: None,
            texture_pool: None,
        })
    }
}

impl VideoDecoder for FfmpegNextDecoder {
    fn info(&self) -> &MediaInfo {
        &self.info
    }

    fn seek(&mut self, time_sec: f64) -> Result<()> {
        let target = time_sec.max(0.0);
        let ts = (target * 1_000_000.0).round() as i64;
        self.ictx.seek(ts, ..ts).with_context(|| {
            format!(
                "failed to seek ffmpeg-next decoder for {}",
                self.path.display()
            )
        })?;
        self.decoder.flush();
        self.eof_sent = false;
        // libav становится на ключевой кадр ≤ target; запоминаем цель, чтобы `next_frame`
        // декодировал и отбросил кадры внутри GOP вплоть до запрошенной позиции.
        self.seek_target = Some(target);
        Ok(())
    }

    fn next_frame(&mut self) -> Result<Option<VideoFrame>> {
        loop {
            let mut decoded = ffmpeg::util::frame::Video::empty();
            match self.decoder.receive_frame(&mut decoded) {
                Ok(()) => {
                    // Frame-accurate seek: после прыжка на ключевой кадр пропускаем кадры,
                    // отстающие от цели больше чем на полкадра, не тратя CPU на их scale-в-RGBA.
                    if let Some(target) = self.seek_target {
                        let tolerance = 0.5 / self.effective_fps();
                        if self.frame_pts_sec(&decoded) < target - tolerance {
                            continue;
                        }
                        self.seek_target = None;
                    }
                    return self.decode_frame(&decoded).map(Some);
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

/// Открывает видео-декодер для preview/thumbnail/export.
///
/// Единственный backend — `ffmpeg-next` поверх libav*: прямой доступ к PTS/timebase,
/// frame-accurate seek без респауна процесса. CLI-fallback намеренно убран — он давал
/// расходящееся поведение (другой seek/rotation/PTS) и молча маскировал проблемы
/// ffmpeg-next. Там, где нужен именно CLI (HW-энкод экспорта, одиночная extract-команда),
/// он вызывается напрямую, а не как скрытая подмена этого декодера.
pub fn open(path: &Path, max_output_long_edge: Option<u32>) -> Result<Box<dyn VideoDecoder>> {
    Ok(Box::new(FfmpegNextDecoder::open(
        path,
        max_output_long_edge,
    )?))
}

fn init_ffmpeg() -> Result<()> {
    FFMPEG_INIT
        .get_or_try_init(|| ffmpeg::init().context("failed to initialize ffmpeg-next"))
        .map(|_| ())
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
    if is_quarter_turn(rotation) {
        (visual_h, visual_w)
    } else {
        (visual_w, visual_h)
    }
}

/// Считает target dims декода, сохраняя aspect и НЕ увеличивая разрешение.
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
    // Кратность 2 — ffmpeg требует чётных размеров для yuv-целевых форматов; нам RGBA,
    // но всё равно проще держать чётно, чтобы избежать редких артефактов scale-фильтра.
    let w = ((src_w as f64 * scale).round() as u32).max(2) & !1;
    let h = ((src_h as f64 * scale).round() as u32).max(2) & !1;
    (w, h)
}

fn visual_dimensions(width: u32, height: u32, rotation: i32) -> (u32, u32) {
    if is_quarter_turn(rotation) {
        (height, width)
    } else {
        (width, height)
    }
}

fn is_quarter_turn(rotation: i32) -> bool {
    let normalized = rotation.rem_euclid(360).abs();
    normalized == 90 || normalized == 270
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
        let mut decoder = FfmpegNextDecoder::open(&fixture, None).unwrap();
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
        let _ = init_ffmpeg().unwrap();
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("test/fixtures/media/test_alpha_simple.webm");
        let mut decoder = FfmpegNextDecoder::open(&fixture, None).unwrap();
        let frame = decoder.next_frame().unwrap().unwrap();

        assert_eq!(decoder.info().codec, "vp9");
        assert_eq!(frame.width, 200);
        assert_eq!(frame.height, 200);
        assert_eq!(frame.pixels.len(), 200 * 200 * 4);

        // Проверяем, что в видео есть прозрачность (хотя бы один пиксель имеет альфа < 255)
        let mut has_transparency = false;
        for i in 0..(frame.pixels.len() / 4) {
            let alpha = frame.pixels[i * 4 + 3];
            if alpha < 255 {
                has_transparency = true;
                break;
            }
        }
        assert!(has_transparency, "Expected some transparent pixels in alpha webm");
    }

    #[test]
    fn ffmpeg_next_decoder_seek_is_frame_accurate() {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("test/fixtures/media/sample-1s-720p.mp4");
        let mut decoder = FfmpegNextDecoder::open(&fixture, None).unwrap();
        let fps = decoder.effective_fps();

        // Seek в середину клипа должен вернуть кадр НА запрошенной позиции (frame-accurate),
        // а не предшествующий ключевой кадр. Допуск — полкадра.
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
}




