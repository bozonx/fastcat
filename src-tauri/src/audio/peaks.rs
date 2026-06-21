use anyhow::{anyhow, Context, Result};
use std::io::Read;
use std::path::Path;
use symphonia::core::audio::SampleBuffer;

use crate::audio::ffmpeg_decode::{spawn_ffmpeg_f32le, FfmpegDecodeParams};
use crate::audio::shared::{make_symphonia_decoder, open_symphonia_audio, SymphoniaAudioInfo};

const MAX_PEAK_LENGTH: usize = 500_000;

/// How many intermediate ("mip") buckets we keep relative to the requested
/// output resolution. Oversampling keeps the final downsample clean (we always
/// downsample, never upsample, for sources longer than `max_length` frames).
const MIP_OVERSAMPLE: usize = 8;

/// Hard ceiling on intermediate buckets per channel, to bound memory for very
/// long sources regardless of the requested `max_length`.
const MAX_MIP_BUCKETS: usize = 2_000_000;

struct AudioDecoderState {
    info: SymphoniaAudioInfo,
    decoder: Box<dyn symphonia::core::codecs::Decoder>,
}

fn open_audio_decoder(path: &Path) -> Result<AudioDecoderState> {
    let info = open_symphonia_audio(path, "peak decode", 48_000)?;
    let track = info
        .track()
        .ok_or_else(|| anyhow!("probed audio track disappeared"))?;
    let decoder = make_symphonia_decoder(track)?;
    Ok(AudioDecoderState { info, decoder })
}

/// Collapses each pair of adjacent mip buckets into one (taking the max), halving
/// the resolution. Used to keep the intermediate buffer bounded while streaming a
/// source whose total length is unknown up front.
fn halve_mip(mip: &mut [Vec<f32>]) {
    for channel in mip.iter_mut() {
        let merged_len = channel.len().div_ceil(2);
        for i in 0..merged_len {
            let a = channel[2 * i];
            let b = channel.get(2 * i + 1).copied().unwrap_or(0.0);
            channel[i] = a.max(b);
        }
        channel.truncate(merged_len);
    }
}

/// Downsamples a single channel's intermediate mip buffer into exactly
/// `output_len` buckets, taking the max absolute amplitude over each output's
/// source range. The mapping is index-based on the *actual* mip length, so the
/// result is correct regardless of any container metadata.
fn resample_channel(mip: &[f32], output_len: usize) -> Vec<f32> {
    let mut out = vec![0.0f32; output_len];
    let source_len = mip.len();
    if source_len == 0 || output_len == 0 {
        return out;
    }

    for (bucket, value) in out.iter_mut().enumerate() {
        let start = (bucket as u128 * source_len as u128 / output_len as u128) as usize;
        let mut end = ((bucket as u128 + 1) * source_len as u128 / output_len as u128) as usize;
        if end <= start {
            end = start + 1;
        }
        let end = end.min(source_len);
        let mut peak = 0.0f32;
        for &sample in &mip[start..end] {
            if sample > peak {
                peak = sample;
            }
        }
        *value = peak;
    }

    out
}

struct PeakAccumulator {
    mip: Vec<Vec<f32>>,
    frames_per_bucket: u64,
    total_frames: u64,
    target_buckets: usize,
}

impl PeakAccumulator {
    fn new(channels: usize, target_buckets: usize) -> Self {
        Self {
            mip: vec![Vec::new(); channels.max(1)],
            frames_per_bucket: 1,
            total_frames: 0,
            target_buckets,
        }
    }

    fn push_interleaved(&mut self, samples: &[f32], num_channels: usize) {
        if num_channels == 0 {
            return;
        }
        let num_frames = samples.len() / num_channels;
        if num_frames == 0 {
            return;
        }

        if num_channels > self.mip.len() {
            let current_len = self.mip.first().map(|c| c.len()).unwrap_or(0);
            while self.mip.len() < num_channels {
                self.mip.push(vec![0.0f32; current_len]);
            }
        }

        for frame in 0..num_frames {
            let global_frame = self.total_frames + frame as u64;
            let bucket = (global_frame / self.frames_per_bucket) as usize;
            for ch in 0..num_channels {
                let channel = &mut self.mip[ch];
                if bucket >= channel.len() {
                    channel.resize(bucket + 1, 0.0);
                }
                let val = samples[frame * num_channels + ch].abs();
                if val > channel[bucket] {
                    channel[bucket] = val;
                }
            }
        }

        self.total_frames += num_frames as u64;

        while self.mip.first().map(|c| c.len()).unwrap_or(0) > self.target_buckets.saturating_mul(2)
        {
            halve_mip(&mut self.mip);
            self.frames_per_bucket = self.frames_per_bucket.saturating_mul(2);
        }
    }

    fn finish(self, max_length: usize) -> Vec<Vec<f32>> {
        let channels = self.mip.len().max(1);
        if self.total_frames == 0 {
            return vec![vec![0.0f32; max_length]; channels];
        }

        self.mip
            .iter()
            .map(|channel| resample_channel(channel, max_length))
            .collect()
    }
}

/// Extracts audio peaks from a media file in a single streaming decode pass.
///
/// Amplitudes are accumulated into an intermediate per-channel "mip" buffer at a
/// resolution that oversamples `max_length`; when the mip grows past its ceiling
/// it is halved in place. A final downsample maps the mip onto exactly
/// `max_length` buckets. Because both the accumulation and the final mapping use
/// the real decoded frame count, the output never depends on (potentially wrong)
/// container `n_frames` metadata, and the file is decoded exactly once.
pub fn extract_peaks(path: &Path, max_length: usize) -> Result<Vec<Vec<f32>>> {
    let max_length = max_length.clamp(1, MAX_PEAK_LENGTH);
    let target_buckets = max_length
        .saturating_mul(MIP_OVERSAMPLE)
        .clamp(1, MAX_MIP_BUCKETS);

    match extract_peaks_symphonia(path, max_length, target_buckets) {
        Ok(peaks) => Ok(peaks),
        Err(symphonia_error) => {
            log::warn!(
                "[audio peaks] symphonia failed for {}; falling back to ffmpeg: {symphonia_error:#}",
                path.display()
            );
            extract_peaks_ffmpeg(path, max_length, target_buckets).with_context(|| {
                format!(
                    "failed to extract peaks via ffmpeg after symphonia failed: {symphonia_error:#}"
                )
            })
        }
    }
}

fn extract_peaks_symphonia(
    path: &Path,
    max_length: usize,
    target_buckets: usize,
) -> Result<Vec<Vec<f32>>> {
    let mut state = open_audio_decoder(path)?;
    let mut accumulator = PeakAccumulator::new(state.info.channels, target_buckets);

    loop {
        let packet = match state.info.format.next_packet() {
            Ok(packet) => packet,
            Err(symphonia::core::errors::Error::IoError(ref err))
                if err.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(err) => return Err(err).context("failed to read next packet"),
        };

        if packet.track_id() != state.info.track_id {
            continue;
        }

        match state.decoder.decode(&packet) {
            Ok(audio_buf) => {
                let spec = *audio_buf.spec();
                let duration = audio_buf.frames() as u64;
                let mut sample_buf = SampleBuffer::<f32>::new(duration, spec);
                sample_buf.copy_interleaved_ref(audio_buf);

                let samples = sample_buf.samples();
                let num_channels = spec.channels.count();
                accumulator.push_interleaved(samples, num_channels);
            }
            Err(symphonia::core::errors::Error::IoError(ref err))
                if err.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(symphonia::core::errors::Error::DecodeError(_)) => {
                continue;
            }
            Err(err) => return Err(err).context("failed to decode packet"),
        }
    }

    Ok(accumulator.finish(max_length))
}

fn extract_peaks_ffmpeg(
    path: &Path,
    max_length: usize,
    target_buckets: usize,
) -> Result<Vec<Vec<f32>>> {
    let info = open_symphonia_audio(path, "ffmpeg peak fallback", 48_000)?;
    let channels = info.channels.max(1);
    let mut reader = spawn_ffmpeg_f32le(FfmpegDecodeParams {
        path,
        start_sec: 0.0,
        duration_sec: None,
        target_sample_rate: info.sample_rate.max(1),
        output_channels: channels,
    })?;
    let mut accumulator = PeakAccumulator::new(channels, target_buckets);
    let mut pending = Vec::<u8>::new();
    let mut chunk = [0u8; 64 * 1024];

    loop {
        let read = reader
            .stdout_mut()
            .read(&mut chunk)
            .context("failed to read ffmpeg waveform PCM")?;
        if read == 0 {
            break;
        }
        pending.extend_from_slice(&chunk[..read]);
        let complete_len = pending.len() / std::mem::size_of::<f32>() * std::mem::size_of::<f32>();
        if complete_len == 0 {
            continue;
        }

        let samples: Vec<f32> = pending[..complete_len]
            .chunks_exact(std::mem::size_of::<f32>())
            .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
            .collect();
        accumulator.push_interleaved(&samples, channels);

        pending.drain(..complete_len);
    }

    reader.wait()?;
    Ok(accumulator.finish(max_length))
}

pub fn pack_peaks(peaks: &[Vec<f32>]) -> Vec<u8> {
    let channel_count = peaks.len() as u32;
    let samples_count = peaks.first().map(|channel| channel.len()).unwrap_or(0) as u32;
    let mut bytes = Vec::with_capacity(8 + channel_count as usize * samples_count as usize * 4);
    bytes.extend_from_slice(&channel_count.to_le_bytes());
    bytes.extend_from_slice(&samples_count.to_le_bytes());

    for channel in peaks {
        for value in channel.iter().take(samples_count as usize) {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        for _ in channel.len()..samples_count as usize {
            bytes.extend_from_slice(&0.0f32.to_le_bytes());
        }
    }

    bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_peaks_from_fixture() {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("test/fixtures/media/sample-1s-720p.mp4");

        let peaks = extract_peaks(&fixture, 100).unwrap();
        assert!(!peaks.is_empty());
        assert_eq!(peaks[0].len(), 100);
        for val in &peaks[0] {
            assert!(*val >= 0.0 && *val <= 1.0);
        }
    }

    #[test]
    fn test_extract_peaks_uses_real_decoded_duration() {
        let path = unique_temp_wav("decoded-duration");
        write_mono_pcm_wav(&path, &[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]).unwrap();

        let peaks = extract_peaks(&path, 5).unwrap();
        let _ = std::fs::remove_file(path);

        assert_eq!(peaks.len(), 1);
        assert_eq!(peaks[0].len(), 5);
        let expected = [0.2f32, 0.4, 0.6, 0.8, 1.0];
        for (a, b) in peaks[0].iter().zip(expected.iter()) {
            assert!((a - b).abs() < 1e-4, "peak mismatch: {} vs {}", a, b);
        }
    }

    #[test]
    fn test_extract_peaks_aligns_to_real_decoded_frames() {
        // A 100-sample ramp downsampled to 10 buckets must yield the max of each
        // 10-sample group, with no trailing flatline or last-bucket spike. This
        // would break if bucketing relied on a mismatched container frame count.
        let path = unique_temp_wav("ramp");
        let samples: Vec<f32> = (0..100).map(|i| (i as f32 + 1.0) / 100.0).collect();
        write_mono_pcm_wav(&path, &samples).unwrap();

        let peaks = extract_peaks(&path, 10).unwrap();
        let _ = std::fs::remove_file(path);

        assert_eq!(peaks.len(), 1);
        assert_eq!(peaks[0].len(), 10);
        let expected: Vec<f32> = (1..=10).map(|k| (k as f32 * 10.0) / 100.0).collect();
        for (a, b) in peaks[0].iter().zip(expected.iter()) {
            assert!((a - b).abs() < 1e-3, "peak mismatch: {} vs {}", a, b);
        }
    }

    #[test]
    fn test_extract_peaks_clamps_max_length() {
        let path = unique_temp_wav("clamp");
        write_mono_pcm_wav(&path, &[0.1, 0.2]).unwrap();

        let peaks = extract_peaks(&path, 1_000_000).unwrap();
        let _ = std::fs::remove_file(path);

        assert_eq!(peaks[0].len(), MAX_PEAK_LENGTH);
    }

    #[test]
    fn test_extract_peaks_zero_max_length_defaults_to_one() {
        let path = unique_temp_wav("zero-max");
        write_mono_pcm_wav(&path, &[0.1, 0.2]).unwrap();

        let peaks = extract_peaks(&path, 0).unwrap();
        let _ = std::fs::remove_file(path);

        assert_eq!(peaks[0].len(), 1);
    }

    #[test]
    fn test_pack_peaks_uses_waveform_binary_layout() {
        let bytes = pack_peaks(&[vec![0.5, 1.0], vec![0.25, 0.75]]);
        assert_eq!(&bytes[0..4], &2u32.to_le_bytes());
        assert_eq!(&bytes[4..8], &2u32.to_le_bytes());

        let values: Vec<f32> = bytes[8..]
            .chunks_exact(4)
            .map(|chunk| f32::from_le_bytes(chunk.try_into().unwrap()))
            .collect();
        assert_eq!(values, vec![0.5, 1.0, 0.25, 0.75]);
    }

    #[test]
    fn test_halve_mip() {
        let mut mip = vec![vec![0.5, 0.2, 0.8, 0.1, 0.4], vec![0.1, 0.9, 0.3, 0.4, 0.2]];
        halve_mip(&mut mip);
        assert_eq!(mip.len(), 2);
        assert_eq!(mip[0].len(), 3);
        assert_eq!(mip[1].len(), 3);
        assert_eq!(mip[0], vec![0.5, 0.8, 0.4]);
        assert_eq!(mip[1], vec![0.9, 0.4, 0.2]);
    }

    #[test]
    fn test_resample_channel() {
        let mip = vec![0.1, 0.5, 0.9, 0.3, 0.2, 0.8, 0.4, 0.6];
        let resampled = resample_channel(&mip, 4);
        assert_eq!(resampled.len(), 4);
        assert_eq!(resampled, vec![0.5, 0.9, 0.8, 0.6]);

        assert_eq!(resample_channel(&[], 4), vec![0.0, 0.0, 0.0, 0.0]);
        assert!(resample_channel(&mip, 0).is_empty());
    }

    /// Unique temp path per test+process to avoid clobbering between tests that
    /// run in parallel (Rust's test harness is multi-threaded by default).
    fn unique_temp_wav(label: &str) -> std::path::PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "fastcat-waveform-{}-{}-{}.wav",
            label,
            std::process::id(),
            n
        ))
    }

    fn write_mono_pcm_wav(path: &Path, samples: &[f32]) -> std::io::Result<()> {
        let sample_rate = 48_000u32;
        let bits_per_sample = 16u16;
        let channels = 1u16;
        let block_align = channels * (bits_per_sample / 8);
        let byte_rate = sample_rate * block_align as u32;
        let data_size = samples.len() as u32 * block_align as u32;
        let mut bytes = Vec::new();

        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_size).to_le_bytes());
        bytes.extend_from_slice(b"WAVE");
        bytes.extend_from_slice(b"fmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&channels.to_le_bytes());
        bytes.extend_from_slice(&sample_rate.to_le_bytes());
        bytes.extend_from_slice(&byte_rate.to_le_bytes());
        bytes.extend_from_slice(&block_align.to_le_bytes());
        bytes.extend_from_slice(&bits_per_sample.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_size.to_le_bytes());

        for sample in samples {
            let value = (sample.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16;
            bytes.extend_from_slice(&value.to_le_bytes());
        }

        std::fs::write(path, bytes)
    }
}
