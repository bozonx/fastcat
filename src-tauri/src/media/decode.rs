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
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdout, Command, Stdio};
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
}

// The decoder is created on the caller thread and then moved as a whole into one decode thread.
// We never share libav/scaler pointers across threads after that move.
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
        })
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

        let pts_sec = decoded
            .timestamp()
            .or_else(|| decoded.pts())
            .map(|pts| pts as f64 * rational_as_f64(self.stream_time_base))
            .unwrap_or(0.0);

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
        let ts = (time_sec.max(0.0) * 1_000_000.0).round() as i64;
        self.ictx.seek(ts, ..ts).with_context(|| {
            format!(
                "failed to seek ffmpeg-next decoder for {}",
                self.path.display()
            )
        })?;
        self.decoder.flush();
        self.eof_sent = false;
        Ok(())
    }

    fn next_frame(&mut self) -> Result<Option<VideoFrame>> {
        loop {
            let mut decoded = ffmpeg::util::frame::Video::empty();
            match self.decoder.receive_frame(&mut decoded) {
                Ok(()) => return self.decode_frame(&decoded).map(Some),
                Err(ffmpeg::Error::Other { errno }) if errno == ffmpeg::error::EAGAIN => {}
                Err(ffmpeg::Error::Eof) => return Ok(None),
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

pub struct FfmpegCliDecoder {
    path: PathBuf,
    info: MediaInfo,
    frame_bytes: usize,
    child: Option<Child>,
    stdout: Option<ChildStdout>,
    /// Время в треке, с которого запущен текущий subprocess.
    start_time: f64,
    /// Индекс кадра в рамках текущего subprocess.
    frame_index: u64,
    cached_frame: Option<VideoFrame>,
    hw_settings: crate::FfmpegHardwareSettings,
}

impl FfmpegCliDecoder {
    /// `max_output_long_edge` — максимальная длинная сторона декодированного кадра в пикселях.
    /// Если `Some(n)` и source-длинная сторона > n, ffmpeg downscale'нет (`-vf scale=...`),
    /// что радикально снижает CPU/GPU-нагрузку для 4K/HEVC превью. Аспект сохраняется.
    /// При `None` или если source меньше — декод в source-разрешении.
    pub fn open(path: &Path, max_output_long_edge: Option<u32>, hw_settings: crate::FfmpegHardwareSettings) -> Result<Self> {
        let mut info = probe(path, &hw_settings.ffprobe_path)?;

        // FFmpeg autorotate applies display-matrix rotation before our filter graph. For phone
        // videos stored as landscape-coded frames with a 90/270 degree display rotation, scaling
        // back to coded width/height would squash the already-rotated portrait frame.
        let (visual_w, visual_h) = visual_dimensions(info.width, info.height, info.rotation);
        let (out_w, out_h) = compute_output_dims(visual_w, visual_h, max_output_long_edge);
        info.width = out_w;
        info.height = out_h;
        info.rotation = 0;

        let frame_bytes = (out_w as usize)
            .checked_mul(out_h as usize)
            .and_then(|n| n.checked_mul(4))
            .ok_or_else(|| anyhow!("invalid frame size"))?;
        let mut dec = Self {
            path: path.to_path_buf(),
            info,
            frame_bytes,
            child: None,
            stdout: None,
            start_time: 0.0,
            frame_index: 0,
            cached_frame: None,
            hw_settings,
        };
        dec.spawn(0.0)?;
        Ok(dec)
    }

    fn spawn(&mut self, time_sec: f64) -> Result<()> {
        self.kill();
        self.cached_frame = None;
        let time_sec = time_sec.max(0.0);
        let mut cmd = Command::new(&self.hw_settings.ffmpeg_path);
        cmd.arg("-nostdin").arg("-loglevel").arg("error");

        let hw_accel = &self.hw_settings.hardware_acceleration_mode;
        if hw_accel != "none" {
            let mode = if hw_accel == "auto" {
                if std::path::Path::new(&self.hw_settings.vaapi_device).exists() {
                    "vaapi"
                } else {
                    "none"
                }
            } else {
                hw_accel.as_str()
            };

            match mode {
                "vaapi" => {
                    cmd.arg("-hwaccel").arg("vaapi")
                       .arg("-hwaccel_device").arg(&self.hw_settings.vaapi_device);
                }
                "nvdec" => {
                    cmd.arg("-hwaccel").arg("nvdec");
                }
                _ => {}
            }
        }

        // Двухэтапный seek для frame-accurate позиционирования:
        //   1) `-ss <pre>` ДО `-i` — быстрый прыжок к ближайшему keyframe (pre = t − 0.5s);
        //   2) `-ss <post>` ПОСЛЕ `-i` — точный досдвиг оставшихся ≤0.5s внутри GOP.
        // При time_sec ≤ 0.5 первый этап пропускается (pre=0, post=time_sec).
        // PTS считаем как start_time + frame_index / fps (cfr-вывод через -vf fps=...).
        let pre = if time_sec > 0.5 { time_sec - 0.5 } else { 0.0 };
        let post = time_sec - pre;
        if pre > 0.0 {
            cmd.arg("-ss").arg(format!("{pre}"));
        }
        if self.info.codec == "vp9" {
            cmd.arg("-c:v").arg("libvpx-vp9");
        }
        cmd.arg("-i").arg(&self.path);
        if post > 0.0 || pre > 0.0 {
            cmd.arg("-ss").arg(format!("{post}"));
        }

        cmd.arg("-f")
            .arg("rawvideo")
            .arg("-pix_fmt")
            .arg("rgba")
            // На случай не-квадратных пикселей форсим масштаб к декларированным размерам
            // и cfr-таймбейс, чтобы frame_index/fps давал корректные PTS.
            .arg("-vf")
            .arg(format!(
                "scale={}:{},fps={}",
                self.info.width,
                self.info.height,
                fmt_fps(self.info.fps)
            ))
            .arg("-an")
            .arg("-")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = cmd
            .spawn()
            .context("failed to spawn ffmpeg (is it installed and on PATH?)")?;
        self.stdout = child.stdout.take();
        self.child = Some(child);
        self.start_time = time_sec;
        self.frame_index = 0;
        Ok(())
    }

    fn kill(&mut self) {
        self.stdout = None;
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for FfmpegCliDecoder {
    fn drop(&mut self) {
        self.kill();
    }
}

impl VideoDecoder for FfmpegCliDecoder {
    fn info(&self) -> &MediaInfo {
        &self.info
    }

    fn seek(&mut self, time_sec: f64) -> Result<()> {
        let fps = if self.info.fps > 0.0 {
            self.info.fps
        } else {
            30.0
        };
        let current_pts = self.start_time + self.frame_index as f64 / fps;

        // Если мы хотим переместиться вперед на небольшое расстояние (до 1.0 секунды),
        // читаем кадры последовательно вместо перезапуска процесса.
        if time_sec >= current_pts && time_sec - current_pts < 1.0 {
            let mut last_frame = None;
            while let Some(frame) = self.next_frame()? {
                let pts = frame.pts_sec;
                last_frame = Some(frame);
                if pts >= time_sec {
                    break;
                }
            }
            self.cached_frame = last_frame;
            return Ok(());
        }

        self.cached_frame = None;
        self.spawn(time_sec.max(0.0))
    }

    fn next_frame(&mut self) -> Result<Option<VideoFrame>> {
        if let Some(frame) = self.cached_frame.take() {
            return Ok(Some(frame));
        }

        let stdout = match self.stdout.as_mut() {
            Some(s) => s,
            None => return Ok(None),
        };
        let mut pixels = vec![0u8; self.frame_bytes];
        match stdout.read_exact(&mut pixels) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
            Err(e) => return Err(e.into()),
        }
        let fps = if self.info.fps > 0.0 {
            self.info.fps
        } else {
            30.0
        };
        // start_time = первый «полезный» кадр выходного потока (после двухэтапного seek),
        // выход cfr → PTS=start_time + i/fps корректный.
        let pts_sec = self.start_time + self.frame_index as f64 / fps;
        self.frame_index += 1;
        Ok(Some(VideoFrame {
            width: self.info.width,
            height: self.info.height,
            pixels,
            pts_sec,
            texture: None,
            texture_pool: None,
        }))
    }
}

fn fmt_fps(fps: f64) -> String {
    let f = if fps > 0.0 && fps.is_finite() {
        fps
    } else {
        30.0
    };
    // 6 знаков достаточно для 23.976024 и подобных; ffmpeg парсит как float.
    format!("{:.6}", f)
}

pub fn open(
    path: &Path,
    max_output_long_edge: Option<u32>,
    hw_settings: crate::FfmpegHardwareSettings,
) -> Result<Box<dyn VideoDecoder>> {
    match FfmpegNextDecoder::open(path, max_output_long_edge) {
        Ok(decoder) => Ok(Box::new(decoder)),
        Err(error) => {
            log::warn!(
                "[native-media] ffmpeg-next decoder failed for {}; falling back to ffmpeg CLI: {error:#}",
                path.display()
            );
            Ok(Box::new(FfmpegCliDecoder::open(
                path,
                max_output_long_edge,
                hw_settings,
            )?))
        }
    }
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

fn probe(path: &Path, ffprobe_path: &str) -> Result<MediaInfo> {
    let output = Command::new(ffprobe_path)
        .arg("-v")
        .arg("error")
        .arg("-print_format")
        .arg("json")
        .arg("-show_streams")
        .arg("-show_format")
        .arg(path)
        .output()
        .context("failed to run ffprobe (is it installed?)")?;
    if !output.status.success() {
        return Err(anyhow!(
            "ffprobe failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let json: serde_json::Value =
        serde_json::from_slice(&output.stdout).context("ffprobe returned non-JSON output")?;
    let streams = json
        .get("streams")
        .and_then(|s| s.as_array())
        .ok_or_else(|| anyhow!("ffprobe: no streams"))?;
    let video = streams
        .iter()
        .find(|s| s.get("codec_type").and_then(|v| v.as_str()) == Some("video"))
        .ok_or_else(|| anyhow!("no video stream"))?;
    let width = video
        .get("width")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| anyhow!("missing video width"))? as u32;
    let height = video
        .get("height")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| anyhow!("missing video height"))? as u32;
    let codec = video
        .get("codec_name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let fps = video
        .get("avg_frame_rate")
        .and_then(|v| v.as_str())
        .and_then(parse_rational)
        .or_else(|| {
            video
                .get("r_frame_rate")
                .and_then(|v| v.as_str())
                .and_then(parse_rational)
        })
        .unwrap_or(0.0);
    let duration_sec = json
        .get("format")
        .and_then(|f| f.get("duration"))
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);
    let has_audio = streams
        .iter()
        .any(|s| s.get("codec_type").and_then(|v| v.as_str()) == Some("audio"));

    Ok(MediaInfo {
        duration_sec,
        width,
        height,
        rotation: probe_rotation(video),
        fps,
        codec,
        has_audio,
    })
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

fn parse_rational(s: &str) -> Option<f64> {
    let mut parts = s.split('/');
    let num: f64 = parts.next()?.parse().ok()?;
    let den: f64 = parts.next().and_then(|d| d.parse().ok()).unwrap_or(1.0);
    if den == 0.0 {
        return None;
    }
    Some(num / den)
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn fmt_fps_handles_invalid() {
        assert_eq!(fmt_fps(0.0), "30.000000");
        assert_eq!(fmt_fps(f64::NAN), "30.000000");
        assert_eq!(fmt_fps(23.976), "23.976000");
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
    fn ffmpeg_cli_decoder_reads_alpha_webm() {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("test/fixtures/media/test_alpha_simple.webm");
        let mut decoder = FfmpegCliDecoder::open(
            &fixture,
            None,
            crate::FfmpegHardwareSettings::default(),
        )
        .unwrap();
        let frame = decoder.next_frame().unwrap().unwrap();

        assert_eq!(decoder.info().codec, "vp9");
        assert_eq!(frame.width, 200);
        assert_eq!(frame.height, 200);
        assert_eq!(frame.pixels.len(), 200 * 200 * 4);

        let mut has_transparency = false;
        for i in 0..(frame.pixels.len() / 4) {
            let alpha = frame.pixels[i * 4 + 3];
            if alpha < 255 {
                has_transparency = true;
                break;
            }
        }
        assert!(has_transparency, "Expected some transparent pixels in alpha webm (CLI)");
    }
}




