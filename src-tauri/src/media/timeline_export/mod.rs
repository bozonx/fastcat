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

use crate::audio::engine::render_scene_to_wav;
use crate::compositor::Compositor;
use crate::monitor::scene::MonitorScene;

use super::ffmpeg_utils::*;
use super::processing::{now_millis, spawn_stderr_drain, NativeMediaTasks};
use super::types::HwAccelMode;

pub mod audio;
pub mod direct;
pub mod ffmpeg_args_builder;
pub mod options;
#[cfg(test)]
mod tests;

pub use audio::temp_audio_path;
pub use options::NativeExportOptions;

use direct::plan_direct;
use ffmpeg_args_builder::{
    build_direct_ffmpeg_args, build_ffmpeg_args, export_uses_alpha, is_gpu_render_error,
    resolve_export_hw_mode,
};

/// Kill the export if ffmpeg makes no progress for this long. A stall guard rather
/// than a wall-clock cap, so a legitimately long encode that keeps streaming frames
/// (or flushing the container) is never killed mid-run, while a genuinely hung
/// process — a blocked stdin write or a stuck finalization — is reaped.
const EXPORT_STALL_TIMEOUT: Duration = Duration::from_secs(300);
const DEFAULT_FALLBACK_FPS: f64 = 30.0;
const DEFAULT_AUDIO_SAMPLE_RATE: u32 = 48_000;
const FRAME_SAMPLE_END_EPS_SEC: f64 = 1e-9;

pub(crate) fn export_frame_sample_time(
    start_sec: f64,
    end_sec: f64,
    fps: f64,
    frame_index: u64,
) -> f64 {
    let fps = if fps.is_finite() && fps > 0.0 {
        fps
    } else {
        DEFAULT_FALLBACK_FPS
    };
    let start = start_sec.max(0.0);
    let end = end_sec.max(start);
    let center = start + (frame_index as f64 + 0.5) / fps;
    if end <= start {
        return start;
    }
    let last_visible_time = (end - FRAME_SAMPLE_END_EPS_SEC).max(start);
    center.min(last_visible_time)
}

/// Runs the full export. `on_progress(0..1)` is called after each written frame.
pub fn export_timeline(
    tasks: &NativeMediaTasks,
    task_id: &str,
    scene: MonitorScene,
    options: NativeExportOptions,
    target_path: &Path,
    on_progress: &(dyn Fn(f64) + Send + Sync),
    on_warning: &(dyn Fn(String) + Send + Sync),
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

    // Split the progress bar between the offline audio pre-render (which runs to
    // completion before ffmpeg even starts) and the ffmpeg encode. The pre-render
    // takes a small leading slice when there is video to encode; an audio-only
    // export has no per-frame encode progress, so the pre-render owns the whole bar.
    let is_video_export = options.video_enabled.unwrap_or(true);
    let will_render_audio = options.audio_enabled && !scene.audio_layers.is_empty();
    let audio_progress_share = if will_render_audio {
        if is_video_export {
            0.1
        } else {
            1.0
        }
    } else {
        0.0
    };
    // Remaps the ffmpeg-encode fraction into the trailing slice after the pre-render.
    let report_video_progress = |frac: f64| {
        on_progress(audio_progress_share + (1.0 - audio_progress_share) * frac.clamp(0.0, 1.0));
    };

    // Resolve the hardware mode once (auto → vaapi/none, alpha forces software) so
    // the fallback decision below is based on what the first attempt *actually* used.
    // Otherwise an "auto" export on a machine without a VAAPI device would render the
    // whole timeline through software, then needlessly render it a second time.
    let effective_hw = resolve_export_hw_mode(&options);
    let effective_decode_hw = resolve_hw_decode_mode(
        options
            .hardware_acceleration_mode
            .as_ref()
            .unwrap_or(&HwAccelMode::None),
        options
            .vaapi_device
            .as_deref()
            .unwrap_or(DEFAULT_VAAPI_DEVICE),
    );
    let decode_vaapi_device = options.vaapi_device.clone();

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
        let last_reported_pct = std::sync::atomic::AtomicU32::new(0);
        if let Err(e) = render_scene_to_wav(crate::audio::mix::WavRenderParams {
            scene: &scene.audio_layers,
            tracks: &scene.audio_tracks,
            master_gain,
            audio_master_effects: &scene.audio_master_effects,
            start_sec: start,
            end_sec: audio_end,
            sample_rate,
            output_channels,
            target_path: &path,
            should_cancel: Some(&|| tasks.was_cancelled(task_id)),
            on_progress: Some(&|frac: f64| {
                let progress = (audio_progress_share * frac).clamp(0.0, 1.0);
                let pct = (progress * 100.0) as u32;
                let last = last_reported_pct.load(std::sync::atomic::Ordering::Relaxed);
                if pct != last || progress == 0.0 || progress == 1.0 {
                    last_reported_pct.store(pct, std::sync::atomic::Ordering::Relaxed);
                    on_progress(progress);
                }
            }),
        })
        .context("failed to render native audio mix")
        {
            let _ = std::fs::remove_file(&path);
            return Err(e);
        }
        Some(path)
    } else {
        None
    };

    // Fast path: a single untouched, frame-filling video clip needs no compositing, so
    // skip the per-frame vello render/readback entirely and let ffmpeg decode→scale→encode
    // the source in one pass. `None` keeps the full pipeline. Audio still rides as the
    // pre-rendered mix below.
    let direct_plan = plan_direct(
        &scene,
        &options,
        width,
        height,
        start,
        end,
        fps,
        frame_count,
    );
    if direct_plan.is_some() {
        log::info!("[native-export] using direct transcode (single untouched clip)");
    }

    // One export attempt with the given options. The caller owns temp_audio cleanup.
    let run_attempt = |opts: &NativeExportOptions| -> Result<()> {
        let is_video = opts.video_enabled.unwrap_or(true);
        if !is_video && audio_input.is_none() {
            return Err(anyhow!("audio-only export has no audio input"));
        }
        let direct = direct_plan.as_ref().filter(|_| is_video);

        // Background fill for the rendered frames. With alpha export the canvas stays
        // transparent (VP9 yuva420p carries it). Without alpha, ffmpeg discards the
        // alpha channel on RGBA→yuv420p, so clear to opaque black up front: uncovered
        // regions become black *and* semi-transparent edges blend correctly onto it,
        // instead of straight-alpha pixels being flattened over an implicit zero.
        let frame_background = if export_uses_alpha(opts) {
            vello::peniko::Color::TRANSPARENT
        } else {
            vello::peniko::Color::BLACK
        };

        let args = match direct {
            Some(plan) => build_direct_ffmpeg_args(
                opts,
                plan,
                audio_input.as_deref(),
                width,
                height,
                fps,
                target_path,
            ),
            None => build_ffmpeg_args(
                opts,
                audio_input.as_deref(),
                width,
                height,
                fps,
                frame_count as f64 / fps,
                target_path,
            ),
        };
        let ffmpeg_cmd = opts.ffmpeg_path.as_deref().unwrap_or("ffmpeg");
        verify_ffmpeg_binary(ffmpeg_cmd).context("ffmpeg binary check failed")?;
        let mut child = Command::new(ffmpeg_cmd)
            .args(&args)
            // Direct path reads the source file itself (no rawvideo stdin) and reports
            // progress on stdout; the vello path streams RGBA into stdin.
            .stdin(if is_video && direct.is_none() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(if direct.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stderr(Stdio::piped())
            .spawn()
            .context("failed to spawn ffmpeg for timeline export")?;

        // Drain stderr in background to avoid pipe deadlock, recording the last time
        // ffmpeg emitted anything so the watchdog can tell a true stall from a slow
        // but otherwise healthy encode.
        let (stderr_handle, last_activity, _stderr_buf) = spawn_stderr_drain(&mut child);

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
            // Poll cancellation here too (the registry is `Clone`/Arc-backed) so a cancel
            // is honoured within one tick on *both* export paths. The direct path otherwise
            // only notices a cancel when ffmpeg emits its next `-progress` line, which can
            // lag; the vello path checks per frame but stalls behind a blocked stdin write.
            let tasks = tasks.clone();
            let task_id = task_id.to_string();
            std::thread::spawn(move || {
                while !done.load(Ordering::Relaxed) {
                    std::thread::sleep(Duration::from_millis(250));
                    if tasks.was_cancelled(&task_id) {
                        let mut guard = child.lock();
                        let _ = guard.kill();
                        let _ = guard.wait();
                        break;
                    }
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
            let render_result = if let Some(plan) = direct {
                // Direct transcode: ffmpeg owns decode/scale/encode. We only relay its
                // `-progress` stdout to the UI and the stall watchdog until it finishes.
                let stdout = child
                    .lock()
                    .stdout
                    .take()
                    .ok_or_else(|| anyhow!("ffmpeg stdout unavailable"))?;
                let total_sec = plan.duration_sec;
                let reader = std::io::BufReader::new(stdout);
                let mut result = Ok(());
                for line in std::io::BufRead::lines(reader) {
                    let line = match line {
                        Ok(line) => line,
                        Err(e) => {
                            result = Err(anyhow!("reading ffmpeg progress: {e}"));
                            break;
                        }
                    };
                    if tasks.was_cancelled(task_id) {
                        result = Err(anyhow!("cancelled"));
                        break;
                    }
                    last_activity.store(now_millis(), Ordering::Release);
                    if let Some(rest) = line.strip_prefix("out_time_us=") {
                        if let Ok(us) = rest.trim().parse::<i64>() {
                            if total_sec > 0.0 && us >= 0 {
                                let frac = (us as f64 / 1_000_000.0 / total_sec).clamp(0.0, 1.0);
                                report_video_progress(frac);
                            }
                        }
                    } else if line.starts_with("progress=end") {
                        report_video_progress(1.0);
                    }
                }
                result
            } else if is_video {
                let stdin = child
                    .lock()
                    .stdin
                    .take()
                    .ok_or_else(|| anyhow!("ffmpeg stdin unavailable"))?;

                // Three-stage pipeline so decode (CPU), composite (GPU) and encode
                // (ffmpeg) run concurrently instead of taking turns on one thread:
                //
                //   decode thread → [scene] → GPU (this thread) → [rgba] → writer thread
                //
                // The old serial loop left every stage idle while another ran — the GPU
                // waited on the single-threaded CPU decode, then both stalled on a blocking
                // `stdin.write_all` whenever ffmpeg applied back-pressure — so neither the
                // GPU nor the CPU ever saturated. The bounded channels cap in-flight frames
                // (and therefore memory) while letting each stage work a frame ahead.
                //
                // Shutdown/error flow: when a downstream stage fails it drops its receiver,
                // so the upstream `send` returns `Err`. Each stage treats a failed send as
                // "stop quietly" and returns `Ok`, leaving the stage that *actually* failed
                // to surface the real error. Cancellation is detected in the decode stage
                // (per frame) and, faster, by the watchdog tearing ffmpeg down — which makes
                // the writer's `write_all` fail and unwinds the pipeline the same way.
                const PIPELINE_DEPTH: usize = 4;
                let (scene_tx, scene_rx) = std::sync::mpsc::sync_channel::<
                    crate::compositor::scene::Scene,
                >(PIPELINE_DEPTH);
                let (rgba_tx, rgba_rx) = std::sync::mpsc::sync_channel::<Vec<u8>>(PIPELINE_DEPTH);

                // Owned clone: `run_attempt` may run twice (HW→SW fallback), so we must not
                // move the captured `decode_vaapi_device` out of the enclosing closure.
                let decode_vaapi_device = decode_vaapi_device.clone();
                let scene_ref = &scene;
                let report = &report_video_progress;
                let activity = &last_activity;

                std::thread::scope(|s| -> Result<()> {
                    // Stage 1: decode each source frame and build its export scene.
                    let decode_handle = s.spawn(move || -> Result<()> {
                        let mut cache =
                            super::timeline_render::VideoDecoderCache::new_with_hw_decode(
                                effective_decode_hw,
                                decode_vaapi_device,
                            );
                        for i in 0..frame_count {
                            // Honour cancellation here; the watchdog covers the case where
                            // this stage is blocked on a full channel (GPU is the bottleneck).
                            if tasks.was_cancelled(task_id) {
                                return Err(anyhow!("cancelled"));
                            }
                            // Sample the CENTRE of each frame interval, not its leading
                            // edge. Clip boundaries are stored on a microsecond grid
                            // (`frameToUs`), so a boundary can sit up to half a microsecond
                            // *after* the exact `i/fps` edge; the half-open `covers()` test
                            // then kept the previous clip's last frame for one extra frame at
                            // the cut (a duplicate frame / stutter). The centre `(i+0.5)/fps`
                            // is always strictly inside frame `i`'s interval, on the correct
                            // side of any frame-quantised boundary — matching the paused
                            // monitor, which samples the quantised playhead exactly on the cut.
                            let time = export_frame_sample_time(start, end, fps, i);
                            let mut frame_scene = super::timeline_render::build_export_scene(
                                scene_ref,
                                time,
                                (width, height),
                                &mut cache,
                                Some(on_warning),
                            )?;
                            frame_scene.background = frame_background;
                            // Downstream (GPU) gone: stop and let it report the real error.
                            if scene_tx.send(frame_scene).is_err() {
                                return Ok(());
                            }
                        }
                        Ok(())
                    });

                    // Stage 3: stream finished RGBA frames into ffmpeg's stdin.
                    let write_handle = s.spawn(move || -> Result<()> {
                        let mut stdin = stdin;
                        let mut written: u64 = 0;
                        for pixels in rgba_rx.iter() {
                            if let Err(e) = stdin.write_all(&pixels) {
                                return Err(anyhow!("ffmpeg stdin closed prematurely: {e}"));
                            }
                            written += 1;
                            activity.store(now_millis(), Ordering::Release);
                            report(written as f64 / frame_count as f64);
                        }
                        // Close stdin so ffmpeg finalizes the container.
                        drop(stdin);
                        Ok(())
                    });

                    // Stage 2: composite on the GPU (this thread, separate from the
                    // thumbnail pool so export and thumbnails don't contend for the target).
                    let gpu_result = (|| -> Result<()> {
                        let mut compositor = Compositor::new();
                        let dev_id = compositor
                            .ensure_offscreen_device()
                            .context("export: no GPU device")?;
                        let mut pipeline = compositor
                            .begin_pipelined_readback(dev_id, width, height, 2)
                            .context("export: failed to create pipelined readback")?;
                        for frame_scene in scene_rx.iter() {
                            if let Some(pixels) = compositor
                                .render_scene_to_pixels_pipelined(&mut pipeline, &frame_scene)?
                            {
                                // Downstream (writer) gone: stop and let it report.
                                if rgba_tx.send(pixels).is_err() {
                                    return Ok(());
                                }
                            }
                        }
                        // Flush the tail frames still held in the readback pipeline.
                        for pixels in pipeline.drain(&mut compositor)? {
                            if rgba_tx.send(pixels).is_err() {
                                return Ok(());
                            }
                        }
                        Ok(())
                    })();
                    // Drop our sender so the writer's `rgba_rx.iter()` terminates.
                    drop(rgba_tx);

                    let decode_result = decode_handle
                        .join()
                        .map_err(|_| anyhow!("export decode thread panicked"))?;
                    let write_result = write_handle
                        .join()
                        .map_err(|_| anyhow!("export writer thread panicked"))?;

                    // Surface the root cause first: a stage whose downstream died returned
                    // Ok, so the only Err here is the stage that truly failed. Order
                    // decode → GPU → writer puts the cause ahead of the symptom.
                    decode_result.and(gpu_result).and(write_result)
                })
            } else {
                report_video_progress(1.0);
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

            // Finalization phase: stdin is closed and (for mp4/mov) ffmpeg now flushes the
            // encoder and writes the container trailer — a span that emits nothing on
            // stdin/stdout/stderr and so looks like a stall to the watchdog. A long but
            // healthy encode could be killed at "100%". Feed the watchdog from real output
            // progress instead: reset the clock now, then bump it whenever the output file
            // grows. (The faststart moov-relocation pass rewrites via a sibling temp and is
            // bounded by file size / disk speed, well under the stall window.)
            last_activity.store(now_millis(), Ordering::Release);
            let mut last_output_len = std::fs::metadata(target_path).map(|m| m.len()).unwrap_or(0);
            loop {
                if let Ok(len) = std::fs::metadata(target_path).map(|m| m.len()) {
                    if len != last_output_len {
                        last_output_len = len;
                        last_activity.store(now_millis(), Ordering::Release);
                    }
                }
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
