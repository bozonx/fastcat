use anyhow::{anyhow, Context, Result};
use std::path::Path;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{Decoder, DecoderOptions};
use symphonia::core::formats::{FormatOptions, FormatReader};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

const MAX_PEAK_LENGTH: usize = 500_000;

/// How many intermediate ("mip") buckets we keep relative to the requested
/// output resolution. Oversampling keeps the final downsample clean (we always
/// downsample, never upsample, for sources longer than `max_length` frames).
const MIP_OVERSAMPLE: usize = 8;

/// Hard ceiling on intermediate buckets per channel, to bound memory for very
/// long sources regardless of the requested `max_length`.
const MAX_MIP_BUCKETS: usize = 2_000_000;

struct AudioDecoderState {
    format: Box<dyn FormatReader>,
    decoder: Box<dyn Decoder>,
    track_id: u32,
    channels: usize,
}

fn open_audio_decoder(path: &Path) -> Result<AudioDecoderState> {
    let file = std::fs::File::open(path)
        .with_context(|| format!("failed to open audio file: {}", path.display()))?;
    let mss = symphonia::core::io::MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
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

    Ok(AudioDecoderState {
        track_id: track.id,
        channels: track.codec_params.channels.map(|c| c.count()).unwrap_or(1),
        format,
        decoder,
    })
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

    let mut state = open_audio_decoder(path)?;
    let mut mip: Vec<Vec<f32>> = vec![Vec::new(); state.channels.max(1)];
    let mut frames_per_bucket: u64 = 1;
    let mut total_frames: u64 = 0;

    loop {
        let packet = match state.format.next_packet() {
            Ok(packet) => packet,
            Err(symphonia::core::errors::Error::IoError(ref err))
                if err.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(err) => return Err(err).context("failed to read next packet"),
        };

        if packet.track_id() != state.track_id {
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
                if num_channels == 0 {
                    continue;
                }
                let num_frames = samples.len() / num_channels;
                if num_frames == 0 {
                    continue;
                }

                if num_channels > mip.len() {
                    let current_len = mip.first().map(|c| c.len()).unwrap_or(0);
                    while mip.len() < num_channels {
                        mip.push(vec![0.0f32; current_len]);
                    }
                }

                for frame in 0..num_frames {
                    let global_frame = total_frames + frame as u64;
                    let bucket = (global_frame / frames_per_bucket) as usize;
                    for ch in 0..num_channels {
                        let channel = &mut mip[ch];
                        if bucket >= channel.len() {
                            channel.resize(bucket + 1, 0.0);
                        }
                        let val = samples[frame * num_channels + ch].abs();
                        if val > channel[bucket] {
                            channel[bucket] = val;
                        }
                    }
                }

                total_frames += num_frames as u64;

                // Keep the intermediate buffer bounded: once it grows past twice
                // the target resolution, halve it (and the frames-per-bucket).
                while mip.first().map(|c| c.len()).unwrap_or(0) > target_buckets.saturating_mul(2) {
                    halve_mip(&mut mip);
                    frames_per_bucket = frames_per_bucket.saturating_mul(2);
                }
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

    let channels = mip.len().max(1);
    if total_frames == 0 {
        return Ok(vec![vec![0.0f32; max_length]; channels]);
    }

    Ok(mip
        .iter()
        .map(|channel| resample_channel(channel, max_length))
        .collect())
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
