use anyhow::{anyhow, Context, Result};
use std::path::Path;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{Decoder, DecoderOptions};
use symphonia::core::formats::FormatOptions;
use symphonia::core::formats::FormatReader;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

struct AudioDecoderState {
    format: Box<dyn FormatReader>,
    decoder: Box<dyn Decoder>,
    track_id: u32,
    channels: usize,
    /// Total frame count reported by container metadata, if available.
    n_frames: Option<u64>,
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
        n_frames: track.codec_params.n_frames,
        format,
        decoder,
    })
}

fn count_decoded_frames(path: &Path) -> Result<(u64, usize)> {
    let mut state = open_audio_decoder(path)?;
    let mut total_frames = 0u64;
    let mut channels = state.channels.max(1);

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
                channels = channels.max(audio_buf.spec().channels.count());
                total_frames += audio_buf.frames() as u64;
            }
            Err(symphonia::core::errors::Error::IoError(ref err))
                if err.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(symphonia::core::errors::Error::DecodeError(_)) => continue,
            Err(err) => return Err(err).context("failed to decode packet"),
        }
    }

    Ok((total_frames, channels))
}

/// Extracts audio peaks from a media file by streamingly decoding it and downsampling
/// the absolute amplitude values into a fixed-size buffer per channel.
pub fn extract_peaks(path: &Path, max_length: usize) -> Result<Vec<Vec<f32>>> {
    if max_length == 0 {
        return Ok(Vec::new());
    }

    let (total_frames, channels) = {
        let state = open_audio_decoder(path)?;
        match state.n_frames {
            Some(n) if n > 0 => (n, state.channels.max(1)),
            _ => count_decoded_frames(path)?,
        }
    };
    let channels = channels.max(1);
    if total_frames == 0 {
        return Ok(vec![vec![0.0f32; max_length]; channels]);
    }

    let mut state = open_audio_decoder(path)?;

    let mut peaks = vec![vec![0.0f32; max_length]; channels];
    let mut current_frame_offset = 0u64;

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
                let num_frames = samples.len() / num_channels;

                if num_frames == 0 {
                    continue;
                }

                for frame in 0..num_frames {
                    let global_frame = current_frame_offset + frame as u64;
                    let bucket = ((global_frame as u128 * max_length as u128)
                        / total_frames as u128) as usize;
                    let bucket = bucket.min(max_length - 1);

                    for ch in 0..num_channels.min(channels) {
                        if ch < channels {
                            let val = samples[frame * num_channels + ch].abs();
                            if val > peaks[ch][bucket] {
                                peaks[ch][bucket] = val;
                            }
                        }
                    }
                }

                current_frame_offset += num_frames as u64;
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

    Ok(peaks)
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
        let path =
            std::env::temp_dir().join(format!("fastcat-waveform-test-{}.wav", std::process::id()));
        write_mono_pcm_wav(&path, &[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]).unwrap();

        let peaks = extract_peaks(&path, 5).unwrap();
        let _ = std::fs::remove_file(path);

        assert_eq!(peaks.len(), 1);
        assert_eq!(peaks[0].len(), 5);
        let expected = vec![0.2f32, 0.4, 0.6, 0.8, 1.0];
        for (a, b) in peaks[0].iter().zip(expected.iter()) {
            assert!((a - b).abs() < 1e-4, "peak mismatch: {} vs {}", a, b);
        }
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
