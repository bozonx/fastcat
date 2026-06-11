use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;

use anyhow::{Context, Result};
use parking_lot::{Condvar, Mutex};

use crate::audio::clock::RealtimeClock;
use crate::audio::mix::sanitize_master_gain;
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
}

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

        let producer = spawn_producer_thread(
            shared.clone(),
            ring.clone(),
            running.clone(),
            clock.clone(),
            AudioRenderTarget::monitor(sample_rate, output_channels),
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
        })
    }

    fn restart_finished_producer(&self) {
        if !self.running.load(Ordering::Acquire) {
            return;
        }

        let mut producer = self.producer.lock();
        if producer
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
        state.master_gain = sanitize_master_gain(master_gain);
        // Bump scene_serial so the producer re-reads the scene (refreshes its
        // cached snapshot and applies new mix params). This does NOT discard the
        // in-flight chunk — only a seek (flush) does — so frequent param edits
        // can't starve the ring.
        state.scene_serial = state.scene_serial.wrapping_add(1);

        if needs_flush {
            state.pending_ring_clear = true;
            let speed = if state.global_speed > 0.0 {
                state.global_speed
            } else {
                1.0
            };
            state.producer_pts_sec =
                state.origin_pts_sec + self.clock.frames() as f64 / self.sample_rate as f64 * speed;
            // Discontinuous output: invalidate in-flight chunks and force decoders
            // to reseek to the new positions.
            state.seek_serial = state.seek_serial.wrapping_add(1);
        }

        // Drop decoded files / decoders no longer referenced by the scene.
        let scene_clone = state.scene.clone();
        let to_remove: Vec<String> = state
            .decoded_cache
            .iter()
            .filter_map(|(key, _)| {
                let path = key.split("|sr=").next().unwrap_or(key);
                if scene_clone.iter().any(|l| l.path == path) {
                    None
                } else {
                    Some(key.clone())
                }
            })
            .collect();
        for key in &to_remove {
            state.drop_decoded(key);
        }
        state
            .file_size_cache
            .retain(|path, _| scene_clone.iter().any(|l| l.path == *path));
        state
            .source_metadata_cache
            .retain(|path, _| scene_clone.iter().any(|l| l.path == *path));
        // Decoders are keyed per layer id (not per path), so retain by layer id.
        state
            .decoders
            .retain(|layer_id, _| scene_clone.iter().any(|l| l.id == *layer_id));
        let plugin_host = state.plugin_host.clone();
        let plugin_specs: Vec<_> = scene_clone
            .iter()
            .map(|layer| (layer.id.clone(), layer.audio_effects.clone()))
            .collect();
        drop(state);
        plugin_host.lock().retain_scene_specs(
            plugin_specs
                .iter()
                .map(|(layer_id, specs)| (layer_id.as_str(), specs.as_slice())),
        );
        if needs_flush {
            plugin_host.lock().reset_all();
        }

        // Pre-emptively warm up the cache for all audio layers in the scene
        let sample_rate = self.sample_rate;
        let output_channels = self.device_channels as usize;
        for layer in &scene_clone {
            let cache_key = crate::audio::shared::decoded_cache_key(&layer.path, sample_rate, output_channels);
            crate::audio::decode::maybe_spawn_background_precache(
                &self.shared,
                &layer.path,
                sample_rate,
                output_channels,
                &cache_key,
            );
        }

        self.shared.1.notify_all();
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
        state.playing = true;
        state.hold_output = hold_output;
        state.origin_pts_sec = pts_sec.max(0.0);
        state.producer_pts_sec = state.origin_pts_sec;
        self.clock.reset_frames();
        // The producer arms the real-time output clock after a tiny startup
        // prebuffer. Until then the cpal callback emits silence without counting
        // an underrun for an intentionally empty ring.
        self.clock.playing.store(false, Ordering::Release);
        state.pending_ring_clear = true;
        state.seek_serial = state.seek_serial.wrapping_add(1);
        let plugin_host = state.plugin_host.clone();
        drop(state);
        plugin_host.lock().reset_all();
        self.shared.1.notify_all();
    }

    /// True once a primed ring has filled enough that releasing the output will not
    /// immediately underrun. Returns `true` for cases that don't need (or can't be)
    /// primed — not currently priming, no audible scene, or reverse/stopped speed —
    /// so the caller's warmup gate never blocks on them.
    pub fn is_primed(&self) -> bool {
        let (playing, hold, scene_empty, speed, has_decoding_in_flight, pending_ring_clear) = {
            let state = self.shared.0.lock();
            (
                state.playing,
                state.hold_output,
                state.scene.is_empty(),
                state.global_speed,
                !state.decoding_in_flight.is_empty(),
                state.pending_ring_clear,
            )
        };
        if !playing || !hold || scene_empty || speed <= 0.0 {
            return true;
        }
        if pending_ring_clear || has_decoding_in_flight {
            return false;
        }
        self.ring.len() >= self.prebuffer_target_samples()
    }

    /// Releases the warmup gate so the primed ring becomes audible. Arms the output
    /// clock right away when a startup prebuffer is already queued; otherwise the
    /// producer arms it once the ring fills past the startup threshold. Re-arming is
    /// idempotent (guarded by `clock.playing`), so a late producer arm is harmless.
    pub fn release_output(&self) {
        let already_armed = {
            let mut state = self.shared.0.lock();
            state.hold_output = false;
            self.clock.playing.load(Ordering::Acquire)
        };
        if !already_armed && self.ring.len() >= self.start_prebuffer_samples() {
            self.clock.reset_frames();
            self.clock.playing.store(true, Ordering::Release);
        }
        self.shared.1.notify_all();
    }

    fn chunk_frames(&self) -> usize {
        (CHUNK_DURATION_SEC * self.sample_rate as f64).round().max(1.0) as usize
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

    pub fn seek(&self, pts_sec: f64, playing: bool) {
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
        if playing && state.playing {
            let current = audible_pts_sec(&state, &self.clock, self.sample_rate);
            if (pts - current).abs() < SEEK_IGNORE_SEC {
                return;
            }
            // Диагностика «двойного» аудио на старте: реальная перемотка НАЗАД во время
            // воспроизведения заставляет продюсер пере-декодить и заново проиграть уже
            // прозвучавший участок (слышно как повтор). Если это логируется в первые
            // секунды после Play — корень дубля именно тут (эхо-seek назад), а не в
            // продюсере. Сними лог, когда причина подтверждена/устранена.
            if pts + SEEK_IGNORE_SEC < current {
                log::warn!(
                    "[audio] backward seek during playback: {current:.3}s -> {pts:.3}s \
                     (replays already-played audio; likely a startup echo-seek)"
                );
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
    /// silent); `playing` reflects whether the master transport is running.
    ///
    /// Forward speeds (>0) varispeed the output (pitch shifts); a value <=0 means
    /// reverse/stopped, where audio is intentionally muted (the producer renders
    /// nothing). Changing speed while playing re-anchors the mix origin and flushes
    /// the buffered output (which was mixed at the old rate), exactly like a seek,
    /// so the new rate starts cleanly.
    pub fn set_speed(&self, speed: f64, anchor_sec: f64, playing: bool) {
        self.restart_finished_producer();
        let speed = if speed.is_finite() && speed != 0.0 {
            speed
        } else {
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

        if playing && state.playing {
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

    pub fn is_empty(&self) -> bool {
        self.restart_finished_producer();
        self.shared.0.lock().scene.is_empty()
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::clock::RealtimeClock;
    use crate::audio::output::{AudioBackend, AudioStream};
    use crate::audio::ring::SpscRingBuffer;
    use crate::monitor::scene::{AudioFadeCurve, SceneAudioLayer};
    use std::sync::Arc;

    struct MockAudioStream;

    impl AudioStream for MockAudioStream {
        fn play(&self) -> Result<()> {
            Ok(())
        }
    }

    struct MockAudioBackend {
        sample_rate: u32,
        channels: u16,
    }

    impl AudioBackend for MockAudioBackend {
        fn sample_rate(&self) -> u32 {
            self.sample_rate
        }

        fn channels(&self) -> u16 {
            self.channels
        }

        fn build_output_stream(
            &self,
            _ring: Arc<SpscRingBuffer>,
            _clock: Arc<RealtimeClock>,
        ) -> Result<Box<dyn AudioStream>> {
            Ok(Box::new(MockAudioStream))
        }
    }

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
    fn playing_seek_defers_output_clock_until_producer_prebuffers() {
        let engine = mock_engine();
        engine.play(10.0);

        engine.seek(25.0, true);

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

        // An echo seek to ~the current position must be ignored: no reseek,
        // no ring flush. seek_serial is the observable proxy for "we reseeked".
        engine.seek(10.0 + SEEK_IGNORE_SEC / 2.0, true);
        assert_eq!(
            seek_serial(&engine),
            before,
            "redundant in-place seek during playback must not reseek/flush"
        );
        assert_eq!(engine.shared.0.lock().origin_pts_sec, 10.0);
    }

    /// Регрессионный тест: seek в пределах prebuffer window не должен сбрасывать ring.
    ///
    /// До фикса `SEEK_IGNORE_SEC = 0.4s` < `PREBUFFER_CHUNKS × 0.05s = 0.8s`: сразу
    /// после `release_output` `audible_pts_sec = origin`, ring держит 0.8s вперёд.
    /// Frontend-seek на +0.7s от origin воспринимался как «реальный», сбрасывал ring
    /// и продюсер начинал пере-декодировать — слышался треск + ускоренный повтор.
    #[test]
    fn seek_within_prebuffer_window_is_ignored() {
        let engine = mock_engine();
        engine.play(10.0);
        let before = seek_serial(&engine);

        // 0.7s вперёд — внутри prebuffer window (0.8s), старый порог 0.4s пропускал это.
        engine.seek(10.0 + 0.7, true);
        assert_eq!(
            seek_serial(&engine),
            before,
            "seek within prebuffer window must not flush the ring (was crackle + repeat)"
        );
    }


    #[test]
    fn seek_honors_real_scrub_during_playback() {
        let engine = mock_engine();
        engine.play(10.0);
        let before = seek_serial(&engine);

        // A genuine position jump (beyond the tolerance) must seek normally.
        engine.seek(25.0, true);
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
        engine.set_speed(2.0, 12.0, true);

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

        engine.seek(15.0, true);

        let after_resets = engine.shared.0.lock().plugin_host.lock().reset_all_count;
        assert_eq!(after_resets, initial_resets + 1);
    }

    #[test]
    fn reverse_speed_mutes_audio_clock() {
        let engine = mock_engine();
        engine.play(10.0);
        // Reverse: audio is intentionally silent, so it is not the master clock.
        engine.set_speed(-1.0, 10.0, true);
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
        engine.set_speed(0.0, 10.0, true);
        assert_eq!(engine.shared.0.lock().global_speed, 1.0);
    }

    #[test]
    fn seek_while_paused_is_never_swallowed() {
        let engine = mock_engine();
        engine.play(10.0);
        let before = seek_serial(&engine);

        // A scrub that pauses (playing=false) must seek even if very close to the
        // current position — the guard only applies to play→play echoes.
        engine.seek(10.0, false);
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
        engine.set_scene(&[l.clone()], &[], 1.0);
        let seek_serial_after_first = seek_serial(&engine);

        // Change only gain — pure mix param.
        let mut l2 = l.clone();
        l2.audio_gain = 0.5;
        engine.set_scene(&[l2], &[], 1.0);
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
        engine.set_scene(&[l.clone()], &[], 1.0);
        let before = seek_serial(&engine);

        let mut l2 = l.clone();
        l2.timeline_start_sec = 1.0;
        engine.set_scene(&[l2], &[], 1.0);
        let state = engine.shared.0.lock();
        assert!(state.seek_serial != before, "position change must flush");
    }

    #[test]
    fn set_scene_speed_change_triggers_flush() {
        let engine = mock_engine();
        let l = layer("l1", "/tmp/a.wav", 0.0, 10.0, 1.0);
        engine.set_scene(&[l.clone()], &[], 1.0);
        let before = seek_serial(&engine);

        let mut l2 = l.clone();
        l2.speed = 2.0;
        engine.set_scene(&[l2], &[], 1.0);
        let state = engine.shared.0.lock();
        assert!(state.seek_serial != before, "speed change must flush");
    }

    #[test]
    fn set_scene_updates_master_gain() {
        let engine = mock_engine();
        engine.set_scene(&[], &[], 0.5);
        let state = engine.shared.0.lock();
        assert_eq!(state.master_gain, 0.5);
    }

    #[test]
    fn set_scene_evicts_unused_decoded_cache() {
        let engine = mock_engine();
        let l1 = layer("l1", "/tmp/a.wav", 0.0, 10.0, 1.0);
        engine.set_scene(&[l1.clone()], &[], 1.0);
        {
            let mut state = engine.shared.0.lock();
            state.cache_decoded(
                "/tmp/a.wav|sr=48000".into(),
                std::sync::Arc::new(vec![0.0f32; 100]),
            );
            state.cache_decoded(
                "/tmp/b.wav|sr=48000".into(),
                std::sync::Arc::new(vec![0.0f32; 100]),
            );
        }

        engine.set_scene(&[l1.clone()], &[], 1.0);
        let state = engine.shared.0.lock();
        assert!(state
            .decoded_cache
            .contains(&"/tmp/a.wav|sr=48000".to_string()));
        assert!(!state
            .decoded_cache
            .contains(&"/tmp/b.wav|sr=48000".to_string()));
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
        assert!(!engine.shared.0.lock().hold_output, "hold_output must be cleared");
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
        engine.set_speed(-1.0, 0.0, true);
        assert!(engine.is_primed(), "reverse speed must report primed");
    }

    #[test]
    fn is_primed_is_false_until_ring_reaches_target() {
        let engine = mock_engine();
        let l = layer("l1", "/tmp/a.wav", 0.0, 10.0, 1.0);
        engine.set_scene(&[l], &[], 1.0);
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
        engine.set_scene(&[l], &[], 1.0);
        
        // Мануально ставим pending_ring_clear в true, как при старте
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
        engine.seek(5.0, false);
        assert!(
            !engine.shared.0.lock().hold_output,
            "seek must clear hold_output"
        );
    }
}
