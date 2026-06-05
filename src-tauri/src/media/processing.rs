use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;

use crate::media::decode_gate::decoder_load_gate;

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
        return Err(anyhow!(
            "ffprobe failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let json: Value =
        serde_json::from_slice(&output.stdout).context("ffprobe returned invalid JSON")?;
    metadata_from_ffprobe(json)
}

use crate::media::decode::probe_rotation;
use crate::media::ffmpeg_utils::*;

fn metadata_from_ffprobe(json: Value) -> Result<NativeMediaMetadata> {
    let streams = json
        .get("streams")
        .and_then(|s| s.as_array())
        .ok_or_else(|| anyhow!("ffprobe: no streams"))?;

    let duration = json
        .get("format")
        .and_then(|f| f.get("duration"))
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);

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

    let hw_accel = options.hardware_acceleration_mode.as_deref().unwrap_or("none");
    let hw_decode = if hw_accel != "none" {
        if hw_accel == "auto" {
            let vaapi_dev = options.vaapi_device.as_deref().unwrap_or(DEFAULT_VAAPI_DEVICE);
            if std::path::Path::new(vaapi_dev).exists() {
                "vaapi"
            } else {
                "none"
            }
        } else {
            hw_accel
        }
    } else {
        "none"
    };

    let hw_encode = if options.enable_hardware_encoding.unwrap_or(false) {
        hw_decode
    } else {
        "none"
    };

    let mut args = Vec::new();

    if hw_encode == "vaapi" {
        let vaapi_dev = options.vaapi_device.as_deref().unwrap_or(DEFAULT_VAAPI_DEVICE);
        args.extend([
            "-init_hw_device".to_string(),
            format!("vaapi=gpu:{vaapi_dev}"),
            "-filter_hw_device".to_string(),
            "gpu".to_string(),
        ]);
    }

    args.extend([
        "-nostdin".to_string(),
        "-y".to_string(),
    ]);

    if hw_decode == "vaapi" {
        let vaapi_dev = options.vaapi_device.as_deref().unwrap_or(DEFAULT_VAAPI_DEVICE);
        args.extend([
            "-hwaccel".to_string(),
            "vaapi".to_string(),
            "-hwaccel_device".to_string(),
            vaapi_dev.to_string(),
        ]);
    } else if hw_decode == "nvdec" {
        args.extend([
            "-hwaccel".to_string(),
            "nvdec".to_string(),
        ]);
    }

    args.extend([
        "-i".to_string(),
        source_path.display().to_string(),
    ]);

    let vf_filter = if hw_encode == "vaapi" {
        format!("scale={width}:{height},format=nv12|vaapi,hwupload")
    } else if hw_encode == "nvdec" {
        format!("scale={width}:{height},format=yuv420p")
    } else {
        format!("scale={width}:{height}")
    };
    args.extend([
        "-vf".to_string(),
        vf_filter,
    ]);

    let video_codec = ffmpeg_video_codec_hw(&options.video_codec, hw_encode);
    args.extend([
        "-c:v".to_string(),
        video_codec.to_string(),
        "-b:v".to_string(),
        options.video_bitrate_bps.to_string(),
    ]);

    if hw_encode == "vaapi" {
        args.extend([
            "-pix_fmt".to_string(),
            "vaapi".to_string(),
        ]);
    } else if hw_encode == "nvdec" {
        args.extend([
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
        ]);
    }

    args.extend([
        "-movflags".to_string(),
        "+faststart".to_string(),
    ]);

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
        Err(e) if hw_encode != "none" && !e.to_string().contains("cancelled") => {
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
    let hw_accel = options.hardware_acceleration_mode.as_deref().unwrap_or("none");
    let hw_decode = if hw_accel != "none" {
        if hw_accel == "auto" {
            let vaapi_dev = options.vaapi_device.as_deref().unwrap_or(DEFAULT_VAAPI_DEVICE);
            if std::path::Path::new(vaapi_dev).exists() {
                "vaapi"
            } else {
                "none"
            }
        } else {
            hw_accel
        }
    } else {
        "none"
    };

    let hw_encode = if options.enable_hardware_encoding.unwrap_or(false) {
        hw_decode
    } else {
        "none"
    };

    let mut args = Vec::new();

    if hw_encode == "vaapi" && options.kind == "video" {
        let vaapi_dev = options.vaapi_device.as_deref().unwrap_or(DEFAULT_VAAPI_DEVICE);
        args.extend([
            "-init_hw_device".to_string(),
            format!("vaapi=gpu:{vaapi_dev}"),
            "-filter_hw_device".to_string(),
            "gpu".to_string(),
        ]);
    }

    args.extend([
        "-nostdin".to_string(),
        "-y".to_string(),
    ]);

    if hw_decode == "vaapi" && options.kind == "video" {
        let vaapi_dev = options.vaapi_device.as_deref().unwrap_or(DEFAULT_VAAPI_DEVICE);
        args.extend([
            "-hwaccel".to_string(),
            "vaapi".to_string(),
            "-hwaccel_device".to_string(),
            vaapi_dev.to_string(),
        ]);
    } else if hw_decode == "nvdec" && options.kind == "video" {
        args.extend([
            "-hwaccel".to_string(),
            "nvdec".to_string(),
        ]);
    }

    args.extend([
        "-i".to_string(),
        source_path.display().to_string(),
    ]);

    match options.kind.as_str() {
        "video" => {
            let width = options.width.unwrap_or(1920).max(1);
            let height = options.height.unwrap_or(1080).max(1);
            
            let vf_filter = if hw_encode == "vaapi" {
                format!("scale={}:{}:format=nv12|vaapi,hwupload", even(width), even(height))
            } else if hw_encode == "nvdec" {
                format!("scale={}:{}:format=yuv420p", even(width), even(height))
            } else {
                format!("scale={}:{}", even(width), even(height))
            };
            args.extend([
                "-vf".into(),
                vf_filter,
            ]);

            let raw_video_codec = options.video_codec.as_deref().unwrap_or("avc1");
            let video_codec = ffmpeg_video_codec_hw(raw_video_codec, hw_encode);

            args.extend([
                "-r".into(),
                format_fps(options.fps.unwrap_or(30.0)),
                "-c:v".into(),
                video_codec.to_string(),
                "-b:v".into(),
                options.video_bitrate_bps.unwrap_or(5_000_000).to_string(),
            ]);

            if hw_encode == "vaapi" {
                args.extend([
                    "-pix_fmt".to_string(),
                    "vaapi".to_string(),
                ]);
            } else if hw_encode == "nvdec" {
                args.extend([
                    "-pix_fmt".to_string(),
                    "yuv420p".to_string(),
                ]);
            }

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
        Err(e) if hw_encode != "none" && !e.to_string().contains("cancelled") => {
            log::warn!("[native-media] HW conversion failed ({e}), falling back to software encoding");
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

    let hw_accel = &hw_settings.hardware_acceleration_mode;
    let hw_decode = if hw_accel != "none" {
        if hw_accel == "auto" {
            let vaapi_dev = &hw_settings.vaapi_device;
            if std::path::Path::new(vaapi_dev).exists() {
                "vaapi"
            } else {
                "none"
            }
        } else {
            hw_accel.as_str()
        }
    } else {
        "none"
    };

    let mut cmd = Command::new(&hw_settings.ffmpeg_path);
    cmd.arg("-nostdin");

    if hw_decode == "vaapi" {
        cmd.arg("-hwaccel").arg("vaapi")
           .arg("-hwaccel_device").arg(&hw_settings.vaapi_device);
    } else if hw_decode == "nvdec" {
        cmd.arg("-hwaccel").arg("nvdec");
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

    let output = cmd.output().context("failed to run ffmpeg frame extraction")?;

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
    _quality: f32,
) -> Result<Vec<Option<Vec<u8>>>> {
    let mut sorted_times: Vec<(usize, f64)> = times_sec
        .iter()
        .copied()
        .enumerate()
        .collect();
    sorted_times.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));

    let _permit = decoder_load_gate().acquire();
    let max_edge = max_width.max(max_height);
    let mut decoder = crate::media::decode::open(source_path, Some(max_edge))?;
    let mut results = vec![None; times_sec.len()];

    let mut last_pts = -1.0;

    for (orig_idx, target_time) in sorted_times {
        let needs_seek = last_pts < 0.0 || target_time < last_pts || (target_time - last_pts) > 5.0;
        if needs_seek {
            if let Err(e) = decoder.seek(target_time) {
                log::warn!(
                    "[native-media] seek failed at {:.3}s for {}: {e}",
                    target_time,
                    source_path.display()
                );
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
            let mut bytes = Vec::new();
            let rotation = decoder.info().rotation.rem_euclid(360);

            let res: Result<(), anyhow::Error> = if rotation == 90 || rotation == 180 || rotation == 270 {
                if let Some(buf) = image::ImageBuffer::<image::Rgba<u8>, Vec<u8>>::from_raw(
                    frame.width,
                    frame.height,
                    frame.pixels.clone(),
                ) {
                    match rotation {
                        90 => {
                            let rotated = image::imageops::rotate90(&buf);
                            image::write_buffer_with_format(
                                &mut std::io::Cursor::new(&mut bytes),
                                &rotated,
                                rotated.width(),
                                rotated.height(),
                                image::ColorType::Rgba8,
                                image::ImageFormat::WebP,
                            ).map_err(Into::into)
                        }
                        180 => {
                            let rotated = image::imageops::rotate180(&buf);
                            image::write_buffer_with_format(
                                &mut std::io::Cursor::new(&mut bytes),
                                &rotated,
                                rotated.width(),
                                rotated.height(),
                                image::ColorType::Rgba8,
                                image::ImageFormat::WebP,
                            ).map_err(Into::into)
                        }
                        270 => {
                            let rotated = image::imageops::rotate270(&buf);
                            image::write_buffer_with_format(
                                &mut std::io::Cursor::new(&mut bytes),
                                &rotated,
                                rotated.width(),
                                rotated.height(),
                                image::ColorType::Rgba8,
                                image::ImageFormat::WebP,
                            ).map_err(Into::into)
                        }
                        _ => unreachable!(),
                    }
                } else {
                    Err(anyhow!("failed to create image buffer for rotation"))
                }
            } else {
                image::write_buffer_with_format(
                    &mut std::io::Cursor::new(&mut bytes),
                    &frame.pixels,
                    frame.width,
                    frame.height,
                    image::ColorType::Rgba8,
                    image::ImageFormat::WebP,
                ).map_err(Into::into)
            };

            if let Err(e) = res {
                log::warn!(
                    "[native-media] webp encode/rotate failed at {:.3}s for {}: {e}",
                    target_time,
                    source_path.display()
                );
                continue;
            }
            results[orig_idx] = Some(bytes);
        }
    }

    Ok(results)
}

/// Kill a job if ffmpeg makes no progress (no stderr output) for this long. A
/// stall guard rather than a wall-clock cap, so a legitimately long encode that
/// keeps emitting progress is never killed mid-run.
const FFMPEG_STALL_TIMEOUT: Duration = Duration::from_secs(300);

fn run_ffmpeg_task(tasks: &NativeMediaTasks, task_id: &str, ffmpeg_path: &str, args: Vec<String>) -> Result<()> {
    verify_ffmpeg_binary(ffmpeg_path).context("ffmpeg binary check failed")?;
    let mut child = Command::new(ffmpeg_path)
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .context("failed to spawn ffmpeg")?;

    // Drain stderr in a background thread (prevents pipe deadlock) and record the
    // last time ffmpeg wrote anything, so the poll loop can detect a true stall.
    let last_activity = Arc::new(Mutex::new(Instant::now()));
    let activity = last_activity.clone();
    let stderr_handle = child.stderr.take().map(|mut stderr| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let mut chunk = [0u8; 4096];
            loop {
                match std::io::Read::read(&mut stderr, &mut chunk) {
                    Ok(0) => break,
                    Ok(n) => {
                        *activity.lock() = Instant::now();
                        buf.extend_from_slice(&chunk[..n]);
                    }
                    Err(_) => break,
                }
            }
            buf
        })
    });

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
        if last_activity.lock().elapsed() > FFMPEG_STALL_TIMEOUT {
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
        assert_eq!(resolve_audio_encoder(Some("aac"), "webm"), ("libopus", true));
        // aac for mp4 is fine.
        assert_eq!(resolve_audio_encoder(Some("aac"), "mp4"), ("aac", false));
        // opus passes through.
        assert_eq!(resolve_audio_encoder(Some("opus"), "webm"), ("libopus", false));
        // Unknown codec falls back to a safe default per container.
        assert_eq!(resolve_audio_encoder(Some("garbage"), "mp4"), ("aac", true));
        assert_eq!(resolve_audio_encoder(Some("garbage"), "webm"), ("libopus", true));
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
