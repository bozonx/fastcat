//! Native timeline export: render each frame through vello, stream raw RGBA to
//! ffmpeg stdin, then encode.
//!
//! Architecture:
//!   - Video is rendered by the native core (the same `compositor`/`scene_build`
//!     path as preview/thumbnail), so export matches the monitor pixel-for-pixel.
//!   - Audio can come from a pre-mixed browser file, or from the native audio
//!     mixer when no browser mix path is supplied.
//!
//! ffmpeg runs as one process: `-f rawvideo -pix_fmt rgba -s WxH -r fps -i -`
//! for stdin video, plus optional `-i <audio>` and codec flags. Progress is
//! reported after each written frame. Cancellation is handled through
//! `NativeMediaTasks`, the same registry used by `native_media_cancel`.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;

use crate::audio::engine::render_scene_to_wav;
use crate::compositor::Compositor;
use crate::monitor::scene::MonitorScene;

use super::ffmpeg_utils::*;
use super::processing::NativeMediaTasks;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeExportOptions {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    /// Export range in timeline seconds. `end` is exclusive.
    pub start_sec: f64,
    pub end_sec: f64,
    /// Browser codec string (avc1.* / vp09.* / av01.*), mapped to an ffmpeg encoder.
    pub video_codec: String,
    pub video_bitrate_bps: u32,
    pub format: String,
    /// Path to a pre-mixed browser audio file (wav/m4a/...); None means no pre-mix.
    #[serde(default)]
    pub audio_enabled: bool,
    pub audio_path: Option<String>,
    pub audio_codec: Option<String>,
    pub audio_bitrate_bps: Option<u32>,
    #[serde(default)]
    pub audio_channels: Option<u32>,

    // Hardware Acceleration Settings
    #[serde(default)]
    pub ffmpeg_path: Option<String>,
    #[serde(default)]
    pub hardware_acceleration_mode: Option<String>,
    #[serde(default)]
    pub vaapi_device: Option<String>,
    #[serde(default)]
    pub enable_hardware_encoding: Option<bool>,
    #[serde(default)]
    pub ffprobe_path: Option<String>,
    #[serde(default)]
    pub export_alpha: Option<bool>,
}

/// Runs the full export. `on_progress(0..1)` is called after each written frame.
pub fn export_timeline(
    tasks: &NativeMediaTasks,
    task_id: &str,
    scene: MonitorScene,
    options: NativeExportOptions,
    target_path: &Path,
    on_progress: &(dyn Fn(f64) + Send + Sync),
) -> Result<()> {
    let width = even(options.width.max(2));
    let height = even(options.height.max(2));
    let fps = if options.fps.is_finite() && options.fps > 0.0 {
        options.fps
    } else {
        30.0
    };
    let start = options.start_sec.max(0.0);
    let end = options.end_sec.max(start);
    // Frame count: duration times fps. Keep at least one frame for a zero-length range.
    let frame_count = (((end - start) * fps).round() as u64).max(1);

    let hw_mode = options
        .hardware_acceleration_mode
        .as_deref()
        .unwrap_or("none")
        .to_string();
    let hw_enabled = options.enable_hardware_encoding.unwrap_or(false);

    // Render the audio mix once so hardware-to-software fallback can reuse the
    // same temporary file instead of running the expensive offline mix twice.
    let mut temp_audio: Option<PathBuf> = None;
    let audio_input: Option<PathBuf> = if options.audio_enabled {
        match options.audio_path.as_deref().filter(|p| !p.is_empty()) {
            Some(path) => Some(PathBuf::from(path)),
            None if !scene.audio_layers.is_empty() => {
                let path = temp_audio_path();
                let master_gain = if scene.audio_master_muted {
                    0.0
                } else {
                    scene.audio_master_gain
                };
                let output_channels = options.audio_channels.unwrap_or(2) as usize;
                render_scene_to_wav(
                    &scene.audio_layers,
                    &scene.audio_tracks,
                    master_gain,
                    start,
                    end,
                    48_000,
                    output_channels,
                    &path,
                )
                .context("failed to render native audio mix")?;
                temp_audio = Some(path.clone());
                Some(path)
            }
            None => None,
        }
    } else {
        None
    };

    // One export attempt with the given options. The caller owns temp_audio cleanup.
    let run_attempt = |opts: &NativeExportOptions| -> Result<()> {
        let args = build_ffmpeg_args(
            opts,
            audio_input.as_deref(),
            width,
            height,
            fps,
            target_path,
        );
        let ffmpeg_cmd = opts.ffmpeg_path.as_deref().unwrap_or("ffmpeg");
        verify_ffmpeg_binary(ffmpeg_cmd).context("ffmpeg binary check failed")?;
        let mut child = Command::new(ffmpeg_cmd)
            .args(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .context("failed to spawn ffmpeg for timeline export")?;
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow!("ffmpeg stdin unavailable"))?;

        // Drain stderr in background to avoid pipe deadlock.
        let stderr_handle = child.stderr.take().map(|mut stderr| {
            std::thread::spawn(move || {
                let mut buf = Vec::new();
                let _ = std::io::Read::read_to_end(&mut stderr, &mut buf);
                buf
            })
        });

        // Register the process so `native_media_cancel(task_id)` can stop it.
        let child = tasks.insert(task_id, child);

        // Render frames sequentially through a dedicated compositor, separate
        // from the thumbnail pool, so export and thumbnail generation do not
        // contend for the same GPU target.
        let mut compositor = Compositor::new();
        let dev_id = compositor
            .ensure_offscreen_device()
            .context("export: no GPU device")?;

        let mut cache = super::timeline_render::VideoDecoderCache::new();
        let empty_cache = crate::compositor::texture_cache::TextureCache::new();
        let render_result = (|| -> Result<()> {
            for i in 0..frame_count {
                let time = start + i as f64 / fps;
                let frame_scene = super::timeline_render::build_export_scene(
                    &scene,
                    time,
                    (width, height),
                    &mut cache,
                )?;
                let pixels = compositor.render_scene_to_pixels(
                    dev_id,
                    &frame_scene,
                    width,
                    height,
                    &empty_cache,
                )?;
                if let Err(e) = stdin.write_all(&pixels) {
                    return Err(anyhow!("ffmpeg stdin closed prematurely: {e}"));
                }
                on_progress((i + 1) as f64 / frame_count as f64);
            }
            Ok(())
        })();

        // Close stdin so ffmpeg finalizes the container.
        drop(stdin);

        if let Err(error) = render_result {
            let mut guard = child.lock();
            let _ = guard.kill();
            drop(guard);
            tasks.remove(task_id);
            return Err(error);
        }

        let poll_start = std::time::Instant::now();
        const TIMEOUT: Duration = Duration::from_secs(3600);

        loop {
            let mut guard = child.lock();
            if let Some(status) = guard.try_wait().context("failed to poll ffmpeg export")? {
                let stderr_text = match stderr_handle {
                    Some(handle) => {
                        String::from_utf8_lossy(&handle.join().unwrap_or_default()).to_string()
                    }
                    None => String::new(),
                };
                drop(guard);
                tasks.remove(task_id);
                if status.success() {
                    if !target_path.exists() {
                        return Err(anyhow!(
                            "ffmpeg export succeeded but output file is missing: {}",
                            target_path.display()
                        ));
                    }
                    return Ok(());
                }
                return Err(anyhow!("ffmpeg export failed: {}", stderr_text.trim()));
            }
            drop(guard);
            std::thread::sleep(Duration::from_millis(100));
            if poll_start.elapsed() > TIMEOUT {
                let mut guard = child.lock();
                let _ = guard.kill();
                let _ = guard.wait();
                drop(guard);
                tasks.remove(task_id);
                return Err(anyhow!(
                    "ffmpeg export timed out after {} seconds",
                    TIMEOUT.as_secs()
                ));
            }
        }
    };

    let result = match run_attempt(&options) {
        Err(e) if hw_enabled && hw_mode != "none" => {
            log::warn!("[native-media] HW export failed ({e}), falling back to software encoding");
            let mut sw_options = options.clone();
            sw_options.enable_hardware_encoding = Some(false);
            run_attempt(&sw_options)
        }
        other => other,
    };

    if let Some(path) = temp_audio.as_deref() {
        let _ = std::fs::remove_file(path);
    }
    result
}

fn build_ffmpeg_args(
    options: &NativeExportOptions,
    audio_input: Option<&Path>,
    width: u32,
    height: u32,
    fps: f64,
    target_path: &Path,
) -> Vec<String> {
    let export_alpha = options.export_alpha.unwrap_or(false)
        && (options.format == "webm" || options.format == "mkv");

    let hw_mode = if options.enable_hardware_encoding.unwrap_or(false) && !export_alpha {
        let mode = options
            .hardware_acceleration_mode
            .as_deref()
            .unwrap_or("none");
        if mode == "auto" {
            let vaapi_dev = options
                .vaapi_device
                .as_deref()
                .unwrap_or("/dev/dri/renderD128");
            if std::path::Path::new(vaapi_dev).exists() {
                "vaapi"
            } else {
                "none"
            }
        } else {
            mode
        }
    } else {
        "none"
    };

    let mut args = Vec::new();

    if hw_mode == "vaapi" {
        let vaapi_dev = options
            .vaapi_device
            .as_deref()
            .unwrap_or("/dev/dri/renderD128");
        args.extend([
            "-init_hw_device".to_string(),
            format!("vaapi=gpu:{vaapi_dev}"),
            "-filter_hw_device".to_string(),
            "gpu".to_string(),
        ]);
    }

    args.extend([
        "-y".to_string(),
        "-loglevel".to_string(),
        "error".to_string(),
        // Video comes from stdin as raw RGBA.
        "-f".to_string(),
        "rawvideo".to_string(),
        "-pix_fmt".to_string(),
        "rgba".to_string(),
        "-s".to_string(),
        format!("{width}x{height}"),
        "-r".to_string(),
        format!("{fps:.6}"),
        "-i".to_string(),
        "-".to_string(),
    ]);

    let has_audio = audio_input.is_some();
    if let Some(audio) = audio_input {
        args.extend(["-i".to_string(), audio.display().to_string()]);
    }

    let video_codec = ffmpeg_video_codec_hw(&options.video_codec, hw_mode);
    args.extend([
        "-c:v".to_string(),
        video_codec.to_string(),
        "-b:v".to_string(),
        options.video_bitrate_bps.max(1).to_string(),
    ]);

    if export_alpha && video_codec == "libvpx-vp9" {
        args.extend(["-auto-alt-ref".to_string(), "0".to_string()]);
    }

    if hw_mode == "vaapi" {
        args.extend([
            "-vf".to_string(),
            "format=nv12|vaapi,hwupload".to_string(),
            "-pix_fmt".to_string(),
            "vaapi".to_string(),
        ]);
    } else if hw_mode == "nvdec" {
        args.extend([
            "-vf".to_string(),
            "format=yuv420p".to_string(),
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
        ]);
    } else {
        if export_alpha {
            args.extend(["-pix_fmt".to_string(), "yuva420p".to_string()]);
        } else {
            args.extend(["-pix_fmt".to_string(), "yuv420p".to_string()]);
        }
    }

    if has_audio {
        let codec = match options.audio_codec.as_deref() {
            Some("opus") => "libopus",
            Some("aac") | None => {
                if options.format == "webm" {
                    "libopus"
                } else {
                    "aac"
                }
            }
            Some(other) => {
                if options.format == "webm" && other == "aac" {
                    "libopus"
                } else {
                    other
                }
            }
        };
        args.extend(["-c:a".to_string(), codec.to_string()]);
        if let Some(bitrate) = options.audio_bitrate_bps {
            args.extend(["-b:a".to_string(), bitrate.max(1).to_string()]);
        }
        // Trim to the shorter stream; video duration is the reference.
        args.push("-shortest".to_string());
    } else {
        args.push("-an".to_string());
    }

    if options.format == "mp4" || options.format == "mov" {
        args.extend(["-movflags".to_string(), "+faststart".to_string()]);
    }

    args.push(target_path.display().to_string());
    args
}

/// Returns a temporary path for the audio mix WAV.
pub fn temp_audio_path() -> PathBuf {
    let name = format!(
        "fastcat-export-audio-{}-{}.wav",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    std::env::temp_dir().join(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_build_ffmpeg_args_webm_forces_opus() {
        let options = NativeExportOptions {
            width: 1920,
            height: 1080,
            fps: 30.0,
            start_sec: 0.0,
            end_sec: 10.0,
            video_codec: "vp9".to_string(),
            video_bitrate_bps: 5_000_000,
            format: "webm".to_string(),
            audio_enabled: true,
            audio_path: None,
            audio_codec: Some("aac".to_string()),
            audio_bitrate_bps: Some(128_000),
            audio_channels: Some(2),
            ffmpeg_path: None,
            ffprobe_path: None,
            hardware_acceleration_mode: None,
            vaapi_device: None,
            enable_hardware_encoding: None,
            export_alpha: None,
        };
        let args = build_ffmpeg_args(
            &options,
            Some(Path::new("dummy.wav")),
            1920,
            1080,
            30.0,
            Path::new("output.webm"),
        );
        let mut idx = 0;
        let mut found_opus = false;
        while idx < args.len() {
            if args[idx] == "-c:a" {
                assert_eq!(args[idx + 1], "libopus");
                found_opus = true;
                break;
            }
            idx += 1;
        }
        assert!(found_opus, "Audio codec argument not found");
    }

    #[test]
    fn test_build_ffmpeg_args_vp9_alpha_adds_auto_alt_ref() {
        let options = NativeExportOptions {
            width: 1920,
            height: 1080,
            fps: 30.0,
            start_sec: 0.0,
            end_sec: 10.0,
            video_codec: "vp9".to_string(),
            video_bitrate_bps: 5_000_000,
            format: "webm".to_string(),
            audio_enabled: false,
            audio_path: None,
            audio_codec: None,
            audio_bitrate_bps: None,
            audio_channels: None,
            ffmpeg_path: None,
            ffprobe_path: None,
            hardware_acceleration_mode: None,
            vaapi_device: None,
            enable_hardware_encoding: None,
            export_alpha: Some(true),
        };
        let args = build_ffmpeg_args(&options, None, 1920, 1080, 30.0, Path::new("output.webm"));
        let mut found_yuva = false;
        let mut found_auto_alt_ref = false;
        let mut idx = 0;
        while idx < args.len() {
            if args[idx] == "-pix_fmt" && args.get(idx + 1) == Some(&"yuva420p".to_string()) {
                found_yuva = true;
            }
            if args[idx] == "-auto-alt-ref" && args.get(idx + 1) == Some(&"0".to_string()) {
                found_auto_alt_ref = true;
            }
            idx += 1;
        }
        assert!(found_yuva, "Expected yuva420p pixel format");
        assert!(found_auto_alt_ref, "Expected -auto-alt-ref 0 for VP9 alpha");
    }

    #[test]
    fn test_build_ffmpeg_args_mp4_ignores_alpha() {
        let options = NativeExportOptions {
            width: 1920,
            height: 1080,
            fps: 30.0,
            start_sec: 0.0,
            end_sec: 10.0,
            video_codec: "avc1.64001f".to_string(),
            video_bitrate_bps: 5_000_000,
            format: "mp4".to_string(),
            audio_enabled: false,
            audio_path: None,
            audio_codec: None,
            audio_bitrate_bps: None,
            audio_channels: None,
            ffmpeg_path: None,
            ffprobe_path: None,
            hardware_acceleration_mode: None,
            vaapi_device: None,
            enable_hardware_encoding: None,
            export_alpha: Some(true),
        };
        let args = build_ffmpeg_args(&options, None, 1920, 1080, 30.0, Path::new("output.mp4"));
        assert!(
            !args.contains(&"yuva420p".to_string()),
            "mp4 should ignore alpha flag"
        );
        assert!(
            !args.contains(&"-auto-alt-ref".to_string()),
            "mp4 should not add VP9 alpha flags"
        );
    }
}
