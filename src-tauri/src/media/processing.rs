use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, SystemTime};

use parking_lot::Mutex;

use crate::media::decode::probe_rotation;
use crate::media::decode_gate::decoder_load_gate;
use crate::media::ffmpeg_args::*;
use crate::media::ffmpeg_utils::*;
use crate::media::types::HwAccelMode;
use crate::media::timeline_render::encode_rgba_as_webp;

const DEFAULT_VIDEO_WIDTH: u32 = 1920;
const DEFAULT_VIDEO_HEIGHT: u32 = 1080;
const DEFAULT_VIDEO_FPS: f64 = 30.0;
const DEFAULT_VIDEO_BITRATE_BPS: u32 = 5_000_000;
const DEFAULT_WEBP_QUALITY: f32 = 75.0;
const SEEK_THRESHOLD_SEC: f64 = 5.0;

#[derive(Clone, Default)]
pub struct NativeMediaTasks {
    children: Arc<Mutex<HashMap<String, Arc<Mutex<Child>>>>>,
    /// Task ids that were explicitly cancelled, so a non-zero exit can be reported
    /// as a cancellation rather than an opaque ffmpeg failure.
    cancelled: Arc<Mutex<HashSet<String>>>,
}

impl NativeMediaTasks {
    pub(crate) fn insert(&self, task_id: &str, child: Child) -> Arc<Mutex<Child>> {
        let child = Arc::new(Mutex::new(child));
        self.cancelled.lock().remove(task_id);
        // Reusing a task id while a previous process is still registered would
        // orphan that process (cancel only ever sees the latest). Kill the old one.
        let previous = self
            .children
            .lock()
            .insert(task_id.to_string(), child.clone());
        if let Some(previous) = previous {
            let mut guard = previous.lock();
            let _ = guard.kill();
            let _ = guard.wait();
        }
        child
    }

    pub(crate) fn remove(&self, task_id: &str) {
        self.children.lock().remove(task_id);
        self.cancelled.lock().remove(task_id);
    }

    pub(crate) fn was_cancelled(&self, task_id: &str) -> bool {
        self.cancelled.lock().contains(task_id)
    }

    pub fn cancel(&self, task_id: &str) -> bool {
        self.cancelled.lock().insert(task_id.to_string());
        let child = self.children.lock().get(task_id).cloned();
        let Some(child) = child else {
            return false;
        };
        let mut child = child.lock();
        let _ = child.kill();
        let _ = child.wait();
        true
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMediaMetadata {
    pub duration: f64,
    pub container: String,
    pub video: Option<NativeVideoMetadata>,
    pub audio: Option<NativeAudioMetadata>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeVideoMetadata {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub codec: String,
    pub bitrate: Option<u64>,
    pub rotation: i32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioMetadata {
    pub codec: String,
    pub bitrate: Option<u64>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeProxyOptions {
    pub max_pixels: u32,
    pub video_bitrate_bps: u32,
    pub audio_bitrate_bps: u32,
    pub video_codec: String,
    pub copy_opus_audio: bool,

    // Hardware acceleration options
    #[serde(default)]
    pub ffmpeg_path: Option<String>,
    #[serde(default)]
    pub ffprobe_path: Option<String>,
    #[serde(default)]
    pub hardware_acceleration_mode: Option<String>,
    #[serde(default)]
    pub vaapi_device: Option<String>,
    #[serde(default)]
    pub enable_hardware_encoding: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeConvertOptions {
    pub kind: String,
    pub format: String,
    pub video_codec: Option<String>,
    pub video_bitrate_bps: Option<u32>,
    pub audio_codec: Option<String>,
    pub audio_bitrate_bps: Option<u32>,
    pub audio: Option<bool>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
    pub audio_channels: Option<u32>,
    pub audio_sample_rate: Option<u32>,
    pub audio_reverse: Option<bool>,

    // Hardware acceleration options
    #[serde(default)]
    pub ffmpeg_path: Option<String>,
    #[serde(default)]
    pub ffprobe_path: Option<String>,
    #[serde(default)]
    pub hardware_acceleration_mode: Option<String>,
    #[serde(default)]
    pub vaapi_device: Option<String>,
    #[serde(default)]
    pub enable_hardware_encoding: Option<bool>,
}

pub fn probe_media(path: &Path, ffprobe_path: &str) -> Result<NativeMediaMetadata> {
    verify_ffmpeg_binary(ffprobe_path).context("ffprobe binary check failed")?;
    log::debug!("[probe_media] running ffprobe on {}", path.display());
    let output = Command::new(ffprobe_path)
        .arg("-v")
        .arg("error")
        .arg("-print_format")
        .arg("json")
        .arg("-show_streams")
        .arg("-show_format")
        .arg(path)
        .output()
        .context("failed to run ffprobe")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::warn!(
            "[probe_media] ffprobe failed for {}: {}",
            path.display(),
            stderr
        );
        return Err(anyhow!("ffprobe failed: {}", stderr));
    }

    let json: Value =
        serde_json::from_slice(&output.stdout).context("ffprobe returned invalid JSON")?;
    log::debug!(
        "[probe_media] ffprobe output keys: {:?}",
        json.as_object().map(|o| o.keys().collect::<Vec<_>>())
    );
    metadata_from_ffprobe(json)
}

fn metadata_from_ffprobe(json: Value) -> Result<NativeMediaMetadata> {
    let streams = json
        .get("streams")
        .and_then(|s| s.as_array())
        .ok_or_else(|| anyhow!("ffprobe: no streams"))?;

    let format = json.get("format").and_then(|f| f.as_object());

    let duration = format
        .and_then(|f| f.get("duration"))
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);

    let container = format
        .and_then(|f| f.get("format_name"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .split(',')
        .next()
        .unwrap_or("")
        .to_string();

    let video = streams
        .iter()
        .find(|s| s.get("codec_type").and_then(|v| v.as_str()) == Some("video"))
        .map(|stream| NativeVideoMetadata {
            width: stream.get("width").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
            height: stream.get("height").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
            fps: stream
                .get("avg_frame_rate")
                .and_then(|v| v.as_str())
                .and_then(parse_rational)
                .or_else(|| {
                    stream
                        .get("r_frame_rate")
                        .and_then(|v| v.as_str())
                        .and_then(parse_rational)
                })
                .unwrap_or(0.0),
            codec: stream
                .get("codec_name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            bitrate: stream
                .get("bit_rate")
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse::<u64>().ok()),
            rotation: probe_rotation(stream),
        });

    let audio = streams
        .iter()
        .find(|s| s.get("codec_type").and_then(|v| v.as_str()) == Some("audio"))
        .map(|stream| NativeAudioMetadata {
            codec: stream
                .get("codec_name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            bitrate: stream
                .get("bit_rate")
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse::<u64>().ok()),
            sample_rate: stream
                .get("sample_rate")
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse::<u32>().ok()),
            channels: stream
                .get("channels")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32),
        });

    Ok(NativeMediaMetadata {
        duration,
        container,
        video,
        audio,
    })
}

pub fn generate_proxy(
    tasks: &NativeMediaTasks,
    task_id: &str,
    source_path: &Path,
    target_path: &Path,
    options: NativeProxyOptions,
) -> Result<()> {
    let ffprobe_cmd = options.ffprobe_path.as_deref().unwrap_or("ffprobe");
    let metadata = probe_media(source_path, ffprobe_cmd)?;
    let video = metadata
        .video
        .as_ref()
        .ok_or_else(|| anyhow!("source has no video stream"))?;
    let (width, height) = scaled_even_size(video.width, video.height, options.max_pixels);

    let hw_accel = options
        .hardware_acceleration_mode
        .as_deref()
        .unwrap_or("none");
    let vaapi_dev = options
        .vaapi_device
        .as_deref()
        .unwrap_or(DEFAULT_VAAPI_DEVICE);
    let hw_decode = resolve_hw_decode_mode(hw_accel, vaapi_dev);

    let hw_encode = if options.enable_hardware_encoding.unwrap_or(false) {
        hw_decode
    } else {
        HwAccelMode::None
    };

    let mut args = Vec::new();

    if hw_encode == HwAccelMode::Vaapi {
        push_vaapi_init_device_args(&mut args, vaapi_dev);
    }

    args.extend(["-nostdin".to_string(), "-y".to_string()]);

    push_hw_accel_decode_args(&mut args, hw_decode, vaapi_dev);

    args.extend(["-i".to_string(), source_path.display().to_string()]);

    push_video_encode_filter_args(&mut args, hw_encode, width, height, false);

    let video_codec = ffmpeg_video_codec_hw(&options.video_codec, hw_encode);
    args.extend([
        "-c:v".to_string(),
        video_codec.to_string(),
        "-b:v".to_string(),
        options.video_bitrate_bps.to_string(),
    ]);

    args.extend(["-movflags".to_string(), "+faststart".to_string()]);

    if let Some(audio) = metadata.audio.as_ref() {
        if options.copy_opus_audio && audio.codec.to_lowercase().starts_with("opus") {
            args.extend(["-c:a".into(), "copy".into()]);
        } else {
            args.extend([
                "-c:a".into(),
                "libopus".into(),
                "-b:a".into(),
                options.audio_bitrate_bps.to_string(),
            ]);
        }
    } else {
        args.push("-an".into());
    }

    args.push(target_path.display().to_string());

    let ffmpeg_cmd = options.ffmpeg_path.as_deref().unwrap_or("ffmpeg");
    match run_ffmpeg_task(tasks, task_id, ffmpeg_cmd, args) {
        Ok(()) => {
            if !target_path.exists() {
                return Err(anyhow!(
                    "ffmpeg proxy did not produce output file: {}",
                    target_path.display()
                ));
            }
            Ok(())
        }
        Err(e) if hw_encode != HwAccelMode::None && !e.to_string().contains("cancelled") => {
            log::warn!("[native-media] HW proxy failed ({e}), falling back to software encoding");
            let mut sw_options = options.clone();
            sw_options.enable_hardware_encoding = Some(false);
            generate_proxy(tasks, task_id, source_path, target_path, sw_options)
        }
        Err(e) => Err(e),
    }
}

pub fn convert_media(
    tasks: &NativeMediaTasks,
    task_id: &str,
    source_path: &Path,
    target_path: &Path,
    options: NativeConvertOptions,
) -> Result<()> {
    let hw_accel = options
        .hardware_acceleration_mode
        .as_deref()
        .unwrap_or("none");
    let vaapi_dev = options
        .vaapi_device
        .as_deref()
        .unwrap_or(DEFAULT_VAAPI_DEVICE);
    let hw_decode = resolve_hw_decode_mode(hw_accel, vaapi_dev);

    let hw_encode = if options.enable_hardware_encoding.unwrap_or(false) {
        hw_decode
    } else {
        HwAccelMode::None
    };

    let mut args = Vec::new();

    if hw_encode == HwAccelMode::Vaapi && options.kind == "video" {
        push_vaapi_init_device_args(&mut args, vaapi_dev);
    }

    args.extend(["-nostdin".to_string(), "-y".to_string()]);

    if options.kind == "video" {
        push_hw_accel_decode_args(&mut args, hw_decode, vaapi_dev);
    }

    args.extend(["-i".to_string(), source_path.display().to_string()]);

    match options.kind.as_str() {
        "video" => {
            let width = options.width.unwrap_or(DEFAULT_VIDEO_WIDTH).max(1);
            let height = options.height.unwrap_or(DEFAULT_VIDEO_HEIGHT).max(1);

            push_video_encode_filter_args(&mut args, hw_encode, width, height, false);

            let raw_video_codec = options.video_codec.as_deref().unwrap_or("avc1");
            let video_codec = ffmpeg_video_codec_hw(raw_video_codec, hw_encode);

            args.extend([
                "-r".into(),
                format_fps(options.fps.unwrap_or(DEFAULT_VIDEO_FPS)),
                "-c:v".into(),
                video_codec.to_string(),
                "-b:v".into(),
                options.video_bitrate_bps.unwrap_or(DEFAULT_VIDEO_BITRATE_BPS).to_string(),
            ]);

            if options.audio.unwrap_or(true) {
                args.extend(audio_args(&options));
            } else {
                args.push("-an".into());
            }
        }
        "audio" => {
            args.push("-vn".into());
            if options.audio_reverse.unwrap_or(false) {
                args.extend(["-af".into(), "areverse".into()]);
            }
            args.extend(audio_args(&options));
        }
        _ => return Err(anyhow!("unsupported conversion kind: {}", options.kind)),
    }

    if options.format == "mp4" {
        args.extend(["-movflags".into(), "+faststart".into()]);
    }
    args.push(target_path.display().to_string());

    let ffmpeg_cmd = options.ffmpeg_path.as_deref().unwrap_or("ffmpeg");
    match run_ffmpeg_task(tasks, task_id, ffmpeg_cmd, args) {
        Ok(()) => {
            if !target_path.exists() {
                return Err(anyhow!(
                    "ffmpeg conversion did not produce output file: {}",
                    target_path.display()
                ));
            }
            Ok(())
        }
        Err(e) if hw_encode != HwAccelMode::None && !e.to_string().contains("cancelled") => {
            log::warn!(
                "[native-media] HW conversion failed ({e}), falling back to software encoding"
            );
            let mut sw_options = options.clone();
            sw_options.enable_hardware_encoding = Some(false);
            convert_media(tasks, task_id, source_path, target_path, sw_options)
        }
        Err(e) => Err(e),
    }
}

pub fn extract_video_frame_webp(
    source_path: &Path,
    time_sec: f64,
    position_fraction: Option<f64>,
    max_width: u32,
    max_height: u32,
    quality: f32,
    hw_settings: crate::FfmpegHardwareSettings,
) -> Result<Vec<u8>> {
    // Throttle concurrent decoder/ffmpeg spawns the same way the monitor does, so a
    // media panel full of clips can't flood the machine with parallel ffmpeg starts.
    let _permit = decoder_load_gate().acquire();
    let metadata = probe_media(source_path, &hw_settings.ffprobe_path)?;
    let video = metadata
        .video
        .as_ref()
        .ok_or_else(|| anyhow!("source has no video stream"))?;
    let (width, height) = video_frame_thumbnail_size(video, max_width, max_height);

    // When the caller passes a position fraction we derive the timestamp from the
    // duration we already probed here, so the JS side doesn't have to spawn its own
    // ffprobe just to compute `duration * fraction`.
    let time_sec = match position_fraction {
        Some(fraction) if fraction.is_finite() => {
            (metadata.duration.max(0.0) * fraction.clamp(0.0, 1.0)).max(0.0)
        }
        _ => time_sec.max(0.0),
    };

    let hw_accel = &hw_settings.hardware_acceleration_mode;
    let hw_decode = resolve_hw_decode_mode(hw_accel, &hw_settings.vaapi_device);

    let mut cmd = Command::new(&hw_settings.ffmpeg_path);
    cmd.arg("-nostdin");

    match hw_decode {
        HwAccelMode::Vaapi => {
            cmd.arg("-hwaccel")
                .arg("vaapi")
                .arg("-hwaccel_device")
                .arg(&hw_settings.vaapi_device);
        }
        HwAccelMode::Nvdec => {
            cmd.arg("-hwaccel").arg("nvdec");
        }
        _ => {}
    }

    cmd.arg("-v")
        .arg("error")
        .arg("-ss")
        .arg(format_time(time_sec))
        .arg("-i")
        .arg(source_path)
        .arg("-frames:v")
        .arg("1")
        .arg("-vf")
        .arg(format!("scale={width}:{height}"))
        .arg("-c:v")
        .arg("libwebp")
        .arg("-quality")
        .arg(webp_quality_arg(quality))
        .arg("-f")
        .arg("image2pipe")
        .arg("-")
        .stdin(Stdio::null());

    let output = cmd
        .output()
        .context("failed to run ffmpeg frame extraction")?;

    if !output.status.success() {
        return Err(anyhow!(
            "ffmpeg frame extraction failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    if output.stdout.is_empty() {
        return Err(anyhow!("ffmpeg frame extraction returned empty output"));
    }
    Ok(output.stdout)
}

fn video_frame_thumbnail_size(
    video: &NativeVideoMetadata,
    max_width: u32,
    max_height: u32,
) -> (u32, u32) {
    let rotation_deg = video.rotation.rem_euclid(360).abs();
    let is_quarter = rotation_deg == 90 || rotation_deg == 270;
    let (src_w, src_h) = if is_quarter {
        (video.height, video.width)
    } else {
        (video.width, video.height)
    };
    fit_even_size(src_w, src_h, max_width, max_height)
}

pub fn extract_video_frame_webps(
    source_path: &Path,
    times_sec: &[f64],
    max_width: u32,
    max_height: u32,
    quality: f32,
) -> Result<Vec<Option<Vec<u8>>>> {
    let mut sorted_times: Vec<(usize, f64)> = times_sec.iter().copied().enumerate().collect();
    sorted_times.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));

    let max_edge = max_width.max(max_height);
    let mut decoder = {
        let _permit = decoder_load_gate().acquire();
        crate::media::decode::open(source_path, Some(max_edge), HwAccelMode::None, None)?
    };
    let mut results = vec![None; times_sec.len()];

    let mut last_pts = -1.0;
    let webp_quality = if quality.is_finite() {
        quality.clamp(0.0, 1.0) * 100.0
    } else {
        DEFAULT_WEBP_QUALITY
    };

    for (orig_idx, target_time) in sorted_times {
        let needs_seek = last_pts < 0.0 || target_time < last_pts || (target_time - last_pts) > SEEK_THRESHOLD_SEC;
        if needs_seek {
            if let Err(e) = decoder.seek(target_time) {
                log::warn!(
                    "[native-media] seek failed at {:.3}s for {}: {e}",
                    target_time,
                    source_path.display()
                );
                last_pts = -1.0;
                continue;
            }
        }

        let mut last_frame = None;
        loop {
            match decoder.next_frame() {
                Ok(Some(frame)) => {
                    last_pts = frame.pts_sec;
                    let current_pts = frame.pts_sec;
                    last_frame = Some(frame);
                    if current_pts >= target_time {
                        break;
                    }
                }
                Ok(None) => break, // EOF
                Err(e) => {
                    log::warn!(
                        "[native-media] decode failed at {:.3}s for {}: {e}",
                        target_time,
                        source_path.display()
                    );
                    break;
                }
            }
        }

        if let Some(frame) = last_frame {
            let rotation = decoder.info().rotation.rem_euclid(360);

            let encode_res: Result<Vec<u8>, anyhow::Error> =
                if rotation == 90 || rotation == 180 || rotation == 270 {
                    let (frame_width, frame_height) = (frame.width, frame.height);
                    if let Some(buf) = image::ImageBuffer::<image::Rgba<u8>, Vec<u8>>::from_raw(
                        frame_width,
                        frame_height,
                        frame.pixels.clone(),
                    ) {
                        match rotation {
                            90 => {
                                let rotated = image::imageops::rotate90(&buf);
                                encode_rgba_as_webp(
                                    rotated.as_raw(),
                                    rotated.width(),
                                    rotated.height(),
                                    webp_quality,
                                )}
                            180 => {
                                let rotated = image::imageops::rotate180(&buf);
                                encode_rgba_as_webp(
                                    rotated.as_raw(),
                                    rotated.width(),
                                    rotated.height(),
                                    webp_quality,
                                )}
                            270 => {
                                let rotated = image::imageops::rotate270(&buf);
                                encode_rgba_as_webp(
                                    rotated.as_raw(),
                                    rotated.width(),
                                    rotated.height(),
                                    webp_quality,
                                )}
                            _ => unreachable!(),
                        }
                    } else {
                        Err(anyhow!("failed to create image buffer for rotation"))
                    }
                } else {
                    encode_rgba_as_webp(&frame.pixels, frame.width, frame.height, webp_quality)};

            match encode_res {
                Ok(bytes) => {
                    results[orig_idx] = Some(bytes);
                }
                Err(e) => {
                    log::warn!(
                        "[native-media] webp encode/rotate failed at {:.3}s for {}: {e}",
                        target_time,
                        source_path.display()
                    );
                }
            }
        }
    }

    Ok(results)
}

/// Kill a job if ffmpeg makes no progress (no stderr output) for this long. A
/// stall guard rather than a wall-clock cap, so a legitimately long encode that
/// keeps emitting progress is never killed mid-run.
const FFMPEG_STALL_TIMEOUT: Duration = Duration::from_secs(300);

pub(crate) fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub(crate) fn spawn_stderr_drain(
    child: &mut Child,
) -> (Option<JoinHandle<Vec<u8>>>, Arc<AtomicU64>) {
    let last_activity = Arc::new(AtomicU64::new(now_millis()));
    let activity = last_activity.clone();
    let handle = child.stderr.take().map(|mut stderr| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let mut chunk = [0u8; 4096];
            loop {
                match std::io::Read::read(&mut stderr, &mut chunk) {
                    Ok(0) => break,
                    Ok(n) => {
                        activity.store(now_millis(), Ordering::Release);
                        buf.extend_from_slice(&chunk[..n]);
                    }
                    Err(_) => break,
                }
            }
            buf
        })
    });
    (handle, last_activity)
}

fn run_ffmpeg_task(
    tasks: &NativeMediaTasks,
    task_id: &str,
    ffmpeg_path: &str,
    args: Vec<String>,
) -> Result<()> {
    verify_ffmpeg_binary(ffmpeg_path).context("ffmpeg binary check failed")?;
    let mut child = Command::new(ffmpeg_path)
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .context("failed to spawn ffmpeg")?;

    let (stderr_handle, last_activity) = spawn_stderr_drain(&mut child);
    let child = tasks.insert(task_id, child);

    loop {
        let mut guard = child.lock();
        if let Some(status) = guard.try_wait().context("failed to poll ffmpeg")? {
            let stderr_text = match stderr_handle {
                Some(handle) => {
                    String::from_utf8_lossy(&handle.join().unwrap_or_default()).to_string()
                }
                None => String::new(),
            };
            drop(guard);
            let cancelled = tasks.was_cancelled(task_id);
            tasks.remove(task_id);
            if status.success() {
                return Ok(());
            }
            if cancelled {
                return Err(anyhow!("cancelled"));
            }
            return Err(anyhow!("ffmpeg failed: {}", stderr_text.trim()));
        }
        drop(guard);
        std::thread::sleep(Duration::from_millis(100));
        let idle_ms = now_millis().saturating_sub(last_activity.load(Ordering::Acquire));
        if idle_ms > FFMPEG_STALL_TIMEOUT.as_millis() as u64 {
            let mut guard = child.lock();
            let _ = guard.kill();
            let _ = guard.wait();
            drop(guard);
            tasks.remove(task_id);
            return Err(anyhow!(
                "ffmpeg stalled: no progress for {} seconds",
                FFMPEG_STALL_TIMEOUT.as_secs()
            ));
        }
    }
}

fn audio_args(options: &NativeConvertOptions) -> Vec<String> {
    let (codec, substituted) =
        resolve_audio_encoder(options.audio_codec.as_deref(), &options.format);
    if substituted {
        log::warn!(
            "[native-media] audio codec {:?} not usable for {} container; using {codec}",
            options.audio_codec,
            options.format
        );
    }
    let mut args = vec![
        "-c:a".to_string(),
        codec.to_string(),
        "-b:a".to_string(),
        options.audio_bitrate_bps.unwrap_or(128_000).to_string(),
    ];
    if let Some(channels) = options.audio_channels {
        args.extend(["-ac".into(), channels.max(1).to_string()]);
    }
    if let Some(sample_rate) = options.audio_sample_rate {
        args.extend(["-ar".into(), sample_rate.max(1).to_string()]);
    }
    args
}

fn scaled_even_size(width: u32, height: u32, max_pixels: u32) -> (u32, u32) {
    let pixels = width.saturating_mul(height);
    if max_pixels == 0 || pixels <= max_pixels {
        return (even(width), even(height));
    }
    let scale = (max_pixels as f64 / pixels as f64).sqrt();
    (
        even((width as f64 * scale).round() as u32),
        even((height as f64 * scale).round() as u32),
    )
}

fn fit_even_size(width: u32, height: u32, max_width: u32, max_height: u32) -> (u32, u32) {
    if width == 0 || height == 0 {
        return (2, 2);
    }
    let scale = (max_width.max(1) as f64 / width as f64)
        .min(max_height.max(1) as f64 / height as f64)
        .min(1.0);
    (
        even((width as f64 * scale).round() as u32),
        even((height as f64 * scale).round() as u32),
    )
}

fn webp_quality_arg(quality: f32) -> String {
    let value = if quality.is_finite() {
        quality.clamp(0.01, 1.0)
    } else {
        0.7
    };
    format!("{}", (value * 100.0).round() as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scaled_even_size_keeps_small_source() {
        assert_eq!(scaled_even_size(640, 360, 1920 * 1080), (640, 360));
    }

    #[test]
    fn scaled_even_size_downscales_to_pixel_budget() {
        let (w, h) = scaled_even_size(3840, 2160, 1920 * 1080);
        assert_eq!((w, h), (1920, 1080));
    }

    #[test]
    fn fit_even_size_fits_box_without_upscale() {
        assert_eq!(fit_even_size(1920, 1080, 320, 320), (320, 180));
        assert_eq!(fit_even_size(1080, 1920, 320, 320), (180, 320));
        assert_eq!(fit_even_size(100, 50, 320, 320), (100, 50));
    }

    #[test]
    fn video_frame_thumbnail_size_keeps_portrait_after_quarter_rotation() {
        let video = NativeVideoMetadata {
            width: 1920,
            height: 1080,
            fps: 30.0,
            codec: "h264".into(),
            bitrate: None,
            rotation: 90,
        };

        assert_eq!(video_frame_thumbnail_size(&video, 320, 320), (180, 320));
    }

    #[test]
    fn ffmpeg_video_codec_maps_browser_codec_strings() {
        assert_eq!(ffmpeg_video_codec("avc1.64001f"), "libx264");
        assert_eq!(ffmpeg_video_codec("av01.0.05M.08"), "libsvtav1");
        assert_eq!(ffmpeg_video_codec("vp09.00.10.08"), "libvpx-vp9");
        // HEVC must map to libx265, not silently downgrade to H.264.
        assert_eq!(ffmpeg_video_codec("hevc"), "libx265");
        assert_eq!(ffmpeg_video_codec("hvc1.1.6.L93.B0"), "libx265");
        assert_eq!(ffmpeg_video_codec("h265"), "libx265");
    }

    #[test]
    fn resolve_audio_encoder_remaps_unsupported_for_container() {
        // aac requested for webm → opus (substituted).
        assert_eq!(
            resolve_audio_encoder(Some("aac"), "webm"),
            ("libopus", true)
        );
        // aac for mp4 is fine.
        assert_eq!(resolve_audio_encoder(Some("aac"), "mp4"), ("aac", false));
        // opus passes through.
        assert_eq!(
            resolve_audio_encoder(Some("opus"), "webm"),
            ("libopus", false)
        );
        // flac and pcm pass through.
        assert_eq!(resolve_audio_encoder(Some("flac"), "flac"), ("flac", false));
        assert_eq!(
            resolve_audio_encoder(Some("pcm"), "wav"),
            ("pcm_s16le", false)
        );
        // Unknown codec falls back to a safe default per container.
        assert_eq!(resolve_audio_encoder(Some("garbage"), "mp4"), ("aac", true));
        assert_eq!(
            resolve_audio_encoder(Some("garbage"), "webm"),
            ("libopus", true)
        );
        // None defaults sensibly.
        assert_eq!(resolve_audio_encoder(None, "mp4"), ("aac", false));
    }

    #[test]
    fn parse_rational_handles_common_rates() {
        assert_eq!(parse_rational("30000/1001"), Some(30000.0 / 1001.0));
        assert_eq!(parse_rational("25"), Some(25.0));
        assert_eq!(parse_rational("0/0"), None);
    }
}
