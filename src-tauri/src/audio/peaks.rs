use std::path::Path;
use anyhow::{Result, Context, anyhow};
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::audio::SampleBuffer;

/// Extracts audio peaks from a media file by streamingly decoding it and downsampling
/// the absolute amplitude values into a fixed-size buffer per channel.
pub fn extract_peaks(path: &Path, max_length: usize) -> Result<Vec<Vec<f32>>> {
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
    let channels = track.codec_params.channels.map(|c| c.count()).unwrap_or(2);
    let sample_rate = track.codec_params.sample_rate.unwrap_or(48000);

    let file_duration_estimate = track.codec_params.n_frames
        .map(|f| f as f64)
        .unwrap_or_else(|| 60.0 * sample_rate as f64);
    let mut total_frames_estimate = file_duration_estimate.max(1.0) as u64;

    let mut peaks = vec![vec![0.0f32; max_length]; channels];
    let mut current_frame_offset = 0u64;

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(symphonia::core::errors::Error::IoError(ref err))
                if err.kind() == std::io::ErrorKind::UnexpectedEof => { break; }
            Err(err) => return Err(err).context("failed to read next packet"),
        };

        if packet.track_id() != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(audio_buf) => {
                let spec = *audio_buf.spec();
                let duration = audio_buf.capacity() as u64;
                let mut sample_buf = SampleBuffer::<f32>::new(duration, spec);
                sample_buf.copy_interleaved_ref(audio_buf);

                let samples = sample_buf.samples();
                let num_channels = spec.channels.count();
                let num_frames = samples.len() / num_channels;

                if num_frames == 0 { continue; }

                let packet_end_frame = current_frame_offset + num_frames as u64;
                if packet_end_frame > total_frames_estimate {
                    let old_estimate = total_frames_estimate;
                    total_frames_estimate = packet_end_frame;
                    let ratio = old_estimate as f64 / total_frames_estimate as f64;

                    for ch in 0..channels {
                        let mut new_peaks = vec![0.0f32; max_length];
                        for b in 0..max_length {
                            let new_b = ((b as f64 * ratio).floor() as usize).min(max_length - 1);
                            if peaks[ch][b] > new_peaks[new_b] {
                                new_peaks[new_b] = peaks[ch][b];
                            }
                        }
                        peaks[ch] = new_peaks;
                    }
                }

                for frame in 0..num_frames {
                    let global_frame = current_frame_offset + frame as u64;
                    let bucket = ((global_frame as f64 / total_frames_estimate as f64) * max_length as f64).floor() as usize;
                    let bucket = bucket.min(max_length - 1);

                    for ch in 0..num_channels {
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
                if err.kind() == std::io::ErrorKind::UnexpectedEof => { break; }
            Err(symphonia::core::errors::Error::DecodeError(_)) => { continue; }
            Err(err) => return Err(err).context("failed to decode packet"),
        }
    }

    for ch in 0..channels {
        for val in peaks[ch].iter_mut() {
            *val = (*val * 10000.0).round() / 10000.0;
        }
    }

    Ok(peaks)
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
}

