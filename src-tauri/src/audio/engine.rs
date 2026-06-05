use std::collections::HashMap;
use std::io::{Seek, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{OutputCallbackInfo, SampleFormat, Stream, StreamConfig};
use parking_lot::{Condvar, Mutex};

use crate::monitor::scene::{AudioFadeCurve, SceneAudioLayer, SceneAudioTrack};

const CHUNK_DURATION_SEC: f64 = 0.05;
const PREBUFFER_CHUNKS: usize = 8;

struct CachedAudioDecoder {
    format: Box<dyn symphonia::core::formats::FormatReader>,
    decoder: Box<dyn symphonia::core::codecs::Decoder>,
    track_id: u32,
    source_rate: u32,
    channels: usize,
    time_base: symphonia::core::units::TimeBase,
    // Cached resampler to avoid rebuilding it every chunk.
    // Stored as Option<Box<...>> because resamplers are large and rarely change ratio.
    resampler: Option<Box<rubato::SincFixedIn<f32>>>,
    last_resample_ratio: f64,
    // Last source position we decoded up to; used to skip seeks on sequential chunks.
    last_decode_end_sec: f64,
    // Planar input frames not yet consumed by the fixed-size resampler. Carried
    // across sequential chunks so block boundaries don't inject zero-padding,
    // which would otherwise create periodic clicks in the output.
    resample_remainder: Vec<Vec<f32>>,
}

/// Lock-free SPSC ring buffer for real-time audio output.
/// Uses atomic read/write indices and bit-casts f32 samples into AtomicU32
/// slots so the backing buffer is plain atomics (no mutex/alloc on hot path).
struct SpscRingBuffer {
    buffer: Vec<std::sync::atomic::AtomicU32>,
    write_idx: AtomicUsize,
    read_idx: AtomicUsize,
}

impl SpscRingBuffer {
    fn new(capacity: usize) -> Self {
        let mut buffer = Vec::with_capacity(capacity);
        for _ in 0..capacity {
            buffer.push(std::sync::atomic::AtomicU32::new(0));
        }
        Self {
            buffer,
            write_idx: AtomicUsize::new(0),
            read_idx: AtomicUsize::new(0),
        }
    }

    fn len(&self) -> usize {
        let write = self.write_idx.load(Ordering::Acquire);
        let read = self.read_idx.load(Ordering::Acquire);
        write.wrapping_sub(read)
    }

    fn clear(&self) {
        let write = self.write_idx.load(Ordering::Acquire);
        self.read_idx.store(write, Ordering::Release);
    }

    /// Push as many samples as capacity allows. Returns count written.
    fn push_slice(&self, samples: &[f32]) -> usize {
        let capacity = self.buffer.len();
        let mut written = 0;
        for &sample in samples {
            let write = self.write_idx.load(Ordering::Relaxed);
            let read = self.read_idx.load(Ordering::Acquire);
            let available = capacity - write.wrapping_sub(read);
            if available == 0 {
                break;
            }
            let idx = write % capacity;
            self.buffer[idx].store(sample.to_bits(), Ordering::Release);
            self.write_idx
                .store(write.wrapping_add(1), Ordering::Release);
            written += 1;
        }
        written
    }

    /// Pop up to `out.len()` samples. Returns count read.
    fn pop_slice(&self, out: &mut [f32]) -> usize {
        let w = self.write_idx.load(Ordering::Acquire);
        let r = self.read_idx.load(Ordering::Relaxed);
        let available = w.wrapping_sub(r).min(out.len());
        if available == 0 {
            return 0;
        }
        let capacity = self.buffer.len();
        let start = r % capacity;
        let end = start + available;
        if end <= capacity {
            for i in 0..available {
                out[i] = f32::from_bits(self.buffer[start + i].load(Ordering::Relaxed));
            }
        } else {
            let first = capacity - start;
            for i in 0..first {
                out[i] = f32::from_bits(self.buffer[start + i].load(Ordering::Relaxed));
            }
            for i in first..available {
                out[i] = f32::from_bits(self.buffer[i - first].load(Ordering::Relaxed));
            }
        }
        self.read_idx
            .store(r.wrapping_add(available), Ordering::Release);
        available
    }
}

struct AudioShared {
    scene: Vec<SceneAudioLayer>,
    tracks: Vec<SceneAudioTrack>,
    master_gain: f64,
    playing: bool,
    origin_pts_sec: f64,
    producer_pts_sec: f64,
    seek_serial: u64,
    scene_serial: u64,
    decoded_cache: lru::LruCache<String, Arc<Vec<f32>>>,
    decoders: HashMap<String, CachedAudioDecoder>,
}

fn decoded_cache_key(path: &str, sample_rate: u32, output_channels: usize) -> String {
    format!("{path}|sr={sample_rate}|ch={output_channels}")
}

impl Default for AudioShared {
    fn default() -> Self {
        Self {
            scene: Vec::new(),
            tracks: Vec::new(),
            master_gain: 1.0,
            playing: false,
            origin_pts_sec: 0.0,
            producer_pts_sec: 0.0,
            seek_serial: 0,
            scene_serial: 0,
            decoded_cache: lru::LruCache::new(std::num::NonZeroUsize::new(20).unwrap()),
            decoders: HashMap::new(),
        }
    }
}

/// Lock-free clock/state shared with the real-time output callback. The audio
/// callback must never block on a mutex, so playback state and frame counters
/// live in atomics that the callback reads/writes without locking.
#[derive(Default)]
struct RealtimeClock {
    playing: AtomicBool,
    frames_written: std::sync::atomic::AtomicU64,
    // f64 output latency (seconds) stored as raw bits for atomic access.
    output_latency_bits: std::sync::atomic::AtomicU64,
}

impl RealtimeClock {
    fn reset_frames(&self) {
        self.frames_written.store(0, Ordering::Release);
        self.output_latency_bits.store(0, Ordering::Release);
    }

    fn frames(&self) -> u64 {
        self.frames_written.load(Ordering::Acquire)
    }

    fn output_latency_sec(&self) -> f64 {
        f64::from_bits(self.output_latency_bits.load(Ordering::Acquire))
    }
}

pub struct NativeAudioEngine {
    shared: Arc<(Mutex<AudioShared>, Condvar)>,
    ring: Arc<SpscRingBuffer>,
    running: Arc<AtomicBool>,
    clock: Arc<RealtimeClock>,
    sample_rate: u32,
    device_channels: u16,
    _stream: Stream,
    producer: Option<JoinHandle<()>>,
}

impl NativeAudioEngine {
    pub fn new() -> Result<Self> {
        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or_else(|| anyhow!("no default audio output device"))?;
        let supported = device
            .default_output_config()
            .context("default output config failed")?;
        let sample_rate = supported.sample_rate();
        let config: StreamConfig = supported.clone().into();
        let device_channels = config.channels.max(1);
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

        let producer_shared = shared.clone();
        let producer_ring = ring.clone();
        let producer_running = running.clone();
        let producer = std::thread::Builder::new()
            .name("fastcat-audio-producer".into())
            .spawn(move || {
                if let Err(e) = thread_priority::set_current_thread_priority(
                    thread_priority::ThreadPriority::Max,
                ) {
                    log::warn!("[audio] failed to set real-time priority: {e}");
                }
                producer_loop(
                    producer_shared,
                    producer_ring,
                    producer_running,
                    sample_rate,
                    output_channels,
                )
            })?;

        Ok(Self {
            shared,
            ring,
            running,
            clock,
            sample_rate,
            device_channels,
            _stream: stream,
            producer: Some(producer),
        })
    }

    pub fn set_scene(
        &self,
        layers: Vec<SceneAudioLayer>,
        tracks: Vec<SceneAudioTrack>,
        master_gain: f64,
    ) {
        let mut state = self.shared.0.lock();
        state.scene = layers;
        state.tracks = tracks;
        state.master_gain = sanitize_master_gain(master_gain);
        self.ring.clear();
        state.producer_pts_sec =
            state.origin_pts_sec + self.clock.frames() as f64 / self.sample_rate as f64;
        state.scene_serial = state.scene_serial.wrapping_add(1);

        // Drop decoded files that are no longer referenced by the scene.
        let current_paths: std::collections::HashSet<String> =
            state.scene.iter().map(|l| l.path.clone()).collect();
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
            state.decoded_cache.pop(key);
        }
        state
            .decoders
            .retain(|path, _| current_paths.contains(path));
        self.shared.1.notify_all();
    }

    pub fn play(&self, pts_sec: f64) {
        let mut state = self.shared.0.lock();
        state.playing = true;
        state.origin_pts_sec = pts_sec.max(0.0);
        state.producer_pts_sec = state.origin_pts_sec;
        self.clock.reset_frames();
        self.clock.playing.store(true, Ordering::Release);
        self.ring.clear();
        state.seek_serial = state.seek_serial.wrapping_add(1);
        self.shared.1.notify_all();
    }

    pub fn pause(&self) -> f64 {
        let mut state = self.shared.0.lock();
        let pts = audible_pts_sec(&state, &self.clock, self.sample_rate);
        state.playing = false;
        self.clock.playing.store(false, Ordering::Release);
        state.origin_pts_sec = pts;
        self.clock.reset_frames();
        self.ring.clear();
        state.producer_pts_sec = pts;
        self.shared.1.notify_all();
        pts
    }

    pub fn seek(&self, pts_sec: f64, playing: bool) {
        let mut state = self.shared.0.lock();
        let pts = pts_sec.max(0.0);
        state.origin_pts_sec = pts;
        self.clock.reset_frames();
        state.producer_pts_sec = pts;
        self.ring.clear();
        state.playing = playing;
        self.clock.playing.store(playing, Ordering::Release);
        state.seek_serial = state.seek_serial.wrapping_add(1);
        self.shared.1.notify_all();
    }

    pub fn current_pts(&self) -> Option<f64> {
        let state = self.shared.0.lock();
        if !state.playing {
            return None;
        }
        Some(audible_pts_sec(&state, &self.clock, self.sample_rate))
    }

    pub fn is_empty(&self) -> bool {
        self.shared.0.lock().scene.is_empty()
    }

    pub fn scene_end(&self) -> f64 {
        self.shared
            .0
            .lock()
            .scene
            .iter()
            .map(|layer| {
                let duration = (layer.timeline_end_sec - layer.timeline_start_sec).max(0.0);
                // `speed` is signed (negative means reversed); only its magnitude
                // affects how long the clip occupies on the timeline.
                let speed = sanitize_speed(layer.speed.abs());
                let actual_duration = if speed > 0.0 {
                    duration / speed
                } else {
                    duration
                };
                layer.timeline_start_sec + actual_duration
            })
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
        if let Some(handle) = self.producer.take() {
            if let Err(e) = handle.join() {
                log::warn!("[audio] producer thread panicked: {e:?}");
            }
        }
    }
}

fn build_stream(
    device: &cpal::Device,
    config: &StreamConfig,
    format: SampleFormat,
    ring: Arc<SpscRingBuffer>,
    clock: Arc<RealtimeClock>,
    device_channels: u16,
) -> Result<Stream> {
    let err_fn = |err| log::error!("[audio] output stream error: {err}");
    match format {
        SampleFormat::F32 => device
            .build_output_stream(
                config,
                move |data: &mut [f32], info| {
                    write_output(data, info, &clock, &ring, device_channels)
                },
                err_fn,
                None,
            )
            .context("build f32 output stream failed"),
        SampleFormat::I16 => device
            .build_output_stream(
                config,
                move |data: &mut [i16], info| {
                    write_output(data, info, &clock, &ring, device_channels)
                },
                err_fn,
                None,
            )
            .context("build i16 output stream failed"),
        SampleFormat::U16 => device
            .build_output_stream(
                config,
                move |data: &mut [u16], info| {
                    write_output(data, info, &clock, &ring, device_channels)
                },
                err_fn,
                None,
            )
            .context("build u16 output stream failed"),
        other => Err(anyhow!("unsupported audio sample format: {other:?}")),
    }
}

trait OutputSample {
    fn from_f32(value: f32) -> Self;
}

impl OutputSample for f32 {
    fn from_f32(value: f32) -> Self {
        value.clamp(-1.0, 1.0)
    }
}

impl OutputSample for i16 {
    fn from_f32(value: f32) -> Self {
        (value.clamp(-1.0, 1.0) * i16::MAX as f32) as i16
    }
}

impl OutputSample for u16 {
    fn from_f32(value: f32) -> Self {
        ((value.clamp(-1.0, 1.0) * 0.5 + 0.5) * u16::MAX as f32) as u16
    }
}

fn write_output<T: OutputSample>(
    data: &mut [T],
    info: &OutputCallbackInfo,
    clock: &RealtimeClock,
    ring: &SpscRingBuffer,
    device_channels: u16,
) {
    let channels = device_channels.max(1) as usize;
    let frames = data.len() / channels;

    // Playback state is read lock-free; the callback never blocks on a mutex.
    if !clock.playing.load(Ordering::Acquire) {
        for sample in data.iter_mut() {
            *sample = T::from_f32(0.0);
        }
        return;
    }

    let mut temp = [0.0f32; 4096];
    let mut heap_temp: Vec<f32> = Vec::new();
    let temp_slice = if data.len() <= temp.len() {
        temp[..data.len()].fill(0.0);
        &mut temp[..data.len()]
    } else {
        // Heap fallback for very large device buffers (uncommon).
        heap_temp.resize(data.len(), 0.0);
        &mut heap_temp[..]
    };
    // The ring already holds device-channel interleaved samples, so we copy 1:1.
    // On underrun the unfilled tail stays zeroed (silence), but the clock still
    // advances below to prevent drift.
    let _read = ring.pop_slice(temp_slice);
    for (out, sample) in data.iter_mut().zip(temp_slice.iter()) {
        *out = T::from_f32(*sample);
    }

    clock
        .frames_written
        .fetch_add(frames as u64, Ordering::AcqRel);
    clock
        .output_latency_bits
        .store(output_latency_sec(info).to_bits(), Ordering::Release);
}

fn audible_pts_sec(state: &AudioShared, clock: &RealtimeClock, sample_rate: u32) -> f64 {
    let latency_frames = (clock.output_latency_sec().max(0.0) * sample_rate as f64).round() as u64;
    // `frames_written` already accounts for every frame handed to the OS callback;
    // the output latency is the pipeline delay. Subtracting buffer size again
    // would double-count the in-flight audio.
    let audible_frames = clock.frames().saturating_sub(latency_frames);
    state.origin_pts_sec + audible_frames as f64 / sample_rate as f64
}

fn output_latency_sec(info: &OutputCallbackInfo) -> f64 {
    info.timestamp()
        .playback
        .duration_since(&info.timestamp().callback)
        .map(|duration| duration.as_secs_f64().clamp(0.0, 0.5))
        .unwrap_or(0.0)
}

fn producer_loop(
    shared: Arc<(Mutex<AudioShared>, Condvar)>,
    ring: Arc<SpscRingBuffer>,
    running: Arc<AtomicBool>,
    sample_rate: u32,
    output_channels: usize,
) {
    let chunk_frames = (CHUNK_DURATION_SEC * sample_rate as f64).round().max(1.0) as usize;
    let limit_samples = chunk_frames * output_channels * PREBUFFER_CHUNKS;

    while running.load(Ordering::Relaxed) {
        let snapshot = {
            let mut state = shared.0.lock();
            loop {
                if !running.load(Ordering::Relaxed) {
                    return;
                }
                if state.playing && !state.scene.is_empty() && ring.len() < limit_samples {
                    break Some((
                        state.scene.clone(),
                        state.tracks.clone(),
                        state.master_gain,
                        state.producer_pts_sec,
                        state.seek_serial,
                        state.scene_serial,
                    ));
                }
                let wait_res = shared.1.wait_for(&mut state, Duration::from_millis(50));
                if wait_res.timed_out()
                    && (!state.playing || state.scene.is_empty() || ring.len() >= limit_samples)
                {
                    break None;
                }
            }
        };

        let Some((scene, tracks, master_gain, chunk_start, seek_serial, scene_serial)) = snapshot
        else {
            continue;
        };

        let chunk = mix_chunk(
            &scene,
            &tracks,
            master_gain,
            chunk_start,
            CHUNK_DURATION_SEC,
            sample_rate,
            output_channels,
            &shared,
            false,
        );

        let mut state = shared.0.lock();
        if state.seek_serial != seek_serial || state.scene_serial != scene_serial || !state.playing
        {
            continue;
        }
        if ring.len() < limit_samples {
            ring.push_slice(&chunk);
            state.producer_pts_sec += CHUNK_DURATION_SEC;
        }
    }
}

/// Renders the audio scene to an f32 WAV file.
///
/// `output_channels` selects the file's channel layout (1 = mono, 2 = stereo).
/// Export is intentionally limited to mono/stereo for now.
pub(crate) fn render_scene_to_wav(
    scene: &[SceneAudioLayer],
    tracks: &[SceneAudioTrack],
    master_gain: f64,
    start_sec: f64,
    end_sec: f64,
    sample_rate: u32,
    output_channels: usize,
    target_path: &Path,
) -> Result<()> {
    let output_channels = output_channels.clamp(1, 2);
    let start = if start_sec.is_finite() {
        start_sec.max(0.0)
    } else {
        0.0
    };
    let end = if end_sec.is_finite() {
        end_sec.max(start)
    } else {
        start
    };
    let estimated_frames = ((end - start) * sample_rate as f64).round().max(1.0) as u64;
    let mut file = std::fs::File::create(target_path)
        .with_context(|| format!("create audio wav {}", target_path.display()))?;

    // Write placeholder header (will be patched after we know actual size).
    write_wav_f32_header_placeholder(&mut file, sample_rate, output_channels as u16)?;

    let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));

    let mut written_frames = 0u64;
    while written_frames < estimated_frames {
        let chunk_frames = ((CHUNK_DURATION_SEC * sample_rate as f64).round() as u64)
            .min(estimated_frames - written_frames)
            .max(1);
        let chunk_duration = chunk_frames as f64 / sample_rate as f64;
        let chunk_start = start + written_frames as f64 / sample_rate as f64;
        let chunk = mix_chunk(
            scene,
            tracks,
            master_gain,
            chunk_start,
            chunk_duration,
            sample_rate,
            output_channels,
            &shared,
            true,
        );
        let samples_to_write = chunk_frames as usize * output_channels;
        for sample in chunk.into_iter().take(samples_to_write) {
            file.write_all(&sample.to_le_bytes())?;
        }
        written_frames = written_frames.saturating_add(chunk_frames);
    }

    // Patch header with actual frame count.
    let data_size = written_frames
        .saturating_mul(output_channels as u64)
        .saturating_mul(4);
    if data_size > u32::MAX as u64 {
        log::warn!(
            "[audio] WAV data size {} exceeds 32-bit limit; header will be truncated",
            data_size
        );
    }
    let riff_size = 36u64.saturating_add(data_size).min(u32::MAX as u64);
    file.seek(std::io::SeekFrom::Start(4))?;
    file.write_all(&(riff_size as u32).to_le_bytes())?;
    file.seek(std::io::SeekFrom::Start(40))?;
    file.write_all(&(data_size.min(u32::MAX as u64) as u32).to_le_bytes())?;
    Ok(())
}

fn write_wav_f32_header_placeholder(
    file: &mut std::fs::File,
    sample_rate: u32,
    channels: u16,
) -> Result<()> {
    // Standard WAV header with zero data_size; will be patched after writing.
    let bits_per_sample = 32u16;
    let bytes_per_sample = (bits_per_sample / 8) as u32;
    let data_size = 0u32;
    let riff_size = 36u32.saturating_add(data_size);
    file.write_all(b"RIFF")?;
    file.write_all(&riff_size.to_le_bytes())?;
    file.write_all(b"WAVE")?;
    file.write_all(b"fmt ")?;
    file.write_all(&16u32.to_le_bytes())?;
    file.write_all(&3u16.to_le_bytes())?;
    file.write_all(&channels.to_le_bytes())?;
    file.write_all(&sample_rate.to_le_bytes())?;
    let byte_rate = sample_rate
        .saturating_mul(channels as u32)
        .saturating_mul(bytes_per_sample);
    file.write_all(&byte_rate.to_le_bytes())?;
    let block_align = channels.saturating_mul(bytes_per_sample as u16);
    file.write_all(&block_align.to_le_bytes())?;
    file.write_all(&bits_per_sample.to_le_bytes())?;
    file.write_all(b"data")?;
    file.write_all(&data_size.to_le_bytes())?;
    Ok(())
}

fn mix_chunk(
    scene: &[SceneAudioLayer],
    tracks: &[SceneAudioTrack],
    master_gain: f64,
    chunk_start_sec: f64,
    chunk_duration_sec: f64,
    sample_rate: u32,
    output_channels: usize,
    shared: &Arc<(Mutex<AudioShared>, Condvar)>,
    is_export: bool,
) -> Vec<f32> {
    let output_channels = output_channels.max(1);
    let frames = (chunk_duration_sec * sample_rate as f64).round().max(1.0) as usize;
    let mut mixed = vec![0.0f32; frames * output_channels];
    let chunk_end_sec = chunk_start_sec + chunk_duration_sec;

    // 1. Check the solo state of tracks.
    let has_solo = tracks.iter().any(|t| t.audio_solo);

    // 2. Group layers by track_id. Layers without a matching track are mixed
    // directly into the master bus ("orphan" layers, kept for compatibility).
    let mut track_layers: HashMap<String, Vec<&SceneAudioLayer>> = HashMap::new();
    let mut orphan_layers: Vec<&SceneAudioLayer> = Vec::new();

    for layer in scene {
        let tid = layer.track_id.as_deref().unwrap_or("");
        match resolve_track_for_layer(tid, tracks) {
            Some(track) => track_layers
                .entry(track.id.clone())
                .or_default()
                .push(layer),
            None => orphan_layers.push(layer),
        }
    }

    // 3. Mix track buses.
    for track in tracks {
        if has_solo && !track.audio_solo {
            continue;
        }
        if !has_solo && track.audio_muted {
            continue;
        }

        let Some(layers) = track_layers.get(&track.id) else {
            continue;
        };

        let mut track_mixed = vec![0.0f32; frames * output_channels];
        let mut has_audio_on_track = false;

        for layer in layers {
            has_audio_on_track |= mix_layer_into(
                &mut track_mixed,
                layer,
                chunk_start_sec,
                chunk_end_sec,
                frames,
                sample_rate,
                output_channels,
                is_export,
                shared,
            );
        }

        if has_audio_on_track {
            apply_bus_gain_balance(
                &mut mixed,
                &track_mixed,
                frames,
                output_channels,
                track.audio_gain,
                track.audio_balance,
            );
        }
    }

    // 4. Mix orphan layers directly into the master bus.
    if !has_solo {
        for layer in orphan_layers {
            mix_layer_into(
                &mut mixed,
                layer,
                chunk_start_sec,
                chunk_end_sec,
                frames,
                sample_rate,
                output_channels,
                is_export,
                shared,
            );
        }
    }

    apply_master_gain(&mut mixed, master_gain);
    soft_clip(&mut mixed);
    mixed
}

/// Resolves the bus track that owns a layer. An empty `tid` is never matched
/// (the layer is treated as orphan). Matching is exact, or `tid` may use the
/// `"{track_id}_..."` suffix form; the most specific (longest) track id wins to
/// keep routing deterministic.
fn resolve_track_for_layer<'a>(
    tid: &str,
    tracks: &'a [SceneAudioTrack],
) -> Option<&'a SceneAudioTrack> {
    if tid.is_empty() {
        return None;
    }
    tracks
        .iter()
        .filter(|t| tid == t.id || tid.starts_with(&format!("{}_", t.id)))
        .max_by_key(|t| t.id.len())
}

/// Decodes, optionally reverses, and mixes a single layer into `buffer`.
/// Returns `true` if the layer contributed audio to this chunk.
#[allow(clippy::too_many_arguments)]
fn mix_layer_into(
    buffer: &mut [f32],
    layer: &SceneAudioLayer,
    chunk_start_sec: f64,
    chunk_end_sec: f64,
    frames: usize,
    sample_rate: u32,
    output_channels: usize,
    is_export: bool,
    shared: &Arc<(Mutex<AudioShared>, Condvar)>,
) -> bool {
    if layer.timeline_end_sec <= chunk_start_sec || layer.timeline_start_sec >= chunk_end_sec {
        return false;
    }
    let raw_segment_start = chunk_start_sec.max(layer.timeline_start_sec);
    let raw_segment_end = chunk_end_sec.min(layer.timeline_end_sec);
    let (write_start_frame, frames_to_write) = chunk_write_range(
        chunk_start_sec,
        raw_segment_start,
        raw_segment_end,
        sample_rate,
        frames,
    );
    if frames_to_write == 0 {
        return false;
    }
    let segment_start = chunk_start_sec + write_start_frame as f64 / sample_rate as f64;
    let segment_duration = frames_to_write as f64 / sample_rate as f64;
    let segment_end = segment_start + segment_duration;

    let reversed = layer.speed < 0.0;
    if !is_export && reversed {
        // Reverse audio is muted in preview/monitor; only rendered on export.
        return false;
    }

    let speed = sanitize_speed(layer.speed.abs());
    let source_start = if reversed {
        let source_start_in_range = ((layer.timeline_end_sec - segment_end) * speed).max(0.0);
        layer.source_start_sec + source_start_in_range
    } else {
        layer.source_start_sec + (segment_start - layer.timeline_start_sec) * speed
    };

    let mut decoded = match decode_audio_chunk(
        &layer.path,
        source_start,
        segment_duration,
        speed,
        sample_rate,
        output_channels,
        shared,
    )
    .with_context(|| format!("decode audio layer {}", layer.id))
    {
        Ok(decoded) => decoded,
        Err(error) => {
            log::warn!(
                "[audio] skipping layer {} at {chunk_start_sec:.3}s: {error:?}",
                layer.id
            );
            return false;
        }
    };

    if reversed {
        reverse_frames(&mut decoded, output_channels);
    }

    let frames_to_write = frames_to_write.min(decoded.len() / output_channels);
    apply_layer_mix(
        buffer,
        &decoded,
        write_start_frame,
        frames_to_write,
        sample_rate,
        layer,
        segment_start,
        output_channels,
    );
    true
}

fn chunk_write_range(
    chunk_start_sec: f64,
    segment_start_sec: f64,
    segment_end_sec: f64,
    sample_rate: u32,
    chunk_frames: usize,
) -> (usize, usize) {
    if segment_end_sec <= segment_start_sec || chunk_frames == 0 {
        return (0, 0);
    }

    let sample_rate = sample_rate as f64;
    let chunk_start_frame = (chunk_start_sec * sample_rate).round() as i64;
    let segment_start_frame = (segment_start_sec * sample_rate).round() as i64;
    let segment_end_frame = (segment_end_sec * sample_rate).round() as i64;

    let write_start = segment_start_frame
        .saturating_sub(chunk_start_frame)
        .clamp(0, chunk_frames as i64) as usize;
    let write_end = segment_end_frame
        .saturating_sub(chunk_start_frame)
        .clamp(write_start as i64, chunk_frames as i64) as usize;

    (write_start, write_end.saturating_sub(write_start))
}

/// Reverses an interleaved buffer frame-by-frame, preserving channel order
/// within each frame, for any channel count.
fn reverse_frames(decoded: &mut [f32], channels: usize) {
    if channels == 0 {
        return;
    }
    let num_frames = decoded.len() / channels;
    for i in 0..num_frames / 2 {
        let j = num_frames - 1 - i;
        for ch in 0..channels {
            decoded.swap(i * channels + ch, j * channels + ch);
        }
    }
}

/// Applies a track bus gain and stereo balance, then accumulates into the
/// master `mixed` buffer. Balance only affects the front L/R pair (channels 0
/// and 1); any further channels are passed through with gain only. Mono output
/// ignores balance entirely.
fn apply_bus_gain_balance(
    mixed: &mut [f32],
    track_mixed: &[f32],
    frames: usize,
    channels: usize,
    audio_gain: f64,
    audio_balance: f64,
) {
    let gain = audio_gain.max(0.0) as f32;
    if channels >= 2 {
        let (ll, lr, rl, rr) = stereo_pan_matrix(audio_balance);
        let (ll, lr, rl, rr) = (ll as f32, lr as f32, rl as f32, rr as f32);
        for i in 0..frames {
            let base = i * channels;
            let left = track_mixed[base] * gain;
            let right = track_mixed[base + 1] * gain;
            mixed[base] += ll * left + lr * right;
            mixed[base + 1] += rl * left + rr * right;
            for ch in 2..channels {
                mixed[base + ch] += track_mixed[base + ch] * gain;
            }
        }
    } else {
        for i in 0..frames {
            mixed[i] += track_mixed[i] * gain;
        }
    }
}

fn apply_master_gain(samples: &mut [f32], master_gain: f64) {
    let gain = sanitize_master_gain(master_gain) as f32;
    if (gain - 1.0).abs() <= f32::EPSILON {
        return;
    }
    // The final `soft_clip` pass keeps the signal bounded, so master gain only
    // needs to scale; no intermediate headroom clamp is required.
    for sample in samples {
        *sample *= gain;
    }
}

fn resample_planar_with_speed(
    input: Vec<Vec<f32>>,
    source_rate: u32,
    target_rate: u32,
    speed: f64,
    num_channels: usize,
) -> Result<Vec<Vec<f32>>> {
    use rubato::{
        Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction,
    };

    let ratio = target_rate as f64 / (source_rate as f64 * speed);

    if (ratio - 1.0).abs() < 1e-6 && source_rate == target_rate {
        return Ok(input);
    }

    if input.is_empty() || input[0].is_empty() {
        return Ok(input);
    }

    let params = SincInterpolationParameters {
        sinc_len: 256,
        f_cutoff: 0.95,
        interpolation: SincInterpolationType::Linear,
        oversampling_factor: 160,
        window: WindowFunction::BlackmanHarris2,
    };

    let chunk_size = 1024;
    let max_ratio_factor = ratio.max(2.0);
    let mut resampler =
        SincFixedIn::<f32>::new(ratio, max_ratio_factor, params, chunk_size, num_channels)
            .map_err(|e| anyhow!("failed to create resampler: {:?}", e))?;

    let input_len = input[0].len();
    let mut output = vec![Vec::new(); num_channels];
    let mut offset = 0;

    while offset < input_len {
        let copy_len = (input_len - offset).min(chunk_size);
        let mut chunk = vec![vec![0.0f32; chunk_size]; num_channels];
        for ch in 0..num_channels {
            chunk[ch][..copy_len].copy_from_slice(&input[ch][offset..offset + copy_len]);
        }

        let out_chunk = resampler
            .process(&chunk, None)
            .map_err(|e| anyhow!("failed to resample chunk: {:?}", e))?;

        for ch in 0..num_channels {
            output[ch].extend_from_slice(&out_chunk[ch]);
        }
        offset += copy_len;
    }

    // Flush any remaining resampler delay/tail samples.
    let flush = vec![vec![0.0f32; chunk_size]; num_channels];
    loop {
        let out_chunk = resampler
            .process(&flush, None)
            .map_err(|e| anyhow!("failed to flush resampler: {:?}", e))?;
        let all_empty = out_chunk.iter().all(|ch| ch.is_empty());
        if all_empty {
            break;
        }
        for ch in 0..num_channels {
            output[ch].extend_from_slice(&out_chunk[ch]);
        }
    }

    Ok(output)
}

/// Streaming resampler for sequential chunks. Unlike `resample_planar_with_speed`
/// it keeps a cached resampler instance and carries unconsumed input frames in
/// `remainder` across calls. This avoids zero-padding the final partial block of
/// each chunk (which would feed silence into the resampler delay line and create
/// periodic clicks at chunk boundaries). The caller must clear `remainder` (and
/// the cached resampler) whenever it seeks/discontinues the source stream.
#[allow(clippy::too_many_arguments)]
fn resample_planar_cached(
    input: Vec<Vec<f32>>,
    source_rate: u32,
    target_rate: u32,
    speed: f64,
    num_channels: usize,
    cached_resampler: &mut Option<Box<rubato::SincFixedIn<f32>>>,
    remainder: &mut Vec<Vec<f32>>,
) -> Result<Vec<Vec<f32>>> {
    use rubato::{
        Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction,
    };

    let ratio = target_rate as f64 / (source_rate as f64 * speed);

    if (ratio - 1.0).abs() < 1e-6 && source_rate == target_rate {
        return Ok(input);
    }

    if num_channels == 0 {
        return Ok(input);
    }

    if cached_resampler.is_none() {
        let params = SincInterpolationParameters {
            sinc_len: 256,
            f_cutoff: 0.95,
            interpolation: SincInterpolationType::Linear,
            oversampling_factor: 160,
            window: WindowFunction::BlackmanHarris2,
        };
        let chunk_size = 1024;
        let max_ratio_factor = ratio.max(2.0);
        let resampler =
            SincFixedIn::<f32>::new(ratio, max_ratio_factor, params, chunk_size, num_channels)
                .map_err(|e| anyhow!("failed to create resampler: {:?}", e))?;
        *cached_resampler = Some(Box::new(resampler));
        *remainder = vec![Vec::new(); num_channels];
    }

    if remainder.len() != num_channels {
        *remainder = vec![Vec::new(); num_channels];
    }

    let resampler = cached_resampler.as_mut().unwrap();
    let chunk_size = resampler.input_frames_max();

    // Combine carried-over remainder with the freshly decoded input.
    let mut pending: Vec<Vec<f32>> = Vec::with_capacity(num_channels);
    for ch in 0..num_channels {
        let mut channel = std::mem::take(&mut remainder[ch]);
        if let Some(src) = input.get(ch) {
            channel.extend_from_slice(src);
        }
        pending.push(channel);
    }
    let pending_len = pending.first().map(|c| c.len()).unwrap_or(0);

    let mut output = vec![Vec::new(); num_channels];
    let mut offset = 0;
    while offset + chunk_size <= pending_len {
        let mut chunk = vec![vec![0.0f32; chunk_size]; num_channels];
        for ch in 0..num_channels {
            chunk[ch].copy_from_slice(&pending[ch][offset..offset + chunk_size]);
        }
        let out_chunk = resampler
            .process(&chunk, None)
            .map_err(|e| anyhow!("failed to resample chunk: {:?}", e))?;
        for ch in 0..num_channels {
            output[ch].extend_from_slice(&out_chunk[ch]);
        }
        offset += chunk_size;
    }

    // Stash the unconsumed tail (< chunk_size frames) for the next call.
    for ch in 0..num_channels {
        remainder[ch] = pending[ch][offset..].to_vec();
    }

    Ok(output)
}

/// Converts planar channel buffers into an interleaved buffer with exactly
/// `out_channels` channels, applying a sensible down/up-mix:
/// - equal channel counts: copied 1:1;
/// - mono source: duplicated into the front L/R pair (others silent);
/// - mono output: average of all source channels;
/// - otherwise: the overlapping channels are copied, extra outputs stay silent.
///
/// Channels of unequal length are tolerated (frame count is the shortest
/// channel) so a malformed decode never panics.
fn planar_to_interleaved(planar: &[Vec<f32>], out_channels: usize) -> Vec<f32> {
    let src_channels = planar.len();
    if src_channels == 0 || out_channels == 0 {
        return Vec::new();
    }
    let num_frames = planar.iter().map(|c| c.len()).min().unwrap_or(0);
    if num_frames == 0 {
        return Vec::new();
    }
    let mut interleaved = vec![0.0f32; num_frames * out_channels];

    if src_channels == out_channels {
        for f in 0..num_frames {
            let base = f * out_channels;
            for ch in 0..out_channels {
                interleaved[base + ch] = planar[ch][f];
            }
        }
    } else if src_channels == 1 {
        // Mono source: front L/R for stereo+, single channel for mono.
        let front = out_channels.min(2);
        for f in 0..num_frames {
            let val = planar[0][f];
            let base = f * out_channels;
            for ch in 0..front {
                interleaved[base + ch] = val;
            }
        }
    } else if out_channels == 1 {
        // Downmix every source channel into mono.
        let inv = 1.0 / src_channels as f32;
        for f in 0..num_frames {
            let mut sum = 0.0;
            for ch in 0..src_channels {
                sum += planar[ch][f];
            }
            interleaved[f] = sum * inv;
        }
    } else {
        // Mismatched multichannel: copy the overlapping channels, rest silent.
        let common = src_channels.min(out_channels);
        for f in 0..num_frames {
            let base = f * out_channels;
            for ch in 0..common {
                interleaved[base + ch] = planar[ch][f];
            }
        }
    }
    interleaved
}

fn decode_entire_file_symphonia(
    path: &str,
    target_sample_rate: u32,
    output_channels: usize,
) -> Result<Vec<f32>> {
    use symphonia::core::codecs::DecoderOptions;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let file = std::fs::File::open(path)
        .with_context(|| format!("failed to open audio file: {}", path))?;
    let mss = symphonia::core::io::MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = Path::new(path).extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .context("failed to probe media format")?;

    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL)
        .ok_or_else(|| anyhow!("no active audio track found"))?;

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .context("failed to create decoder")?;

    let track_id = track.id;
    let source_rate = track.codec_params.sample_rate.unwrap_or(target_sample_rate);
    let declared_channels = track.codec_params.channels.map(|c| c.count()).unwrap_or(0);
    let mut channels = declared_channels.max(1);
    let mut planar_buffers = vec![Vec::new(); channels];
    let mut collected_frames = 0usize;

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(symphonia::core::errors::Error::IoError(ref err))
                if err.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(err) => return Err(err).context("failed to read next packet"),
        };

        if packet.track_id() != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(audio_buf) => {
                let spec = *audio_buf.spec();
                let duration = audio_buf.capacity() as u64;
                let mut sample_buf =
                    symphonia::core::audio::SampleBuffer::<f32>::new(duration, spec);
                sample_buf.copy_interleaved_ref(audio_buf);

                let samples = sample_buf.samples();
                let num_channels = spec.channels.count();
                let num_frames = samples.len() / num_channels;
                if num_channels > channels {
                    for _ in channels..num_channels {
                        planar_buffers.push(vec![0.0; collected_frames]);
                    }
                    channels = num_channels;
                }

                for frame in 0..num_frames {
                    for ch in 0..channels {
                        let sample = if ch < num_channels {
                            samples[frame * num_channels + ch]
                        } else {
                            0.0
                        };
                        planar_buffers[ch].push(sample);
                    }
                    collected_frames += 1;
                }
            }
            Err(symphonia::core::errors::Error::IoError(ref err))
                if err.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(symphonia::core::errors::Error::DecodeError(err)) => {
                log::warn!("[audio] symphonia decode error: {:?}", err);
                continue;
            }
            Err(err) => return Err(err).context("failed to decode packet"),
        }
    }

    let resampled = resample_planar_with_speed(
        planar_buffers,
        source_rate,
        target_sample_rate,
        1.0,
        channels,
    )?;
    let interleaved = planar_to_interleaved(&resampled, output_channels);
    Ok(interleaved)
}

#[allow(clippy::too_many_arguments)]
fn decode_symphonia_chunk(
    path: &str,
    source_start_sec: f64,
    timeline_duration_sec: f64,
    speed: f64,
    target_sample_rate: u32,
    output_channels: usize,
    shared: &Arc<(Mutex<AudioShared>, Condvar)>,
) -> Result<Vec<f32>> {
    let mut decoder_state = {
        let mut state = shared.0.lock();
        state.decoders.remove(path)
    };

    if decoder_state.is_none() {
        use symphonia::core::codecs::DecoderOptions;
        use symphonia::core::formats::FormatOptions;
        use symphonia::core::meta::MetadataOptions;
        use symphonia::core::probe::Hint;

        let file = std::fs::File::open(path)
            .with_context(|| format!("failed to open audio file for chunk: {}", path))?;
        let mss = symphonia::core::io::MediaSourceStream::new(Box::new(file), Default::default());

        let mut hint = Hint::new();
        if let Some(ext) = Path::new(path).extension().and_then(|e| e.to_str()) {
            hint.with_extension(ext);
        }

        let probed = symphonia::default::get_probe()
            .format(
                &hint,
                mss,
                &FormatOptions::default(),
                &MetadataOptions::default(),
            )
            .context("failed to probe media format")?;

        let format = probed.format;
        let track = format
            .tracks()
            .iter()
            .find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL)
            .ok_or_else(|| anyhow!("no active audio track found"))?;

        let decoder = symphonia::default::get_codecs()
            .make(&track.codec_params, &DecoderOptions::default())
            .context("failed to create decoder")?;

        let track_id = track.id;
        let source_rate = track.codec_params.sample_rate.unwrap_or(target_sample_rate);
        let channels = track
            .codec_params
            .channels
            .map(|c| c.count())
            .unwrap_or(1)
            .max(1);
        let time_base = track
            .codec_params
            .time_base
            .unwrap_or(symphonia::core::units::TimeBase::new(1, source_rate));

        decoder_state = Some(CachedAudioDecoder {
            format,
            decoder,
            track_id,
            source_rate,
            channels,
            time_base,
            resampler: None,
            last_resample_ratio: 0.0,
            last_decode_end_sec: 0.0,
            resample_remainder: vec![Vec::new(); channels],
        });
    }

    let mut state_val = decoder_state.unwrap();

    // Only seek/reset when the requested position is not contiguous with
    // where the decoder left off. Sequential chunk decodes (the common case
    // in the producer loop) skip the expensive seek+reset.
    let source_end_sec = source_start_sec + timeline_duration_sec;
    let needs_seek = source_start_sec < state_val.last_decode_end_sec - 0.05
        || source_start_sec > state_val.last_decode_end_sec + 0.05;
    let current_ratio = target_sample_rate as f64 / (state_val.source_rate as f64 * speed);

    let (_actual_sec, discard_frames_remaining) = if needs_seek {
        let seeked_to = state_val
            .format
            .seek(
                symphonia::core::formats::SeekMode::Accurate,
                symphonia::core::formats::SeekTo::Time {
                    time: symphonia::core::units::Time {
                        seconds: source_start_sec.floor() as u64,
                        frac: source_start_sec.fract(),
                    },
                    track_id: Some(state_val.track_id),
                },
            )
            .context("failed to seek in format reader")?;

        state_val.decoder.reset();
        // Seeking discontinues the source stream, so the cached resampler and
        // its carried-over input remainder must be discarded to avoid splicing
        // unrelated audio across the seek boundary.
        state_val.resampler = None;
        state_val.resample_remainder = vec![Vec::new(); state_val.channels];
        state_val.last_resample_ratio = current_ratio;

        let actual_sec = {
            let t = state_val.time_base.calc_time(seeked_to.actual_ts);
            t.seconds as f64 + t.frac
        };
        // If seek landed before requested time, discard leading frames.
        // If seek landed after, we cannot recover without another seek,
        // so treat the gap as silence by shifting decode start forward.
        let (decode_start_sec, discard_frames) = if actual_sec <= source_start_sec {
            let discard_sec = source_start_sec - actual_sec;
            // Floor instead of round to avoid discarding one frame too many,
            // which would create a sub-millisecond silent gap after the seek.
            let discard_frames = (discard_sec * state_val.source_rate as f64).floor() as usize;
            (actual_sec, discard_frames)
        } else {
            // Seek landed past desired position → start decode from actual position,
            // the gap will become silence in the mixed output.
            (actual_sec, 0usize)
        };
        (decode_start_sec, discard_frames)
    } else {
        (source_start_sec, 0usize)
    };
    let mut discard_frames_remaining = discard_frames_remaining;
    let source_frames_needed =
        (timeline_duration_sec * speed * state_val.source_rate as f64).round() as usize;

    let mut planar_buffers = vec![Vec::new(); state_val.channels];
    let mut collected_frames = 0;
    let mut break_loop = false;

    loop {
        if break_loop {
            break;
        }

        let packet = match state_val.format.next_packet() {
            Ok(packet) => packet,
            Err(symphonia::core::errors::Error::IoError(ref err))
                if err.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(err) => return Err(err).context("failed to read next packet"),
        };

        if packet.track_id() != state_val.track_id {
            continue;
        }

        match state_val.decoder.decode(&packet) {
            Ok(audio_buf) => {
                let spec = *audio_buf.spec();
                let duration = audio_buf.capacity() as u64;
                let mut sample_buf =
                    symphonia::core::audio::SampleBuffer::<f32>::new(duration, spec);
                sample_buf.copy_interleaved_ref(audio_buf);

                let samples = sample_buf.samples();
                let num_channels = spec.channels.count();
                let num_frames = samples.len() / num_channels;
                if num_channels > state_val.channels {
                    for _ in state_val.channels..num_channels {
                        planar_buffers.push(vec![0.0; collected_frames]);
                    }
                    state_val.channels = num_channels;
                    state_val.resampler = None;
                    state_val.resample_remainder = vec![Vec::new(); state_val.channels];
                    state_val.last_resample_ratio = current_ratio;
                }

                for frame in 0..num_frames {
                    if discard_frames_remaining > 0 {
                        discard_frames_remaining -= 1;
                        continue;
                    }
                    if collected_frames >= source_frames_needed {
                        break_loop = true;
                        break;
                    }
                    for ch in 0..state_val.channels {
                        let sample = if ch < num_channels {
                            samples[frame * num_channels + ch]
                        } else {
                            0.0
                        };
                        planar_buffers[ch].push(sample);
                    }
                    collected_frames += 1;
                }
            }
            Err(symphonia::core::errors::Error::IoError(ref err))
                if err.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(symphonia::core::errors::Error::DecodeError(err)) => {
                log::warn!("[audio] symphonia chunk decode error: {:?}", err);
                continue;
            }
            Err(err) => return Err(err).context("failed to decode packet"),
        }
    }

    if collected_frames == 0 {
        let silence_len =
            (timeline_duration_sec * target_sample_rate as f64).round() as usize * output_channels;
        // Put the state back even on empty decode
        {
            let mut state = shared.0.lock();
            state.decoders.insert(path.to_string(), state_val);
        }
        return Ok(vec![0.0f32; silence_len]);
    }

    if state_val.resampler.is_some() && (state_val.last_resample_ratio - current_ratio).abs() > 1e-6
    {
        // Ratio changed (e.g. speed change): rebuild the resampler and drop the
        // stale input remainder captured at the previous ratio.
        state_val.resampler = None;
        state_val.resample_remainder = vec![Vec::new(); state_val.channels];
        state_val.last_resample_ratio = current_ratio;
    }
    let resampled = resample_planar_cached(
        planar_buffers,
        state_val.source_rate,
        target_sample_rate,
        speed,
        state_val.channels,
        &mut state_val.resampler,
        &mut state_val.resample_remainder,
    )?;
    let interleaved = planar_to_interleaved(&resampled, output_channels);

    // Record where this decode left off so the next chunk can skip the seek.
    state_val.last_decode_end_sec = source_end_sec;

    // Put it back in the cache:
    {
        let mut state = shared.0.lock();
        state.decoders.insert(path.to_string(), state_val);
    }
    Ok(interleaved)
}

#[allow(clippy::too_many_arguments)]
fn decode_audio_chunk(
    path: &str,
    source_start_sec: f64,
    timeline_duration_sec: f64,
    speed: f64,
    sample_rate: u32,
    output_channels: usize,
    shared: &Arc<(Mutex<AudioShared>, Condvar)>,
) -> Result<Vec<f32>> {
    let is_cacheable = (speed - 1.0).abs() <= f64::EPSILON;
    let file_size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);

    if is_cacheable && file_size > 0 && file_size < 50 * 1024 * 1024 {
        let cache_key = decoded_cache_key(path, sample_rate, output_channels);
        let cached_samples = {
            let mut state = shared.0.lock();
            state.decoded_cache.get(&cache_key).cloned()
        };

        let cached_samples = match cached_samples {
            Some(samples) => samples,
            None => {
                log::info!("[audio] caching entire file in memory: {}", path);
                let decoded = decode_entire_file_symphonia(path, sample_rate, output_channels)?;
                let shared_samples = Arc::new(decoded);
                let mut state = shared.0.lock();
                state.decoded_cache.put(cache_key, shared_samples.clone());
                shared_samples
            }
        };

        let start_frame = (source_start_sec * sample_rate as f64).round() as usize;
        let frames_to_read = (timeline_duration_sec * sample_rate as f64).round() as usize;
        let start_sample = start_frame * output_channels;
        let samples_to_read = frames_to_read * output_channels;

        let mut result = vec![0.0f32; samples_to_read];
        let cached_len = cached_samples.len();

        if start_sample < cached_len {
            let available = (cached_len - start_sample).min(samples_to_read);
            result[..available]
                .copy_from_slice(&cached_samples[start_sample..start_sample + available]);
        }
        return Ok(result);
    }

    decode_symphonia_chunk(
        path,
        source_start_sec,
        timeline_duration_sec,
        speed,
        sample_rate,
        output_channels,
        shared,
    )
}

/// Applies the per-layer gain envelope and stereo balance, then accumulates the
/// `decoded` interleaved samples into `mixed`. Balance only affects the front
/// L/R pair; extra channels are passed through with gain. Mono output ignores
/// balance entirely.
#[allow(clippy::too_many_arguments)]
fn apply_layer_mix(
    mixed: &mut [f32],
    decoded: &[f32],
    write_start_frame: usize,
    frames_to_write: usize,
    sample_rate: u32,
    layer: &SceneAudioLayer,
    segment_start_sec: f64,
    channels: usize,
) {
    if channels == 0 {
        return;
    }
    let stereo = channels >= 2;
    let (ll, lr, rl, rr) = if stereo {
        let (ll, lr, rl, rr) = stereo_pan_matrix(layer.audio_balance);
        (ll as f32, lr as f32, rl as f32, rr as f32)
    } else {
        (1.0, 0.0, 0.0, 1.0)
    };
    for i in 0..frames_to_write {
        let timeline_sec = segment_start_sec + i as f64 / sample_rate as f64;
        let clip_sec = (timeline_sec - layer.timeline_start_sec).max(0.0);
        let gain = gain_at_clip_time(layer, clip_sec) as f32;
        if gain == 0.0 {
            continue;
        }
        let src = i * channels;
        let dst = (write_start_frame + i) * channels;
        if stereo {
            let left = decoded[src] * gain;
            let right = decoded[src + 1] * gain;
            mixed[dst] += ll * left + lr * right;
            mixed[dst + 1] += rl * left + rr * right;
            for ch in 2..channels {
                mixed[dst + ch] += decoded[src + ch] * gain;
            }
        } else {
            mixed[dst] += decoded[src] * gain;
        }
    }
}

fn gain_at_clip_time(layer: &SceneAudioLayer, clip_sec: f64) -> f64 {
    let mut gain = layer.audio_gain.max(0.0);
    let duration = (layer.timeline_end_sec - layer.timeline_start_sec).max(0.0);
    if duration <= 0.0 {
        return 0.0;
    }
    let fade_in = layer.audio_fade_in_sec.max(0.0).min(duration);
    let fade_out = layer.audio_fade_out_sec.max(0.0).min(duration);
    if fade_in > 0.0 && clip_sec < fade_in {
        gain *= fade_curve(clip_sec / fade_in, layer.audio_fade_in_curve);
    }
    if fade_out > 0.0 {
        let fade_out_start = (duration - fade_out).max(0.0);
        if clip_sec >= fade_out_start {
            gain *= fade_curve((duration - clip_sec) / fade_out, layer.audio_fade_out_curve);
        }
    }
    gain
}

fn fade_curve(t: f64, curve: AudioFadeCurve) -> f64 {
    let x = t.clamp(0.0, 1.0);
    match curve {
        AudioFadeCurve::Linear => x,
        AudioFadeCurve::Logarithmic => (x * std::f64::consts::FRAC_PI_2).sin().max(0.0),
    }
}

fn stereo_pan_matrix(balance: f64) -> (f64, f64, f64, f64) {
    let pan = balance.clamp(-1.0, 1.0);
    // Equal-power stereo balance: attenuate the opposite channel with a cosine taper.
    if pan <= 0.0 {
        let right_gain = ((-pan) * std::f64::consts::FRAC_PI_2).cos();
        (1.0, 0.0, 0.0, right_gain)
    } else {
        let left_gain = (pan * std::f64::consts::FRAC_PI_2).cos();
        (left_gain, 0.0, 0.0, 1.0)
    }
}

fn sanitize_speed(speed: f64) -> f64 {
    if speed.is_finite() && speed > 0.0 {
        speed.clamp(0.01, 100.0)
    } else {
        1.0
    }
}

fn sanitize_master_gain(gain: f64) -> f64 {
    if gain.is_finite() {
        gain.max(0.0)
    } else {
        1.0
    }
}

/// Smooth soft-knee limiter. Below the knee the signal is untouched; above it,
/// magnitudes are mapped asymptotically toward (but never exceeding) 1.0 with a
/// tanh curve, so loud mixes are gracefully compressed instead of hard-clipped.
/// Non-finite inputs are flushed to silence to keep the output bounded.
fn soft_clip(samples: &mut [f32]) {
    const KNEE: f32 = 0.8;
    for sample in samples {
        let s = *sample;
        if !s.is_finite() {
            *sample = 0.0;
            continue;
        }
        let mag = s.abs();
        if mag <= KNEE {
            continue;
        }
        let over = (mag - KNEE) / (1.0 - KNEE);
        let limited = KNEE + (1.0 - KNEE) * over.tanh();
        *sample = limited.copysign(s);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cpal::{OutputStreamTimestamp, StreamInstant};

    fn layer() -> SceneAudioLayer {
        SceneAudioLayer {
            id: "a1".into(),
            track_id: Some("track-a".into()),
            path: "/tmp/a.wav".into(),
            timeline_start_sec: 0.0,
            timeline_end_sec: 10.0,
            source_start_sec: 0.0,
            speed: 1.0,
            audio_gain: 1.0,
            audio_balance: 0.0,
            audio_fade_in_sec: 2.0,
            audio_fade_out_sec: 2.0,
            audio_fade_in_curve: AudioFadeCurve::Linear,
            audio_fade_out_curve: AudioFadeCurve::Linear,
        }
    }

    fn track(id: &str) -> SceneAudioTrack {
        SceneAudioTrack {
            id: id.into(),
            audio_gain: 1.0,
            audio_balance: 0.0,
            audio_muted: false,
            audio_solo: false,
        }
    }

    fn callback_info(latency_sec: f64) -> OutputCallbackInfo {
        let callback = StreamInstant::new(10, 0);
        let playback = callback
            .add(Duration::from_secs_f64(latency_sec))
            .unwrap_or(callback);
        OutputCallbackInfo::new(OutputStreamTimestamp { callback, playback })
    }

    // ------------------------------------------------------------------
    // SPSC Ring Buffer
    // ------------------------------------------------------------------

    #[test]
    fn ring_buffer_push_pop_round_trip() {
        let ring = SpscRingBuffer::new(16);
        let in_samples = vec![0.25, -0.5, 0.75, -0.25];
        assert_eq!(ring.push_slice(&in_samples), 4);
        let mut out = [0.0f32; 4];
        assert_eq!(ring.pop_slice(&mut out), 4);
        assert_eq!(out, [0.25, -0.5, 0.75, -0.25]);
    }

    #[test]
    fn ring_buffer_drops_excess_push() {
        let ring = SpscRingBuffer::new(4);
        let in_samples = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        assert_eq!(ring.push_slice(&in_samples), 4);
        let mut out = [0.0f32; 5];
        assert_eq!(ring.pop_slice(&mut out), 4);
        assert_eq!(out, [1.0, 2.0, 3.0, 4.0, 0.0]);
    }

    #[test]
    fn ring_buffer_clear_empties() {
        let ring = SpscRingBuffer::new(8);
        ring.push_slice(&[1.0, 2.0, 3.0]);
        ring.clear();
        assert_eq!(ring.len(), 0);
        let mut out = [0.0f32; 3];
        assert_eq!(ring.pop_slice(&mut out), 0);
    }

    #[test]
    fn ring_buffer_wraparound() {
        let ring = SpscRingBuffer::new(4);
        ring.push_slice(&[1.0, 2.0]);
        let mut out = [0.0f32; 2];
        ring.pop_slice(&mut out);
        ring.push_slice(&[3.0, 4.0, 5.0]);
        let mut out2 = [0.0f32; 4];
        assert_eq!(ring.pop_slice(&mut out2), 3);
        assert_eq!(out2[..3], [3.0, 4.0, 5.0]);
    }

    // ------------------------------------------------------------------
    // Gain / Fade
    // ------------------------------------------------------------------

    #[test]
    fn gain_envelope_applies_linear_fades() {
        let l = layer();
        assert_eq!(gain_at_clip_time(&l, 0.0), 0.0);
        assert!((gain_at_clip_time(&l, 1.0) - 0.5).abs() < 1e-9);
        assert!((gain_at_clip_time(&l, 5.0) - 1.0).abs() < 1e-9);
        assert!((gain_at_clip_time(&l, 9.0) - 0.5).abs() < 1e-9);
    }

    #[test]
    fn logarithmic_fade_reaches_unity() {
        assert_eq!(fade_curve(0.0, AudioFadeCurve::Logarithmic), 0.0);
        assert!((fade_curve(1.0, AudioFadeCurve::Logarithmic) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn gain_clips_negative_and_excess_fade() {
        let mut l = layer();
        l.audio_fade_in_sec = 12.0; // longer than duration
        l.audio_fade_out_sec = 12.0;
        // Both fades clamped to duration 10s, so at t=5 both are active:
        // fade_in = 5/10 = 0.5, fade_out = (10-5)/10 = 0.5, total = 0.25
        assert!((gain_at_clip_time(&l, 5.0) - 0.25).abs() < 1e-9);
    }

    // ------------------------------------------------------------------
    // Stereo Pan / Balance
    // ------------------------------------------------------------------

    #[test]
    fn stereo_balance_center_unity() {
        let (ll, lr, rl, rr) = stereo_pan_matrix(0.0);
        assert!((ll - 1.0).abs() < 1e-9);
        assert_eq!(lr, 0.0);
        assert_eq!(rl, 0.0);
        assert!((rr - 1.0).abs() < 1e-9);
    }

    #[test]
    fn stereo_balance_full_left() {
        let (ll, lr, rl, rr) = stereo_pan_matrix(-1.0);
        assert!((ll - 1.0).abs() < 1e-9);
        assert_eq!(lr, 0.0);
        assert_eq!(rl, 0.0);
        assert!((rr - 0.0).abs() < 1e-9);
    }

    #[test]
    fn stereo_balance_full_right() {
        let (ll, lr, rl, rr) = stereo_pan_matrix(1.0);
        assert!((ll - 0.0).abs() < 1e-9);
        assert_eq!(lr, 0.0);
        assert_eq!(rl, 0.0);
        assert!((rr - 1.0).abs() < 1e-9);
    }

    #[test]
    fn stereo_balance_half_left_attenuates_right() {
        let (_, _, _, rr) = stereo_pan_matrix(-0.5);
        let expected = (0.5 * std::f64::consts::FRAC_PI_2).cos();
        assert!((rr - expected).abs() < 1e-9);
    }

    #[test]
    fn stereo_balance_no_boost() {
        // Center must not exceed unity for any channel.
        let (ll, _lr, _rl, rr) = stereo_pan_matrix(0.0);
        assert!(ll <= 1.0 + 1e-9);
        assert!(rr <= 1.0 + 1e-9);
    }

    // ------------------------------------------------------------------
    // Conversions
    // ------------------------------------------------------------------

    #[test]
    fn planar_to_interleaved_duplicates_mono_to_front_pair() {
        let planar = vec![vec![1.0, 2.0, 3.0]];
        let interleaved = planar_to_interleaved(&planar, 6);
        assert_eq!(
            interleaved,
            vec![
                1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 2.0, 2.0, 0.0, 0.0, 0.0, 0.0, 3.0, 3.0, 0.0, 0.0,
                0.0, 0.0,
            ]
        );
    }

    #[test]
    fn planar_to_interleaved_copies_stereo() {
        let planar = vec![vec![1.0, 2.0], vec![3.0, 4.0]];
        let interleaved = planar_to_interleaved(&planar, 2);
        assert_eq!(interleaved, vec![1.0, 3.0, 2.0, 4.0]);
    }

    #[test]
    fn planar_to_interleaved_downmixes_to_mono() {
        let planar = vec![vec![1.0, 3.0], vec![3.0, 5.0], vec![5.0, 7.0]];
        let interleaved = planar_to_interleaved(&planar, 1);
        assert_eq!(interleaved, vec![3.0, 5.0]);
    }

    #[test]
    fn planar_to_interleaved_handles_uneven_channels_without_panic() {
        let planar = vec![vec![1.0, 2.0], vec![3.0]];
        let interleaved = planar_to_interleaved(&planar, 2);
        assert_eq!(interleaved, vec![1.0, 3.0]);
    }

    // ------------------------------------------------------------------
    // Resampler
    // ------------------------------------------------------------------

    #[test]
    fn test_resample_planar_no_op() {
        let planar = vec![vec![0.5; 100], vec![-0.5; 100]];
        let resampled = resample_planar_with_speed(planar.clone(), 44100, 44100, 1.0, 2).unwrap();
        assert_eq!(resampled, planar);
    }

    #[test]
    fn test_resample_planar_cached_reuses_instance() {
        let mut cached = None;
        let mut remainder = Vec::new();
        let planar = vec![vec![0.5; 100], vec![-0.5; 100]];
        let _ = resample_planar_cached(
            planar.clone(),
            44100,
            48000,
            1.0,
            2,
            &mut cached,
            &mut remainder,
        )
        .unwrap();
        assert!(cached.is_some());
        // Calling again with the same ratio reuses the cached resampler.
        let _ = resample_planar_cached(
            planar.clone(),
            44100,
            48000,
            1.0,
            2,
            &mut cached,
            &mut remainder,
        )
        .unwrap();
        assert!(cached.is_some());
    }

    #[test]
    fn test_resample_planar_cached_keeps_partial_input_as_remainder() {
        let mut cached = None;
        let mut remainder = Vec::new();
        let planar = vec![vec![0.5; 100], vec![-0.5; 100]];
        let out = resample_planar_cached(planar, 44100, 48000, 1.0, 2, &mut cached, &mut remainder)
            .unwrap();
        assert!(out.iter().all(Vec::is_empty));
        assert_eq!(remainder.len(), 2);
        assert_eq!(remainder[0].len(), 100);
        assert_eq!(remainder[1].len(), 100);
    }

    // ------------------------------------------------------------------
    // Master Gain / Soft Clip
    // ------------------------------------------------------------------

    #[test]
    fn master_gain_is_applied_after_layer_mix() {
        let mut samples = vec![0.25, -0.5, 1.0];
        apply_master_gain(&mut samples, 0.5);
        assert_eq!(samples, vec![0.125, -0.25, 0.5]);
    }

    #[test]
    fn soft_clip_preserves_in_band() {
        let mut samples = vec![-0.5, 0.0, 0.5, 0.8, -0.8];
        soft_clip(&mut samples);
        assert!((samples[0] - (-0.5)).abs() < 1e-6);
        assert!((samples[1] - 0.0).abs() < 1e-6);
        assert!((samples[2] - 0.5).abs() < 1e-6);
        assert!((samples[3] - 0.8).abs() < 1e-6);
        assert!((samples[4] - (-0.8)).abs() < 1e-6);
    }

    #[test]
    fn soft_clip_limits_out_of_band() {
        let mut samples = vec![2.0, -2.0];
        soft_clip(&mut samples);
        assert!(samples[0] > 0.8 && samples[0] < 1.0);
        assert!(samples[1] < -0.8 && samples[1] > -1.0);
    }

    #[test]
    fn soft_clip_flushes_non_finite_samples() {
        let mut samples = vec![f32::NAN, f32::INFINITY, f32::NEG_INFINITY];
        soft_clip(&mut samples);
        assert_eq!(samples, vec![0.0, 0.0, 0.0]);
    }

    #[test]
    fn sanitize_speed_rejects_non_positive() {
        assert_eq!(sanitize_speed(0.0), 1.0);
        assert_eq!(sanitize_speed(-1.0), 1.0);
        assert_eq!(sanitize_speed(f64::NAN), 1.0);
        assert_eq!(sanitize_speed(f64::INFINITY), 1.0);
        assert_eq!(sanitize_speed(0.005), 0.01);
        assert_eq!(sanitize_speed(101.0), 100.0);
    }

    // ------------------------------------------------------------------
    // Output Callback / Clock
    // ------------------------------------------------------------------

    #[test]
    fn output_clock_advances_on_underrun_to_prevent_drift() {
        let clock = RealtimeClock::default();
        clock.playing.store(true, Ordering::Release);
        let ring = SpscRingBuffer::new(256);
        let channels = 2;
        let mut data = vec![1.0f32; 128 * channels];

        write_output(
            &mut data,
            &callback_info(0.0),
            &clock,
            &ring,
            channels as u16,
        );

        assert!(data.iter().all(|sample| *sample == 0.0));
        // Even when the ring underruns we must advance the frame counter so
        // that audible_pts_sec does not fall behind real time.
        assert_eq!(clock.frames(), 128);
    }

    #[test]
    fn output_callback_copies_multichannel_ring_samples() {
        let clock = RealtimeClock::default();
        clock.playing.store(true, Ordering::Release);
        let ring = SpscRingBuffer::new(512);
        let channels = 6;
        let frames = 4;
        let samples: Vec<f32> = (0..frames * channels).map(|i| i as f32 / 100.0).collect();
        ring.push_slice(&samples);
        let mut data = vec![1.0f32; frames * channels];

        write_output(
            &mut data,
            &callback_info(0.0),
            &clock,
            &ring,
            channels as u16,
        );

        assert_eq!(data, samples);
        assert_eq!(clock.frames(), frames as u64);
    }

    #[test]
    fn output_callback_copies_mono_ring_samples() {
        let clock = RealtimeClock::default();
        clock.playing.store(true, Ordering::Release);
        let ring = SpscRingBuffer::new(16);
        ring.push_slice(&[0.25, -0.25, 0.5, -0.5]);
        let mut data = vec![0.0f32; 4];

        write_output(&mut data, &callback_info(0.0), &clock, &ring, 1);

        assert_eq!(data, vec![0.25, -0.25, 0.5, -0.5]);
        assert_eq!(clock.frames(), 4);
    }

    #[test]
    fn output_callback_outputs_silence_when_stopped_without_advancing_clock() {
        let clock = RealtimeClock::default();
        let ring = SpscRingBuffer::new(16);
        ring.push_slice(&[0.25, -0.25]);
        let mut data = vec![1.0f32; 2];

        write_output(&mut data, &callback_info(0.0), &clock, &ring, 1);

        assert_eq!(data, vec![0.0, 0.0]);
        assert_eq!(clock.frames(), 0);
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

    // ------------------------------------------------------------------
    // Decode (integration with fixtures)
    // ------------------------------------------------------------------

    #[test]
    fn test_decode_entire_file_symphonia() {
        let path = "../test/fixtures/media/sample-1s-audio.mp3";
        let decoded = decode_entire_file_symphonia(path, 48000, 2);
        assert!(
            decoded.is_ok(),
            "Failed to decode MP3 file: {:?}",
            decoded.err()
        );
        let samples = decoded.unwrap();
        assert!(samples.len() > 0, "Decoded sample buffer is empty");
    }

    #[test]
    fn test_decode_symphonia_chunk() {
        let path = "../test/fixtures/media/sample-1s-audio.mp3";
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        let decoded = decode_symphonia_chunk(path, 0.2, 0.5, 1.0, 48000, 2, &shared);
        assert!(
            decoded.is_ok(),
            "Failed to decode chunk: {:?}",
            decoded.err()
        );
        let samples = decoded.unwrap();
        assert!(samples.len() > 0, "Decoded chunk buffer is empty");
        assert!(
            samples.len() >= 45000 && samples.len() <= 55000,
            "Unexpected chunk length: {}",
            samples.len()
        );
    }

    // ------------------------------------------------------------------
    // Mix / Integration
    // ------------------------------------------------------------------

    #[test]
    fn mix_chunk_with_solo_mutes_others() {
        let mut l1 = layer();
        l1.id = "l1".into();
        l1.track_id = Some("t1".into());
        let mut l2 = layer();
        l2.id = "l2".into();
        l2.track_id = Some("t2".into());
        l2.timeline_start_sec = 0.0;
        l2.timeline_end_sec = 1.0;

        let mut t1 = track("t1");
        t1.audio_solo = true;
        let t2 = track("t2");

        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        // Because decode will fail on fake paths, we just test that orphan/muted logic runs
        // without panic and produces a buffer of the expected size.
        let chunk = mix_chunk(
            &[l1, l2],
            &[t1, t2],
            1.0,
            0.0,
            1.0,
            48000,
            2,
            &shared,
            false,
        );
        assert_eq!(chunk.len(), (1.0f64 * 48000.0).round() as usize * 2);
    }

    #[test]
    fn mix_chunk_clamps_prevent_inf() {
        // Build two layers on the same track with extreme gain
        let mut l = layer();
        l.audio_gain = 1000.0;
        let mut l2 = layer();
        l2.id = "l2".into();
        l2.audio_gain = 1000.0;

        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        let chunk = mix_chunk(&[l, l2], &[], 10.0, 0.0, 0.01, 48000, 2, &shared, false);
        // Must not contain inf or NaN
        assert!(
            chunk.iter().all(|s| s.is_finite()),
            "mix produced non-finite sample"
        );
    }

    #[test]
    fn apply_layer_mix_zero_gain_skips() {
        let mut mixed = vec![0.0f32; 4];
        let decoded = vec![1.0f32, 2.0f32, 3.0f32, 4.0f32];
        let mut l = layer();
        l.audio_gain = 0.0;
        apply_layer_mix(&mut mixed, &decoded, 0, 2, 48000, &l, 0.0, 2);
        assert_eq!(mixed, vec![0.0, 0.0, 0.0, 0.0]);
    }

    #[test]
    fn apply_layer_mix_allows_headroom_for_later_clamp() {
        let mut mixed = vec![0.0f32; 4];
        let decoded = vec![10.0f32, 10.0f32, 10.0f32, 10.0f32];
        let mut l = layer();
        l.audio_gain = 5.0;
        l.audio_fade_in_sec = 0.0;
        l.audio_fade_out_sec = 0.0;
        apply_layer_mix(&mut mixed, &decoded, 0, 2, 48000, &l, 0.0, 2);
        // Each channel: decoded(10) * gain(5) = 50.
        // With centre pan (1.0,0,0,1.0) mixed should accumulate to 50.0.
        assert!((mixed[0] - 50.0).abs() < 1e-5);
        assert!((mixed[1] - 50.0).abs() < 1e-5);
        assert!((mixed[2] - 50.0).abs() < 1e-5);
        assert!((mixed[3] - 50.0).abs() < 1e-5);
    }

    #[test]
    fn apply_layer_mix_passes_extra_channels_through() {
        let mut mixed = vec![0.0f32; 8];
        let decoded = vec![1.0f32, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0];
        let mut l = layer();
        l.audio_fade_in_sec = 0.0;
        l.audio_fade_out_sec = 0.0;

        apply_layer_mix(&mut mixed, &decoded, 0, 2, 48000, &l, 0.0, 4);

        assert_eq!(mixed, decoded);
    }

    #[test]
    fn apply_layer_mix_supports_mono_output() {
        let mut mixed = vec![0.0f32; 2];
        let decoded = vec![1.0f32, 2.0];
        let mut l = layer();
        l.audio_fade_in_sec = 0.0;
        l.audio_fade_out_sec = 0.0;

        apply_layer_mix(&mut mixed, &decoded, 0, 2, 48000, &l, 0.0, 1);

        assert_eq!(mixed, decoded);
    }

    #[test]
    fn resolve_track_requires_exact_or_underscore_suffix() {
        let tracks = vec![track("a"), track("abc")];
        assert_eq!(resolve_track_for_layer("abc", &tracks).unwrap().id, "abc");
        assert_eq!(resolve_track_for_layer("a_take", &tracks).unwrap().id, "a");
        assert!(resolve_track_for_layer("ab", &tracks).is_none());
    }

    #[test]
    fn chunk_write_range_uses_contiguous_absolute_frame_grid() {
        let sample_rate = 48_000;
        let chunk_frames = 2_400;
        let first = chunk_write_range(0.0, 0.0, 0.05, sample_rate, chunk_frames);
        let second = chunk_write_range(0.05, 0.05, 0.1, sample_rate, chunk_frames);

        assert_eq!(first, (0, 2_400));
        assert_eq!(second, (0, 2_400));
    }

    #[test]
    fn chunk_write_range_clips_layer_boundary_inside_chunk() {
        let sample_rate = 48_000;
        let chunk_frames = 2_400;
        let range = chunk_write_range(1.0, 1.01, 1.03, sample_rate, chunk_frames);

        assert_eq!(range, (480, 960));
    }

    // ------------------------------------------------------------------
    // WAV Export
    // ------------------------------------------------------------------

    #[test]
    fn render_scene_to_wav_produces_valid_header() {
        let tmp =
            std::env::temp_dir().join(format!("fastcat-audit-wav-test-{}.wav", std::process::id()));
        let l = layer();
        // Render a tiny silent scene
        render_scene_to_wav(&[l], &[], 1.0, 0.0, 0.01, 48000, 1, &tmp).unwrap();

        let bytes = std::fs::read(&tmp).unwrap();
        assert!(bytes.len() >= 44);
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        assert_eq!(&bytes[12..16], b"fmt ");
        assert_eq!(u16::from_le_bytes(bytes[22..24].try_into().unwrap()), 1);

        // riff_size = 36 + data_size
        let data_size = u32::from_le_bytes(bytes[40..44].try_into().unwrap()) as u64;
        let riff_size = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as u64;
        assert_eq!(riff_size, 36 + data_size);

        let _ = std::fs::remove_file(&tmp);
    }
}
