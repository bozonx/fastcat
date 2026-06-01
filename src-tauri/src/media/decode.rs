//! Видео-декодер через системный `ffmpeg` CLI.
//!
//! Почему не ffmpeg-next: на системе обычно стоит ffmpeg 8.x, а биндинги ffmpeg-next/ffmpeg-sys-next
//! 7.x ещё ссылаются на удалённый `avfft.h`. Городить локальную сборку libav под старый ABI
//! ради минимального плеера — оверкилл. CLI-подход даёт нам raw rgba поток с минимальным кодом.
//!
//! Контракт:
//!   - `ffprobe` отдаёт метаданные (размер, fps, длительность, codec).
//!   - `ffmpeg -i <path> -ss <t> -f rawvideo -pix_fmt rgba -` пишет в stdout кадры подряд:
//!     `width * height * 4` байт на каждый. PTS вычисляем как `start_time + frame_index / fps`.

use anyhow::{anyhow, Context, Result};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdout, Command, Stdio};

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
}

pub trait VideoDecoder: Send {
    fn info(&self) -> &MediaInfo;
    fn seek(&mut self, time_sec: f64) -> Result<()>;
    fn next_frame(&mut self) -> Result<Option<VideoFrame>>;
}

pub struct FfmpegDecoder {
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
}

impl FfmpegDecoder {
    /// `max_output_long_edge` — максимальная длинная сторона декодированного кадра в пикселях.
    /// Если `Some(n)` и source-длинная сторона > n, ffmpeg downscale'нет (`-vf scale=...`),
    /// что радикально снижает CPU/GPU-нагрузку для 4K/HEVC превью. Аспект сохраняется.
    /// При `None` или если source меньше — декод в source-разрешении.
    pub fn open(path: &Path, max_output_long_edge: Option<u32>) -> Result<Self> {
        let mut info = probe(path)?;

        // FFmpeg autorotate applies display-matrix rotation before our filter graph. For phone
        // videos stored as landscape-coded frames with a 90/270 degree display rotation, scaling
        // back to coded width/height would squash the already-rotated portrait frame.
        let (visual_w, visual_h) = visual_dimensions(info.width, info.height, info.rotation);
        let (out_w, out_h) = compute_output_dims(visual_w, visual_h, max_output_long_edge);
        info.width = out_w;
        info.height = out_h;

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
        };
        dec.spawn(0.0)?;
        Ok(dec)
    }

    fn spawn(&mut self, time_sec: f64) -> Result<()> {
        self.kill();
        self.cached_frame = None;
        let time_sec = time_sec.max(0.0);
        let mut cmd = Command::new("ffmpeg");
        cmd.arg("-nostdin").arg("-loglevel").arg("error");

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

impl Drop for FfmpegDecoder {
    fn drop(&mut self) {
        self.kill();
    }
}

impl VideoDecoder for FfmpegDecoder {
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

pub fn open(path: &Path, max_output_long_edge: Option<u32>) -> Result<Box<dyn VideoDecoder>> {
    Ok(Box::new(FfmpegDecoder::open(path, max_output_long_edge)?))
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

fn probe(path: &Path) -> Result<MediaInfo> {
    let output = Command::new("ffprobe")
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

fn probe_rotation(video: &serde_json::Value) -> i32 {
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
                })
        })
        .unwrap_or(0)
}

fn parse_rotation_value(value: &serde_json::Value) -> Option<i32> {
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

        assert_eq!(probe_rotation(&video), -90);
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
}
