use std::collections::VecDeque;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, TryLockError};
use std::thread::JoinHandle;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream, StreamConfig};

use crate::monitor::scene::{AudioFadeCurve, SceneAudioLayer};

const OUTPUT_CHANNELS: usize = 2;
const CHUNK_DURATION_SEC: f64 = 1.0;
const PREBUFFER_CHUNKS: usize = 3;

#[derive(Default)]
struct AudioShared {
    scene: Vec<SceneAudioLayer>,
    ring: VecDeque<f32>,
    playing: bool,
    origin_pts_sec: f64,
    frames_written: u64,
    producer_pts_sec: f64,
    seek_serial: u64,
    scene_serial: u64,
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

    pub fn set_scene(&self, layers: Vec<SceneAudioLayer>) {
        let mut state = self.shared.lock().unwrap();
        state.scene = layers;
        state.ring.clear();
        state.producer_pts_sec =
            state.origin_pts_sec + state.frames_written as f64 / self.sample_rate as f64;
        state.scene_serial = state.scene_serial.wrapping_add(1);
    }

    pub fn play(&self, pts_sec: f64) {
        let mut state = self.shared.lock().unwrap();
        state.playing = true;
        state.origin_pts_sec = pts_sec.max(0.0);
        state.frames_written = 0;
        state.producer_pts_sec = state.origin_pts_sec;
        state.ring.clear();
        state.seek_serial = state.seek_serial.wrapping_add(1);
    }

    pub fn pause(&self) -> f64 {
        let mut state = self.shared.lock().unwrap();
        let pts = state.origin_pts_sec + state.frames_written as f64 / self.sample_rate as f64;
        state.playing = false;
        state.origin_pts_sec = pts;
        state.frames_written = 0;
        state.ring.clear();
        state.producer_pts_sec = pts;
        pts
    }

    pub fn seek(&self, pts_sec: f64, playing: bool) {
        let mut state = self.shared.lock().unwrap();
        let pts = pts_sec.max(0.0);
        state.origin_pts_sec = pts;
        state.frames_written = 0;
        state.producer_pts_sec = pts;
        state.ring.clear();
        state.playing = playing;
        state.seek_serial = state.seek_serial.wrapping_add(1);
    }

    pub fn current_pts(&self) -> Option<f64> {
        let state = self.shared.lock().unwrap();
        if !state.playing {
            return None;
        }
        Some(state.origin_pts_sec + state.frames_written as f64 / self.sample_rate as f64)
    }

    pub fn is_empty(&self) -> bool {
        self.shared.lock().unwrap().scene.is_empty()
    }

    pub fn scene_end(&self) -> f64 {
        self.shared
            .lock()
            .unwrap()
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
                move |data: &mut [f32], _| {
                    write_output(data, &shared, sample_rate, device_channels)
                },
                err_fn,
                None,
            )
            .context("build f32 output stream failed"),
        SampleFormat::I16 => device
            .build_output_stream(
                config,
                move |data: &mut [i16], _| {
                    write_output(data, &shared, sample_rate, device_channels)
                },
                err_fn,
                None,
            )
            .context("build i16 output stream failed"),
        SampleFormat::U16 => device
            .build_output_stream(
                config,
                move |data: &mut [u16], _| {
                    write_output(data, &shared, sample_rate, device_channels)
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
    shared: &Arc<Mutex<AudioShared>>,
    sample_rate: u32,
    device_channels: u16,
) {
    let channels = device_channels.max(1) as usize;
    let frames = data.len() / channels;
    let mut state = match shared.try_lock() {
        Ok(state) => state,
        Err(TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
        Err(TryLockError::WouldBlock) => {
            for sample in data {
                *sample = T::from_f32(0.0);
            }
            return;
        }
    };
    for frame in 0..frames {
        let (left, right) = if state.playing {
            if state.ring.len() >= 2 {
                let left = state.ring.pop_front().unwrap_or(0.0);
                let right = state.ring.pop_front().unwrap_or(0.0);
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
        state.frames_written = state.frames_written.saturating_add(frames as u64);
    } else {
        let _ = sample_rate;
    }
}

fn producer_loop(shared: Arc<Mutex<AudioShared>>, running: Arc<AtomicBool>, sample_rate: u32) {
    let chunk_frames = (CHUNK_DURATION_SEC * sample_rate as f64).round().max(1.0) as usize;
    let limit_samples = chunk_frames * OUTPUT_CHANNELS * PREBUFFER_CHUNKS;

    while running.load(Ordering::Relaxed) {
        let snapshot = {
            let state = shared.lock().unwrap();
            if !state.playing || state.scene.is_empty() || state.ring.len() >= limit_samples {
                None
            } else {
                Some((
                    state.scene.clone(),
                    state.producer_pts_sec,
                    state.seek_serial,
                    state.scene_serial,
                ))
            }
        };

        let Some((scene, chunk_start, seek_serial, scene_serial)) = snapshot else {
            std::thread::sleep(Duration::from_millis(8));
            continue;
        };

        let chunk = mix_chunk(&scene, chunk_start, CHUNK_DURATION_SEC, sample_rate);

        let mut state = shared.lock().unwrap();
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

fn mix_chunk(
    scene: &[SceneAudioLayer],
    chunk_start_sec: f64,
    chunk_duration_sec: f64,
    sample_rate: u32,
) -> Vec<f32> {
    let frames = (chunk_duration_sec * sample_rate as f64).round().max(1.0) as usize;
    let mut mixed = vec![0.0f32; frames * OUTPUT_CHANNELS];
    let chunk_end_sec = chunk_start_sec + chunk_duration_sec;

    for layer in scene {
        if layer.timeline_end_sec <= chunk_start_sec || layer.timeline_start_sec >= chunk_end_sec {
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
        let mut decoded = match decode_ffmpeg_chunk(
            &layer.path,
            source_start,
            segment_duration,
            speed,
            sample_rate,
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

    soft_clip(&mut mixed);
    mixed
}

fn build_atempo_filter_str(speed: f64) -> Option<String> {
    let speed_clamped = sanitize_speed(speed);
    if (speed_clamped - 1.0).abs() <= f64::EPSILON {
        return None;
    }
    let mut filters = Vec::new();
    let mut s = speed_clamped;
    while s > 2.0 {
        filters.push("atempo=2.0".to_string());
        s /= 2.0;
    }
    while s < 0.5 {
        filters.push("atempo=0.5".to_string());
        s /= 0.5;
    }
    if (s - 1.0).abs() > f64::EPSILON {
        filters.push(format!("atempo={:.6}", s));
    }
    if filters.is_empty() {
        None
    } else {
        Some(filters.join(","))
    }
}

fn decode_ffmpeg_chunk(
    path: &str,
    source_start_sec: f64,
    timeline_duration_sec: f64,
    speed: f64,
    sample_rate: u32,
) -> Result<Vec<f32>> {
    let source_duration = (timeline_duration_sec * speed).max(0.001);
    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-nostdin")
        .arg("-loglevel")
        .arg("error")
        .arg("-ss")
        .arg(format!("{:.6}", source_start_sec.max(0.0)))
        .arg("-t")
        .arg(format!("{:.6}", source_duration))
        .arg("-i")
        .arg(path)
        .arg("-vn");
    if let Some(filter_str) = build_atempo_filter_str(speed) {
        cmd.arg("-filter:a").arg(filter_str);
    }
    cmd.arg("-f")
        .arg("f32le")
        .arg("-ac")
        .arg(OUTPUT_CHANNELS.to_string())
        .arg("-ar")
        .arg(sample_rate.to_string())
        .arg("-")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = cmd
        .spawn()
        .context("failed to spawn ffmpeg for audio")?
        .wait_with_output()?;
    if !output.status.success() {
        return Err(anyhow!(
            "ffmpeg audio decode failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let mut samples = Vec::with_capacity(output.stdout.len() / 4);
    for chunk in output.stdout.chunks_exact(4) {
        samples.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }
    Ok(samples)
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

fn soft_clip(samples: &mut [f32]) {
    for sample in samples {
        *sample = sample.tanh();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layer() -> SceneAudioLayer {
        SceneAudioLayer {
            id: "a1".into(),
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
    fn build_atempo_filter_str_chains_correctly() {
        assert_eq!(build_atempo_filter_str(1.0), None);
        assert_eq!(
            build_atempo_filter_str(2.0).as_deref(),
            Some("atempo=2.000000")
        );
        assert_eq!(
            build_atempo_filter_str(4.0).as_deref(),
            Some("atempo=2.0,atempo=2.000000")
        );
        assert_eq!(
            build_atempo_filter_str(0.5).as_deref(),
            Some("atempo=0.500000")
        );
        assert_eq!(
            build_atempo_filter_str(0.25).as_deref(),
            Some("atempo=0.5,atempo=0.500000")
        );
        assert_eq!(
            build_atempo_filter_str(3.0).as_deref(),
            Some("atempo=2.0,atempo=1.500000")
        );
    }

    #[test]
    fn logarithmic_fade_reaches_unity() {
        assert_eq!(fade_curve(0.0, AudioFadeCurve::Logarithmic), 0.0);
        assert!((fade_curve(1.0, AudioFadeCurve::Logarithmic) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn output_clock_advances_across_silence() {
        let shared = Arc::new(Mutex::new(AudioShared {
            playing: true,
            ..AudioShared::default()
        }));
        let mut data = vec![1.0f32; 128 * OUTPUT_CHANNELS];

        write_output(&mut data, &shared, 48_000, OUTPUT_CHANNELS as u16);

        assert!(data.iter().all(|sample| *sample == 0.0));
        assert_eq!(shared.lock().unwrap().frames_written, 128);
    }
}
