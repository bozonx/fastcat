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
    #[serde(default)]
    pub audio_sample_rate: Option<u32>,
    #[serde(default)]
    pub video_enabled: Option<bool>,
    #[serde(default)]
    pub bitrate_mode: Option<String>,
    #[serde(default)]
    pub keyframe_interval_sec: Option<f64>,
    #[serde(default)]
    pub metadata_title: Option<String>,
    #[serde(default)]
    pub metadata_description: Option<String>,
    #[serde(default)]
    pub metadata_author: Option<String>,
    #[serde(default)]
    pub metadata_tags: Option<String>,

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
    if end <= start {
        return Err(anyhow!("export range is zero or negative"));
    }
    if options.video_enabled.unwrap_or(true)
        && options.export_alpha == Some(true)
        && !export_uses_alpha(&options)
    {
        return Err(anyhow!(
            "alpha export is only supported for VP9 in WebM or MKV containers"
        ));
    }
    // Frame count: duration times fps, rounded up so the last frame covers the end.
    let frame_count = (((end - start) * fps).ceil() as u64).max(1);

    // Resolve the hardware mode once (auto → vaapi/none, alpha forces software) so
    // the fallback decision below is based on what the first attempt *actually* used.
    // Otherwise an "auto" export on a machine without a VAAPI device would render the
    // whole timeline through software, then needlessly render it a second time.
    let effective_hw = resolve_export_hw_mode(&options);

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
                let output_channels = options.audio_channels.unwrap_or(2).clamp(1, 2) as usize;
                let sample_rate = options
                    .audio_sample_rate
                    .unwrap_or(48_000)
                    .clamp(8_000, 192_000);
                render_scene_to_wav(
                    &scene.audio_layers,
                    &scene.audio_tracks,
                    master_gain,
                    start,
                    end,
                    sample_rate,
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
        let is_video = opts.video_enabled.unwrap_or(true);
        if !is_video && audio_input.is_none() {
            return Err(anyhow!("audio-only export has no audio input"));
        }

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
            .stdin(if is_video {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .context("failed to spawn ffmpeg for timeline export")?;

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

        let render_result = if is_video {
            let mut stdin = child
                .lock()
                .stdin
                .take()
                .ok_or_else(|| anyhow!("ffmpeg stdin unavailable"))?;

            // Render frames sequentially through a dedicated compositor, separate
            // from the thumbnail pool, so export and thumbnail generation do not
            // contend for the same GPU target.
            let mut compositor = Compositor::new();
            let dev_id = compositor
                .ensure_offscreen_device()
                .context("export: no GPU device")?;

            let mut cache = super::timeline_render::VideoDecoderCache::new();
            let mut pipeline = compositor
                .begin_pipelined_readback(dev_id, width, height, 2)
                .context("export: failed to create pipelined readback")?;

            let result = (|| -> Result<()> {
                for i in 0..frame_count {
                    let time = start + i as f64 / fps;
                    let frame_scene = super::timeline_render::build_export_scene(
                        &scene,
                        time,
                        (width, height),
                        &mut cache,
                    )?;
                    if let Some(pixels) =
                        compositor.render_scene_to_pixels_pipelined(&mut pipeline, &frame_scene)?
                    {
                        if let Err(e) = stdin.write_all(&pixels) {
                            return Err(anyhow!("ffmpeg stdin closed prematurely: {e}"));
                        }
                        on_progress(pipeline.emitted as f64 / frame_count as f64);
                    }
                }
                // Сливаем хвостовые кадры, которые ещё висят в pipeline.
                for pixels in pipeline.drain(&mut compositor)? {
                    if let Err(e) = stdin.write_all(&pixels) {
                        return Err(anyhow!("ffmpeg stdin closed prematurely: {e}"));
                    }
                    on_progress(pipeline.emitted as f64 / frame_count as f64);
                }
                Ok(())
            })();

            // Close stdin so ffmpeg finalizes the container.
            drop(stdin);
            result
        } else {
            on_progress(1.0);
            Ok(())
        };

        if let Err(error) = render_result {
            // The write failed because ffmpeg closed the pipe — its stderr almost
            // always says why (bad encoder, unsupported pix_fmt, …). Surface that
            // instead of the generic "stdin closed prematurely" we observed locally.
            let mut guard = child.lock();
            let _ = guard.kill();
            let _ = guard.wait();
            drop(guard);
            let cancelled = tasks.was_cancelled(task_id);
            tasks.remove(task_id);
            if cancelled {
                return Err(anyhow!("cancelled"));
            }
            let stderr_text = stderr_handle
                .map(|h| String::from_utf8_lossy(&h.join().unwrap_or_default()).to_string())
                .unwrap_or_default();
            let stderr_text = stderr_text.trim();
            if stderr_text.is_empty() {
                return Err(error);
            }
            return Err(anyhow!("{error}: {stderr_text}"));
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
                let cancelled = tasks.was_cancelled(task_id);
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
                if cancelled {
                    return Err(anyhow!("cancelled"));
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
        // Only retry in software if the first attempt was actually hardware-encoded
        // and didn't fail because the user cancelled it.
        Err(e) if effective_hw != "none" && !e.to_string().contains("cancelled") => {
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
    let export_alpha = export_uses_alpha(options);
    let hw_mode = resolve_export_hw_mode(options);
    let is_video = options.video_enabled.unwrap_or(true);
    let has_audio = audio_input.is_some();
    let mut args = Vec::new();

    if hw_mode == "vaapi" {
        let vaapi_dev = options
            .vaapi_device
            .as_deref()
            .unwrap_or(DEFAULT_VAAPI_DEVICE);
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
    ]);

    // Audio-only path: no rawvideo stdin.
    if is_video {
        args.extend([
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
    }

    if let Some(audio) = audio_input {
        args.extend(["-i".to_string(), audio.display().to_string()]);
    }

    if is_video {
        let video_codec = ffmpeg_video_codec_hw(&options.video_codec, hw_mode);
        args.extend([
            "-c:v".to_string(),
            video_codec.to_string(),
            "-b:v".to_string(),
            options.video_bitrate_bps.max(1).to_string(),
        ]);

        // Bitrate mode
        let is_cbr = options.bitrate_mode.as_deref() == Some("constant");
        if is_cbr {
            let bitrate = options.video_bitrate_bps.max(1);
            if hw_mode == "nvdec" || hw_mode == "nvenc" {
                args.extend(["-rc".to_string(), "cbr".to_string()]);
            } else if hw_mode == "vaapi" {
                args.extend(["-rc_mode".to_string(), "CBR".to_string()]);
            } else {
                args.extend([
                    "-maxrate".to_string(),
                    bitrate.to_string(),
                    "-bufsize".to_string(),
                    bitrate.to_string(),
                ]);
            }
        }

        // Keyframe interval
        if let Some(interval_sec) = options.keyframe_interval_sec {
            if interval_sec.is_finite() && interval_sec > 0.0 {
                let gop = (fps * interval_sec).round() as u32;
                if gop > 0 {
                    args.extend(["-g".to_string(), gop.to_string()]);
                }
            }
        }

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
    } else {
        args.push("-vn".to_string());
    }

    if has_audio {
        let (codec, substituted) =
            resolve_audio_encoder(options.audio_codec.as_deref(), &options.format);
        if substituted {
            log::warn!(
                "[native-export] audio codec {:?} not usable for {} container; using {codec}",
                options.audio_codec,
                options.format
            );
        }
        args.extend(["-c:a".to_string(), codec.to_string()]);
        if let Some(bitrate) = options.audio_bitrate_bps {
            args.extend(["-b:a".to_string(), bitrate.max(1).to_string()]);
        }
        if let Some(sample_rate) = options.audio_sample_rate {
            let sr = sample_rate.clamp(8_000, 192_000);
            args.extend(["-ar".to_string(), sr.to_string()]);
        }
        if is_video {
            // Trim to the shorter stream; video duration is the reference.
            args.push("-shortest".to_string());
        }
    } else if is_video {
        args.push("-an".to_string());
    }

    // Metadata
    if let Some(title) = options.metadata_title.as_deref().filter(|s| !s.is_empty()) {
        args.extend(["-metadata".to_string(), format!("title={title}")]);
    }
    if let Some(description) = options
        .metadata_description
        .as_deref()
        .filter(|s| !s.is_empty())
    {
        args.extend([
            "-metadata".to_string(),
            format!("description={description}"),
        ]);
    }
    if let Some(author) = options.metadata_author.as_deref().filter(|s| !s.is_empty()) {
        args.extend(["-metadata".to_string(), format!("author={author}")]);
    }
    if let Some(tags) = options.metadata_tags.as_deref().filter(|s| !s.is_empty()) {
        args.extend(["-metadata".to_string(), format!("tags={tags}")]);
    }

    if options.format == "mp4" || options.format == "mov" {
        args.extend(["-movflags".to_string(), "+faststart".to_string()]);
    }

    args.push(target_path.display().to_string());
    args
}

/// Alpha export is only meaningful for containers/codecs that carry it (webm/mkv);
/// it also forces software encoding (HW VAAPI/NVENC paths here don't emit alpha).
fn export_uses_alpha(options: &NativeExportOptions) -> bool {
    options.export_alpha.unwrap_or(false) && (options.format == "webm" || options.format == "mkv")
}

/// Resolves the export hardware mode to a concrete `"vaapi" | "nvdec" | "none"`,
/// applying the same auto-detection used to build the ffmpeg args. Centralised so
/// the fallback decision and the arg builder can never disagree.
fn resolve_export_hw_mode(options: &NativeExportOptions) -> &'static str {
    if !options.enable_hardware_encoding.unwrap_or(false) || export_uses_alpha(options) {
        return "none";
    }
    match options
        .hardware_acceleration_mode
        .as_deref()
        .unwrap_or("none")
    {
        "auto" => {
            let dev = options
                .vaapi_device
                .as_deref()
                .unwrap_or(DEFAULT_VAAPI_DEVICE);
            if std::path::Path::new(dev).exists() {
                "vaapi"
            } else {
                "none"
            }
        }
        "vaapi" => "vaapi",
        "nvdec" | "nvenc" => "nvdec",
        _ => "none",
    }
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

    fn base_options() -> NativeExportOptions {
        NativeExportOptions {
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
            audio_sample_rate: None,
            video_enabled: None,
            bitrate_mode: None,
            keyframe_interval_sec: None,
            metadata_title: None,
            metadata_description: None,
            metadata_author: None,
            metadata_tags: None,
            ffmpeg_path: None,
            ffprobe_path: None,
            hardware_acceleration_mode: None,
            vaapi_device: None,
            enable_hardware_encoding: None,
            export_alpha: None,
        }
    }

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
            audio_sample_rate: Some(48_000),
            video_enabled: None,
            bitrate_mode: None,
            keyframe_interval_sec: None,
            metadata_title: None,
            metadata_description: None,
            metadata_author: None,
            metadata_tags: None,
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
            audio_sample_rate: None,
            video_enabled: None,
            bitrate_mode: None,
            keyframe_interval_sec: None,
            metadata_title: None,
            metadata_description: None,
            metadata_author: None,
            metadata_tags: None,
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
            audio_sample_rate: None,
            video_enabled: None,
            bitrate_mode: None,
            keyframe_interval_sec: None,
            metadata_title: None,
            metadata_description: None,
            metadata_author: None,
            metadata_tags: None,
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

    #[test]
    fn test_build_ffmpeg_args_adds_metadata_cbr_and_keyframes() {
        let options = NativeExportOptions {
            bitrate_mode: Some("constant".to_string()),
            keyframe_interval_sec: Some(2.0),
            metadata_title: Some("Export title".to_string()),
            metadata_description: Some("Export description".to_string()),
            metadata_author: Some("Author".to_string()),
            metadata_tags: Some("one, two".to_string()),
            ..base_options()
        };
        let args = build_ffmpeg_args(&options, None, 1920, 1080, 30.0, Path::new("output.mp4"));

        assert!(args.windows(2).any(|pair| pair == ["-g", "60"]));
        assert!(args.windows(2).any(|pair| pair == ["-maxrate", "5000000"]));
        assert!(args.windows(2).any(|pair| pair == ["-bufsize", "5000000"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-metadata", "title=Export title"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-metadata", "description=Export description"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-metadata", "author=Author"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-metadata", "tags=one, two"]));
    }

    #[test]
    fn test_build_ffmpeg_args_audio_only_skips_rawvideo_input() {
        let options = NativeExportOptions {
            format: "wav".to_string(),
            video_enabled: Some(false),
            audio_enabled: true,
            audio_codec: Some("pcm".to_string()),
            audio_sample_rate: Some(44_100),
            ..base_options()
        };
        let args = build_ffmpeg_args(
            &options,
            Some(Path::new("dummy.wav")),
            2,
            2,
            30.0,
            Path::new("output.wav"),
        );

        assert!(args.windows(2).any(|pair| pair == ["-vn", "-c:a"]));
        assert!(args.windows(2).any(|pair| pair == ["-ar", "44100"]));
        assert!(!args.windows(2).any(|pair| pair == ["-f", "rawvideo"]));
        assert!(!args.contains(&"-c:v".to_string()));
    }
}
