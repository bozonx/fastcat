use std::path::Path;
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use parking_lot::{Condvar, Mutex};

use crate::audio::resample::{
    make_sinc_resampler, planar_to_interleaved, resample_planar_cached, resample_planar_with_speed,
    RESAMPLER_CHUNK_SIZE,
};
use crate::audio::shared::{
    decoded_cache_key, AudioRenderTarget, AudioShared, AudioSourceMetadata, CachedAudioDecoder,
    MAX_CACHEABLE_FILE_BYTES,
};

/// Fraction of the current source chunk tolerated as scheduling jitter before
/// the streaming decoder treats the request as a discontinuity and reseeks.
/// Reversed clips bypass this and always reseek (see `decode_symphonia_chunk`).
const SEEK_TOLERANCE_CHUNK_FRACTION: f64 = 0.25;
const SEEK_TOLERANCE_MIN_SEC: f64 = 0.001;

pub(crate) fn probe_audio_source_metadata(path: &str) -> Result<AudioSourceMetadata> {
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let file = std::fs::File::open(path)
        .with_context(|| format!("failed to open audio file for metadata: {}", path))?;
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
        .context("failed to probe media metadata")?;

    let track = probed
        .format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL)
        .ok_or_else(|| anyhow!("no active audio track found"))?;
    let sample_rate = track
        .codec_params
        .sample_rate
        .ok_or_else(|| anyhow!("audio track has no declared sample rate"))?;
    let channels = track
        .codec_params
        .channels
        .map(|channels| channels.count())
        .unwrap_or(1)
        .max(1);

    Ok(AudioSourceMetadata {
        sample_rate,
        channels,
    })
}

pub(crate) fn cached_audio_source_metadata(
    path: &str,
    shared: &Arc<(Mutex<AudioShared>, Condvar)>,
) -> Result<AudioSourceMetadata> {
    if let Some(metadata) = shared.0.lock().source_metadata_cache.get(path).copied() {
        return Ok(metadata);
    }

    let metadata = probe_audio_source_metadata(path)?;
    let mut state = shared.0.lock();
    Ok(*state
        .source_metadata_cache
        .entry(path.to_string())
        .or_insert(metadata))
}

pub(crate) fn decode_entire_file_symphonia(
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
                let duration = audio_buf.frames() as u64;
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
pub(crate) fn decode_symphonia_chunk(
    layer_id: &str,
    path: &str,
    source_start_sec: f64,
    timeline_duration_sec: f64,
    speed: f64,
    target_sample_rate: u32,
    output_channels: usize,
    reverse: bool,
    shared: &Arc<(Mutex<AudioShared>, Condvar)>,
) -> Result<Vec<f32>> {
    let mut decoder_state = {
        let mut state = shared.0.lock();
        state.decoders.remove(layer_id)
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
            resampler_primed: false,
            last_decode_end_sec: 0.0,
            resample_remainder: vec![Vec::new(); channels],
            resample_output_remainder: Vec::new(),
        });
    }

    let mut state_val = decoder_state.unwrap();

    let source_advance_sec = timeline_duration_sec * speed;
    let seek_tolerance_sec =
        (source_advance_sec.abs() * SEEK_TOLERANCE_CHUNK_FRACTION).max(SEEK_TOLERANCE_MIN_SEC);
    let needs_seek = reverse
        || source_start_sec < state_val.last_decode_end_sec - seek_tolerance_sec
        || source_start_sec > state_val.last_decode_end_sec + seek_tolerance_sec;
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
        if state_val.resampler.is_some()
            && (state_val.last_resample_ratio - current_ratio).abs() <= 1e-6
        {
            if let Some(r) = state_val.resampler.as_mut() {
                use rubato::Resampler;
                r.reset();
            }
        } else {
            state_val.resampler = None;
        }
        state_val.resample_remainder = vec![Vec::new(); state_val.channels];
        state_val.resample_output_remainder.clear();
        state_val.last_resample_ratio = current_ratio;
        state_val.resampler_primed = false;

        let actual_sec = {
            let t = state_val.time_base.calc_time(seeked_to.actual_ts);
            t.seconds as f64 + t.frac
        };
        let (decode_start_sec, discard_frames) = if actual_sec <= source_start_sec {
            let discard_sec = source_start_sec - actual_sec;
            let discard_frames = (discard_sec * state_val.source_rate as f64).floor() as usize;
            (actual_sec, discard_frames)
        } else {
            (actual_sec, 0usize)
        };
        (decode_start_sec, discard_frames)
    } else {
        (source_start_sec, 0usize)
    };
    let mut discard_frames_remaining = discard_frames_remaining;

    let resampling_active =
        !((current_ratio - 1.0).abs() < 1e-6 && state_val.source_rate == target_sample_rate);
    if state_val.resampler.is_some() && (state_val.last_resample_ratio - current_ratio).abs() > 1e-6
    {
        state_val.resampler = None;
        state_val.resample_remainder = vec![Vec::new(); state_val.channels];
        state_val.resample_output_remainder.clear();
        state_val.resampler_primed = false;
    }
    state_val.last_resample_ratio = current_ratio;

    let mut prime_source_frames = 0usize;
    if resampling_active {
        if state_val.resampler.is_none() {
            state_val.resampler = Some(Box::new(make_sinc_resampler(
                current_ratio,
                state_val.channels,
            )?));
            state_val.resample_remainder = vec![Vec::new(); state_val.channels];
            state_val.resampler_primed = false;
        }
        if !state_val.resampler_primed {
            let delay = {
                use rubato::Resampler;
                state_val
                    .resampler
                    .as_ref()
                    .map(|r| r.output_delay())
                    .unwrap_or(0)
            };
            prime_source_frames =
                (delay as f64 / current_ratio).ceil() as usize + RESAMPLER_CHUNK_SIZE + 1;
        }
    }

    let source_frames_needed = (timeline_duration_sec * speed * state_val.source_rate as f64)
        .round() as usize
        + prime_source_frames;

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
                let duration = audio_buf.frames() as u64;
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
                    state_val.resample_output_remainder.clear();
                    state_val.last_resample_ratio = current_ratio;
                    state_val.resampler_primed = false;
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

    let target_frames = (timeline_duration_sec * target_sample_rate as f64).round() as usize;
    let target_samples = target_frames * output_channels;

    if collected_frames == 0 {
        state_val.last_decode_end_sec = source_start_sec;
        {
            let mut state = shared.0.lock();
            state.decoders.insert(layer_id.to_string(), state_val);
        }
        return Ok(vec![0.0f32; target_samples]);
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
    let drop_delay_samples = if resampling_active && !state_val.resampler_primed {
        let delay_frames = {
            use rubato::Resampler;
            state_val
                .resampler
                .as_ref()
                .map(|r| r.output_delay())
                .unwrap_or(0)
        };
        delay_frames * output_channels
    } else {
        0
    };

    let interleaved = planar_to_interleaved(&resampled, output_channels);

    let mut combined = std::mem::take(&mut state_val.resample_output_remainder);
    combined.extend_from_slice(&interleaved);
    if drop_delay_samples > 0 {
        if combined.len() > drop_delay_samples {
            combined.drain(0..drop_delay_samples);
        } else {
            combined.clear();
        }
    }
    let out = if combined.len() >= target_samples {
        state_val.resample_output_remainder = combined.split_off(target_samples);
        combined
    } else {
        combined.resize(target_samples, 0.0);
        combined
    };
    state_val.resampler_primed = true;

    let logical_source_end_sec = source_start_sec + source_advance_sec;
    state_val.last_decode_end_sec = if collected_frames < source_frames_needed {
        source_start_sec
    } else {
        logical_source_end_sec
    };

    {
        let mut state = shared.0.lock();
        state.decoders.insert(layer_id.to_string(), state_val);
    }
    Ok(out)
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn decode_audio_chunk(
    layer_id: &str,
    path: &str,
    source_start_sec: f64,
    timeline_duration_sec: f64,
    speed: f64,
    target: AudioRenderTarget,
    reverse: bool,
    shared: &Arc<(Mutex<AudioShared>, Condvar)>,
) -> Result<Vec<f32>> {
    let sample_rate = target.sample_rate;
    let output_channels = target.channels;
    let source_start_sec = if source_start_sec.is_finite() {
        source_start_sec.max(0.0)
    } else {
        0.0
    };
    let timeline_duration_sec = if timeline_duration_sec.is_finite() {
        timeline_duration_sec.max(0.0)
    } else {
        0.0
    };
    let is_cacheable = (speed - 1.0).abs() <= 1e-6;
    let cache_key = decoded_cache_key(path, sample_rate, output_channels);

    let cached_samples = if is_cacheable {
        let mut state = shared.0.lock();
        state.decoded_cache.get(&cache_key).cloned()
    } else {
        None
    };

    if is_cacheable {
        let cached_samples = match cached_samples {
            Some(samples) => Some(samples),
            None => {
                let file_size = {
                    let mut state = shared.0.lock();
                    match state.file_size_cache.get(path) {
                        Some(&size) => size,
                        None => {
                            let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
                            state.file_size_cache.insert(path.to_string(), size);
                            size
                        }
                    }
                };
                let source_metadata = cached_audio_source_metadata(path, shared)?;
                if file_size > 0
                    && file_size < MAX_CACHEABLE_FILE_BYTES
                    && source_metadata.sample_rate == sample_rate
                {
                    log::info!(
                        "[audio] caching entire file in memory: {} ({} Hz, {} ch)",
                        path,
                        source_metadata.sample_rate,
                        source_metadata.channels,
                    );
                    let decoded = decode_entire_file_symphonia(path, sample_rate, output_channels)?;
                    let shared_samples = Arc::new(decoded);
                    let mut state = shared.0.lock();
                    state.cache_decoded(cache_key, shared_samples.clone());
                    Some(shared_samples)
                } else {
                    None
                }
            }
        };

        if let Some(cached_samples) = cached_samples {
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
    }

    decode_symphonia_chunk(
        layer_id,
        path,
        source_start_sec,
        timeline_duration_sec,
        speed,
        sample_rate,
        output_channels,
        reverse,
        shared,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::shared::AudioShared;

    fn write_temp_f32_wav(sample_rate: u32, channels: usize, frames: usize) -> std::path::PathBuf {
        use std::io::{Seek, Write};
        let mut path = std::env::temp_dir();
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        path.push(format!("fastcat-audio-test-{unique}.wav"));

        let mut file = std::fs::File::create(&path).unwrap();
        let bits_per_sample = 32u16;
        let bytes_per_sample = (bits_per_sample / 8) as u32;
        let data_size = 0u32;
        let riff_size = 36u32.saturating_add(data_size);
        file.write_all(b"RIFF").unwrap();
        file.write_all(&riff_size.to_le_bytes()).unwrap();
        file.write_all(b"WAVE").unwrap();
        file.write_all(b"fmt ").unwrap();
        file.write_all(&16u32.to_le_bytes()).unwrap();
        file.write_all(&3u16.to_le_bytes()).unwrap();
        file.write_all(&(channels as u16).to_le_bytes()).unwrap();
        file.write_all(&sample_rate.to_le_bytes()).unwrap();
        let byte_rate = sample_rate
            .saturating_mul(channels as u32)
            .saturating_mul(bytes_per_sample);
        file.write_all(&byte_rate.to_le_bytes()).unwrap();
        let block_align = (channels as u16).saturating_mul(bytes_per_sample as u16);
        file.write_all(&block_align.to_le_bytes()).unwrap();
        file.write_all(&bits_per_sample.to_le_bytes()).unwrap();
        file.write_all(b"data").unwrap();
        file.write_all(&data_size.to_le_bytes()).unwrap();

        for frame in 0..frames {
            let sample =
                ((frame as f32 / sample_rate as f32) * 440.0 * std::f32::consts::TAU).sin() * 0.25;
            for _ in 0..channels {
                file.write_all(&sample.to_le_bytes()).unwrap();
            }
        }
        let data_size = (frames * channels * std::mem::size_of::<f32>()) as u32;
        file.seek(std::io::SeekFrom::Start(4)).unwrap();
        file.write_all(&(36u32 + data_size).to_le_bytes()).unwrap();
        file.seek(std::io::SeekFrom::Start(40)).unwrap();
        file.write_all(&data_size.to_le_bytes()).unwrap();

        path
    }

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
        let decoded =
            decode_symphonia_chunk("layer-1", path, 0.2, 0.5, 1.0, 48000, 2, false, &shared);
        assert!(
            decoded.is_ok(),
            "Failed to decode chunk: {:?}",
            decoded.err()
        );
        let samples = decoded.unwrap();
        let expected = (0.5f64 * 48000.0).round() as usize * 2;
        assert_eq!(samples.len(), expected, "chunk length must be exact");
    }

    #[test]
    fn rate_mismatched_small_file_streams_instead_of_full_cache() {
        let path = write_temp_f32_wav(8000, 1, 8000);
        let path_str = path.to_string_lossy().to_string();
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));

        let target = AudioRenderTarget::monitor(48000, 2);
        let decoded = decode_audio_chunk(
            "layer-8k", &path_str, 0.0, 0.05, 1.0, target, false, &shared,
        )
        .unwrap();

        assert_eq!(decoded.len(), (0.05f64 * 48000.0).round() as usize * 2);
        let state = shared.0.lock();
        assert_eq!(
            state.source_metadata_cache.get(&path_str),
            Some(&AudioSourceMetadata {
                sample_rate: 8000,
                channels: 1,
            })
        );
        assert!(
            state.decoded_cache.is_empty(),
            "rate-mismatched files must not use full-file cache on the producer thread"
        );
        drop(state);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn streaming_resampler_drops_initial_filter_delay() {
        let path = write_temp_f32_wav(8000, 1, 8000);
        let path_str = path.to_string_lossy().to_string();
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));

        let chunk = decode_symphonia_chunk(
            "delay-layer",
            &path_str,
            0.0,
            0.05,
            1.0,
            48000,
            2,
            false,
            &shared,
        )
        .unwrap();
        let full = decode_entire_file_symphonia(&path_str, 48000, 2).unwrap();

        let compare_len = chunk.len().min(full.len()).min(512);
        let mean_abs_diff = chunk[..compare_len]
            .iter()
            .zip(full[..compare_len].iter())
            .map(|(a, b)| (*a - *b).abs())
            .sum::<f32>()
            / compare_len as f32;

        assert!(
            mean_abs_diff < 0.03,
            "streaming first chunk should align with whole-file resample, mean abs diff {mean_abs_diff}"
        );

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn decode_chunk_primes_resampler_no_tail_silence_after_seek() {
        let path = "../test/fixtures/media/sample-1s-audio.mp3";
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        let chunk =
            decode_symphonia_chunk("seek-layer", path, 0.1, 0.05, 1.0, 44100, 2, false, &shared)
                .expect("decode chunk");
        let frames = chunk.len() / 2;
        let expected_frames = (0.05f64 * 44100.0).round() as usize;
        assert_eq!(frames, expected_frames, "chunk length must be exact");

        let state = shared.0.lock();
        let decoder = state.decoders.get("seek-layer").expect("decoder cached");
        assert!(decoder.resampler_primed, "resampler should be primed");
        assert!(
            !decoder.resample_output_remainder.is_empty(),
            "priming should leave surplus resampled audio for the next chunk"
        );
    }

    #[test]
    fn decode_chunk_reverse_resampled_stays_full() {
        let path = "../test/fixtures/media/sample-1s-audio.mp3";
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        let expected_frames = (0.05f64 * 44100.0).round() as usize;
        for i in 0..3 {
            let src = 0.5 - i as f64 * 0.05;
            let chunk =
                decode_symphonia_chunk("rev-layer", path, src, 0.05, 1.0, 44100, 2, true, &shared)
                    .expect("decode reverse chunk");
            assert_eq!(
                chunk.len() / 2,
                expected_frames,
                "reverse chunk exact length"
            );
            let state = shared.0.lock();
            let decoder = state.decoders.get("rev-layer").expect("decoder cached");
            assert!(
                decoder.resampler_primed,
                "reverse resampler should be primed"
            );
            assert!(
                !decoder.resample_output_remainder.is_empty(),
                "reverse priming should leave surplus resampled audio"
            );
        }
    }

    #[test]
    fn decode_chunk_tail_eof_keeps_cursor_on_clamped_source_start() {
        let path = "../test/fixtures/media/sample-1s-audio.mp3";
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        let source_start = 0.999;
        let chunk = decode_symphonia_chunk(
            "tail-layer",
            path,
            source_start,
            0.05,
            1.0,
            44100,
            2,
            false,
            &shared,
        )
        .expect("decode tail chunk");
        let expected_samples = (0.05f64 * 44100.0).round() as usize * 2;
        assert_eq!(
            chunk.len(),
            expected_samples,
            "tail chunk length must be exact"
        );

        let state = shared.0.lock();
        let decoder = state.decoders.get("tail-layer").expect("decoder cached");
        assert!(
            (decoder.last_decode_end_sec - source_start).abs() < 1e-9,
            "EOF tail cursor should stay at clamped source start"
        );
    }
}
