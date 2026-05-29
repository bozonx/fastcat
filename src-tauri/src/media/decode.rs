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
}

impl FfmpegDecoder {
    pub fn open(path: &Path) -> Result<Self> {
        let info = probe(path)?;
        let frame_bytes = (info.width as usize)
            .checked_mul(info.height as usize)
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
        };
        dec.spawn(0.0)?;
        Ok(dec)
    }

    fn spawn(&mut self, time_sec: f64) -> Result<()> {
        self.kill();
        let mut cmd = Command::new("ffmpeg");
        cmd.arg("-nostdin")
            .arg("-loglevel")
            .arg("error")
            // -ss перед -i = быстрый seek по ключевым кадрам (минус точность, плюс скорость).
            .arg("-ss")
            .arg(format!("{time_sec}"))
            .arg("-i")
            .arg(&self.path)
            .arg("-f")
            .arg("rawvideo")
            .arg("-pix_fmt")
            .arg("rgba")
            // На случай не-квадратных пикселей форсим масштаб к декларированным размерам.
            .arg("-vf")
            .arg(format!("scale={}:{}", self.info.width, self.info.height))
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
        self.spawn(time_sec.max(0.0))
    }

    fn next_frame(&mut self) -> Result<Option<VideoFrame>> {
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
        let fps = if self.info.fps > 0.0 { self.info.fps } else { 30.0 };
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

pub fn open(path: &Path) -> Result<Box<dyn VideoDecoder>> {
    Ok(Box::new(FfmpegDecoder::open(path)?))
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
    let json: serde_json::Value = serde_json::from_slice(&output.stdout)
        .context("ffprobe returned non-JSON output")?;
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
        fps,
        codec,
        has_audio,
    })
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
