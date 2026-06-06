//! Native timeline export: render each frame through vello, stream raw RGBA to
//! ffmpeg stdin, then encode.
//!
//! Architecture:
//!   - Video is rendered by the native core (the same `compositor`/`scene_build`
//!     path as preview/thumbnail), so export matches the monitor pixel-for-pixel.
//!   - Audio is rendered by the native audio mixer (`render_scene_to_wav`) over the
//!     export range; the native side has no browser pre-mix path.
//!
//! ffmpeg runs as one process: `-f rawvideo -pix_fmt rgba -s WxH -r fps -i -`
//! for stdin video, plus optional `-i <audio>` and codec flags. Progress is
//! reported after each written frame. Cancellation is handled through
//! `NativeMediaTasks`, the same registry used by `native_media_cancel`.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;

use crate::audio::engine::render_scene_to_wav;
use crate::compositor::Compositor;
use crate::monitor::scene::MonitorScene;

use super::ffmpeg_args::*;
use super::ffmpeg_utils::*;
use super::types::HwAccelMode;
use super::processing::{now_millis, spawn_stderr_drain, NativeMediaTasks};

/// Kill the export if ffmpeg makes no progress for this long. A stall guard rather
/// than a wall-clock cap, so a legitimately long encode that keeps streaming frames
/// (or flushing the container) is never killed mid-run, while a genuinely hung
/// process — a blocked stdin write or a stuck finalization — is reaped.
const EXPORT_STALL_TIMEOUT: Duration = Duration::from_secs(300);
const DEFAULT_FALLBACK_FPS: f64 = 30.0;
const DEFAULT_AUDIO_SAMPLE_RATE: u32 = 48_000;

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
    #[serde(default)]
    pub audio_enabled: bool,
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
        DEFAULT_FALLBACK_FPS
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

    // Video runs `frame_count / fps` seconds, which is ≥ (end - start). Render the
    // audio mix to that same length so the muxer's `-shortest` doesn't clip the
    // final partial frame. Audio-only exports keep the exact requested range.
    let audio_end = if options.video_enabled.unwrap_or(true) {
        start + frame_count as f64 / fps
    } else {
        end
    };

    // Resolve the hardware mode once (auto → vaapi/none, alpha forces software) so
    // the fallback decision below is based on what the first attempt *actually* used.
    // Otherwise an "auto" export on a machine without a VAAPI device would render the
    // whole timeline through software, then needlessly render it a second time.
    let effective_hw = resolve_export_hw_mode(&options);

    // Render the native audio mix once so hardware-to-software fallback can reuse the
    // same temporary file instead of running the expensive offline mix twice.
    let mut temp_audio: Option<PathBuf> = None;
    let audio_input: Option<PathBuf> = if options.audio_enabled && !scene.audio_layers.is_empty() {
        let path = temp_audio_path();
        // Register the temp path for cleanup *before* rendering: render_scene_to_wav
        // creates the file up front and may fail mid-write, which would otherwise
        // orphan it.
        temp_audio = Some(path.clone());
        let master_gain = if scene.audio_master_muted {
            0.0
        } else {
            scene.audio_master_gain
        };
        let output_channels = options.audio_channels.unwrap_or(2).clamp(1, 2) as usize;
        let sample_rate = options
            .audio_sample_rate
            .unwrap_or(DEFAULT_AUDIO_SAMPLE_RATE)
            .clamp(8_000, 192_000);
        if let Err(e) = render_scene_to_wav(
            &scene.audio_layers,
            &scene.audio_tracks,
            master_gain,
            start,
            audio_end,
            sample_rate,
            output_channels,
            &path,
        )
        .context("failed to render native audio mix")
        {
            let _ = std::fs::remove_file(&path);
            return Err(e);
        }
        Some(path)
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

        // Drain stderr in background to avoid pipe deadlock, recording the last time
        // ffmpeg emitted anything so the watchdog can tell a true stall from a slow
        // but otherwise healthy encode.
        let (stderr_handle, last_activity) = spawn_stderr_drain(&mut child);

        // Register the process so `native_media_cancel(task_id)` can stop it.
        let child = tasks.insert(task_id, child);

        // Watchdog: kill ffmpeg if it makes no progress for EXPORT_STALL_TIMEOUT. The
        // main thread can't enforce this itself — a blocked `stdin.write_all` (encoder
        // stopped consuming) only returns once the pipe is torn down, and finalization
        // is a plain blocking wait. The watchdog tears the process down on stall, which
        // unblocks both paths with an error.
        let watchdog_done = Arc::new(AtomicBool::new(false));
        let watchdog_stalled = Arc::new(AtomicBool::new(false));
        let watchdog = {
            let child = child.clone();
            let activity = last_activity.clone();
            let done = watchdog_done.clone();
            let stalled = watchdog_stalled.clone();
            std::thread::spawn(move || {
                while !done.load(Ordering::Relaxed) {
                    std::thread::sleep(Duration::from_millis(250));
                    let idle_ms = now_millis().saturating_sub(activity.load(Ordering::Acquire));
                    if idle_ms > EXPORT_STALL_TIMEOUT.as_millis() as u64 {
                        stalled.store(true, Ordering::Relaxed);
                        let mut guard = child.lock();
                        let _ = guard.kill();
                        let _ = guard.wait();
                        break;
                    }
                }
            })
        };

        let io_result = (|| -> Result<()> {
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
                        // Honour cancellation even while the GPU is the bottleneck and no
                        // frame is being written (the stdin-write path below only notices a
                        // killed ffmpeg on the next successful emit).
                        if tasks.was_cancelled(task_id) {
                            return Err(anyhow!("cancelled"));
                        }
                        let time = start + i as f64 / fps;
                        let frame_scene = super::timeline_render::build_export_scene(
                            &scene,
                            time,
                            (width, height),
                            &mut cache,
                        )?;
                        if let Some(pixels) = compositor
                            .render_scene_to_pixels_pipelined(&mut pipeline, &frame_scene)?
                        {
                            if let Err(e) = stdin.write_all(&pixels) {
                                return Err(anyhow!("ffmpeg stdin closed prematurely: {e}"));
                            }
                            last_activity.store(now_millis(), Ordering::Release);
                            on_progress(pipeline.emitted as f64 / frame_count as f64);
                        }
                    }
                    // Сливаем хвостовые кадры, которые ещё висят в pipeline.
                    for pixels in pipeline.drain(&mut compositor)? {
                        if let Err(e) = stdin.write_all(&pixels) {
                            return Err(anyhow!("ffmpeg stdin closed prematurely: {e}"));
                        }
                        last_activity.store(now_millis(), Ordering::Release);
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
            }
        })();

        // Stop the watchdog before returning so it can't kill a later attempt's
        // process (the HW→SW fallback spawns a fresh ffmpeg under the same task id).
        watchdog_done.store(true, Ordering::Relaxed);
        let _ = watchdog.join();

        // A stall surfaces as a broken pipe / non-zero exit; relabel it so the user
        // sees the real cause. Cancellation takes precedence over a coincident stall.
        match io_result {
            Err(e)
                if watchdog_stalled.load(Ordering::Relaxed)
                    && !e.to_string().contains("cancelled") =>
            {
                Err(anyhow!(
                    "ffmpeg export stalled: no progress for {} seconds",
                    EXPORT_STALL_TIMEOUT.as_secs()
                ))
            }
            other => other,
        }
    };

    let result = match run_attempt(&options) {
        // Only retry in software if the first attempt was actually hardware-encoded,
        // wasn't cancelled, and didn't fail in the GPU render path. Software fallback
        // only swaps the encoder, so a render/GPU error would recur identically and a
        // full re-render would be wasted work.
        Err(e)
            if effective_hw != HwAccelMode::None
                && !e.to_string().contains("cancelled")
                && !is_gpu_render_error(&e.to_string()) =>
        {
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

    if hw_mode == HwAccelMode::Vaapi {
        let vaapi_dev = options
            .vaapi_device
            .as_deref()
            .unwrap_or(DEFAULT_VAAPI_DEVICE);
        push_vaapi_init_device_args(&mut args, vaapi_dev);
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

        // Bitrate mode. CBR must actually pin the rate, not just select a mode flag
        // on one backend and a peak cap on another. Combine the backend-specific
        // rate-control selector with a shared HRD buffer (maxrate == bufsize ==
        // bitrate) so every encoder targets the same constant rate.
        let is_cbr = options.bitrate_mode.as_deref() == Some("constant");
        if is_cbr {
            let bitrate = options.video_bitrate_bps.max(1).to_string();
            match hw_mode {
                HwAccelMode::Nvdec | HwAccelMode::Nvenc => args.extend(["-rc".to_string(), "cbr".to_string()]),
                HwAccelMode::Vaapi => args.extend(["-rc_mode".to_string(), "CBR".to_string()]),
                // Software encoders only get a *cap* from maxrate/bufsize; add an equal
                // floor so the rate is constant rather than merely bounded above.
                _ => args.extend(["-minrate".to_string(), bitrate.clone()]),
            }
            args.extend([
                "-maxrate".to_string(),
                bitrate.clone(),
                "-bufsize".to_string(),
                bitrate,
            ]);
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

        push_video_encode_filter_args(&mut args, hw_mode, 0, 0, export_alpha);
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
        // Lossless encoders ignore (and warn about) a target bitrate.
        let is_lossless_audio = codec == "flac" || codec.starts_with("pcm");
        if !is_lossless_audio {
            if let Some(bitrate) = options.audio_bitrate_bps {
                args.extend(["-b:a".to_string(), bitrate.max(1).to_string()]);
            }
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
///
/// The only encoder path that actually emits alpha is VP9 software (yuva420p +
/// libvpx-vp9). MKV's default codec is AV1 (libsvtav1), which rejects yuva420p, so
/// gate on the resolved codec too — otherwise an alpha+MKV request would slip past
/// the validation in `export_timeline` and produce a broken ffmpeg invocation.
fn export_uses_alpha(options: &NativeExportOptions) -> bool {
    options.export_alpha.unwrap_or(false)
        && (options.format == "webm" || options.format == "mkv")
        && ffmpeg_video_codec(&options.video_codec) == "libvpx-vp9"
}

/// Resolves the export hardware mode to a concrete `"vaapi" | "nvdec" | "none"`,
/// applying the same auto-detection used to build the ffmpeg args. Centralised so
/// the fallback decision and the arg builder can never disagree.
fn resolve_export_hw_mode(options: &NativeExportOptions) -> HwAccelMode {
    if !options.enable_hardware_encoding.unwrap_or(false) || export_uses_alpha(options) {
        return HwAccelMode::None;
    }
    let hw_accel = options.hardware_acceleration_mode.as_deref().unwrap_or("none");
    let vaapi_device = options.vaapi_device.as_deref().unwrap_or(DEFAULT_VAAPI_DEVICE);
    let mode = resolve_hw_decode_mode(hw_accel, vaapi_device);
    if mode == HwAccelMode::None && hw_accel == "auto" && std::path::Path::new("/dev/nvidia0").exists() {
        // No VAAPI render node, but an NVIDIA device is present — use NVENC
        // instead of silently dropping to software.
        HwAccelMode::Nvdec
    } else {
        mode
    }
}

/// True for errors raised by the GPU render path rather than the ffmpeg encoder.
/// A software fallback only swaps the encoder, so such failures would recur and a
/// full re-render would be wasted work — see the fallback guard in `export_timeline`.
fn is_gpu_render_error(message: &str) -> bool {
    message.contains("no GPU device")
        || message.contains("pipelined readback")
        || message.contains("vello render")
        || message.contains("no renderer for device")
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
        // Software CBR pins the rate with an equal floor/ceiling, not just a cap.
        assert!(args.windows(2).any(|pair| pair == ["-minrate", "5000000"]));
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
        // WAV/PCM must use a PCM encoder, not silently downgrade to AAC.
        assert!(args.windows(2).any(|pair| pair == ["-c:a", "pcm_s16le"]));
        assert!(!args.contains(&"aac".to_string()));
    }

    #[test]
    fn test_lossless_audio_skips_bitrate() {
        let options = NativeExportOptions {
            format: "flac".to_string(),
            video_enabled: Some(false),
            audio_enabled: true,
            audio_codec: Some("flac".to_string()),
            audio_bitrate_bps: Some(320_000),
            ..base_options()
        };
        let args = build_ffmpeg_args(
            &options,
            Some(Path::new("dummy.wav")),
            2,
            2,
            30.0,
            Path::new("output.flac"),
        );
        assert!(args.windows(2).any(|pair| pair == ["-c:a", "flac"]));
        // FLAC ignores a target bitrate; -b:a must not be emitted.
        assert!(!args.contains(&"-b:a".to_string()));
    }

    #[test]
    fn test_alpha_mkv_av1_does_not_emit_yuva() {
        // MKV's default codec is AV1 (libsvtav1), which can't carry alpha. The
        // request must not produce a yuva420p invocation that ffmpeg would reject.
        let options = NativeExportOptions {
            video_codec: "av01.0.05M.08".to_string(),
            format: "mkv".to_string(),
            export_alpha: Some(true),
            ..base_options()
        };
        assert!(!export_uses_alpha(&options));
        let args = build_ffmpeg_args(&options, None, 1920, 1080, 30.0, Path::new("output.mkv"));
        assert!(!args.contains(&"yuva420p".to_string()));
        assert!(!args.contains(&"-auto-alt-ref".to_string()));
    }

    #[test]
    fn test_alpha_mkv_vp9_emits_yuva() {
        // VP9 in MKV is the one codec/container pairing that does carry alpha.
        let options = NativeExportOptions {
            video_codec: "vp9".to_string(),
            format: "mkv".to_string(),
            export_alpha: Some(true),
            ..base_options()
        };
        assert!(export_uses_alpha(&options));
        let args = build_ffmpeg_args(&options, None, 1920, 1080, 30.0, Path::new("output.mkv"));
        assert!(args.contains(&"yuva420p".to_string()));
        assert!(args.windows(2).any(|pair| pair == ["-auto-alt-ref", "0"]));
    }

    #[test]
    fn test_mp4_flac_request_remaps_to_aac() {
        // mp4/mov can't carry FLAC/PCM — those must remap to AAC.
        assert_eq!(resolve_audio_encoder(Some("flac"), "mp4"), ("aac", true));
        assert_eq!(resolve_audio_encoder(Some("pcm"), "mov"), ("aac", true));
        // mkv keeps them.
        assert_eq!(resolve_audio_encoder(Some("flac"), "mkv"), ("flac", false));
        assert_eq!(
            resolve_audio_encoder(Some("pcm"), "mkv"),
            ("pcm_s16le", false)
        );
    }
}
