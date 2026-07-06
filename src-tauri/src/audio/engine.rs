use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use anyhow::{Context, Result};
use parking_lot::{Condvar, Mutex};

use crate::audio::clock::RealtimeClock;
use crate::audio::evict_stale_silent_paths;
use crate::audio::mix::{prewarm_audio_layers_around, sanitize_master_gain};
use crate::audio::output::{AudioBackend, AudioStream, CpalAudioBackend};
use crate::audio::producer::{audible_pts_sec, spawn_producer_thread};
use crate::audio::ring::SpscRingBuffer;
use crate::audio::shared::{
    compute_timing_sig, AudioRenderTarget, AudioShared, CHUNK_DURATION_SEC, PREBUFFER_CHUNKS,
    START_PREBUFFER_CHUNKS,
};

pub use crate::audio::mix::render_scene_to_wav;

/// Per-layer audio engine settings forwarded from the UI.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Deserialize)]
pub struct AudioEngineSettings {
    pub buffer_size: Option<u32>,
    pub backend: Option<String>,
}

pub struct NativeAudioEngine {
    shared: Arc<(Mutex<AudioShared>, Condvar)>,
    /// Kept alive so the producer thread and cpal callback can use their clones.
    #[allow(dead_code)]
    ring: Arc<SpscRingBuffer>,
    running: Arc<AtomicBool>,
    clock: Arc<RealtimeClock>,
    sample_rate: u32,
    device_channels: u16,
    settings: AudioEngineSettings,
    _stream: Box<dyn AudioStream>,
    producer: Mutex<Option<JoinHandle<()>>>,
    /// Set by the producer thread when it exits (clean stop or panic). Lets
    /// `restart_finished_producer` skip the producer mutex on the common (alive)
    /// path with a single atomic load, instead of locking on every per-frame call.
    producer_exited: Arc<AtomicBool>,
    /// Last `(frames_consumed, sampled_at)` observed by the output-stall watchdog.
    /// `None` until the first armed observation; reset whenever the clock disarms.
    output_watchdog: Mutex<Option<(u64, std::time::Instant)>>,
}

#[derive(Debug, Clone, Default)]
pub struct NativeAudioDiagnosticsSnapshot {
    pub skipped_layers_total: u64,
    pub decode_errors_total: u64,
    pub prewarm_requests_total: u64,
    pub catchup_events_total: u64,
    pub catchup_dropped_sec_total: f64,
    pub over_budget_chunks_total: u64,
    pub worst_chunk_ms: f64,
    pub last_ring_fill_samples: usize,
    pub last_ring_fill_ratio: f64,
    pub last_audio_pts_sec: Option<f64>,
    pub last_producer_pts_sec: f64,
    pub underrun_events: u64,
    pub underrun_frames: u64,
    pub last_skipped_layer_id: Option<String>,
    pub last_skip_timeline_sec: Option<f64>,
}

/// How long the output clock may stay frozen while armed and the ring still holds
/// playable audio before we treat the device stream as dead. The producer keeps
/// refilling a ring nobody drains when the cpal stream silently dies (device
/// unplugged, default sink switched, PipeWire node lost), so a full ring plus a
/// stuck frame counter is the unambiguous fingerprint — distinct from a genuine
/// underrun, where the ring is empty because the producer fell behind.
const OUTPUT_STALL_TIMEOUT: Duration = Duration::from_millis(1500);

/// A seek to within this of the current playback position, while already playing,
/// is treated as a redundant master-clock echo and ignored (no ring flush / no
/// decoder reseek). Must be at least as large as the full prebuffer window:
/// PREBUFFER_CHUNKS (16) × CHUNK_DURATION_SEC (0.05s) = 0.8s. Immediately after
/// `release_output` the audible_pts_sec is exactly at the origin while the ring
/// holds 800ms pre-mixed audio ahead; a frontend seek to any position inside that
/// window looks like a forward jump of up to 800ms. With only 0.4s the guard
/// passed those through, cleared the ring, and the producer replayed the first
/// fraction of audio — heard as crackle + sped-up repeat.
const SEEK_IGNORE_SEC: f64 = 1.0;
const PRIME_REUSE_EPSILON_SEC: f64 = 1e-4;

impl NativeAudioEngine {
    pub fn new(settings: &AudioEngineSettings) -> Result<Self> {
        let backend = Box::new(CpalAudioBackend::new(settings)?);
        Self::new_with_backend(settings, backend)
    }

    pub(crate) fn new_with_backend(
        settings: &AudioEngineSettings,
        backend: Box<dyn AudioBackend>,
    ) -> Result<Self> {
        let sample_rate = backend.sample_rate();
        let device_channels = backend.channels();
        let output_channels = device_channels as usize;
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        let running = Arc::new(AtomicBool::new(true));
        let clock = Arc::new(RealtimeClock::default());

        let chunk_frames = (CHUNK_DURATION_SEC * sample_rate as f64).round().max(1.0) as usize;
        let ring_capacity = chunk_frames * output_channels * PREBUFFER_CHUNKS * 2;
        let ring = Arc::new(SpscRingBuffer::new(ring_capacity));

        let stream = backend.build_output_stream(ring.clone(), clock.clone())?;
        stream.play().context("audio stream play failed")?;

        let producer_exited = Arc::new(AtomicBool::new(false));
        let producer = spawn_producer_thread(
            shared.clone(),
            ring.clone(),
            running.clone(),
            clock.clone(),
            AudioRenderTarget::monitor(sample_rate, output_channels),
            producer_exited.clone(),
        )?;

        Ok(Self {
            shared,
            ring,
            running,
            clock,
            sample_rate,
            device_channels,
            settings: settings.clone(),
            _stream: stream,
            producer: Mutex::new(Some(producer)),
            producer_exited,
            output_watchdog: Mutex::new(None),
        })
    }

    fn restart_finished_producer(&self) {
        if !self.running.load(Ordering::Acquire) {
            return;
        }
        // Fast path: the producer flags this only when its thread has exited. Avoids
        // taking the producer mutex on every engine call (current_pts / scene_end /
        // is_empty all run once per monitor frame).
        if !self.producer_exited.load(Ordering::Relaxed) {
            return;
        }

        let mut producer = self.producer.lock();
        // Re-check under the lock: another caller may have already restarted it.
        if !self.producer_exited.load(Ordering::Relaxed)
            || producer
                .as_ref()
                .is_some_and(|handle| !handle.is_finished())
        {
            return;
        }

        if let Some(handle) = producer.take() {
            match handle.join() {
                Ok(()) => log::error!("[audio] producer thread stopped; restarting it"),
                Err(error) => log::error!(
                    "[audio] producer thread panicked before watchdog join: {error:?}; restarting it"
                ),
            }
        } else {
            log::error!("[audio] producer thread missing; restarting it");
        }

        match spawn_producer_thread(
            self.shared.clone(),
            self.ring.clone(),
            self.running.clone(),
            self.clock.clone(),
            AudioRenderTarget::monitor(self.sample_rate, self.device_channels as usize),
            self.producer_exited.clone(),
        ) {
            Ok(handle) => {
                *producer = Some(handle);
                self.shared.1.notify_all();
            }
            Err(error) => {
                log::error!("[audio] failed to restart producer thread: {error:?}");
            }
        }
    }

    pub fn update_settings(&mut self, settings: &AudioEngineSettings) {
        self.restart_finished_producer();
        if self.settings.buffer_size != settings.buffer_size
            || self.settings.backend != settings.backend
        {
            log::info!("[audio] settings changed, will apply on next monitor restart");
            self.settings = settings.clone();
        }
    }

    pub fn set_scene(
        &self,
        layers: &[crate::monitor::scene::SceneAudioLayer],
        tracks: &[crate::monitor::scene::SceneAudioTrack],
        master_gain: f64,
        audio_master_effects: &[crate::audio::plugins::AudioEffectSpec],
    ) {
        self.restart_finished_producer();
        let mut state = self.shared.0.lock();
        // A flush (drop buffered output + realign the producer) is only needed
        // when audio moves on the timeline. Pure mix-param edits (gain, balance,
        // fade, mute/solo, master) take effect on the next mixed chunk without a
        // ring clear, so dragging a slider during playback no longer clicks.
        let new_sig = compute_timing_sig(layers);
        let needs_flush = new_sig != state.timing_sig;
        state.timing_sig = new_sig;

        state.scene = layers.to_vec();
        state.tracks = tracks.to_vec();
        state.audio_master_effects = audio_master_effects.to_vec();
        state.master_gain = sanitize_master_gain(master_gain);

        // Evict silent-path cache entries for paths no longer in the scene so an
        // in-place file replace (same path, now with audio) is re-probed.
        let active_paths: std::collections::HashSet<&str> =
            layers.iter().map(|l| l.path.as_str()).collect();
        evict_stale_silent_paths(&mut state, &active_paths);

        // Bump scene_serial so the producer re-reads the scene (refreshes its
        // cached snapshot and applies new mix params). This does NOT discard the
        // in-flight chunk — only a seek (flush) does — so frequent param edits
        // can't starve the ring.
        state.scene_serial = state.scene_serial.wrapping_add(1);

        if needs_flush {
            state.pending_ring_clear = true;
            if state.playing && state.global_speed > 0.0 {
                // Audio moved while playing: re-anchor to the position currently
                // leaving the speakers and re-prime exactly like a seek. Without
                // disarming the clock + resetting the frame counter, the callback
                // keeps consuming the just-cleared (empty) ring while `clock.playing`
                // stays armed, so the producer never gets the START_PREBUFFER window
                // to refill — the ring oscillates near empty and crackles. Capturing
                // the audible pts as the new origin keeps the playhead continuous
                // (frames reset to 0 → audible == old audible), and disarming lets
                // the producer re-arm only after START_PREBUFFER_CHUNKS have queued.
                let audible = audible_pts_sec(&state, &self.clock, self.sample_rate);
                state.origin_pts_sec = audible;
                state.producer_pts_sec = audible;
                state.hold_output = false;
                self.clock.reset_frames();
                self.clock.playing.store(false, Ordering::Release);
            } else {
                // Paused, priming, or reverse/stopped: the output clock is not the
                // master here, so just realign the producer cursor to the origin.
                state.producer_pts_sec = state.origin_pts_sec;
            }
            // Discontinuous output: invalidate in-flight chunks and force decoders
            // to reseek to the new positions.
            state.seek_serial = state.seek_serial.wrapping_add(1);
        }

        // Drop per-layer state no longer referenced by the scene. Windows, in-flight
        // fills and streaming decoders are all keyed by layer id, so retain by id.
        let scene_clone = state.scene.clone();
        state
            .layer_windows
            .retain(|layer_id, _| scene_clone.iter().any(|l| l.id == *layer_id));
        state
            .silent_tails
            .retain(|layer_id, _| scene_clone.iter().any(|l| l.id == *layer_id));
        state
            .window_fill_in_flight
            .retain(|layer_id, _| scene_clone.iter().any(|l| l.id == *layer_id));
        state
            .decoders
            .retain(|layer_id, _| scene_clone.iter().any(|l| l.id == *layer_id));
        let plugin_host = state.plugin_host.clone();
        let plugin_specs: Vec<_> = scene_clone
            .iter()
            .map(|layer| (layer.id.clone(), layer.audio_effects.clone()))
            .collect();
        let audio_master_effects = state.audio_master_effects.clone();
        drop(state);
        plugin_host.lock().retain_scene_specs(
            plugin_specs
                .iter()
                .map(|(layer_id, specs)| (layer_id.as_str(), specs.as_slice())),
            &audio_master_effects,
        );
        if needs_flush {
            plugin_host.lock().reset_all();
        }

        // No eager whole-file warm: a layer's look-ahead window is filled on demand
        // when the producer first mixes it (at the playhead), bounded to WINDOW_SEC.
        // Speculatively decoding every scene clip would do unbounded work for far-away
        // and never-played clips.

        self.shared.1.notify_all();
    }

    pub fn set_output_gain(&self, gain: f64) {
        self.clock.set_output_gain(gain);
    }

    pub fn set_master_gain(&self, gain: f64) {
        let mut state = self.shared.0.lock();
        state.master_gain = sanitize_master_gain(gain);
        drop(state);
        self.shared.1.notify_all();
    }

    /// Drops per-layer streaming decoders and look-ahead windows for clips whose
    /// timeline interval is far from `t`. Without this a long uninterrupted
    /// playthrough accumulates one `CachedAudioDecoder` (with a large resampler) +
    /// one `WINDOW_SEC` PCM window per clip ever played, freed only on a scene edit
    /// (`set_scene` retain). Pruning bounds that to a working set around the playhead.
    ///
    /// Safe vs. the producer: each chunk re-locks and re-inserts the decoder it uses,
    /// and only clips NOT near the playhead (i.e. not being mixed) are dropped, so a
    /// pruned decoder is never one mid-decode. `active_window_fill_count` is left
    /// untouched — the `WindowFillGuard` always decrements it on completion. The
    /// `window_fill_in_flight` marker of a pruned layer IS dropped here: otherwise a
    /// fill spawned before this prune would pass its `== Some(start)` guard on
    /// completion and re-insert the very window we just evicted, partially undoing the
    /// prune. Clearing the marker makes that landing a no-op (the guard's count
    /// decrement still runs, so the slot is released either way).
    pub fn prune_distant_layers(&self, t: f64) {
        const KEEP_BEHIND_SEC: f64 = 5.0;
        const KEEP_AHEAD_SEC: f64 = 5.0;
        let mut state = self.shared.0.lock();
        if state.decoders.is_empty()
            && state.layer_windows.is_empty()
            && state.window_fill_in_flight.is_empty()
        {
            return;
        }
        let keep: std::collections::HashSet<String> = state
            .scene
            .iter()
            .filter(|l| {
                l.timeline_start_sec < t + KEEP_AHEAD_SEC
                    && l.timeline_end_sec > t - KEEP_BEHIND_SEC
            })
            .map(|l| l.id.clone())
            .collect();
        state.decoders.retain(|id, _| keep.contains(id));
        state.layer_windows.retain(|id, _| keep.contains(id));
        state
            .window_fill_in_flight
            .retain(|id, _| keep.contains(id));
    }

    pub fn play(&self, pts_sec: f64) {
        self.start_transport(pts_sec, false);
    }

    /// Starts mixing into the ring WITHOUT making it audible (warmup priming).
    ///
    /// Used during the native monitor's video prebuffer window: the producer fills
    /// the ring to its full prebuffer while `hold_output` keeps the real-time output
    /// clock disarmed, so the first Play after a cold page load starts from a full
    /// buffer instead of an immediate underrun (crackle + sped-up audio). Audibility
    /// is released later via `release_output` when the master clock actually starts.
    pub fn start_priming(&self, pts_sec: f64) {
        self.start_transport(pts_sec, true);
    }

    fn start_transport(&self, pts_sec: f64, hold_output: bool) {
        self.restart_finished_producer();
        let mut state = self.shared.0.lock();
        let pts = pts_sec.max(0.0);
        if hold_output
            && state.playing
            && state.hold_output
            && !state.pending_ring_clear
            && (state.origin_pts_sec - pts).abs() <= PRIME_REUSE_EPSILON_SEC
        {
            return;
        }
        state.playing = true;
        state.hold_output = hold_output;
        state.origin_pts_sec = pts;
        state.producer_pts_sec = state.origin_pts_sec;
        self.clock.reset_frames();
        // The producer arms the real-time output clock after a tiny startup
        // prebuffer. Until then the cpal callback emits silence without counting
        // an underrun for an intentionally empty ring.
        self.clock.playing.store(false, Ordering::Release);
        state.pending_ring_clear = true;
        state.seek_serial = state.seek_serial.wrapping_add(1);
        let plugin_host = state.plugin_host.clone();
        let scene = state.scene.clone();
        drop(state);
        plugin_host.lock().reset_all();
        prewarm_audio_layers_around(
            &scene,
            pts,
            self.sample_rate,
            self.device_channels as usize,
            &self.shared,
        );
        self.shared.1.notify_all();
    }

    /// True once a primed ring has filled enough that releasing the output will not
    /// immediately underrun. Returns `true` for cases that don't need (or can't be)
    /// primed — not currently priming, no audible scene, or reverse/stopped speed —
    /// so the caller's warmup gate never blocks on them.
    pub fn is_primed(&self) -> bool {
        let (playing, hold, scene_empty, speed, pending_ring_clear) = {
            let state = self.shared.0.lock();
            (
                state.playing,
                state.hold_output,
                state.scene.is_empty(),
                state.global_speed,
                state.pending_ring_clear,
            )
        };
        if !playing || !hold || scene_empty || speed <= 0.0 {
            return true;
        }
        // Primed = the ring has streamed enough audio to start, NOT that a clip is
        // fully decoded. Streaming a clip's audio at the playhead is cheap (decoding
        // ~50ms of audio costs ~1ms) and fills the ring in well under a second.
        // Sustained playback then stays clean because each layer's bounded look-ahead
        // window is filled off-thread (concurrency-limited, see
        // WINDOW_FILL_MAX_CONCURRENCY) and the producer memcpys from it. Only a
        // pending ring clear (buffer about to be wiped) blocks priming.
        if pending_ring_clear {
            return false;
        }
        let ring_len = self.ring.len();
        let target = self.prebuffer_target_samples();
        let primed = ring_len >= target;
        log::trace!(
            "[audio] is_primed: ring={ring_len}/{target} samples ({:.0}%), primed={primed}",
            (ring_len as f64 / target.max(1) as f64) * 100.0,
        );
        primed
    }

    /// Releases the warmup gate so the primed ring becomes audible. Arms the output
    /// clock right away when a startup prebuffer is already queued; otherwise the
    /// producer arms it once the ring fills past the startup threshold. Re-arming is
    /// idempotent (guarded by `clock.playing`), so a late producer arm is harmless.
    pub fn release_output(&self) {
        // Arm under the state lock. The producer only arms the clock while holding
        // this same lock (see `arm_output_clock_after_prebuffer`, called inside the
        // producer's `state` critical section), so taking it here makes the
        // check-then-arm atomic with respect to the producer. Doing the
        // `reset_frames` + arm after dropping the lock (the previous shape) let the
        // producer arm in the gap and start counting consumed frames, which our
        // `reset_frames` then zeroed — the audible position (and the video slaved to
        // it) lurched backward by that many frames.
        let mut state = self.shared.0.lock();
        state.hold_output = false;
        if !self.clock.playing.load(Ordering::Acquire)
            && self.ring.len() >= self.start_prebuffer_samples()
        {
            self.clock.reset_frames();
            self.clock.playing.store(true, Ordering::Release);
        }
        drop(state);
        self.shared.1.notify_all();
    }

    fn chunk_frames(&self) -> usize {
        (CHUNK_DURATION_SEC * self.sample_rate as f64)
            .round()
            .max(1.0) as usize
    }

    fn start_prebuffer_samples(&self) -> usize {
        self.chunk_frames() * self.device_channels as usize * START_PREBUFFER_CHUNKS
    }

    fn prebuffer_target_samples(&self) -> usize {
        self.chunk_frames() * self.device_channels as usize * PREBUFFER_CHUNKS
    }

    pub fn pause(&self) -> f64 {
        self.restart_finished_producer();
        let mut state = self.shared.0.lock();
        let pts = audible_pts_sec(&state, &self.clock, self.sample_rate);
        state.playing = false;
        // Cancel any in-progress warmup priming so a later play isn't stuck held.
        state.hold_output = false;
        self.clock.playing.store(false, Ordering::Release);
        state.origin_pts_sec = pts;
        self.clock.reset_frames();
        state.pending_ring_clear = true;
        state.producer_pts_sec = pts;
        self.shared.1.notify_all();
        pts
    }

    pub fn seek(&self, pts_sec: f64, playing: bool, explicit: bool) {
        self.restart_finished_producer();
        let pts = pts_sec.max(0.0);
        let mut state = self.shared.0.lock();

        // Guard against redundant in-place seeks during playback. The native engine
        // is the master clock; the frontend interpolates its OWN smooth playhead
        // between our `monitor:time` emits and, if not careful, echoes that back as
        // a `monitor_seek` to ~the current position several times a second. Each
        // real seek clears the ring (drops the whole ~800ms prebuffer) and resets
        // the streaming decoders/resampler — heard as constant crackle. So when we
        // are already playing, staying playing, and the target is essentially where
        // playback already is, treat it as a no-op: do NOT flush or reseek. A real
        // scrub (a genuine position jump) exceeds the tolerance and seeks normally.
        //
        // `explicit` user seeks (a click/drag on the playhead, already filtered by
        // the frontend's expected-position anchor) bypass this guard entirely: with
        // the coarse `SEEK_IGNORE_SEC` window they would otherwise be swallowed for
        // sub-1s scrubs, making a nearby click feel ignored while the video clock
        // snapped back. The guard is now only a backstop for non-explicit echoes.
        if !explicit && playing && state.playing {
            let current = audible_pts_sec(&state, &self.clock, self.sample_rate);
            // At varispeed (`global_speed` != 1) every device-time chunk in the ring
            // covers `speed×` as much TIMELINE time (see `mix_duration` in
            // `producer_loop`), so the buffered prebuffer this guard must cover scales
            // with speed too. At speed >= ~1.25 the un-scaled 1.0s window is smaller
            // than the buffered 0.8s-of-device-time * speed span, so an echo seek
            // inside that (larger) window would fall through as "real", flushing the
            // ring and re-priming mid-playback — the crackle + sped-up repeat this
            // guard exists to prevent. Speeds <= 1 keep the base window unchanged.
            let seek_ignore_sec = SEEK_IGNORE_SEC * state.global_speed.max(1.0);
            if (pts - current).abs() < seek_ignore_sec {
                return;
            }
        }

        let was_playing = state.playing;
        state.origin_pts_sec = pts;
        state.producer_pts_sec = pts;
        state.seek_serial = state.seek_serial.wrapping_add(1);
        state.playing = playing;
        if playing || was_playing {
            // Entering, continuing, or stopping real playback: discard buffered
            // output and let the producer re-arm the clock for the new position.
            // A position jump also invalidates any warmup priming for the old spot.
            state.hold_output = false;
            self.clock.reset_frames();
            state.pending_ring_clear = true;
            self.clock.playing.store(false, Ordering::Release);
        }
        let plugin_host = state.plugin_host.clone();
        drop(state);
        plugin_host.lock().reset_all();
        self.shared.1.notify_all();
    }

    /// Sets the global transport speed (timeline-time multiplier). `anchor_sec` is
    /// the authoritative master-clock position to continue from (the caller's
    /// `PlaybackClock`, which stays correct across reverse spans where audio is
    /// silent).
    ///
    /// Forward speeds (>0) varispeed the output (pitch shifts); a value <=0 means
    /// reverse/stopped, where audio is intentionally muted (the producer renders
    /// nothing). When the producer is buffering (`state.playing`, including the
    /// warmup-priming window) this re-anchors the mix origin and flushes the
    /// buffered output (mixed at the old rate), exactly like a seek, so the new
    /// rate starts cleanly.
    pub fn set_speed(&self, speed: f64, anchor_sec: f64) {
        debug_assert!(speed.is_finite(), "set_speed received non-finite speed");
        self.restart_finished_producer();
        let speed = if speed.is_finite() && speed != 0.0 {
            speed
        } else {
            if speed == 0.0 {
                log::warn!(
                    "[audio] set_speed received 0.0; normalizing to 1.0 (use pause for stop)"
                );
            } else if !speed.is_finite() {
                log::warn!(
                    "[audio] set_speed received non-finite speed {speed}; normalizing to 1.0"
                );
            }
            1.0
        };
        let mut state = self.shared.0.lock();
        if (state.global_speed - speed).abs() < 1e-9 {
            return;
        }

        let current = anchor_sec.max(0.0);
        state.global_speed = speed;
        state.origin_pts_sec = current;
        state.producer_pts_sec = current;
        state.seek_serial = state.seek_serial.wrapping_add(1);

        // Flush whenever the producer is actively filling the ring (`state.playing`),
        // which includes the warmup-priming window where the master clock hasn't
        // started yet (`playing` arg is false but the ring already holds old-rate
        // audio). Keying the flush on the caller's `playing` instead left that primed
        // old-speed audio in the ring, so the first ~800ms after release_output
        // played at the previous pitch. `reset_frames` / `clock.playing=false` are
        // harmless no-ops while still held (the output clock isn't armed yet).
        if state.playing {
            // Discard output mixed at the old rate and re-arm the clock for the new one.
            self.clock.reset_frames();
            state.pending_ring_clear = true;
            self.clock.playing.store(false, Ordering::Release);
        }
        let plugin_host = state.plugin_host.clone();
        drop(state);
        plugin_host.lock().reset_all();
        self.shared.1.notify_all();
    }

    /// Requests a one-shot forward-scrub audio preview of `[from_sec, from_sec +
    /// duration_sec)`. Plays only while NOT in normal playback and does not move
    /// the master transport. The actual mixing + ring writes happen on the
    /// producer thread (see `producer_loop`) to keep the SPSC ring single-writer.
    pub fn scrub_preview(&self, from_sec: f64, duration_sec: f64) {
        self.restart_finished_producer();
        if duration_sec <= 0.0 {
            return;
        }
        let mut state = self.shared.0.lock();
        // Never scrub over real playback — the transport owns the output then.
        if state.playing {
            return;
        }
        state.scrub_request = Some(crate::audio::shared::ScrubRequest {
            from_sec: from_sec.max(0.0),
            duration_sec,
        });
        state.scrub_cancel = false;
        self.shared.1.notify_all();
    }

    /// Stops an in-progress forward-scrub preview (e.g. the drag ended).
    pub fn stop_scrub_preview(&self) {
        let mut state = self.shared.0.lock();
        state.scrub_request = None;
        state.scrub_cancel = true;
        self.shared.1.notify_all();
    }

    pub fn current_pts(&self) -> Option<f64> {
        self.restart_finished_producer();
        let state = self.shared.0.lock();
        if !state.playing {
            return None;
        }
        // Reverse / non-positive speed: audio is muted and produces nothing, so it
        // is NOT the master clock — let the caller's PlaybackClock free-run instead.
        if state.global_speed <= 0.0 {
            return None;
        }
        if !self.clock.playing.load(Ordering::Acquire) {
            return None;
        }
        Some(audible_pts_sec(&state, &self.clock, self.sample_rate))
    }

    pub fn output_levels_db(&self) -> (f64, f64) {
        self.clock.output_levels_db()
    }

    pub fn track_levels_db(&self) -> std::collections::HashMap<String, (f64, f64)> {
        let state = self.shared.0.lock();
        state.track_levels.clone()
    }

    pub fn clear_track_levels(&self) {
        let mut state = self.shared.0.lock();
        state.track_levels.clear();
    }

    /// True when the output device stream looks dead and the engine should be
    /// rebuilt. Two signals: a fatal cpal stream error (`err_fn` set the flag), or
    /// the output clock frozen for `OUTPUT_STALL_TIMEOUT` while armed with a
    /// non-empty ring (the producer keeps filling a ring no callback is draining).
    /// A normal underrun is NOT a stall: there the ring is empty, so the watchdog
    /// resamples its baseline and reports healthy.
    pub fn output_stalled(&self) -> bool {
        if self.clock.stream_failed.load(Ordering::Acquire) {
            return true;
        }
        let mut watchdog = self.output_watchdog.lock();
        // Not armed, or nothing buffered to play: can't be a device stall. Re-baseline
        // so a later freeze is measured from now, not from a stale pre-pause sample.
        if !self.clock.playing.load(Ordering::Acquire) || self.ring.len() == 0 {
            *watchdog = None;
            return false;
        }
        let frames = self.clock.frames();
        let now = std::time::Instant::now();
        match *watchdog {
            Some((last_frames, since)) if frames == last_frames => {
                if now.duration_since(since) >= OUTPUT_STALL_TIMEOUT {
                    *watchdog = None;
                    return true;
                }
            }
            _ => *watchdog = Some((frames, now)),
        }
        false
    }

    pub fn is_empty(&self) -> bool {
        self.restart_finished_producer();
        self.shared.0.lock().scene.is_empty()
    }

    pub fn active_layer_count(&self) -> usize {
        self.restart_finished_producer();
        self.shared.0.lock().scene.len()
    }

    pub fn diagnostics_snapshot(&self) -> NativeAudioDiagnosticsSnapshot {
        self.restart_finished_producer();
        let state = self.shared.0.lock();
        let d = &state.diagnostics;
        NativeAudioDiagnosticsSnapshot {
            skipped_layers_total: d.skipped_layers_total,
            decode_errors_total: d.decode_errors_total,
            prewarm_requests_total: d.prewarm_requests_total,
            catchup_events_total: d.catchup_events_total,
            catchup_dropped_sec_total: d.catchup_dropped_sec_total,
            over_budget_chunks_total: d.over_budget_chunks_total,
            worst_chunk_ms: d.worst_chunk_ms,
            last_ring_fill_samples: d.last_ring_fill_samples,
            last_ring_fill_ratio: d.last_ring_fill_ratio,
            last_audio_pts_sec: d.last_audio_pts_sec,
            last_producer_pts_sec: d.last_producer_pts_sec,
            underrun_events: self.clock.underrun_events.load(Ordering::Relaxed),
            underrun_frames: self.clock.underrun_frames.load(Ordering::Relaxed),
            last_skipped_layer_id: d.last_skipped_layer_id.clone(),
            last_skip_timeline_sec: d.last_skip_timeline_sec,
        }
    }

    pub fn scene_end(&self) -> f64 {
        self.restart_finished_producer();
        // `timeline_end_sec` is already in timeline coordinates (speed is baked
        // into how the clip was placed), so the scene end is simply the latest
        // layer end. Dividing by speed here previously cut sped-up clips short.
        self.shared
            .0
            .lock()
            .scene
            .iter()
            .map(|layer| layer.timeline_end_sec)
            .fold(0.0, f64::max)
    }

    #[allow(dead_code)]
    pub fn output_info(&self) -> (u32, u16) {
        (self.sample_rate, self.device_channels)
    }
}

impl Drop for NativeAudioEngine {
    fn drop(&mut self) {
        self.running.store(false, Ordering::Release);
        self.shared.1.notify_all();
        if let Some(handle) = self.producer.lock().take() {
            if let Err(e) = handle.join() {
                log::warn!("[audio] producer thread panicked: {e:?}");
            }
        }
    }
}

/// Test-only constructors, available to integration tests via the
/// `test-support` feature. Uses an in-process mock backend so no real audio
/// device is opened.
#[cfg(any(test, feature = "test-support"))]
impl NativeAudioEngine {
    /// Build an engine backed by the mock output (48 kHz stereo, no device).
    pub fn new_mock(settings: &AudioEngineSettings) -> Result<Self> {
        Self::new_with_backend(
            settings,
            Box::new(crate::audio::test_support::MockAudioBackend::stereo_48k()),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::test_support::MockAudioBackend;
    use crate::monitor::scene::{AudioFadeCurve, SceneAudioLayer};

    #[test]
    fn native_audio_engine_new_with_backend_sets_fields() {
        let backend = MockAudioBackend {
            sample_rate: 48000,
            channels: 2,
        };
        let engine =
            NativeAudioEngine::new_with_backend(&AudioEngineSettings::default(), Box::new(backend))
                .unwrap();

        assert_eq!(engine.sample_rate, 48000);
        assert_eq!(engine.device_channels, 2);
    }

    fn mock_engine() -> NativeAudioEngine {
        NativeAudioEngine::new_with_backend(
            &AudioEngineSettings::default(),
            Box::new(MockAudioBackend {
                sample_rate: 48000,
                channels: 2,
            }),
        )
        .unwrap()
    }

    fn seek_serial(engine: &NativeAudioEngine) -> u64 {
        engine.shared.0.lock().seek_serial
    }

    fn stop_producer(engine: &NativeAudioEngine) {
        engine.running.store(false, Ordering::Release);
        engine.shared.1.notify_all();
        if let Some(handle) = engine.producer.lock().take() {
            handle.join().expect("producer thread must stop cleanly");
        }
    }

    fn layer(
        id: &str,
        path: &str,
        timeline_start_sec: f64,
        timeline_end_sec: f64,
        speed: f64,
    ) -> SceneAudioLayer {
        SceneAudioLayer {
            id: id.into(),
            track_id: None,
            path: path.into(),
            timeline_start_sec,
            timeline_end_sec,
            source_start_sec: 0.0,
            source_range_duration_sec: 0.0,
            speed,
            audio_gain: 1.0,
            audio_balance: 0.0,
            animations: None,
            audio_fade_in_sec: 0.0,
            audio_fade_out_sec: 0.0,
            audio_fade_in_curve: AudioFadeCurve::Linear,
            audio_fade_out_curve: AudioFadeCurve::Linear,
            audio_effects: vec![],
        }
    }

    #[test]
    fn play_defers_output_clock_until_producer_prebuffers() {
        let engine = mock_engine();

        engine.play(10.0);

        assert!(engine.shared.0.lock().playing);
        assert!(!engine.clock.playing.load(Ordering::Acquire));
        assert_eq!(engine.current_pts(), None);
    }

    #[test]
    fn set_output_gain_updates_realtime_clock() {
        let engine = mock_engine();

        engine.set_output_gain(0.35);

        assert!((engine.clock.output_gain() - 0.35).abs() < 1e-9);
    }

    #[test]
    fn playing_seek_defers_output_clock_until_producer_prebuffers() {
        let engine = mock_engine();
        engine.play(10.0);

        engine.seek(25.0, true, false);

        let state = engine.shared.0.lock();
        assert!(state.playing);
        assert_eq!(state.origin_pts_sec, 25.0);
        drop(state);
        assert!(!engine.clock.playing.load(Ordering::Acquire));
        assert_eq!(engine.current_pts(), None);
    }

    #[test]
    fn seek_ignores_redundant_in_place_echo_during_playback() {
        let engine = mock_engine();
        // No scene set → the producer never fills the ring, so the audible
        // position stays exactly at the play origin (deterministic).
        engine.play(10.0);
        let before = seek_serial(&engine);

        // A non-explicit echo seek to ~the current position must be ignored: no
        // reseek, no ring flush. seek_serial is the observable proxy for "we reseeked".
        engine.seek(10.0 + SEEK_IGNORE_SEC / 2.0, true, false);
        assert_eq!(
            seek_serial(&engine),
            before,
            "redundant in-place seek during playback must not reseek/flush"
        );
        assert_eq!(engine.shared.0.lock().origin_pts_sec, 10.0);
    }

    /// Regression test: a seek within the prebuffer window must not reset the ring.
    ///
    /// Before the fix `SEEK_IGNORE_SEC = 0.4s` < `PREBUFFER_CHUNKS × 0.05s = 0.8s`:
    /// right after `release_output` `audible_pts_sec = origin`, the ring holds 0.8s
    /// ahead. A frontend seek of +0.7s from origin was treated as "real", reset the
    /// ring, and the producer started re-decoding — heard as a crackle + sped-up repeat.
    #[test]
    fn seek_within_prebuffer_window_is_ignored() {
        let engine = mock_engine();
        engine.play(10.0);
        let before = seek_serial(&engine);

        // 0.7s ahead — inside the prebuffer window (0.8s); the old 0.4s threshold let this through.
        // Non-explicit (echo) seek: must be swallowed.
        engine.seek(10.0 + 0.7, true, false);
        assert_eq!(
            seek_serial(&engine),
            before,
            "seek within prebuffer window must not flush the ring (was crackle + repeat)"
        );
    }

    /// Regression test for a UX bug: an explicit user seek within `SEEK_IGNORE_SEC`
    /// during playback MUST take effect (not be swallowed). Otherwise a timeline click
    /// closer than ~1s felt like it "did nothing": audio ignored the
    /// seek while the video clock rolled back via `sync_to_audio_pts`.
    #[test]
    fn explicit_seek_within_window_is_honored_during_playback() {
        let engine = mock_engine();
        engine.play(10.0);
        let before = seek_serial(&engine);

        // Small jump well inside SEEK_IGNORE_SEC, but flagged explicit → must seek.
        engine.seek(10.0 + SEEK_IGNORE_SEC / 2.0, true, true);
        assert_eq!(
            seek_serial(&engine),
            before.wrapping_add(1),
            "an explicit user seek must reseek even within the echo-guard window"
        );
        assert_eq!(
            engine.shared.0.lock().origin_pts_sec,
            10.0 + SEEK_IGNORE_SEC / 2.0
        );
    }

    #[test]
    fn seek_honors_real_scrub_during_playback() {
        let engine = mock_engine();
        engine.play(10.0);
        let before = seek_serial(&engine);

        // A genuine position jump (beyond the tolerance) must seek normally even
        // when not flagged explicit (the guard only swallows in-place echoes).
        engine.seek(25.0, true, false);
        assert_eq!(
            seek_serial(&engine),
            before.wrapping_add(1),
            "a real scrub during playback must reseek"
        );
        assert_eq!(engine.shared.0.lock().origin_pts_sec, 25.0);
    }

    #[test]
    fn set_speed_anchors_origin_and_flushes() {
        let engine = mock_engine();
        engine.play(10.0);
        let before = seek_serial(&engine);

        // Switch to 2× while playing, anchored at 12.0 (master-clock position).
        engine.set_speed(2.0, 12.0);

        let state = engine.shared.0.lock();
        assert_eq!(state.global_speed, 2.0);
        assert_eq!(state.origin_pts_sec, 12.0);
        assert_eq!(state.producer_pts_sec, 12.0);
        drop(state);
        assert_eq!(
            seek_serial(&engine),
            before.wrapping_add(1),
            "speed change must flush (bump seek_serial)"
        );
    }

    #[test]
    fn seek_resets_plugin_host_state() {
        let engine = mock_engine();

        let initial_resets = engine.shared.0.lock().plugin_host.lock().reset_all_count;

        engine.seek(15.0, true, true);

        let after_resets = engine.shared.0.lock().plugin_host.lock().reset_all_count;
        assert_eq!(after_resets, initial_resets + 1);
    }

    #[test]
    fn reverse_speed_mutes_audio_clock() {
        let engine = mock_engine();
        engine.play(10.0);
        // Reverse: audio is intentionally silent, so it is not the master clock.
        engine.set_speed(-1.0, 10.0);
        assert!(
            engine.current_pts().is_none(),
            "reverse playback must report no audible pts"
        );
        assert!(engine.shared.0.lock().global_speed < 0.0);
    }

    #[test]
    fn set_speed_zero_falls_back_to_one() {
        let engine = mock_engine();
        engine.play(10.0);
        engine.set_speed(0.0, 10.0);
        assert_eq!(engine.shared.0.lock().global_speed, 1.0);
    }

    #[test]
    fn seek_while_paused_is_never_swallowed() {
        let engine = mock_engine();
        engine.play(10.0);
        let before = seek_serial(&engine);

        // A scrub that pauses (playing=false) must seek even if very close to the
        // current position — the guard only applies to play→play echoes.
        engine.seek(10.0, false, false);
        assert_eq!(
            seek_serial(&engine),
            before.wrapping_add(1),
            "a paused scrub must always seek"
        );
    }

    #[test]
    fn set_scene_pure_mix_param_edit_does_not_flush() {
        let engine = mock_engine();
        let l = layer("l1", "/tmp/a.wav", 0.0, 10.0, 1.0);
        engine.set_scene(std::slice::from_ref(&l), &[], 1.0, &[]);
        let seek_serial_after_first = seek_serial(&engine);

        // Change only gain — pure mix param.
        let mut l2 = l.clone();
        l2.audio_gain = 0.5;
        engine.set_scene(&[l2], &[], 1.0, &[]);
        let state = engine.shared.0.lock();
        assert_eq!(
            state.seek_serial, seek_serial_after_first,
            "gain-only edit must not flush"
        );
    }

    #[test]
    fn set_scene_position_change_triggers_flush() {
        let engine = mock_engine();
        let l = layer("l1", "/tmp/a.wav", 0.0, 10.0, 1.0);
        engine.set_scene(std::slice::from_ref(&l), &[], 1.0, &[]);
        let before = seek_serial(&engine);

        let mut l2 = l.clone();
        l2.timeline_start_sec = 1.0;
        engine.set_scene(&[l2], &[], 1.0, &[]);
        let state = engine.shared.0.lock();
        assert!(state.seek_serial != before, "position change must flush");
    }

    #[test]
    fn set_scene_speed_change_triggers_flush() {
        let engine = mock_engine();
        let l = layer("l1", "/tmp/a.wav", 0.0, 10.0, 1.0);
        engine.set_scene(std::slice::from_ref(&l), &[], 1.0, &[]);
        let before = seek_serial(&engine);

        let mut l2 = l.clone();
        l2.speed = 2.0;
        engine.set_scene(&[l2], &[], 1.0, &[]);
        let state = engine.shared.0.lock();
        assert!(state.seek_serial != before, "speed change must flush");
    }

    #[test]
    fn set_scene_updates_master_gain() {
        let engine = mock_engine();
        engine.set_scene(&[], &[], 0.5, &[]);
        let state = engine.shared.0.lock();
        assert_eq!(state.master_gain, 0.5);
    }

    #[test]
    fn set_master_gain_updates_mix_without_scene_replacement() {
        let engine = mock_engine();
        let scene_serial = engine.shared.0.lock().scene_serial;

        engine.set_master_gain(0.25);

        let state = engine.shared.0.lock();
        assert_eq!(state.master_gain, 0.25);
        assert_eq!(state.scene_serial, scene_serial);
    }

    #[test]
    fn set_scene_evicts_unused_layer_windows() {
        use crate::audio::shared::AudioWindow;
        let engine = mock_engine();
        let l1 = layer("l1", "/tmp/a.wav", 0.0, 10.0, 1.0);
        engine.set_scene(std::slice::from_ref(&l1), &[], 1.0, &[]);
        {
            let mut state = engine.shared.0.lock();
            // A window for the in-scene layer and one for a layer no longer present.
            for id in ["l1", "stale"] {
                state.layer_windows.insert(
                    id.to_string(),
                    AudioWindow {
                        path: format!("/tmp/{id}.wav"),
                        source_start_frame: 0,
                        sample_rate: 48000,
                        channels: 2,
                        samples: std::sync::Arc::new(vec![0.0f32; 100]),
                    },
                );
            }
        }

        // Re-set the same scene (only l1) → the stale layer's window is dropped.
        engine.set_scene(std::slice::from_ref(&l1), &[], 1.0, &[]);
        let state = engine.shared.0.lock();
        assert!(
            state.layer_windows.contains_key("l1"),
            "in-scene window kept"
        );
        assert!(
            !state.layer_windows.contains_key("stale"),
            "window of a removed layer must be evicted"
        );
    }

    #[test]
    fn start_priming_sets_hold_output_and_keeps_clock_disarmed() {
        let engine = mock_engine();
        engine.start_priming(10.0);

        let state = engine.shared.0.lock();
        assert!(state.playing, "priming must set playing = true");
        assert!(state.hold_output, "priming must set hold_output = true");
        assert_eq!(state.origin_pts_sec, 10.0);
        assert_eq!(state.producer_pts_sec, 10.0);
        drop(state);

        assert!(
            !engine.clock.playing.load(Ordering::Acquire),
            "output clock must stay disarmed during priming"
        );
        assert_eq!(engine.current_pts(), None);
    }

    #[test]
    fn start_priming_reuses_existing_prime_at_same_position() {
        let engine = mock_engine();
        engine.start_priming(10.0);
        {
            let mut state = engine.shared.0.lock();
            // Simulate the producer having consumed the pending clear. After that,
            // a Play at the same paused seek point must keep the warmed ring.
            state.pending_ring_clear = false;
        }
        let before = seek_serial(&engine);

        engine.start_priming(10.0);

        assert_eq!(
            seek_serial(&engine),
            before,
            "re-priming the same paused position must not flush the warmed ring"
        );
        let state = engine.shared.0.lock();
        assert!(state.playing);
        assert!(state.hold_output);
        assert_eq!(state.origin_pts_sec, 10.0);
    }

    #[test]
    fn start_priming_retargets_when_position_changes() {
        let engine = mock_engine();
        engine.start_priming(10.0);
        {
            let mut state = engine.shared.0.lock();
            state.pending_ring_clear = false;
        }
        let before = seek_serial(&engine);

        engine.start_priming(12.0);

        assert_eq!(
            seek_serial(&engine),
            before.wrapping_add(1),
            "a prime for a new playhead position must flush old buffered audio"
        );
        let state = engine.shared.0.lock();
        assert_eq!(state.origin_pts_sec, 12.0);
        assert_eq!(state.producer_pts_sec, 12.0);
        // pending_ring_clear is not asserted here because the producer thread
        // consumes it asynchronously (see producer.rs), making it racy to check
        // from the test thread. The seek_serial increment above already proves
        // a full retarget occurred rather than an early-return reuse.
    }

    #[test]
    fn release_output_arms_clock_when_prebuffer_met() {
        let engine = mock_engine();
        engine.start_priming(0.0);

        // Fill the ring past the startup prebuffer so release_output arms immediately.
        let samples = engine.start_prebuffer_samples();
        engine.ring.push_slice(&vec![0.0f32; samples + 1]);

        engine.release_output();

        assert!(
            engine.clock.playing.load(Ordering::Acquire),
            "release_output must arm the clock when ring has enough samples"
        );
        assert!(
            !engine.shared.0.lock().hold_output,
            "hold_output must be cleared"
        );
    }

    #[test]
    fn release_output_does_not_arm_when_ring_too_short() {
        let engine = mock_engine();
        engine.start_priming(0.0);

        // Leave the ring empty — the startup prebuffer isn't met.
        engine.release_output();

        assert!(
            !engine.clock.playing.load(Ordering::Acquire),
            "release_output must NOT arm when ring is below startup threshold"
        );
        assert!(!engine.shared.0.lock().hold_output);
    }

    #[test]
    fn is_primed_is_true_for_empty_scene_and_reverse_speed() {
        let engine = mock_engine();
        // No scene set → empty → is_primed returns true (nothing to prime).
        engine.start_priming(0.0);
        assert!(engine.is_primed(), "empty scene must report primed");

        // Reverse speed → producer renders nothing → primed is vacuously true.
        engine.set_speed(-1.0, 0.0);
        assert!(engine.is_primed(), "reverse speed must report primed");
    }

    #[test]
    fn is_primed_is_false_until_ring_reaches_target() {
        let engine = mock_engine();
        let l = layer("l1", "/tmp/a.wav", 0.0, 10.0, 1.0);
        engine.set_scene(&[l], &[], 1.0, &[]);
        engine.start_priming(0.0);

        assert!(
            !engine.is_primed(),
            "with a non-empty scene and empty ring, primed must be false"
        );

        // (We don't push to the ring here: the producer thread is already running
        // and SPSC rings have exactly one writer. Filling from the test thread races
        // with the producer, corrupting ring state. The "ring full → primed" path
        // is covered by the integration of producer + engine in real playback.)
    }

    #[test]
    fn is_primed_is_false_when_pending_ring_clear() {
        let engine = mock_engine();
        let l = layer("l1", "/tmp/a.wav", 0.0, 10.0, 1.0);
        engine.set_scene(&[l], &[], 1.0, &[]);

        // Manually set pending_ring_clear to true, as on start
        {
            let mut state = engine.shared.0.lock();
            state.playing = true;
            state.hold_output = true;
            state.pending_ring_clear = true;
        }

        assert!(
            !engine.is_primed(),
            "primed must be false when pending_ring_clear is true, regardless of ring fill"
        );
    }

    #[test]
    fn prune_distant_layers_drops_far_decoders_and_windows_keeps_near() {
        use crate::audio::shared::AudioWindow;
        let engine = mock_engine();
        // Scene: a near clip (covers t≈1s) and a far clip (ends well before t).
        let near = layer("near", "/tmp/n.wav", 0.0, 5.0, 1.0);
        let far = layer("far", "/tmp/f.wav", 100.0, 110.0, 1.0);
        engine.set_scene(&[near, far], &[], 1.0, &[]);

        {
            let mut state = engine.shared.0.lock();
            for id in ["near", "far"] {
                state.layer_windows.insert(
                    id.to_string(),
                    AudioWindow {
                        path: format!("/tmp/{id}.wav"),
                        source_start_frame: 0,
                        sample_rate: 48000,
                        channels: 2,
                        samples: std::sync::Arc::new(vec![0.0f32; 100]),
                    },
                );
            }
        }

        // Playhead at 1s: "near" overlaps the keep window, "far" (100–110s) does not.
        engine.prune_distant_layers(1.0);

        let state = engine.shared.0.lock();
        assert!(
            state.layer_windows.contains_key("near"),
            "window of a clip near the playhead must be kept"
        );
        assert!(
            !state.layer_windows.contains_key("far"),
            "window of a clip far from the playhead must be evicted"
        );
    }

    #[test]
    fn pause_clears_hold_output() {
        let engine = mock_engine();
        engine.start_priming(0.0);
        assert!(engine.shared.0.lock().hold_output);

        engine.pause();
        assert!(
            !engine.shared.0.lock().hold_output,
            "pause must cancel any in-progress priming"
        );
    }

    #[test]
    fn seek_clears_hold_output() {
        let engine = mock_engine();
        engine.start_priming(0.0);
        assert!(engine.shared.0.lock().hold_output);

        // A real position jump (playing=false, pts differs from origin).
        engine.seek(5.0, false, true);
        assert!(
            !engine.shared.0.lock().hold_output,
            "seek must clear hold_output"
        );
    }

    #[test]
    fn scrub_preview_accepted_after_paused_seek() {
        let engine = mock_engine();
        let l = layer("l1", "/tmp/a.wav", 0.0, 10.0, 1.0);
        engine.set_scene(&[l], &[], 1.0, &[]);

        // A paused explicit seek must keep playing=false so that the frontend
        // forward-scrub preview can still be accepted (scrub_preview bails when
        // playing is true).
        engine.seek(2.0, false, true);
        assert!(
            !engine.shared.0.lock().playing,
            "paused seek must keep playing = false"
        );

        // Keep this assertion deterministic: the producer is allowed to consume
        // scrub_request immediately after scrub_preview publishes it.
        stop_producer(&engine);
        engine.scrub_preview(2.0, 0.1);
        assert!(
            engine.shared.0.lock().scrub_request.is_some(),
            "scrub_preview must be accepted after a paused seek"
        );
    }

    #[test]
    fn set_scene_evicts_silent_paths_no_longer_in_scene() {
        use crate::audio::decode::{
            evict_stale_silent_paths, path_known_silent, remember_silent_path,
        };

        let mut state = crate::audio::shared::AudioShared::default();

        // Simulate a video-only file at /tmp/silent.mp4 being cached as silent.
        remember_silent_path(&mut state, "/tmp/silent.mp4");
        remember_silent_path(&mut state, "/tmp/other-silent.mp4");
        assert!(path_known_silent(&state, "/tmp/silent.mp4"));
        assert!(path_known_silent(&state, "/tmp/other-silent.mp4"));

        // Scene update with only /tmp/silent.mp4 present → other-silent is evicted.
        let l = layer("l1", "/tmp/silent.mp4", 0.0, 10.0, 1.0);
        let active_paths: std::collections::HashSet<&str> = std::slice::from_ref(&l)
            .iter()
            .map(|l| l.path.as_str())
            .collect();
        evict_stale_silent_paths(&mut state, &active_paths);
        assert!(
            path_known_silent(&state, "/tmp/silent.mp4"),
            "active path must stay cached"
        );
        assert!(
            !path_known_silent(&state, "/tmp/other-silent.mp4"),
            "evicted path must be removed from silent cache"
        );
    }

    #[test]
    fn set_scene_with_empty_scene_clears_all_silent_paths() {
        use crate::audio::decode::{
            evict_stale_silent_paths, path_known_silent, remember_silent_path,
        };

        let mut state = crate::audio::shared::AudioShared::default();
        remember_silent_path(&mut state, "/tmp/a.mp4");
        remember_silent_path(&mut state, "/tmp/b.mp4");

        let active_paths: std::collections::HashSet<&str> = std::collections::HashSet::new();
        evict_stale_silent_paths(&mut state, &active_paths);
        assert!(
            !path_known_silent(&state, "/tmp/a.mp4") && !path_known_silent(&state, "/tmp/b.mp4"),
            "empty scene must evict all silent paths"
        );
    }
}
