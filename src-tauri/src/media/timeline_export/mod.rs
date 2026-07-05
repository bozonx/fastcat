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
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};

use crate::audio::engine::render_scene_to_wav;
use crate::compositor::Compositor;
use crate::monitor::scene::{LayerKind, MonitorScene};

use super::ffmpeg::utils::*;
use super::processing::{
    finish_stderr_drain, now_millis, spawn_stderr_drain, NativeMediaTasks, StderrDrain,
};
use super::types::HwAccelMode;

pub(crate) mod audio;
pub(crate) mod direct;
pub(crate) mod ffmpeg_args_builder;
pub mod options;
#[cfg(test)]
mod tests;

pub use audio::temp_audio_path;
pub use options::NativeExportOptions;

/// Which sub-stage of the export a progress update belongs to. The export runs the
/// offline audio mix to completion first, then encodes video, so the frontend can
/// relabel the (single, monotonic) progress bar as the native side crosses phases.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ExportProgressPhase {
    Audio,
    Video,
}

impl ExportProgressPhase {
    /// Stable wire token emitted to the frontend alongside the progress fraction.
    pub fn as_str(self) -> &'static str {
        match self {
            ExportProgressPhase::Audio => "audio",
            ExportProgressPhase::Video => "video",
        }
    }
}

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
const EXPORT_TRACE_INTERVAL_FRAMES: u64 = 120;
const EXPORT_MEMORY_SAMPLE_INTERVAL_FRAMES: u64 = 30;
const EXPORT_MEMORY_TRACE_INTERVAL_FRAMES: u64 = 900;
const EXPORT_MEMORY_TRACE_RSS_STEP_MB: u64 = 256;
const EXPORT_MEMORY_LOW_AVAILABLE_MB: u64 = 1024;

fn export_trace_enabled() -> bool {
    static FLAG: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *FLAG.get_or_init(|| {
        std::env::var("FASTCAT_EXPORT_TRACE")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false)
    })
}

fn export_memory_trace_enabled() -> bool {
    static FLAG: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *FLAG.get_or_init(|| {
        std::env::var("FASTCAT_EXPORT_MEMORY_TRACE")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false)
    })
}

#[derive(Debug, Clone, Copy)]
struct ProcessMemorySnapshot {
    rss_mb: u64,
    peak_rss_mb: u64,
    available_mb: Option<u64>,
}

#[cfg(target_os = "linux")]
fn parse_proc_kb_field(contents: &str, key: &str) -> Option<u64> {
    contents.lines().find_map(|line| {
        let rest = line.strip_prefix(key)?;
        let kb = rest
            .split_whitespace()
            .next()
            .and_then(|value| value.parse::<u64>().ok())?;
        Some(kb / 1024)
    })
}

#[cfg(target_os = "linux")]
fn process_memory_snapshot() -> Option<ProcessMemorySnapshot> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    let rss_mb = parse_proc_kb_field(&status, "VmRSS:")?;
    let peak_rss_mb = parse_proc_kb_field(&status, "VmHWM:").unwrap_or(rss_mb);
    let available_mb = std::fs::read_to_string("/proc/meminfo")
        .ok()
        .and_then(|meminfo| parse_proc_kb_field(&meminfo, "MemAvailable:"));
    Some(ProcessMemorySnapshot {
        rss_mb,
        peak_rss_mb,
        available_mb,
    })
}

#[cfg(not(target_os = "linux"))]
fn process_memory_snapshot() -> Option<ProcessMemorySnapshot> {
    None
}

fn log_export_memory_checkpoint(stage: &str) {
    if !export_memory_trace_enabled() {
        return;
    }
    match process_memory_snapshot() {
        Some(snapshot) => log_export_memory_snapshot(stage, None, None, snapshot),
        None => log::info!("[native-export-memory] stage={stage} rss=unavailable"),
    }
}

fn log_export_memory_snapshot(
    stage: &str,
    frame: Option<u64>,
    frame_count: Option<u64>,
    snapshot: ProcessMemorySnapshot,
) {
    let progress = match (frame, frame_count) {
        (Some(frame), Some(total)) => format!(" frame={frame}/{total}"),
        _ => String::new(),
    };
    let available = snapshot
        .available_mb
        .map(|mb| format!(" available_mb={mb}"))
        .unwrap_or_default();
    log::info!(
        "[native-export-memory] stage={stage}{progress} rss_mb={} peak_rss_mb={}{}",
        snapshot.rss_mb,
        snapshot.peak_rss_mb,
        available
    );
}

struct ExportMemoryTrace {
    next_interval_frame: u64,
    last_rss_bucket_mb: Option<u64>,
    warned_low_available: bool,
}

impl ExportMemoryTrace {
    fn new() -> Self {
        Self {
            next_interval_frame: EXPORT_MEMORY_TRACE_INTERVAL_FRAMES,
            last_rss_bucket_mb: None,
            warned_low_available: false,
        }
    }

    fn record_frame(&mut self, stage: &str, frame: u64, frame_count: u64) {
        if !export_memory_trace_enabled() {
            return;
        }
        if frame != 1
            && frame != frame_count
            && !frame.is_multiple_of(EXPORT_MEMORY_SAMPLE_INTERVAL_FRAMES)
        {
            return;
        }
        let Some(snapshot) = process_memory_snapshot() else {
            if frame == 1 {
                log::info!("[native-export-memory] stage={stage} rss=unavailable");
            }
            return;
        };

        let rss_bucket = snapshot.rss_mb / EXPORT_MEMORY_TRACE_RSS_STEP_MB;
        let rss_crossed = self
            .last_rss_bucket_mb
            .is_some_and(|last| rss_bucket > last);
        self.last_rss_bucket_mb = Some(rss_bucket);

        let low_available = snapshot
            .available_mb
            .is_some_and(|mb| mb < EXPORT_MEMORY_LOW_AVAILABLE_MB);
        let should_warn_low_available = low_available && !self.warned_low_available;
        if should_warn_low_available {
            self.warned_low_available = true;
        }

        if frame == 1
            || frame == frame_count
            || frame >= self.next_interval_frame
            || rss_crossed
            || should_warn_low_available
        {
            while frame >= self.next_interval_frame {
                self.next_interval_frame += EXPORT_MEMORY_TRACE_INTERVAL_FRAMES;
            }
            log_export_memory_snapshot(stage, Some(frame), Some(frame_count), snapshot);
        }
    }
}

struct ExportStageTrace {
    stage: &'static str,
    count: u64,
    total_main_ms: f64,
    total_wait_ms: f64,
    started: Instant,
}

impl ExportStageTrace {
    fn new(stage: &'static str) -> Self {
        Self {
            stage,
            count: 0,
            total_main_ms: 0.0,
            total_wait_ms: 0.0,
            started: Instant::now(),
        }
    }

    fn record(&mut self, main_ms: f64, wait_ms: f64) {
        self.count += 1;
        self.total_main_ms += main_ms;
        self.total_wait_ms += wait_ms;
        if !self.count.is_multiple_of(EXPORT_TRACE_INTERVAL_FRAMES) {
            return;
        }

        let elapsed = self.started.elapsed().as_secs_f64().max(0.001);
        log::info!(
            "[native-export-trace] stage={} frames={} throughput_fps={:.2} avg_main_ms={:.2} avg_wait_ms={:.2}",
            self.stage,
            self.count,
            self.count as f64 / elapsed,
            self.total_main_ms / self.count as f64,
            self.total_wait_ms / self.count as f64,
        );
    }
}

fn trace_elapsed_ms(started: Option<Instant>) -> f64 {
    started
        .map(|instant| instant.elapsed().as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

const EXPORT_SCENE_QUEUE_MEMORY_BUDGET_BYTES: u64 = 192 * 1024 * 1024;

/// Bounded depth of the decode→GPU `Scene` channel.
///
/// Decode is bursty: a clip boundary triggers a seek + decode-from-keyframe (a
/// long-GOP source re-decodes a whole GOP for one output frame), so a shallow
/// scene buffer drains during that burst and the GPU stalls until decode catches
/// up. A deeper queue lets the decode thread run further ahead on the cheap
/// (sequential pull-forward) stretches and bank frames to cover the next cut,
/// smoothing GPU utilisation.
///
/// Cost: a queued `Scene` still holds decoded frame pixels (an `Arc<Vec<u8>>` per
/// active video layer, ~`width*height*4` bytes), so the queue is bounded by
/// estimated memory, not just count. Single-layer 1080p exports keep the deeper
/// buffer that hides decode bursts; dense multi-layer timelines are clamped to a
/// shallow queue before they can retain hundreds of MB of decoded frames.
pub(crate) fn scene_pipeline_depth(
    width: u32,
    height: u32,
    max_active_video_layers: usize,
) -> usize {
    let is_4k = width as u64 * height as u64 >= 3840 * 2160;
    let base_depth = if is_4k { 4 } else { 8 };
    let active_layers = max_active_video_layers.max(1) as u64;
    let bytes_per_layer_frame = width as u64 * height as u64 * 4;
    let estimated_scene_bytes = bytes_per_layer_frame.saturating_mul(active_layers).max(1);
    let budget_depth = (EXPORT_SCENE_QUEUE_MEMORY_BUDGET_BYTES / estimated_scene_bytes)
        .clamp(1, base_depth as u64);
    budget_depth as usize
}

fn max_active_video_layers(scene: &MonitorScene, start_sec: f64, end_sec: f64) -> usize {
    let mut events = Vec::new();
    for layer in &scene.layers {
        if layer.kind != LayerKind::Video || layer.opacity.clamp(0.0, 1.0) <= 0.0 {
            continue;
        }

        let layer_start = layer.timeline_start_sec.max(start_sec);
        let layer_end = layer.timeline_end_sec.min(end_sec);
        if layer_start.is_finite() && layer_end.is_finite() && layer_end > layer_start {
            events.push((layer_start, 1i32));
            events.push((layer_end, -1i32));
        }

        if let Some(transition) = &layer.transition_in {
            let transition_start = layer.timeline_start_sec;
            let transition_end = (layer.timeline_start_sec + transition.duration_sec)
                .min(layer.timeline_end_sec)
                .min(end_sec);
            let transition_start = transition_start.max(start_sec);
            if transition_start.is_finite()
                && transition_end.is_finite()
                && transition_end > transition_start
            {
                events.push((transition_start, 1));
                events.push((transition_end, -1));
            }
        }

        if let Some(transition) = &layer.transition_out {
            let duration = layer.timeline_end_sec - layer.timeline_start_sec;
            let transition_start = (layer.timeline_end_sec - transition.duration_sec.min(duration))
                .max(layer.timeline_start_sec)
                .max(start_sec);
            let transition_end = layer.timeline_end_sec.min(end_sec);
            if transition_start.is_finite()
                && transition_end.is_finite()
                && transition_end > transition_start
            {
                events.push((transition_start, 1));
                events.push((transition_end, -1));
            }
        }
    }

    if events.is_empty() {
        return 1;
    }

    events.sort_by(|a, b| {
        a.0.total_cmp(&b.0)
            // End events first: layer coverage is half-open `[start, end)`, so adjacent
            // cuts at the same timestamp do not overlap.
            .then_with(|| a.1.cmp(&b.1))
    });

    let mut active = 0i32;
    let mut max_active = 0i32;
    for (_, delta) in events {
        active = (active + delta).max(0);
        max_active = max_active.max(active);
    }
    max_active.max(1) as usize
}

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
    on_progress: &(dyn Fn(f64, ExportProgressPhase) + Send + Sync),
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
        on_progress(
            audio_progress_share + (1.0 - audio_progress_share) * frac.clamp(0.0, 1.0),
            ExportProgressPhase::Video,
        );
    };

    // Resolve the hardware mode once (auto → vaapi/none, alpha forces software) so
    // the fallback decision below is based on what the first attempt *actually* used.
    // Otherwise an "auto" export on a machine without a VAAPI device would render the
    // whole timeline through software, then needlessly render it a second time.
    let effective_hw = resolve_export_hw_mode(&options);
    let effective_decode_hw = options.hw.hw_decode_mode();
    let decode_vaapi_device = options.hw.vaapi_device.clone();

    // Render the native audio mix once so hardware-to-software fallback can reuse the
    // same temporary file instead of running the expensive offline mix twice.
    // RAII guard: the mix file is deleted when `temp_audio` drops, covering the
    // early-return error below, the normal end-of-fn return, *and* a panic or
    // hard kill mid-export (reclaimed on next launch by `temp::sweep_orphans`).
    let mut temp_audio: Option<crate::media::temp::TempFile> = None;
    let audio_input: Option<PathBuf> = if options.audio_enabled && !scene.audio_layers.is_empty() {
        // Create the guard *before* rendering: render_scene_to_wav creates the
        // file up front and may fail mid-write, which would otherwise orphan it.
        let guard = crate::media::temp::TempFile::new(temp_audio_path());
        let path = guard.path().to_path_buf();
        temp_audio = Some(guard);
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
        render_scene_to_wav(crate::audio::mix::WavRenderParams {
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
                    on_progress(progress, ExportProgressPhase::Audio);
                }
            }),
        })
        .context("failed to render native audio mix")?;
        log_export_memory_checkpoint("audio-prerender-done");
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
        direct::DirectExportParams {
            width,
            height,
            start,
            end,
            fps,
            frame_count,
        },
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
        let ffmpeg_cmd = opts.hw.ffmpeg_cmd();
        verify_ffmpeg_binary(ffmpeg_cmd).context("ffmpeg binary check failed")?;
        eprintln!("[native-export] ffmpeg args: {} {:?}", ffmpeg_cmd, args);
        log_export_memory_checkpoint("ffmpeg-spawn");
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
        let StderrDrain {
            handle: stderr_handle,
            last_activity,
            shared_buf: stderr_shared_buf,
        } = spawn_stderr_drain(&mut child);

        // Register the process so `native_media_cancel(task_id)` can stop it.
        let child = tasks.insert(task_id, child);

        // Watchdog: kill ffmpeg if it makes no progress for EXPORT_STALL_TIMEOUT. The
        // main thread can't enforce this itself — a blocked `stdin.write_all` (encoder
        // stopped consuming) only returns once the pipe is torn down, and finalization
        // is a plain blocking wait. The watchdog tears the process down on stall, which
        // unblocks both paths with an error.
        let watchdog_done = Arc::new(AtomicBool::new(false));
        let watchdog_stalled = Arc::new(AtomicBool::new(false));
        // Disarms the stall guard once ffmpeg enters finalization (see the finalization
        // phase below); the watchdog keeps honouring cancellation while it is set.
        let watchdog_finalizing = Arc::new(AtomicBool::new(false));
        let watchdog = {
            let child = child.clone();
            let activity = last_activity.clone();
            let done = watchdog_done.clone();
            let stalled = watchdog_stalled.clone();
            let finalizing = watchdog_finalizing.clone();
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
                    // After stdin is closed ffmpeg is finalizing the container (encoder
                    // flush + the in-place `+faststart` moov relocation). That pass
                    // rewrites the file in place — constant size, silent on stdout/stderr —
                    // so it has no heartbeat to feed the guard and on a large export runs
                    // for minutes; meanwhile the blocked-stdin-write failure this guard
                    // exists for can no longer happen. Skip the stall-kill here so a healthy
                    // finalization is never reaped at the finish line (cancellation above
                    // still tears the process down).
                    if finalizing.load(Ordering::Relaxed) {
                        continue;
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
            if tasks.was_cancelled(task_id) {
                return Err(anyhow!("cancelled"));
            }
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
                // Decode is bursty: a clip boundary triggers a seek + decode-from-keyframe
                // (a long-GOP source re-decodes a whole GOP for one output frame), so a
                // 4-deep scene buffer drains during that burst and the GPU stalls until
                // decode catches up. A deeper scene queue lets the decode thread run
                // further ahead on the cheap (sequential pull-forward) stretches and bank
                // frames to cover the next cut, smoothing GPU utilisation.
                //
                // Cost: a queued `Scene` still holds decoded frame pixels for every
                // active video layer. Dense timelines clamp the scene queue by an
                // estimated memory budget; the rgba channel stays at PIPELINE_DEPTH
                // because each slot is one full readback buffer and is already capped by
                // the GPU readback pipeline downstream.
                let active_video_layers = max_active_video_layers(&scene, start, end);
                let scene_depth = scene_pipeline_depth(width, height, active_video_layers);
                log::info!(
                    "[native-export] scene queue depth={} active_video_layers={} resolution={}x{}",
                    scene_depth,
                    active_video_layers,
                    width,
                    height
                );
                log_export_memory_checkpoint("compositor-pipeline-start");
                let (scene_tx, scene_rx) =
                    std::sync::mpsc::sync_channel::<crate::compositor::scene::Scene>(scene_depth);
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
                        let mut trace = export_trace_enabled()
                            .then(|| ExportStageTrace::new("decode-build-scene"));
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
                            let build_started = trace.as_ref().map(|_| Instant::now());
                            let mut frame_scene = super::timeline_render::build_export_scene(
                                scene_ref,
                                time,
                                (width, height),
                                &mut cache,
                                Some(on_warning),
                                crate::compositor::effects::EffectQuality::Ultra,
                            )?;
                            frame_scene.background = frame_background;
                            let build_ms = trace_elapsed_ms(build_started);
                            // Downstream (GPU) gone: stop and let it report the real error.
                            let send_started = trace.as_ref().map(|_| Instant::now());
                            if scene_tx.send(frame_scene).is_err() {
                                return Ok(());
                            }
                            let send_wait_ms = trace_elapsed_ms(send_started);
                            if let Some(trace) = trace.as_mut() {
                                trace.record(build_ms, send_wait_ms);
                            }
                        }
                        Ok(())
                    });

                    // Stage 3: stream finished RGBA frames into ffmpeg's stdin.
                    let write_handle = s.spawn(move || -> Result<()> {
                        let mut trace =
                            export_trace_enabled().then(|| ExportStageTrace::new("writer"));
                        let mut memory_trace = ExportMemoryTrace::new();
                        let mut stdin = stdin;
                        let mut written: u64 = 0;
                        for pixels in rgba_rx.iter() {
                            let write_started = trace.as_ref().map(|_| Instant::now());
                            if let Err(e) = stdin.write_all(&pixels) {
                                return Err(anyhow!("ffmpeg stdin closed prematurely: {e}"));
                            }
                            let write_ms = trace_elapsed_ms(write_started);
                            written += 1;
                            activity.store(now_millis(), Ordering::Release);
                            report(written as f64 / frame_count as f64);
                            memory_trace.record_frame("writer", written, frame_count);
                            if let Some(trace) = trace.as_mut() {
                                trace.record(write_ms, 0.0);
                            }
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
                        // Deeper pipeline = more in-flight slots so the GPU does not
                        // stall waiting for `map_async` to complete. Each slot costs
                        // one offscreen texture + readback buffer (~width*height*4
                        // bytes). At 1080p that is ~8.3 MB/slot, so depth 4 is cheap;
                        // at 4K it is ~33 MB/slot, so cap depth there to keep the
                        // readback buffers bounded.
                        let is_4k = width as u64 * height as u64 >= 3840 * 2160;
                        let readback_depth = if is_4k { 3 } else { 4 };
                        let mut pipeline = compositor
                            .begin_pipelined_readback(dev_id, width, height, readback_depth)
                            .context("export: failed to create pipelined readback")?;
                        let mut trace =
                            export_trace_enabled().then(|| ExportStageTrace::new("gpu-readback"));
                        for frame_scene in scene_rx.iter() {
                            let render_started = trace.as_ref().map(|_| Instant::now());
                            let pixels = compositor
                                .render_scene_to_pixels_pipelined(&mut pipeline, &frame_scene)?;
                            let render_ms = trace_elapsed_ms(render_started);
                            let mut send_wait_ms = 0.0;
                            if let Some(pixels) = pixels {
                                // Downstream (writer) gone: stop and let it report.
                                let send_started = trace.as_ref().map(|_| Instant::now());
                                if rgba_tx.send(pixels).is_err() {
                                    return Ok(());
                                }
                                send_wait_ms = trace_elapsed_ms(send_started);
                            }
                            if let Some(trace) = trace.as_mut() {
                                trace.record(render_ms, send_wait_ms);
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
                let stderr_bytes = finish_stderr_drain(stderr_handle, &stderr_shared_buf);
                let stderr_text = String::from_utf8_lossy(&stderr_bytes);
                let stderr_text = stderr_text.trim();
                if stderr_text.is_empty() {
                    return Err(error);
                }
                return Err(anyhow!("{error}: {stderr_text}"));
            }

            // Finalization phase: stdin is closed and (for mp4/mov) ffmpeg now flushes the
            // encoder and writes the container trailer, including the in-place `+faststart`
            // moov relocation. That relocation rewrites the whole file in place — constant
            // size, nothing emitted on stdin/stdout/stderr — so it has no heartbeat the
            // stall watchdog can observe and on a large export legitimately runs for
            // minutes. Disarm the stall guard now that every frame has been delivered: the
            // blocked-stdin-write hang it exists for is no longer possible. The watchdog
            // keeps polling cancellation, so a cancel (or a truly hung mux the user aborts)
            // still tears the process down.
            watchdog_finalizing.store(true, Ordering::Relaxed);
            log_export_memory_checkpoint("ffmpeg-finalize-start");
            loop {
                let mut guard = child.lock();
                if let Some(status) = guard.try_wait().context("failed to poll ffmpeg export")? {
                    let stderr_text = String::from_utf8_lossy(&finish_stderr_drain(
                        stderr_handle,
                        &stderr_shared_buf,
                    ))
                    .to_string();
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
                        log_export_memory_checkpoint("export-done");
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
            sw_options.hw.enable_hardware_encoding = Some(false);
            run_attempt(&sw_options)
        }
        other => other,
    };

    // ffmpeg is done with the mix; drop the guard now to delete it promptly
    // rather than waiting for the function to return.
    drop(temp_audio);
    result
}
