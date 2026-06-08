use std::panic::{self, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use anyhow::{Context, Result};
use parking_lot::{Condvar, Mutex};

use crate::audio::clock::RealtimeClock;
use crate::audio::mix::mix_chunk;
use crate::audio::ring::SpscRingBuffer;
use crate::audio::shared::{
    AudioRenderTarget, AudioShared, CHUNK_DURATION_SEC, PREBUFFER_CHUNKS,
    PRODUCER_RESYNC_THRESHOLD_SEC, START_PREBUFFER_CHUNKS,
};

pub(crate) fn spawn_producer_thread(
    shared: Arc<(Mutex<AudioShared>, Condvar)>,
    ring: Arc<SpscRingBuffer>,
    running: Arc<AtomicBool>,
    clock: Arc<RealtimeClock>,
    target: AudioRenderTarget,
) -> Result<JoinHandle<()>> {
    std::thread::Builder::new()
        .name("fastcat-audio-producer".into())
        .spawn(move || {
            set_producer_realtime_priority();
            let running_for_log = running.clone();
            let result = panic::catch_unwind(AssertUnwindSafe(|| {
                producer_loop(shared, ring, running, clock, target);
            }));
            match result {
                Ok(()) if running_for_log.load(Ordering::Acquire) => {
                    log::error!("[audio] producer thread exited")
                }
                Ok(()) => log::debug!("[audio] producer thread exited"),
                Err(error) => log::error!(
                    "[audio] producer thread panicked and exited: {}",
                    panic_payload_message(&error)
                ),
            }
        })
        .context("failed to spawn audio producer thread")
}

pub(crate) fn producer_loop(
    shared: Arc<(Mutex<AudioShared>, Condvar)>,
    ring: Arc<SpscRingBuffer>,
    running: Arc<AtomicBool>,
    clock: Arc<RealtimeClock>,
    target: AudioRenderTarget,
) {
    let sample_rate = target.sample_rate;
    let output_channels = target.channels;
    let chunk_frames = (CHUNK_DURATION_SEC * sample_rate as f64).round().max(1.0) as usize;
    let chunk_duration_sec = chunk_frames as f64 / sample_rate as f64;
    let limit_samples = chunk_frames * output_channels * PREBUFFER_CHUNKS;
    let start_prebuffer_samples = chunk_frames * output_channels * START_PREBUFFER_CHUNKS;

    // Cached clones of the scene/tracks, refreshed only when `scene_serial`
    // changes, so a static timeline doesn't re-clone the whole scene 20×/sec.
    let mut cached: Option<(
        u64,
        Vec<crate::monitor::scene::SceneAudioLayer>,
        Vec<crate::monitor::scene::SceneAudioTrack>,
    )> = None;

    // Throttled underrun reporting. The real-time callback only bumps the atomic
    // counters; here we log at most once per second when new underruns appear, so
    // crackle/dropouts become visible without spamming or touching the RT path.
    let mut last_underrun_events = 0u64;
    let mut last_underrun_log = std::time::Instant::now();

    // Decode-budget instrumentation. If producing one chunk takes longer than the
    // chunk's own playback duration, the producer is slower than real time and the
    // ring will drain under sustained load (heard as crackle) no matter how large
    // the prebuffer. Counted here and logged throttled (≤1/s) so we can tell a
    // "decode too slow" problem apart from a device-level xrun without spamming.
    let mut over_budget_chunks = 0u64;
    let mut worst_chunk_ms = 0.0f64;
    let mut last_budget_log = std::time::Instant::now();

    // Effective output-rate check. The device must consume ~`sample_rate` frames
    // per wall-second; if it consumes a different rate (e.g. the audio graph runs
    // at 48000 while we opened 44100), every clip plays fast/slow and pitch-shifted
    // with no underrun to flag it. Sample `clock.frames()` once a second and warn
    // on >2% deviation. Resets (seek/arm zero the counter) are skipped.
    let mut last_consumed: Option<(u64, std::time::Instant)> = None;

    while running.load(Ordering::Relaxed) {
        if last_underrun_log.elapsed() >= Duration::from_secs(1) {
            if clock.playing.load(Ordering::Acquire) {
                let now = std::time::Instant::now();
                let cur = clock.frames();
                if let Some((prev, prev_t)) = last_consumed {
                    let dt = now.duration_since(prev_t).as_secs_f64();
                    if cur >= prev && dt > 0.5 {
                        let effective = (cur - prev) as f64 / dt;
                        let deviation = (effective - sample_rate as f64).abs() / sample_rate as f64;
                        if deviation > 0.02 {
                            log::warn!(
                                "[audio] effective output rate {effective:.0} Hz differs from the \
                                 opened {sample_rate} Hz by {:.1}% — the device/graph clock does \
                                 not match the stream, so playback is sped up/slowed and pitch \
                                 shifted. Open the output at the graph's native rate.",
                                deviation * 100.0,
                            );
                        }
                    }
                }
                last_consumed = Some((cur, now));
            } else {
                last_consumed = None;
            }
            let events = clock.underrun_events.load(Ordering::SeqCst);
            // A seek/play calls `reset_frames`, zeroing the counters; rebase so we
            // don't go silent until the count climbs back past the old baseline.
            if events < last_underrun_events {
                last_underrun_events = 0;
            }
            if events > last_underrun_events {
                let frames = clock.underrun_frames.load(Ordering::SeqCst);
                let new_events = events - last_underrun_events;
                log::warn!(
                    "[audio] ring underrun: {new_events} dropout(s) in the last ~1s \
                     ({frames} total silent frames, {events} events since start) — \
                     producer is missing the {:.0}ms chunk deadline; raise PREBUFFER_CHUNKS \
                     or grant the producer real-time priority",
                    CHUNK_DURATION_SEC * 1000.0,
                );
                last_underrun_events = events;
            }
            last_underrun_log = std::time::Instant::now();
        }

        let snapshot = {
            let mut state = shared.0.lock();
            loop {
                if !running.load(Ordering::Relaxed) {
                    return;
                }
                if state.pending_ring_clear {
                    state.pending_ring_clear = false;
                    ring.clear();
                    continue;
                }
                if state.playing && !state.scene.is_empty() && ring.len() < limit_samples {
                    // Refresh the cached scene clone only on a real change.
                    if cached.as_ref().map(|(s, _, _)| *s) != Some(state.scene_serial) {
                        cached = Some((
                            state.scene_serial,
                            state.scene.clone(),
                            state.tracks.clone(),
                        ));
                    }

                    // Realign the mix position with the audible playhead. After an
                    // output underrun the callback advanced `frames_written` over
                    // silence; without this the producer would keep emitting audio
                    // for an already-past position, lagging permanently.
                    let buffered_frames = (ring.len() / output_channels) as f64;
                    let expected_pts = state.origin_pts_sec
                        + (clock.frames() as f64 + buffered_frames) / sample_rate as f64;
                    if state.producer_pts_sec + PRODUCER_RESYNC_THRESHOLD_SEC < expected_pts {
                        state.producer_pts_sec = expected_pts;
                    }

                    break Some((state.master_gain, state.producer_pts_sec, state.seek_serial));
                }
                // Short 1 ms sleep instead of 50 ms: the producer must wake quickly
                // when the ring drops below the prebuffer limit to avoid underruns.
                let wait_res = shared.1.wait_for(&mut state, Duration::from_millis(1));
                if wait_res.timed_out()
                    && (!state.playing || state.scene.is_empty() || ring.len() >= limit_samples)
                {
                    break None;
                }
            }
        };

        let Some((master_gain, chunk_start, seek_serial)) = snapshot else {
            continue;
        };
        let Some((_, scene, tracks)) = cached.as_ref() else {
            continue;
        };

        let mix_started = std::time::Instant::now();
        let chunk = match panic::catch_unwind(AssertUnwindSafe(|| {
            mix_chunk(
                scene,
                tracks,
                master_gain,
                chunk_start,
                chunk_duration_sec,
                target,
                &shared,
            )
        })) {
            Ok(chunk) => chunk,
            Err(error) => {
                log::error!(
                    "[audio] producer skipped chunk at {chunk_start:.3}s after panic: {}",
                    panic_payload_message(&error)
                );
                vec![0.0; chunk_frames * output_channels]
            }
        };

        let mix_ms = mix_started.elapsed().as_secs_f64() * 1000.0;
        if mix_ms > chunk_duration_sec * 1000.0 {
            over_budget_chunks += 1;
            worst_chunk_ms = worst_chunk_ms.max(mix_ms);
        }
        if last_budget_log.elapsed() >= Duration::from_secs(1) {
            if over_budget_chunks > 0 {
                log::warn!(
                    "[audio] decode behind real time: {over_budget_chunks} chunk(s) in the last \
                     ~1s exceeded the {:.0}ms budget (worst {worst_chunk_ms:.1}ms) — the producer \
                     cannot mix/decode fast enough under load, ring will drain and crackle",
                    chunk_duration_sec * 1000.0,
                );
            }
            over_budget_chunks = 0;
            worst_chunk_ms = 0.0;
            last_budget_log = std::time::Instant::now();
        }

        let mut state = shared.0.lock();
        // Only a seek/flush (or stop) invalidates an in-flight chunk. A pure
        // mix-param change bumps scene_serial but not seek_serial, so we keep the
        // chunk — the new params just apply from the following one.
        if state.seek_serial != seek_serial || !state.playing {
            continue;
        }
        if ring.len() < limit_samples {
            ring.push_slice(&chunk);
            state.producer_pts_sec += chunk_duration_sec;
            // Start the real-time output clock once a tiny startup prebuffer has
            // accumulated (see `arm_output_clock_after_prebuffer`). Until armed the
            // cpal callback emits silence without counting a (false) underrun.
            arm_output_clock_after_prebuffer(&clock, ring.len(), start_prebuffer_samples);
        }
    }
}

fn arm_output_clock_after_prebuffer(
    clock: &RealtimeClock,
    ring_samples: usize,
    start_prebuffer_samples: usize,
) -> bool {
    if ring_samples < start_prebuffer_samples || clock.playing.load(Ordering::Acquire) {
        return false;
    }

    clock.reset_frames();
    clock.playing.store(true, Ordering::Release);
    true
}

pub(crate) fn panic_payload_message(error: &Box<dyn std::any::Any + Send>) -> String {
    if let Some(message) = error.downcast_ref::<&str>() {
        return (*message).to_string();
    }
    if let Some(message) = error.downcast_ref::<String>() {
        return message.clone();
    }
    "non-string panic payload".to_string()
}

pub(crate) fn audible_pts_sec(state: &AudioShared, clock: &RealtimeClock, sample_rate: u32) -> f64 {
    // Timeline position currently leaving the speakers = origin + (frames the
    // device has CONSUMED − hardware latency). `clock.frames()` counts frames
    // handed to the device (incremented in the output callback), and the producer
    // pushes the timeline contiguously starting at `origin`, so consumed frame N
    // maps to timeline `origin + N/sr`.
    //
    // The ring buffer holds FUTURE, not-yet-consumed audio, so it must NOT be
    // subtracted here. Doing so used to be masked because seek-thrash kept the
    // ring pinned near one chunk (a constant ~50ms offset); once the prebuffer
    // actually stays full (~800ms) and varies, subtracting it made the reported
    // position lag and lurch BACKWARD whenever the ring grew — the audio playhead
    // wobbled and the video (slaved to this pts) jumped back several frames.
    let hw_latency_frames =
        (clock.output_latency_sec().max(0.0) * sample_rate as f64).round() as u64;
    let audible_frames = clock.frames().saturating_sub(hw_latency_frames);
    state.origin_pts_sec + audible_frames as f64 / sample_rate as f64
}

/// SCHED_FIFO priority for the audio mixer thread on Linux. Deliberately modest:
/// low enough to stay beneath the audio server (PipeWire runs at ~88) and system
/// real-time threads, but far above every SCHED_OTHER thread in the editor (UI,
/// wgpu/vello compositor, media decoders) so the producer always wins the CPU and
/// keeps the playback ring full.
#[cfg(target_os = "linux")]
const DESIRED_RT_PRIORITY: i32 = 20;

/// Requests real-time scheduling for the calling (producer) thread, clamped to
/// the process's `RLIMIT_RTPRIO` ceiling.
///
/// The previous implementation asked `thread_priority` for `Max`, which on Linux
/// maps to SCHED_FIFO priority 99 — one above a typical `@realtime rtprio 98`
/// limit — so the kernel returned `EACCES` and the thread silently stayed on
/// SCHED_OTHER. Under the editor's compositor/decode load it then got preempted,
/// draining the audio ring and producing the crackle. Picking a priority within
/// the limit actually grants real-time scheduling.
#[cfg(target_os = "linux")]
fn set_producer_realtime_priority() {
    let soft_limit = unsafe {
        // SAFETY: `rl` is a zeroed `rlimit` struct on the stack. `getrlimit` only reads/writes
        // this well-defined struct and is a standard POSIX call.
        let mut rl: libc::rlimit = std::mem::zeroed();
        if libc::getrlimit(libc::RLIMIT_RTPRIO, &mut rl) != 0 {
            log::warn!(
                "[audio] getrlimit(RLIMIT_RTPRIO) failed; leaving producer at default priority"
            );
            return;
        }
        rl.rlim_cur
    };

    if soft_limit == 0 {
        log::warn!(
            "[audio] RLIMIT_RTPRIO is 0 — real-time scheduling not permitted; audio may glitch \
             under load. Add the user to a 'realtime'/'audio' group or set rtprio in \
             /etc/security/limits.d/."
        );
        return;
    }

    // Clamp the desired priority to both the kernel's valid SCHED_FIFO range and
    // the rtprio soft limit (RLIM_INFINITY collapses to the kernel max).
    // SAFETY: `sched_get_priority_max/min` are standard POSIX calls with a well-known
    // constant argument (SCHED_FIFO) and only return an integer value.
    let max_fifo = unsafe { libc::sched_get_priority_max(libc::SCHED_FIFO) }.max(1);
    let min_fifo = unsafe { libc::sched_get_priority_min(libc::SCHED_FIFO) }.max(1);
    let ceiling = (soft_limit.min(max_fifo as u64)) as i32;
    let priority = DESIRED_RT_PRIORITY.clamp(min_fifo, ceiling);

    let param = libc::sched_param {
        sched_priority: priority,
    };
    // pthread_setschedparam returns the errno directly (0 on success).
    // SAFETY: `pthread_self()` returns the current thread handle. `param` is a valid
    // `sched_param` on the stack with a priority already clamped to the kernel limits.
    let ret =
        unsafe { libc::pthread_setschedparam(libc::pthread_self(), libc::SCHED_FIFO, &param) };
    if ret == 0 {
        log::info!(
            "[audio] producer thread on SCHED_FIFO priority {priority} (rtprio limit {soft_limit})"
        );
    } else {
        log::warn!(
            "[audio] failed to set SCHED_FIFO priority {priority} (errno {ret}); \
             audio may glitch under load"
        );
    }
}

/// Non-Linux platforms manage audio-thread priority through their own backends;
/// no-op here so the producer simply runs at the default priority.
#[cfg(not(target_os = "linux"))]
fn set_producer_realtime_priority() {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn panic_payload_message_extracts_string_payloads() {
        let literal: Box<dyn std::any::Any + Send> = Box::new("literal panic");
        assert_eq!(panic_payload_message(&literal), "literal panic");

        let owned: Box<dyn std::any::Any + Send> = Box::new(String::from("owned panic"));
        assert_eq!(panic_payload_message(&owned), "owned panic");
    }

    #[test]
    fn audible_pts_compensates_output_latency_only() {
        let state = AudioShared {
            origin_pts_sec: 10.0,
            ..AudioShared::default()
        };
        let clock = RealtimeClock::default();
        clock.frames_written.store(48_000, Ordering::Release);
        clock
            .output_latency_bits
            .store(0.02f64.to_bits(), Ordering::Release);

        let pts = audible_pts_sec(&state, &clock, 48_000);

        // frames_written already accounts for every frame handed to the OS;
        // only pipeline latency should be subtracted (0.02 s = 960 frames).
        // 48000 - 960 = 47040 → 47040/48000 = 0.98 s → pts = 10.98
        assert!((pts - 10.98).abs() < 1e-9);
    }

    #[test]
    fn output_clock_arms_only_after_start_prebuffer() {
        let clock = RealtimeClock::default();
        clock.frames_written.store(123, Ordering::Release);
        let start_samples = 2_000;

        assert!(!arm_output_clock_after_prebuffer(
            &clock,
            start_samples - 1,
            start_samples,
        ));
        assert!(!clock.playing.load(Ordering::Acquire));

        assert!(arm_output_clock_after_prebuffer(
            &clock,
            start_samples,
            start_samples,
        ));
        assert!(clock.playing.load(Ordering::Acquire));
        assert_eq!(clock.frames(), 0);

        assert!(!arm_output_clock_after_prebuffer(
            &clock,
            start_samples * 2,
            start_samples,
        ));
    }
}
