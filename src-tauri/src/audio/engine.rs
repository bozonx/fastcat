use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;

use anyhow::{anyhow, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{BufferSize, Stream, StreamConfig, SupportedBufferSize};
use parking_lot::{Condvar, Mutex};

use crate::audio::ring::SpscRingBuffer;
use crate::audio::clock::RealtimeClock;
use crate::audio::shared::{AudioShared, compute_timing_sig, CHUNK_DURATION_SEC, PREBUFFER_CHUNKS};
use crate::audio::output::build_stream;
use crate::audio::producer::{spawn_producer_thread, audible_pts_sec};
use crate::audio::mix::sanitize_master_gain;

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
    _stream: Stream,
    producer: Mutex<Option<JoinHandle<()>>>,
}

impl NativeAudioEngine {
    pub fn new(settings: &AudioEngineSettings) -> Result<Self> {
        let host = Self::select_host(settings);
        let device = host
            .default_output_device()
            .ok_or_else(|| anyhow!("no default audio output device"))?;
        let supported = device
            .default_output_config()
            .context("default output config failed")?;
        let sample_rate = supported.sample_rate();
        let mut config: StreamConfig = supported.clone().into();
        let device_channels = config.channels.max(1);

        // Apply user-requested buffer size if the device supports it.
        if let Some(req_bs) = settings.buffer_size {
            if let SupportedBufferSize::Range { min, max } = supported.buffer_size() {
                if req_bs >= *min && req_bs <= *max {
                    config.buffer_size = BufferSize::Fixed(req_bs);
                } else {
                    log::warn!(
                        "[audio] requested buffer size {req_bs} outside supported range {min}–{max}"
                    );
                }
            }
        }
        // The engine renders directly into the device's native channel layout,
        // so the ring buffer holds `output_channels`-interleaved samples and the
        // output callback can copy them 1:1 (no channel remapping at playback).
        let output_channels = device_channels as usize;
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        let running = Arc::new(AtomicBool::new(true));
        let clock = Arc::new(RealtimeClock::default());

        let chunk_frames = (CHUNK_DURATION_SEC * sample_rate as f64).round().max(1.0) as usize;
        let ring_capacity = chunk_frames * output_channels * PREBUFFER_CHUNKS * 2;
        let ring = Arc::new(SpscRingBuffer::new(ring_capacity));

        let stream = build_stream(
            &device,
            &config,
            supported.sample_format(),
            ring.clone(),
            clock.clone(),
            device_channels,
        )?;
        stream.play().context("audio stream play failed")?;

        let producer = spawn_producer_thread(
            shared.clone(),
            ring.clone(),
            running.clone(),
            clock.clone(),
            sample_rate,
            output_channels,
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
            self.sample_rate,
            self.device_channels as usize,
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

    fn select_host(settings: &AudioEngineSettings) -> cpal::Host {
        let requested = settings.backend.as_deref().unwrap_or("default");
        if requested == "default" {
            return cpal::default_host();
        }
        let available = cpal::available_hosts();
        let match_id = available.iter().find(|id| {
            let name = format!("{:?}", id).to_lowercase();
            name.contains(&requested.to_lowercase())
        });
        if let Some(id) = match_id {
            log::info!("[audio] using backend: {requested}");
            cpal::host_from_id(*id).unwrap_or_else(|e| {
                log::warn!(
                    "[audio] failed to create host {requested}: {e}, falling back to default"
                );
                cpal::default_host()
            })
        } else {
            log::warn!(
                "[audio] requested backend '{requested}' not in available hosts ({available:?}), using default"
            );
            cpal::default_host()
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
        layers: Vec<crate::monitor::scene::SceneAudioLayer>,
        tracks: Vec<crate::monitor::scene::SceneAudioTrack>,
        master_gain: f64,
    ) {
        self.restart_finished_producer();
        let mut state = self.shared.0.lock();
        // A flush (drop buffered output + realign the producer) is only needed
        // when audio moves on the timeline. Pure mix-param edits (gain, balance,
        // fade, mute/solo, master) take effect on the next mixed chunk without a
        // ring clear, so dragging a slider during playback no longer clicks.
        let new_sig = compute_timing_sig(&layers);
        let needs_flush = new_sig != state.timing_sig;
        state.timing_sig = new_sig;

        state.scene = layers;
        state.tracks = tracks;
        state.master_gain = sanitize_master_gain(master_gain);
        // Bump scene_serial so the producer re-reads the scene (refreshes its
        // cached snapshot and applies new mix params). This does NOT discard the
        // in-flight chunk — only a seek (flush) does — so frequent param edits
        // can't starve the ring.
        state.scene_serial = state.scene_serial.wrapping_add(1);

        if needs_flush {
            state.pending_ring_clear = true;
            state.producer_pts_sec =
                state.origin_pts_sec + self.clock.frames() as f64 / self.sample_rate as f64;
            // Discontinuous output: invalidate in-flight chunks and force decoders
            // to reseek to the new positions.
            state.seek_serial = state.seek_serial.wrapping_add(1);
        }

        // Drop decoded files / decoders no longer referenced by the scene.
        let current_paths: std::collections::HashSet<String> =
            state.scene.iter().map(|l| l.path.clone()).collect();
        let current_layer_ids: std::collections::HashSet<String> =
            state.scene.iter().map(|l| l.id.clone()).collect();
        let to_remove: Vec<String> = state
            .decoded_cache
            .iter()
            .filter_map(|(key, _)| {
                let path = key.split("|sr=").next().unwrap_or(key);
                if current_paths.contains(path) {
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
            .retain(|path, _| current_paths.contains(path));
        state
            .source_metadata_cache
            .retain(|path, _| current_paths.contains(path));
        // Decoders are keyed per layer id (not per path), so retain by layer id.
        state
            .decoders
            .retain(|layer_id, _| current_layer_ids.contains(layer_id));
        self.shared.1.notify_all();
    }

    pub fn play(&self, pts_sec: f64) {
        self.restart_finished_producer();
        let mut state = self.shared.0.lock();
        state.playing = true;
        state.origin_pts_sec = pts_sec.max(0.0);
        state.producer_pts_sec = state.origin_pts_sec;
        self.clock.reset_frames();
        self.clock.playing.store(true, Ordering::Release);
        state.pending_ring_clear = true;
        state.seek_serial = state.seek_serial.wrapping_add(1);
        self.shared.1.notify_all();
    }

    pub fn pause(&self) -> f64 {
        self.restart_finished_producer();
        let mut state = self.shared.0.lock();
        let pts = audible_pts_sec(
            &state,
            &self.clock,
            self.sample_rate,
            self.device_channels as usize,
            self.ring.len(),
        );
        state.playing = false;
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
        let mut state = self.shared.0.lock();
        let pts = pts_sec.max(0.0);
        state.origin_pts_sec = pts;
        self.clock.reset_frames();
        state.producer_pts_sec = pts;
        state.pending_ring_clear = true;
        state.playing = playing;
        self.clock.playing.store(playing, Ordering::Release);
        state.seek_serial = state.seek_serial.wrapping_add(1);
        self.shared.1.notify_all();
    }

    pub fn current_pts(&self) -> Option<f64> {
        self.restart_finished_producer();
        let state = self.shared.0.lock();
        if !state.playing {
            return None;
        }
        Some(audible_pts_sec(
            &state,
            &self.clock,
            self.sample_rate,
            self.device_channels as usize,
            self.ring.len(),
        ))
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
