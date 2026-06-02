use std::collections::{HashMap, VecDeque};
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{OutputCallbackInfo, SampleFormat, Stream, StreamConfig};
use parking_lot::Mutex;

use crate::monitor::scene::{AudioFadeCurve, SceneAudioLayer, SceneAudioTrack};

const OUTPUT_CHANNELS: usize = 2;
const CHUNK_DURATION_SEC: f64 = 1.0;
const PREBUFFER_CHUNKS: usize = 3;

struct CachedAudioDecoder {
    format: Box<dyn symphonia::core::formats::FormatReader>,
    decoder: Box<dyn symphonia::core::codecs::Decoder>,
    track_id: u32,
    source_rate: u32,
    channels: usize,
    time_base: symphonia::core::units::TimeBase,
}

struct AudioShared {
    scene: Vec<SceneAudioLayer>,
    tracks: Vec<SceneAudioTrack>,
    master_gain: f64,
    ring: VecDeque<f32>,
    playing: bool,
    origin_pts_sec: f64,
    frames_written: u64,
    output_latency_sec: f64,
    last_output_buffer_frames: usize,
    producer_pts_sec: f64,
    seek_serial: u64,
    scene_serial: u64,
    decoded_cache: HashMap<String, Arc<Vec<f32>>>,
    decoders: HashMap<String, CachedAudioDecoder>,
}

impl Default for AudioShared {
    fn default() -> Self {
        Self {
            scene: Vec::new(),
            tracks: Vec::new(),
            master_gain: 1.0,
            ring: VecDeque::new(),
            playing: false,
            origin_pts_sec: 0.0,
            frames_written: 0,
            output_latency_sec: 0.0,
            last_output_buffer_frames: 0,
            producer_pts_sec: 0.0,
            seek_serial: 0,
            scene_serial: 0,
            decoded_cache: HashMap::new(),
            decoders: HashMap::new(),
        }
    }
}

pub struct NativeAudioEngine {
    shared: Arc<Mutex<AudioShared>>,
    running: Arc<AtomicBool>,
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
        let shared = Arc::new(Mutex::new(AudioShared::default()));
        let running = Arc::new(AtomicBool::new(true));
        let stream = build_stream(
            &device,
            &config,
            supported.sample_format(),
            shared.clone(),
            sample_rate,
            device_channels,
        )?;
        stream.play().context("audio stream play failed")?;

        let producer_shared = shared.clone();
        let producer_running = running.clone();
        let producer = std::thread::Builder::new()
            .name("fastcat-audio-producer".into())
            .spawn(move || producer_loop(producer_shared, producer_running, sample_rate))?;

        Ok(Self {
            shared,
            running,
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
        let mut state = self.shared.lock();
        state.scene = layers;
        state.tracks = tracks;
        state.master_gain = sanitize_master_gain(master_gain);
        state.ring.clear();
        state.producer_pts_sec =
            state.origin_pts_sec + state.frames_written as f64 / self.sample_rate as f64;
        state.scene_serial = state.scene_serial.wrapping_add(1);

        // GC кэша: удаляем файлы, которых больше нет в сцене
        let current_paths: std::collections::HashSet<String> =
            state.scene.iter().map(|l| l.path.clone()).collect();
        state
            .decoded_cache
            .retain(|path, _| current_paths.contains(path));
        state
            .decoders
            .retain(|path, _| current_paths.contains(path));
    }

    pub fn play(&self, pts_sec: f64) {
        let mut state = self.shared.lock();
        state.playing = true;
        state.origin_pts_sec = pts_sec.max(0.0);
        state.frames_written = 0;
        state.producer_pts_sec = state.origin_pts_sec;
        state.ring.clear();
        state.seek_serial = state.seek_serial.wrapping_add(1);
    }

    pub fn pause(&self) -> f64 {
        let mut state = self.shared.lock();
        let pts = audible_pts_sec(&state, self.sample_rate);
        state.playing = false;
        state.origin_pts_sec = pts;
        state.frames_written = 0;
        state.last_output_buffer_frames = 0;
        state.ring.clear();
        state.producer_pts_sec = pts;
        pts
    }

    pub fn seek(&self, pts_sec: f64, playing: bool) {
        let mut state = self.shared.lock();
        let pts = pts_sec.max(0.0);
        state.origin_pts_sec = pts;
        state.frames_written = 0;
        state.producer_pts_sec = pts;
        state.ring.clear();
        state.playing = playing;
        state.seek_serial = state.seek_serial.wrapping_add(1);
    }

    pub fn current_pts(&self) -> Option<f64> {
        let state = self.shared.lock();
        if !state.playing {
            return None;
        }
        Some(audible_pts_sec(&state, self.sample_rate))
    }

    pub fn is_empty(&self) -> bool {
        self.shared.lock().scene.is_empty()
    }

    pub fn scene_end(&self) -> f64 {
        self.shared
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
        self.running.store(false, Ordering::Relaxed);
        if self.producer.take().is_some() {
            log::debug!("[audio] producer stop requested");
        }
    }
}

fn build_stream(
    device: &cpal::Device,
    config: &StreamConfig,
    format: SampleFormat,
    shared: Arc<Mutex<AudioShared>>,
    sample_rate: u32,
    device_channels: u16,
) -> Result<Stream> {
    let err_fn = |err| log::error!("[audio] output stream error: {err}");
    match format {
        SampleFormat::F32 => device
            .build_output_stream(
                config,
                move |data: &mut [f32], info| {
                    write_output(data, info, &shared, sample_rate, device_channels)
                },
                err_fn,
                None,
            )
            .context("build f32 output stream failed"),
        SampleFormat::I16 => device
            .build_output_stream(
                config,
                move |data: &mut [i16], info| {
                    write_output(data, info, &shared, sample_rate, device_channels)
                },
                err_fn,
                None,
            )
            .context("build i16 output stream failed"),
        SampleFormat::U16 => device
            .build_output_stream(
                config,
                move |data: &mut [u16], info| {
                    write_output(data, info, &shared, sample_rate, device_channels)
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
    shared: &Arc<Mutex<AudioShared>>,
    sample_rate: u32,
    device_channels: u16,
) {
    let channels = device_channels.max(1) as usize;
    let frames = data.len() / channels;
    let mut state = match shared.try_lock() {
        Some(state) => state,
        None => {
            for sample in data {
                *sample = T::from_f32(0.0);
            }
            return;
        }
    };

    let mut actual_played_frames = 0usize;

    for frame in 0..frames {
        let (left, right) = if state.playing {
            if state.ring.len() >= 2 {
                let left = state.ring.pop_front().unwrap_or(0.0);
                let right = state.ring.pop_front().unwrap_or(0.0);
                actual_played_frames += 1;
                (left, right)
            } else {
                (0.0, 0.0)
            }
        } else {
            (0.0, 0.0)
        };
        for ch in 0..channels {
            let value = match ch {
                0 if channels == 1 => (left + right) * 0.5,
                0 => left,
                1 => right,
                _ => 0.0,
            };
            data[frame * channels + ch] = T::from_f32(value);
        }
    }

    if state.playing {
        state.frames_written = state
            .frames_written
            .saturating_add(actual_played_frames as u64);
        state.last_output_buffer_frames = frames;
        state.output_latency_sec = output_latency_sec(info);
    } else {
        let _ = sample_rate;
        state.last_output_buffer_frames = 0;
    }
}

fn audible_pts_sec(state: &AudioShared, sample_rate: u32) -> f64 {
    let latency_frames = (state.output_latency_sec.max(0.0) * sample_rate as f64).round() as u64;
    let buffer_frames = state.last_output_buffer_frames as u64;
    let audible_frames = state
        .frames_written
        .saturating_sub(latency_frames.saturating_add(buffer_frames));
    state.origin_pts_sec + audible_frames as f64 / sample_rate as f64
}

fn output_latency_sec(info: &OutputCallbackInfo) -> f64 {
    info.timestamp()
        .playback
        .duration_since(&info.timestamp().callback)
        .map(|duration| duration.as_secs_f64().clamp(0.0, 0.5))
        .unwrap_or(0.0)
}

fn producer_loop(shared: Arc<Mutex<AudioShared>>, running: Arc<AtomicBool>, sample_rate: u32) {
    let chunk_frames = (CHUNK_DURATION_SEC * sample_rate as f64).round().max(1.0) as usize;
    let limit_samples = chunk_frames * OUTPUT_CHANNELS * PREBUFFER_CHUNKS;

    while running.load(Ordering::Relaxed) {
        let snapshot = {
            let state = shared.lock();
            if !state.playing || state.scene.is_empty() || state.ring.len() >= limit_samples {
                None
            } else {
                Some((
                    state.scene.clone(),
                    state.tracks.clone(),
                    state.master_gain,
                    state.producer_pts_sec,
                    state.seek_serial,
                    state.scene_serial,
                ))
            }
        };

        let Some((scene, tracks, master_gain, chunk_start, seek_serial, scene_serial)) = snapshot
        else {
            std::thread::sleep(Duration::from_millis(8));
            continue;
        };

        let chunk = mix_chunk(
            &scene,
            &tracks,
            master_gain,
            chunk_start,
            CHUNK_DURATION_SEC,
            sample_rate,
            &shared,
        );

        let mut state = shared.lock();
        if state.seek_serial != seek_serial || state.scene_serial != scene_serial || !state.playing
        {
            continue;
        }
        if state.ring.len() < limit_samples {
            state.ring.extend(chunk);
            state.producer_pts_sec += CHUNK_DURATION_SEC;
        }
    }
}

pub(crate) fn render_scene_to_wav(
    scene: &[SceneAudioLayer],
    tracks: &[SceneAudioTrack],
    master_gain: f64,
    start_sec: f64,
    end_sec: f64,
    sample_rate: u32,
    target_path: &Path,
) -> Result<()> {
    let start = start_sec.max(0.0);
    let end = end_sec.max(start);
    let frames = ((end - start) * sample_rate as f64).round().max(1.0) as u32;
    let mut file = std::fs::File::create(target_path)
        .with_context(|| format!("create audio wav {}", target_path.display()))?;
    write_wav_f32_header(&mut file, frames, sample_rate)?;

    let shared = Arc::new(Mutex::new(AudioShared::default()));

    let mut written = 0u32;
    while written < frames {
        let chunk_frames = ((CHUNK_DURATION_SEC * sample_rate as f64).round() as u32)
            .min(frames - written)
            .max(1);
        let chunk_duration = chunk_frames as f64 / sample_rate as f64;
        let chunk_start = start + written as f64 / sample_rate as f64;
        let chunk = mix_chunk(
            scene,
            tracks,
            master_gain,
            chunk_start,
            chunk_duration,
            sample_rate,
            &shared,
        );
        for sample in chunk
            .into_iter()
            .take(chunk_frames as usize * OUTPUT_CHANNELS)
        {
            file.write_all(&sample.to_le_bytes())?;
        }
        written = written.saturating_add(chunk_frames);
    }
    Ok(())
}

fn write_wav_f32_header(file: &mut std::fs::File, frames: u32, sample_rate: u32) -> Result<()> {
    let channels = OUTPUT_CHANNELS as u16;
    let bits_per_sample = 32u16;
    let bytes_per_sample = (bits_per_sample / 8) as u32;
    let data_size = frames
        .saturating_mul(channels as u32)
        .saturating_mul(bytes_per_sample);
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
    shared: &Arc<Mutex<AudioShared>>,
) -> Vec<f32> {
    let frames = (chunk_duration_sec * sample_rate as f64).round().max(1.0) as usize;
    let mut mixed = vec![0.0f32; frames * OUTPUT_CHANNELS];
    let chunk_end_sec = chunk_start_sec + chunk_duration_sec;

    // 1. Проверяем Solo-состояние треков
    let has_solo = tracks.iter().any(|t| t.audio_solo);

    // 2. Группируем слои по track_id
    let mut track_layers: HashMap<String, Vec<&SceneAudioLayer>> = HashMap::new();
    let mut orphan_layers: Vec<&SceneAudioLayer> = Vec::new();

    for layer in scene {
        let tid = layer.track_id.as_deref().unwrap_or("");
        if tid.is_empty() {
            orphan_layers.push(layer);
        } else {
            let matched_track = tracks.iter().find(|t| {
                t.id == tid
                    || tid.starts_with(&format!("{}_", t.id))
                    || tid.starts_with(t.id.as_str())
            });
            if let Some(track) = matched_track {
                track_layers
                    .entry(track.id.clone())
                    .or_default()
                    .push(layer);
            } else {
                orphan_layers.push(layer);
            }
        }
    }

    // 3. Микшируем треки (шины)
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

        let mut track_mixed = vec![0.0f32; frames * OUTPUT_CHANNELS];
        let mut has_audio_on_track = false;

        for layer in layers {
            if layer.timeline_end_sec <= chunk_start_sec
                || layer.timeline_start_sec >= chunk_end_sec
            {
                continue;
            }
            let segment_start = chunk_start_sec.max(layer.timeline_start_sec);
            let segment_end = chunk_end_sec.min(layer.timeline_end_sec);
            let segment_duration = segment_end - segment_start;
            if segment_duration <= 0.0 {
                continue;
            }

            let speed = sanitize_speed(layer.speed);
            let source_start =
                layer.source_start_sec + (segment_start - layer.timeline_start_sec) * speed;
            let mut decoded = match decode_audio_chunk(
                &layer.path,
                source_start,
                segment_duration,
                speed,
                sample_rate,
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
                    continue;
                }
            };
            let write_start_frame =
                ((segment_start - chunk_start_sec) * sample_rate as f64).round() as usize;
            let frames_to_write = frames
                .saturating_sub(write_start_frame)
                .min(decoded.len() / OUTPUT_CHANNELS);
            apply_layer_mix(
                &mut track_mixed,
                &mut decoded,
                write_start_frame,
                frames_to_write,
                sample_rate,
                layer,
                segment_start,
            );
            has_audio_on_track = true;
        }

        if has_audio_on_track {
            // Применяем громкость и баланс трека
            let (ll, lr, rl, rr) = stereo_pan_matrix(track.audio_balance);
            let gain = track.audio_gain.max(0.0) as f32;

            for i in 0..frames {
                let dst = i * OUTPUT_CHANNELS;
                let left = track_mixed[dst] * gain;
                let right = track_mixed[dst + 1] * gain;
                let final_left = (ll as f32) * left + (lr as f32) * right;
                let final_right = (rl as f32) * left + (rr as f32) * right;
                mixed[dst] += final_left;
                mixed[dst + 1] += final_right;
            }
        }
    }

    // 4. Микшируем сиротские слои (для обратной совместимости)
    if !has_solo {
        for layer in orphan_layers {
            if layer.timeline_end_sec <= chunk_start_sec
                || layer.timeline_start_sec >= chunk_end_sec
            {
                continue;
            }
            let segment_start = chunk_start_sec.max(layer.timeline_start_sec);
            let segment_end = chunk_end_sec.min(layer.timeline_end_sec);
            let segment_duration = segment_end - segment_start;
            if segment_duration <= 0.0 {
                continue;
            }

            let speed = sanitize_speed(layer.speed);
            let source_start =
                layer.source_start_sec + (segment_start - layer.timeline_start_sec) * speed;
            let mut decoded = match decode_audio_chunk(
                &layer.path,
                source_start,
                segment_duration,
                speed,
                sample_rate,
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
                    continue;
                }
            };
            let write_start_frame =
                ((segment_start - chunk_start_sec) * sample_rate as f64).round() as usize;
            let frames_to_write = frames
                .saturating_sub(write_start_frame)
                .min(decoded.len() / OUTPUT_CHANNELS);
            apply_layer_mix(
                &mut mixed,
                &mut decoded,
                write_start_frame,
                frames_to_write,
                sample_rate,
                layer,
                segment_start,
            );
        }
    }

    apply_master_gain(&mut mixed, master_gain);
    soft_clip(&mut mixed);
    mixed
}

fn apply_master_gain(samples: &mut [f32], master_gain: f64) {
    let gain = sanitize_master_gain(master_gain) as f32;
    if (gain - 1.0).abs() <= f32::EPSILON {
        return;
    }
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
        let mut chunk = vec![vec![0.0f32; chunk_size]; num_channels];
        let copy_len = (input_len - offset).min(chunk_size);
        for ch in 0..num_channels {
            chunk[ch][..copy_len].copy_from_slice(&input[ch][offset..offset + copy_len]);
        }

        let out_chunk = resampler
            .process(&chunk, None)
            .map_err(|e| anyhow!("failed to resample chunk: {:?}", e))?;

        for ch in 0..num_channels {
            output[ch].extend_from_slice(&out_chunk[ch]);
        }
        offset += chunk_size;
    }

    Ok(output)
}

fn planar_to_interleaved_stereo(planar: Vec<Vec<f32>>) -> Vec<f32> {
    let num_channels = planar.len();
    if num_channels == 0 {
        return Vec::new();
    }
    let num_frames = planar[0].len();
    let mut interleaved = vec![0.0f32; num_frames * 2];

    if num_channels == 1 {
        for i in 0..num_frames {
            let val = planar[0][i];
            interleaved[i * 2] = val;
            interleaved[i * 2 + 1] = val;
        }
    } else {
        for i in 0..num_frames {
            interleaved[i * 2] = planar[0][i];
            interleaved[i * 2 + 1] = planar[1][i];
        }
    }
    interleaved
}

fn decode_entire_file_symphonia(path: &str, target_sample_rate: u32) -> Result<Vec<f32>> {
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
    let channels = track.codec_params.channels.map(|c| c.count()).unwrap_or(2);

    let mut planar_buffers = vec![Vec::new(); channels];

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

                for frame in 0..num_frames {
                    for ch in 0..num_channels {
                        if ch < channels {
                            planar_buffers[ch].push(samples[frame * num_channels + ch]);
                        }
                    }
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
    let interleaved = planar_to_interleaved_stereo(resampled);
    Ok(interleaved)
}

fn decode_symphonia_chunk(
    path: &str,
    source_start_sec: f64,
    timeline_duration_sec: f64,
    speed: f64,
    target_sample_rate: u32,
    shared: &Arc<Mutex<AudioShared>>,
) -> Result<Vec<f32>> {
    let mut decoder_state = {
        let mut state = shared.lock();
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
        let channels = track.codec_params.channels.map(|c| c.count()).unwrap_or(2);
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
        });
    }

    let mut state_val = decoder_state.unwrap();

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

    let actual_sec = {
        let t = state_val.time_base.calc_time(seeked_to.actual_ts);
        t.seconds as f64 + t.frac
    };
    let discard_sec = (source_start_sec - actual_sec).max(0.0);
    let mut discard_frames_remaining =
        (discard_sec * state_val.source_rate as f64).round() as usize;
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

                for frame in 0..num_frames {
                    if discard_frames_remaining > 0 {
                        discard_frames_remaining -= 1;
                        continue;
                    }
                    if collected_frames >= source_frames_needed {
                        break_loop = true;
                        break;
                    }
                    for ch in 0..num_channels {
                        if ch < state_val.channels {
                            planar_buffers[ch].push(samples[frame * num_channels + ch]);
                        }
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
        let silence_len = (timeline_duration_sec * target_sample_rate as f64).round() as usize * 2;
        // Put the state back even on empty decode
        {
            let mut state = shared.lock();
            state.decoders.insert(path.to_string(), state_val);
        }
        return Ok(vec![0.0f32; silence_len]);
    }

    let resampled = resample_planar_with_speed(
        planar_buffers,
        state_val.source_rate,
        target_sample_rate,
        speed,
        state_val.channels,
    )?;
    let interleaved = planar_to_interleaved_stereo(resampled);

    // Put it back in the cache:
    {
        let mut state = shared.lock();
        state.decoders.insert(path.to_string(), state_val);
    }
    Ok(interleaved)
}

fn decode_audio_chunk(
    path: &str,
    source_start_sec: f64,
    timeline_duration_sec: f64,
    speed: f64,
    sample_rate: u32,
    shared: &Arc<Mutex<AudioShared>>,
) -> Result<Vec<f32>> {
    let is_cacheable = (speed - 1.0).abs() <= f64::EPSILON;
    let file_size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);

    if is_cacheable && file_size > 0 && file_size < 50 * 1024 * 1024 {
        let cached_samples = {
            let state = shared.lock();
            state.decoded_cache.get(path).cloned()
        };

        let cached_samples = match cached_samples {
            Some(samples) => samples,
            None => {
                log::info!("[audio] caching entire file in memory: {}", path);
                let decoded = decode_entire_file_symphonia(path, sample_rate)?;
                let shared_samples = Arc::new(decoded);
                let mut state = shared.lock();
                state
                    .decoded_cache
                    .insert(path.to_string(), shared_samples.clone());
                shared_samples
            }
        };

        let start_frame = (source_start_sec * sample_rate as f64).round() as usize;
        let frames_to_read = (timeline_duration_sec * sample_rate as f64).round() as usize;
        let start_sample = start_frame * OUTPUT_CHANNELS;
        let samples_to_read = frames_to_read * OUTPUT_CHANNELS;

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
        shared,
    )
}

fn apply_layer_mix(
    mixed: &mut [f32],
    decoded: &mut [f32],
    write_start_frame: usize,
    frames_to_write: usize,
    sample_rate: u32,
    layer: &SceneAudioLayer,
    segment_start_sec: f64,
) {
    let (ll, lr, rl, rr) = {
        let (ll, lr, rl, rr) = stereo_pan_matrix(layer.audio_balance);
        (ll as f32, lr as f32, rl as f32, rr as f32)
    };
    for i in 0..frames_to_write {
        let timeline_sec = segment_start_sec + i as f64 / sample_rate as f64;
        let clip_sec = (timeline_sec - layer.timeline_start_sec).max(0.0);
        let gain = gain_at_clip_time(layer, clip_sec) as f32;
        if gain == 0.0 {
            continue;
        }
        let src = i * OUTPUT_CHANNELS;
        let left = decoded[src] * gain;
        let right = decoded[src + 1] * gain;
        let dst = (write_start_frame + i) * OUTPUT_CHANNELS;
        mixed[dst] += ll * left + lr * right;
        mixed[dst + 1] += rl * left + rr * right;
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
    if pan <= 0.0 {
        let t = -pan;
        (
            1.0,
            (t * std::f64::consts::FRAC_PI_2).sin(),
            0.0,
            (t * std::f64::consts::FRAC_PI_2).cos(),
        )
    } else {
        let t = pan;
        (
            (t * std::f64::consts::FRAC_PI_2).cos(),
            0.0,
            (t * std::f64::consts::FRAC_PI_2).sin(),
            1.0,
        )
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

fn soft_clip(samples: &mut [f32]) {
    for sample in samples {
        *sample = sample.tanh();
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

    fn callback_info(latency_sec: f64) -> OutputCallbackInfo {
        let callback = StreamInstant::new(10, 0);
        let playback = callback
            .add(Duration::from_secs_f64(latency_sec))
            .unwrap_or(callback);
        OutputCallbackInfo::new(OutputStreamTimestamp { callback, playback })
    }

    #[test]
    fn gain_envelope_applies_linear_fades() {
        let l = layer();
        assert_eq!(gain_at_clip_time(&l, 0.0), 0.0);
        assert!((gain_at_clip_time(&l, 1.0) - 0.5).abs() < 1e-9);
        assert!((gain_at_clip_time(&l, 5.0) - 1.0).abs() < 1e-9);
        assert!((gain_at_clip_time(&l, 9.0) - 0.5).abs() < 1e-9);
    }

    #[test]
    fn stereo_pan_matrix_matches_equal_power_edges() {
        let (ll, lr, rl, rr) = stereo_pan_matrix(-1.0);
        assert!((ll - 1.0).abs() < 1e-9);
        assert!((lr - 1.0).abs() < 1e-9);
        assert_eq!(rl, 0.0);
        assert!(rr.abs() < 1e-9);

        let (ll, lr, rl, rr) = stereo_pan_matrix(1.0);
        assert!(ll.abs() < 1e-9);
        assert_eq!(lr, 0.0);
        assert!((rl - 1.0).abs() < 1e-9);
        assert!((rr - 1.0).abs() < 1e-9);
    }

    #[test]
    fn test_planar_to_interleaved_stereo_mono() {
        let planar = vec![vec![1.0, 2.0, 3.0]];
        let interleaved = planar_to_interleaved_stereo(planar);
        assert_eq!(interleaved, vec![1.0, 1.0, 2.0, 2.0, 3.0, 3.0]);
    }

    #[test]
    fn test_planar_to_interleaved_stereo_stereo() {
        let planar = vec![vec![1.0, 2.0], vec![3.0, 4.0]];
        let interleaved = planar_to_interleaved_stereo(planar);
        assert_eq!(interleaved, vec![1.0, 3.0, 2.0, 4.0]);
    }

    #[test]
    fn test_resample_planar_no_op() {
        let planar = vec![vec![0.5; 100], vec![-0.5; 100]];
        let resampled = resample_planar_with_speed(planar.clone(), 44100, 44100, 1.0, 2).unwrap();
        assert_eq!(resampled, planar);
    }

    #[test]
    fn logarithmic_fade_reaches_unity() {
        assert_eq!(fade_curve(0.0, AudioFadeCurve::Logarithmic), 0.0);
        assert!((fade_curve(1.0, AudioFadeCurve::Logarithmic) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn master_gain_is_applied_after_layer_mix() {
        let mut samples = vec![0.25, -0.5, 1.0];
        apply_master_gain(&mut samples, 0.5);
        assert_eq!(samples, vec![0.125, -0.25, 0.5]);
    }

    #[test]
    fn output_clock_does_not_advance_on_underrun() {
        let shared = Arc::new(Mutex::new(AudioShared {
            playing: true,
            ..AudioShared::default()
        }));
        let mut data = vec![1.0f32; 128 * OUTPUT_CHANNELS];

        write_output(
            &mut data,
            &callback_info(0.0),
            &shared,
            48_000,
            OUTPUT_CHANNELS as u16,
        );

        assert!(data.iter().all(|sample| *sample == 0.0));
        assert_eq!(shared.lock().frames_written, 0); // 0 из-за underrun
    }

    #[test]
    fn output_clock_advances_when_ring_has_samples() {
        let mut ring = VecDeque::new();
        ring.resize(256, 0.0f32); // 128 стерео-фреймов тишины
        let shared = Arc::new(Mutex::new(AudioShared {
            playing: true,
            ring,
            ..AudioShared::default()
        }));
        let mut data = vec![1.0f32; 128 * OUTPUT_CHANNELS];

        write_output(
            &mut data,
            &callback_info(0.0),
            &shared,
            48_000,
            OUTPUT_CHANNELS as u16,
        );

        assert!(data.iter().all(|sample| *sample == 0.0));
        assert_eq!(shared.lock().frames_written, 128); // 128 проигралось
    }

    #[test]
    fn audible_pts_compensates_output_latency_and_buffer() {
        let shared = Arc::new(Mutex::new(AudioShared {
            playing: true,
            origin_pts_sec: 10.0,
            frames_written: 48_000,
            output_latency_sec: 0.02,
            last_output_buffer_frames: 480,
            ..AudioShared::default()
        }));

        let pts = audible_pts_sec(&shared.lock(), 48_000);

        assert!((pts - 10.97).abs() < 1e-9);
    }

    #[test]
    fn test_decode_entire_file_symphonia() {
        let path = "../test/fixtures/media/sample-1s-audio.mp3";
        let decoded = decode_entire_file_symphonia(path, 48000);
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
        let shared = Arc::new(Mutex::new(AudioShared::default()));
        let decoded = decode_symphonia_chunk(path, 0.2, 0.5, 1.0, 48000, &shared);
        assert!(
            decoded.is_ok(),
            "Failed to decode chunk: {:?}",
            decoded.err()
        );
        let samples = decoded.unwrap();
        assert!(samples.len() > 0, "Decoded chunk buffer is empty");
        // For a duration of 0.5 seconds at 48000 Hz, we expect around 0.5 * 48000 * 2 (stereo) = 48000 samples.
        assert!(
            samples.len() >= 45000 && samples.len() <= 55000,
            "Unexpected chunk length: {}",
            samples.len()
        );
    }
}
