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
    AudioRenderTarget, AudioShared, CHUNK_DURATION_SEC, MAX_SCRUB_PREVIEW_SEC, PREBUFFER_CHUNKS,
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

    // Active forward-scrub preview: `Some(end_frame)` while a one-shot snippet is
    // playing out. The snippet is done once the device has consumed `end_frame`
    // frames (see `service_scrub_preview`).
    let mut scrub_end_frame: Option<u64> = None;

    // Streaming varispeed resampler for global playback speed != 1. Producer-local
    // (not shared). One instance lives across chunks so there is no per-chunk
    // delay-line reset (which crackled at every boundary); it is reset only on a
    // timeline discontinuity (seek/flush via `seek_serial`) or a speed change.
    let mut varispeed = crate::audio::resample::VarispeedResampler::new();
    let mut varispeed_serial = u64::MAX;
    let mut varispeed_speed = 1.0f64;
    let mut plugin_seek_serial = u64::MAX;

    while running.load(Ordering::Relaxed) {
        // Forward-scrub preview is a one-shot snippet played while NOT in normal
        // playback. Handled here so every ring write/clear stays on this single
        // producer thread (the SPSC ring has exactly one writer).
        service_scrub_preview(
            &shared,
            &ring,
            &clock,
            target,
            chunk_duration_sec,
            output_channels,
            &mut scrub_end_frame,
        );

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
                            log::error!(
                                "[audio] effective output rate {effective:.0} Hz differs from the \
                                 opened {sample_rate} Hz by {:.1}% — the device/graph clock does \
                                 not match the stream, so playback is sped up/slowed and pitch \
                                 shifted. Try changing the audio backend or output device in settings.",
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
                // Reverse / non-positive global speed: audio is intentionally muted,
                // the producer renders nothing and the master clock (video) free-runs.
                let speed_positive = state.global_speed > 0.0;
                if speed_positive
                    && state.playing
                    && !state.scene.is_empty()
                    && ring.len() < limit_samples
                {
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
                    // for an already-past position, lagging permanently. At speed != 1
                    // each consumed/buffered device frame maps to `speed` timeline
                    // seconds (varispeed), so scale the elapsed span accordingly.
                    let buffered_frames = (ring.len() / output_channels) as f64;
                    let expected_pts = state.origin_pts_sec
                        + (clock.frames() as f64 + buffered_frames) / sample_rate as f64
                            * state.global_speed;
                    if state.producer_pts_sec + PRODUCER_RESYNC_THRESHOLD_SEC < expected_pts {
                        state.producer_pts_sec = expected_pts;
                    }

                    break Some((
                        state.master_gain,
                        state.producer_pts_sec,
                        state.seek_serial,
                        state.global_speed,
                    ));
                }
                // Poll cadence. While the producer must refill the ring (playing) or
                // play out a scrub snippet, wake every 1 ms: the cpal callback drains
                // the ring WITHOUT notifying us, so we have to notice it dropping below
                // the prebuffer limit promptly or we underrun. When idle (paused, no
                // scrub) there is nothing to refill — a 1 ms timeout there just burned
                // ~1000 wakeups/sec for nothing; wait 50 ms instead and rely on
                // `notify_all` (every state change calls it) to wake us immediately on
                // play/seek/scrub. Cuts idle wakeups ~50× with no latency cost to
                // playback (which keeps the 1 ms cadence).
                let poll = if state.playing || scrub_end_frame.is_some() {
                    Duration::from_millis(1)
                } else {
                    Duration::from_millis(50)
                };
                let wait_res = shared.1.wait_for(&mut state, poll);
                // Leave the wait loop (to let the outer loop service scrub previews /
                // re-evaluate) on a timeout OR when a scrub request/cancel just
                // arrived via `notify_all` — otherwise an idle producer would re-sleep
                // for another full poll before noticing the scrub, adding up to 50 ms
                // of latency to the start of a scrub snippet.
                let scrub_pending = state.scrub_request.is_some() || state.scrub_cancel;
                if (wait_res.timed_out() || scrub_pending)
                    && (!speed_positive
                        || !state.playing
                        || state.scene.is_empty()
                        || ring.len() >= limit_samples)
                {
                    break None;
                }
            }
        };

        let Some((master_gain, chunk_start, seek_serial, speed)) = snapshot else {
            continue;
        };
        let Some((_, scene, tracks)) = cached.as_ref() else {
            continue;
        };

        if plugin_seek_serial != seek_serial {
            let plugin_host = { shared.0.lock().plugin_host.clone() };
            plugin_host.lock().reset_all();
            plugin_seek_serial = seek_serial;
        }

        // At speed != 1 we mix a `speed×` longer timeline span and varispeed-resample
        // it back to one device chunk (pitch shifts like tape). The 1× path is left
        // byte-for-byte untouched so normal playback carries zero regression risk.
        let is_varispeed = (speed - 1.0).abs() > 1e-6;
        let mix_duration = chunk_duration_sec * speed;

        let mix_started = std::time::Instant::now();
        // Mix the (possibly `speed×` longer) timeline span at normal pitch. The
        // varispeed pitch-shift happens further down through the streaming resampler.
        let mix_frames = (mix_duration * sample_rate as f64).round().max(1.0) as usize;
        let mixed = match panic::catch_unwind(AssertUnwindSafe(|| {
            mix_chunk(
                scene,
                tracks,
                master_gain,
                chunk_start,
                mix_duration,
                target,
                &shared,
            )
        })) {
            Ok(mixed) => mixed,
            Err(error) => {
                log::error!(
                    "[audio] producer skipped chunk at {chunk_start:.3}s after panic: {}",
                    panic_payload_message(&error)
                );
                vec![0.0; mix_frames * output_channels]
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

        // Varispeed: stream the mixed span through the persistent resampler BEFORE
        // re-locking (resampling is CPU-heavy and must not block engine commands).
        // The resampler is producer-local, so if this span turns out stale (seek
        // raced us) the next iteration's reset discards whatever we fed here.
        let device_chunk = if is_varispeed {
            if varispeed_serial != seek_serial || (varispeed_speed - speed).abs() > 1e-9 {
                varispeed.reset();
                varispeed_serial = seek_serial;
                varispeed_speed = speed;
            }
            varispeed.feed(&mixed, output_channels, sample_rate, speed);
            // `None` only while the resampler is still priming (group delay) right
            // after a (re)start — a one-off; steady state always yields a full chunk.
            varispeed.drain(chunk_frames * output_channels)
        } else {
            Some(mixed)
        };

        let mut state = shared.0.lock();
        // Only a seek/flush (or stop) invalidates an in-flight chunk. A pure
        // mix-param change bumps scene_serial but not seek_serial, so we keep the
        // chunk — the new params just apply from the following one.
        if state.seek_serial != seek_serial || !state.playing {
            continue;
        }
        // Advance the mix read cursor by the timeline span we just consumed. At 1×
        // this is exactly the chunk duration; at speed != 1 it is `speed×` longer.
        // For varispeed the advance is decoupled from the push: input is consumed
        // into the resampler even on a priming iteration that emits no chunk yet.
        if let Some(chunk) = device_chunk {
            if ring.len() < limit_samples {
                ring.push_slice(&chunk);
                state.producer_pts_sec += mix_duration;
                // Start the real-time output clock once a tiny startup prebuffer has
                // accumulated (see `arm_output_clock_after_prebuffer`). Until armed the
                // cpal callback emits silence without counting a (false) underrun.
                // While `hold_output` is set (warmup priming) we keep filling the ring
                // but never arm, so the primed audio stays inaudible until released.
                arm_output_clock_after_prebuffer(
                    &clock,
                    ring.len(),
                    start_prebuffer_samples,
                    state.hold_output,
                );
            }
        } else {
            // Priming iteration (varispeed only): input consumed, no output yet.
            state.producer_pts_sec += mix_duration;
        }
    }
}

fn arm_output_clock_after_prebuffer(
    clock: &RealtimeClock,
    ring_samples: usize,
    start_prebuffer_samples: usize,
    hold_output: bool,
) -> bool {
    if hold_output
        || ring_samples < start_prebuffer_samples
        || clock.playing.load(Ordering::Acquire)
    {
        return false;
    }

    clock.reset_frames();
    clock.playing.store(true, Ordering::Release);
    true
}

/// Services the forward-scrub audio preview. Called once per producer iteration.
///
/// Contract:
/// - Real playback always wins: while `state.playing`, any scrub is abandoned and
///   the output clock/ring are left to the normal playback path.
/// - On a cancel (drag ended) while not playing, the snippet is silenced.
/// - A new request mixes `[from, from+dur)` ONCE (off the state lock, since
///   `mix_chunk` re-locks) and publishes it: clear ring → push → reset+arm the
///   output clock. The transport (origin/playing) is never touched.
/// - The snippet auto-stops once the device has consumed all its frames.
///
/// All ring writes/clears happen here on the producer thread, preserving the
/// SPSC ring's single-writer invariant.
fn service_scrub_preview(
    shared: &Arc<(Mutex<AudioShared>, Condvar)>,
    ring: &SpscRingBuffer,
    clock: &RealtimeClock,
    target: AudioRenderTarget,
    chunk_duration_sec: f64,
    output_channels: usize,
    scrub_end_frame: &mut Option<u64>,
) {
    {
        let mut state = shared.0.lock();

        if state.playing {
            // Normal playback owns the output; drop any scrub bookkeeping and let
            // the playback path manage the clock/ring.
            state.scrub_cancel = false;
            state.scrub_request = None;
            *scrub_end_frame = None;
            return;
        }

        if state.scrub_cancel {
            state.scrub_cancel = false;
            let was_active = scrub_end_frame.take().is_some();
            drop(state);
            if was_active {
                clock.playing.store(false, Ordering::Release);
                ring.clear();
            }
            return;
        }

        // A new request supersedes any in-progress snippet so rapid dragging stays
        // responsive instead of waiting for the previous ~90 ms snippet to finish.
        if let Some(req) = state.scrub_request.take() {
            let scene = state.scene.clone();
            let tracks = state.tracks.clone();
            let master_gain = state.master_gain;
            drop(state);

            // Mix the snippet off the lock (mix_chunk re-locks internally).
            let dur = req.duration_sec.clamp(0.0, MAX_SCRUB_PREVIEW_SEC);
            let mut samples = Vec::new();
            let mut offset = 0.0;
            let plugin_host = { shared.0.lock().plugin_host.clone() };
            plugin_host.lock().reset_all();
            while offset < dur {
                let piece_dur = chunk_duration_sec.min(dur - offset);
                if piece_dur <= 0.0 {
                    break;
                }
                let mut piece = mix_chunk(
                    &scene,
                    &tracks,
                    master_gain,
                    req.from_sec + offset,
                    piece_dur,
                    target,
                    shared,
                );
                samples.append(&mut piece);
                offset += piece_dur;
            }

            let frames = (samples.len() / output_channels.max(1)) as u64;
            if frames > 0 && !shared.0.lock().playing {
                // Publish the snippet and start the output clock. Tiny prebuffer
                // is irrelevant here: the whole snippet is queued atomically.
                ring.clear();
                ring.push_slice(&samples);
                clock.reset_frames();
                clock.playing.store(true, Ordering::Release);
                *scrub_end_frame = Some(frames);
            }
            return;
        }
    }

    // Auto-stop once the snippet has fully played out.
    if let Some(end) = *scrub_end_frame {
        if clock.frames() >= end {
            clock.playing.store(false, Ordering::Release);
            ring.clear();
            *scrub_end_frame = None;
        }
    }
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
    // At global speed != 1 the producer rendered `speed×` of timeline into every
    // device frame (varispeed), so each consumed frame advances the timeline by
    // `speed / sample_rate`. At speed == 1 this collapses to the plain mapping.
    let speed = if state.global_speed > 0.0 {
        state.global_speed
    } else {
        1.0
    };
    state.origin_pts_sec + audible_frames as f64 / sample_rate as f64 * speed
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
    use crate::audio::ring::SpscRingBuffer;
    use crate::audio::shared::ScrubRequest;

    fn scrub_fixture() -> (
        Arc<(Mutex<AudioShared>, Condvar)>,
        SpscRingBuffer,
        RealtimeClock,
        AudioRenderTarget,
    ) {
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        let ring = SpscRingBuffer::new(48_000 * 2);
        let clock = RealtimeClock::default();
        let target = AudioRenderTarget::monitor(48_000, 2);
        (shared, ring, clock, target)
    }

    #[test]
    fn scrub_preview_publishes_snippet_and_arms_output() {
        let (shared, ring, clock, target) = scrub_fixture();
        shared.0.lock().scrub_request = Some(ScrubRequest {
            from_sec: 0.0,
            duration_sec: 0.1,
        });
        let mut scrub_end = None;

        service_scrub_preview(&shared, &ring, &clock, target, 0.05, 2, &mut scrub_end);

        // 0.1 s at 48 kHz = 4800 frames queued, the output clock armed, request taken.
        assert_eq!(scrub_end, Some(4800));
        assert!(clock.playing.load(Ordering::Acquire));
        assert!(ring.len() > 0);
        assert!(shared.0.lock().scrub_request.is_none());
    }

    #[test]
    fn scrub_preview_cancel_silences_output() {
        let (shared, ring, clock, target) = scrub_fixture();
        shared.0.lock().scrub_request = Some(ScrubRequest {
            from_sec: 0.0,
            duration_sec: 0.1,
        });
        let mut scrub_end = None;
        service_scrub_preview(&shared, &ring, &clock, target, 0.05, 2, &mut scrub_end);
        assert!(scrub_end.is_some());

        shared.0.lock().scrub_cancel = true;
        service_scrub_preview(&shared, &ring, &clock, target, 0.05, 2, &mut scrub_end);

        assert_eq!(scrub_end, None);
        assert!(!clock.playing.load(Ordering::Acquire));
        assert_eq!(ring.len(), 0);
    }

    #[test]
    fn scrub_preview_abandoned_when_playback_takes_over() {
        let (shared, ring, clock, target) = scrub_fixture();
        let mut scrub_end = Some(4800);
        clock.playing.store(true, Ordering::Release);
        {
            let mut state = shared.0.lock();
            state.playing = true;
            state.scrub_request = Some(ScrubRequest {
                from_sec: 0.0,
                duration_sec: 0.1,
            });
        }

        service_scrub_preview(&shared, &ring, &clock, target, 0.05, 2, &mut scrub_end);

        // Real playback owns the output: scrub bookkeeping is dropped and the clock
        // is left untouched for the playback path to manage.
        assert_eq!(scrub_end, None);
        assert!(shared.0.lock().scrub_request.is_none());
        assert!(clock.playing.load(Ordering::Acquire));
    }

    #[test]
    fn scrub_preview_auto_stops_when_played_out() {
        let (shared, ring, clock, target) = scrub_fixture();
        let mut scrub_end = Some(4800);
        clock.playing.store(true, Ordering::Release);
        // Device consumed the whole snippet.
        clock.frames_written.store(4800, Ordering::Release);

        service_scrub_preview(&shared, &ring, &clock, target, 0.05, 2, &mut scrub_end);

        assert_eq!(scrub_end, None);
        assert!(!clock.playing.load(Ordering::Acquire));
    }

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
            false,
        ));
        assert!(!clock.playing.load(Ordering::Acquire));

        assert!(arm_output_clock_after_prebuffer(
            &clock,
            start_samples,
            start_samples,
            false,
        ));
        assert!(clock.playing.load(Ordering::Acquire));
        assert_eq!(clock.frames(), 0);

        assert!(!arm_output_clock_after_prebuffer(
            &clock,
            start_samples * 2,
            start_samples,
            false,
        ));
    }

    #[test]
    fn output_clock_stays_silent_while_warmup_holds_output() {
        let clock = RealtimeClock::default();
        let start_samples = 2_000;

        // Even with the ring well past the startup prebuffer, the warmup gate must
        // keep the output clock disarmed so primed audio stays inaudible.
        assert!(!arm_output_clock_after_prebuffer(
            &clock,
            start_samples * 4,
            start_samples,
            true,
        ));
        assert!(!clock.playing.load(Ordering::Acquire));

        // Releasing the gate (hold_output = false) arms it on the next push.
        assert!(arm_output_clock_after_prebuffer(
            &clock,
            start_samples * 4,
            start_samples,
            false,
        ));
        assert!(clock.playing.load(Ordering::Acquire));
    }
}
