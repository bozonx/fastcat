use cpal::traits::DeviceTrait;
use cpal::{OutputCallbackInfo, SampleFormat, Stream, StreamConfig};
use anyhow::{anyhow, Context, Result};

use crate::audio::ring::SpscRingBuffer;
use crate::audio::clock::RealtimeClock;

pub(crate) fn build_stream(
    device: &cpal::Device,
    config: &StreamConfig,
    format: SampleFormat,
    ring: std::sync::Arc<SpscRingBuffer>,
    clock: std::sync::Arc<RealtimeClock>,
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

pub(crate) trait OutputSample {
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

pub(crate) fn write_output<T: OutputSample>(
    data: &mut [T],
    info: &OutputCallbackInfo,
    clock: &RealtimeClock,
    ring: &SpscRingBuffer,
    device_channels: u16,
) {
    let channels = device_channels.max(1) as usize;
    let frames = data.len() / channels;

    // Playback state is read lock-free; the callback never blocks on a mutex.
    if !clock.playing.load(std::sync::atomic::Ordering::Acquire) {
        for sample in data.iter_mut() {
            *sample = T::from_f32(0.0);
        }
        return;
    }

    thread_local! {
        static TEMP_BUF: std::cell::RefCell<Vec<f32>> = {
            let mut v = Vec::with_capacity(131072);
            v.resize(131072, 0.0);
            std::cell::RefCell::new(v)
        };
    }

    TEMP_BUF.with(|buf| {
        let mut buf = buf.borrow_mut();
        let needed = data.len();
        assert!(
            needed <= buf.len(),
            "audio callback buffer size {} exceeds preallocated temp capacity {}",
            needed,
            buf.len()
        );
        let temp_slice = &mut buf[..needed];
        temp_slice.fill(0.0);
        // The ring already holds device-channel interleaved samples, so we copy 1:1.
        // On underrun the unfilled tail stays zeroed (silence), but the clock still
        // advances below to prevent drift.
        let read = ring.pop_slice(temp_slice);
        // Record any shortfall as an underrun. Relaxed stores keep the real-time
        // callback lock-free; the producer thread reads these to log throttled.
        if read < temp_slice.len() {
            let silent_frames = ((temp_slice.len() - read) / channels) as u64;
            clock.underrun_events.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            clock
                .underrun_frames
                .fetch_add(silent_frames, std::sync::atomic::Ordering::Relaxed);
        }
        for (out, sample) in data.iter_mut().zip(temp_slice.iter()) {
            *out = T::from_f32(*sample);
        }
    });

    clock
        .frames_written
        .fetch_add(frames as u64, std::sync::atomic::Ordering::AcqRel);
    clock
        .output_latency_bits
        .store(output_latency_sec(info).to_bits(), std::sync::atomic::Ordering::Release);
}

pub(crate) fn output_latency_sec(info: &OutputCallbackInfo) -> f64 {
    info.timestamp()
        .playback
        .duration_since(&info.timestamp().callback)
        .map(|duration| duration.as_secs_f64().clamp(0.0, 0.5))
        .unwrap_or(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use cpal::{OutputStreamTimestamp, StreamInstant};
    use std::time::Duration;

    fn callback_info(latency_sec: f64) -> OutputCallbackInfo {
        let callback = StreamInstant::new(10, 0);
        let playback = callback
            .add(Duration::from_secs_f64(latency_sec))
            .unwrap_or(callback);
        OutputCallbackInfo::new(OutputStreamTimestamp { callback, playback })
    }

    #[test]
    fn output_clock_advances_on_underrun_to_prevent_drift() {
        let clock = RealtimeClock::default();
        clock.playing.store(true, std::sync::atomic::Ordering::Release);
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
        clock.playing.store(true, std::sync::atomic::Ordering::Release);
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
        clock.playing.store(true, std::sync::atomic::Ordering::Release);
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
}
