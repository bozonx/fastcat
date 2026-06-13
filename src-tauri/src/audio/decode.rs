use std::path::Path;
use std::process::Command;
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use parking_lot::{Condvar, Mutex};

use crate::audio::resample::{
    make_sinc_resampler, planar_to_interleaved, resample_flush_cached, resample_planar_cached,
    resample_planar_with_speed, RESAMPLER_CHUNK_SIZE,
};
use crate::audio::shared::{
    find_audio_track, AudioRenderTarget, AudioShared, AudioSourceMetadata, AudioWindow,
    CachedAudioDecoder, REFILL_MARGIN_SEC, WINDOW_SEC,
};

/// Fraction of the current source chunk tolerated as scheduling jitter before
/// the streaming decoder treats the request as a discontinuity and reseeks.
/// Reversed clips bypass this and always reseek (see `decode_symphonia_chunk`).
const SEEK_TOLERANCE_CHUNK_FRACTION: f64 = 0.25;
const SEEK_TOLERANCE_MIN_SEC: f64 = 0.001;

fn open_symphonia_format(
    path: &str,
    context: &str,
) -> Result<Box<dyn symphonia::core::formats::FormatReader>> {
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let file = std::fs::File::open(path)
        .with_context(|| format!("failed to open audio file for {context}: {path}"))?;
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
        .with_context(|| format!("failed to probe media format for {context}: {path}"))?;

    Ok(probed.format)
}

#[allow(dead_code)]
pub(crate) fn probe_audio_source_metadata(path: &str) -> Result<AudioSourceMetadata> {
    let format = open_symphonia_format(path, "metadata")?;

    let track =
        find_audio_track(format.tracks()).ok_or_else(|| anyhow!("no active audio track found"))?;
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

/// Returns the audio source metadata from the cache or probes it.
/// Note: `source_metadata_cache` is keyed solely by the file path (without channel count
/// or sample rate), which is intentional because the inherent audio source metadata
/// (original sample rate and channels) is a property of the source file itself
/// and does not depend on the output audio device's sample rate or channel count.
#[allow(dead_code)]
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

/// Decodes a BOUNDED time range `[start_sec, start_sec + duration_sec)` of a file
/// to interleaved f32 at the target rate/channels — never the whole file. This is
/// the off-thread fill for the per-layer look-ahead window: memory is bounded by
/// `duration_sec` regardless of how large the source is (tens of GB are fine).
///
/// Seeks accurately to `start_sec` and discards the sub-frame remainder so the
/// returned buffer begins exactly at `start_sec`, then stops once `duration_sec`
/// worth of source frames have been collected. Resampling reuses
/// `resample_planar_with_speed` (speed 1.0), which drops the resampler group delay,
/// so the window has NO leading silence.
pub(crate) fn decode_range_symphonia(
    path: &str,
    start_sec: f64,
    duration_sec: f64,
    target_sample_rate: u32,
    output_channels: usize,
) -> Result<Vec<f32>> {
    use symphonia::core::codecs::DecoderOptions;

    let start_sec = start_sec.max(0.0);
    let duration_sec = duration_sec.max(0.0);

    let mut format = open_symphonia_format(path, "decode")?;
    let track =
        find_audio_track(format.tracks()).ok_or_else(|| anyhow!("no active audio track found"))?;

    let mut decoder = match symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
    {
        Ok(decoder) => decoder,
        Err(_) if track.codec_params.codec == symphonia::core::codecs::CODEC_TYPE_OPUS => {
            log::warn!("[audio] symphonia cannot decode Opus; falling back to ffmpeg: {path}");
            return decode_range_ffmpeg(
                path,
                start_sec,
                duration_sec,
                target_sample_rate,
                output_channels,
            )
            .context("failed to decode Opus audio via ffmpeg");
        }
        Err(err) => return Err(err).context("failed to create decoder"),
    };

    let track_id = track.id;
    let source_rate = track.codec_params.sample_rate.unwrap_or(target_sample_rate);
    let time_base = track
        .codec_params
        .time_base
        .unwrap_or(symphonia::core::units::TimeBase::new(1, source_rate.max(1)));
    let declared_channels = track.codec_params.channels.map(|c| c.count()).unwrap_or(0);
    let mut channels = declared_channels.max(1);

    // Seek to the window start (only when not at 0) and compute how many decoded
    // source frames to discard so the buffer begins exactly at `start_sec`.
    let mut discard_frames_remaining = if start_sec > 0.0 {
        let seeked_to = match format.seek(
            symphonia::core::formats::SeekMode::Accurate,
            symphonia::core::formats::SeekTo::Time {
                time: symphonia::core::units::Time {
                    seconds: start_sec.floor() as u64,
                    frac: start_sec.fract(),
                },
                track_id: Some(track_id),
            },
        ) {
            Ok(seeked_to) => seeked_to,
            // Seeking past the end yields an empty window — the caller treats this
            // region as silence (the chunk it serves zero-fills the tail).
            Err(error) if is_audio_seek_past_end(&error) => return Ok(Vec::new()),
            Err(error) => return Err(error).context("failed to seek in format reader"),
        };
        decoder.reset();
        let actual_sec = {
            let t = time_base.calc_time(seeked_to.actual_ts);
            t.seconds as f64 + t.frac
        };
        if actual_sec <= start_sec {
            ((start_sec - actual_sec) * source_rate as f64).floor() as usize
        } else {
            0
        }
    } else {
        0
    };

    // Stop once this many POST-discard source frames are collected: this is what
    // bounds the decode (and memory) to `duration_sec` regardless of file length.
    let wanted_source_frames = (duration_sec * source_rate as f64).ceil() as usize;
    let mut planar_buffers = vec![Vec::new(); channels];
    let mut collected_frames = 0usize;

    'outer: loop {
        if collected_frames >= wanted_source_frames {
            break;
        }
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
                    if discard_frames_remaining > 0 {
                        discard_frames_remaining -= 1;
                        continue;
                    }
                    if collected_frames >= wanted_source_frames {
                        break 'outer;
                    }
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

    if collected_frames == 0 {
        return Ok(Vec::new());
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

fn decode_range_ffmpeg(
    path: &str,
    start_sec: f64,
    duration_sec: f64,
    target_sample_rate: u32,
    output_channels: usize,
) -> Result<Vec<f32>> {
    let channels = output_channels.max(1).to_string();
    let sample_rate = target_sample_rate.max(1).to_string();
    // `-ss` BEFORE `-i` is fast (input) seeking; `-t` bounds the decoded duration,
    // so ffmpeg never reads the whole file either.
    let ss = format!("{:.6}", start_sec.max(0.0));
    let t = format!("{:.6}", duration_sec.max(0.0));
    let output = Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-ss",
            &ss,
            "-i",
            path,
            "-t",
            &t,
            "-vn",
            "-f",
            "f32le",
            "-ac",
            &channels,
            "-ar",
            &sample_rate,
            "pipe:1",
        ])
        .output()
        .with_context(|| format!("failed to run ffmpeg for audio decode: {path}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!(
            "ffmpeg audio decode failed with status {}: {}",
            output.status,
            stderr.trim()
        ));
    }

    let mut samples = Vec::with_capacity(output.stdout.len() / std::mem::size_of::<f32>());
    for chunk in output.stdout.chunks_exact(std::mem::size_of::<f32>()) {
        samples.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }

    Ok(samples)
}

pub(crate) struct DecodeSymphoniaChunkParams<'a> {
    pub layer_id: &'a str,
    pub path: &'a str,
    pub source_start_sec: f64,
    pub timeline_duration_sec: f64,
    pub speed: f64,
    pub target_sample_rate: u32,
    pub output_channels: usize,
    pub reverse: bool,
    pub shared: &'a Arc<(Mutex<AudioShared>, Condvar)>,
}

pub(crate) fn decode_symphonia_chunk(params: DecodeSymphoniaChunkParams<'_>) -> Result<Vec<f32>> {
    let DecodeSymphoniaChunkParams {
        layer_id,
        path,
        source_start_sec,
        timeline_duration_sec,
        speed,
        target_sample_rate,
        output_channels,
        reverse,
        shared,
    } = params;
    let target_frames =
        (timeline_duration_sec.max(0.0) * target_sample_rate as f64).round() as usize;
    let target_samples = target_frames * output_channels;
    let mut decoder_state = {
        let mut state = shared.0.lock();
        state.decoders.remove(layer_id)
    };

    // Drop a cached decoder whose source path no longer matches this layer (proxy
    // on/off, media replace under the same layer id): reusing it would keep decoding
    // the OLD file. A fresh decoder for the new path is built below.
    if decoder_state
        .as_ref()
        .is_some_and(|state| state.path != path)
    {
        decoder_state = None;
    }

    if decoder_state.is_none() {
        use symphonia::core::codecs::DecoderOptions;

        let format = open_symphonia_format(path, "chunk decode")?;
        let track = find_audio_track(format.tracks())
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
            path: path.to_string(),
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

    let mut state_val =
        decoder_state.ok_or_else(|| anyhow!("decoder state missing for layer {}", layer_id))?;

    let source_advance_sec = timeline_duration_sec * speed;
    let seek_tolerance_sec =
        (source_advance_sec.abs() * SEEK_TOLERANCE_CHUNK_FRACTION).max(SEEK_TOLERANCE_MIN_SEC);
    let needs_seek = reverse
        || source_start_sec < state_val.last_decode_end_sec - seek_tolerance_sec
        || source_start_sec > state_val.last_decode_end_sec + seek_tolerance_sec;
    let current_ratio = target_sample_rate as f64 / (state_val.source_rate as f64 * speed);

    let (_actual_sec, discard_frames_remaining) = if needs_seek {
        let seeked_to = match state_val.format.seek(
            symphonia::core::formats::SeekMode::Accurate,
            symphonia::core::formats::SeekTo::Time {
                time: symphonia::core::units::Time {
                    seconds: source_start_sec.floor() as u64,
                    frac: source_start_sec.fract(),
                },
                track_id: Some(state_val.track_id),
            },
        ) {
            Ok(seeked_to) => seeked_to,
            Err(error) if is_audio_seek_past_end(&error) => {
                state_val.last_decode_end_sec = source_start_sec;
                let mut state = shared.0.lock();
                state.decoders.insert(layer_id.to_string(), state_val);
                return Ok(vec![0.0f32; target_samples]);
            }
            Err(error) => return Err(error).context("failed to seek in format reader"),
        };

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

    if resampling_active && state_val.resampler.is_none() {
        state_val.resampler = Some(Box::new(make_sinc_resampler(
            current_ratio,
            state_val.channels,
        )?));
        state_val.resample_remainder = vec![Vec::new(); state_val.channels];
        state_val.resampler_primed = false;
    }

    // Source frames spanning this chunk's timeline duration. Used only to size the
    // per-iteration decode batch and to advance the logical decode cursor — the
    // amount we actually decode is driven by how much OUTPUT we still need.
    let chunk_source_frames =
        (timeline_duration_sec * speed * state_val.source_rate as f64).round() as usize;

    // Output already buffered from previous chunks' resampler surplus. The decode
    // loop tops this up to a full chunk; the surplus is carried to the next chunk.
    let mut combined = std::mem::take(&mut state_val.resample_output_remainder);

    // Decode source in blocks and resample until we have a full chunk of OUTPUT
    // (or hit end-of-stream). This is the core invariant that prevents periodic
    // silent chunks: `SincFixedIn` only emits output once a full input block
    // accumulates, so for an upsampled source (rate well below the device rate,
    // e.g. an 8 kHz clip on a 48 kHz device → only ~400 source frames per 50 ms
    // chunk) a block fills just once every few chunks. Decoding a FIXED per-chunk
    // source amount and zero-padding the shortfall therefore dropped a fully-silent
    // 50 ms chunk in every inter-burst valley (heard as glitchy/"fast" playback
    // until the background precache swapped in the gap-free whole-file decode).
    // Driving the decode by an OUTPUT target instead guarantees every chunk is
    // filled; the resampler's variable per-block surplus is carried in `combined`
    // so the source read-ahead stays bounded (≈ one block) rather than growing.
    let mut total_collected = 0usize;
    let mut hit_eof = false;
    // Drop the resampler's group-delay region exactly once, on the first resample
    // after a (re)prime, so the first emitted chunk isn't short by the resampler
    // latency. Queried after the first resample (the resampler may have just been
    // created) and carried across batches in case the first batch is shorter than
    // the delay.
    let mut needs_delay_drop = resampling_active && !state_val.resampler_primed;
    let mut pending_delay_samples = 0usize;

    while combined.len() < target_samples {
        // Batch large enough to cross at least one resampler input block so each
        // iteration makes guaranteed progress (covers the chunk span plus read-ahead).
        let batch_target = chunk_source_frames.max(RESAMPLER_CHUNK_SIZE);
        let mut planar_buffers = vec![Vec::new(); state_val.channels];
        let mut batch_collected = 0usize;
        let mut batch_full = false;

        while !batch_full {
            let packet = match state_val.format.next_packet() {
                Ok(packet) => packet,
                Err(symphonia::core::errors::Error::IoError(ref err))
                    if err.kind() == std::io::ErrorKind::UnexpectedEof =>
                {
                    hit_eof = true;
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
                            planar_buffers.push(vec![0.0; batch_collected]);
                        }
                        state_val.channels = num_channels;
                        state_val.resampler = None;
                        state_val.resample_remainder = vec![Vec::new(); state_val.channels];
                        state_val.last_resample_ratio = current_ratio;
                        // Channel layout changed mid-stream: the old resampler and any
                        // already-collected output are invalid. Restart this chunk's
                        // accumulation cleanly and re-prime.
                        combined.clear();
                        needs_delay_drop = resampling_active;
                        pending_delay_samples = 0;
                    }

                    for frame in 0..num_frames {
                        if discard_frames_remaining > 0 {
                            discard_frames_remaining -= 1;
                            continue;
                        }
                        if batch_collected >= batch_target {
                            batch_full = true;
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
                        batch_collected += 1;
                    }
                }
                Err(symphonia::core::errors::Error::IoError(ref err))
                    if err.kind() == std::io::ErrorKind::UnexpectedEof =>
                {
                    hit_eof = true;
                    break;
                }
                Err(symphonia::core::errors::Error::DecodeError(err)) => {
                    log::warn!("[audio] symphonia chunk decode error: {:?}", err);
                    continue;
                }
                Err(err) => return Err(err).context("failed to decode packet"),
            }
        }

        if batch_collected == 0 {
            hit_eof = true;
            break;
        }
        total_collected += batch_collected;

        let resampled =
            resample_planar_cached(crate::audio::resample::ResamplePlanarCachedParams {
                input: planar_buffers,
                source_rate: state_val.source_rate,
                target_rate: target_sample_rate,
                speed,
                num_channels: state_val.channels,
                cached_resampler: &mut state_val.resampler,
                remainder: &mut state_val.resample_remainder,
            })?;
        if needs_delay_drop {
            use rubato::Resampler;
            pending_delay_samples = state_val
                .resampler
                .as_ref()
                .map(|r| r.output_delay())
                .unwrap_or(0)
                * output_channels;
            needs_delay_drop = false;
        }

        let mut interleaved = planar_to_interleaved(&resampled, output_channels);
        if pending_delay_samples > 0 {
            let drop = pending_delay_samples.min(interleaved.len());
            interleaved.drain(0..drop);
            pending_delay_samples -= drop;
        }
        combined.extend_from_slice(&interleaved);

        if hit_eof {
            break;
        }
    }

    // End-of-stream flush: the streaming resampler carries a sub-block input
    // remainder and trails the signal by its group delay. Without draining both at
    // EOF the clip's final ~block-plus-delay of audio would be replaced by the
    // zero-padding below (heard as the tail cutting abruptly to silence). Only
    // meaningful while actually resampling and still short of a full chunk.
    if hit_eof && resampling_active && combined.len() < target_samples {
        if needs_delay_drop {
            // This session never emitted a resampled block (clip shorter than one
            // input block), so its initial priming delay was never dropped: schedule
            // it to be dropped from the flushed output.
            use rubato::Resampler;
            pending_delay_samples = state_val
                .resampler
                .as_ref()
                .map(|r| r.output_delay())
                .unwrap_or(0)
                * output_channels;
        }
        let flushed = resample_flush_cached(crate::audio::resample::ResampleFlushCachedParams {
            source_rate: state_val.source_rate,
            target_rate: target_sample_rate,
            speed,
            num_channels: state_val.channels,
            cached_resampler: &mut state_val.resampler,
            remainder: &mut state_val.resample_remainder,
        })?;
        let mut interleaved = planar_to_interleaved(&flushed, output_channels);
        if pending_delay_samples > 0 {
            let drop = pending_delay_samples.min(interleaved.len());
            interleaved.drain(0..drop);
        }
        combined.extend_from_slice(&interleaved);
    }

    if total_collected == 0 && combined.is_empty() {
        state_val.last_decode_end_sec = source_start_sec;
        {
            let mut state = shared.0.lock();
            state.decoders.insert(layer_id.to_string(), state_val);
        }
        return Ok(vec![0.0f32; target_samples]);
    }

    let out = if combined.len() >= target_samples {
        state_val.resample_output_remainder = combined.split_off(target_samples);
        combined
    } else {
        combined.resize(target_samples, 0.0);
        combined
    };
    state_val.resampler_primed = true;

    // Advance the logical cursor by exactly one chunk on a complete decode. The
    // loop may have read AHEAD of this (its surplus is buffered in
    // `resample_output_remainder`), so the cursor tracks the logical timeline
    // position, not the physical reader position — the next sequential chunk's
    // `source_start` then matches and skips a reseek. On EOF the source ran out
    // before a full chunk, so leave the cursor put (the producer's next advance
    // will exceed the seek tolerance and reseek, as before).
    let logical_source_end_sec = source_start_sec + source_advance_sec;
    state_val.last_decode_end_sec = if hit_eof {
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

pub(crate) struct DecodeAudioChunkParams<'a> {
    pub layer_id: &'a str,
    pub path: &'a str,
    pub source_start_sec: f64,
    pub timeline_duration_sec: f64,
    pub speed: f64,
    pub target: AudioRenderTarget,
    pub reverse: bool,
    pub shared: &'a Arc<(Mutex<AudioShared>, Condvar)>,
}

pub(crate) fn decode_audio_chunk(params: DecodeAudioChunkParams<'_>) -> Result<Vec<f32>> {
    let DecodeAudioChunkParams {
        layer_id,
        path,
        source_start_sec,
        timeline_duration_sec,
        speed,
        target,
        reverse,
        shared,
    } = params;
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
    // Only forward, 1× clips are served from a window; reverse / speed-shifted
    // clips always stream (the window is a contiguous forward buffer).
    let is_cacheable = (speed - 1.0).abs() <= 1e-6 && !reverse;

    let stream = || {
        decode_symphonia_chunk(DecodeSymphoniaChunkParams {
            layer_id,
            path,
            source_start_sec,
            timeline_duration_sec,
            speed,
            target_sample_rate: sample_rate,
            output_channels,
            reverse,
            shared,
        })
    };

    // Export is offline (no realtime deadline) and mixes strictly FORWARD, so the
    // per-layer streaming decoder stays sequential (one seek, then sequential
    // decode) and is gap-free from the first chunk thanks to the resampler-priming
    // fix. No window / whole-file decode is needed — and never reading the whole
    // file keeps export bounded for tens-of-GB sources too.
    if !is_cacheable || target.is_export() {
        return stream();
    }

    let start_frame = (source_start_sec * sample_rate as f64).round() as usize;
    let frames_to_read = (timeline_duration_sec * sample_rate as f64).round() as usize;
    let samples_to_read = frames_to_read * output_channels;

    // Look for a window covering this chunk. On a hit, copy out of it (window-
    // relative) — the realtime fast path is a lock + Arc clone + memcpy.
    let (hit, window_end_frame) = {
        let state = shared.0.lock();
        match state.layer_windows.get(layer_id) {
            // The window must be for THIS layer's current path: a stale window left from
            // a previous path (proxy swap / media replace) holds the wrong file's PCM.
            Some(w)
                if w.path == path
                    && w.covers(start_frame, frames_to_read, sample_rate, output_channels) =>
            {
                (
                    Some((w.samples.clone(), w.source_start_frame)),
                    Some(w.end_frame()),
                )
            }
            // A window exists but doesn't cover this request (e.g. after a seek):
            // treat as a miss but still report its end so we don't refill needlessly.
            _ => (None, None),
        }
    };
    let source_end_frame = source_end_frame_for_layer(shared, layer_id, sample_rate);

    if let Some((samples, win_start)) = hit {
        let rel = (start_frame - win_start) * output_channels;
        let mut result = vec![0.0f32; samples_to_read];
        let available = samples.len().saturating_sub(rel).min(samples_to_read);
        if available > 0 {
            result[..available].copy_from_slice(&samples[rel..rel + available]);
        }
        // Refill-ahead: once less than `REFILL_MARGIN_SEC` of look-ahead remains,
        // slide the window forward so steady state stays on the memcpy fast path.
        // Target the CURRENT playhead (not the window end) so the new, overlapping
        // window still covers this position — replacing it with a forward-only
        // window would leave the playhead in a gap and thrash (miss → refill → …).
        if let Some(end) = window_end_frame {
            let margin_frames = (REFILL_MARGIN_SEC * sample_rate as f64) as usize;
            let reached_source_end = source_end_frame.is_some_and(|source_end| end >= source_end);
            if !reached_source_end
                && end.saturating_sub(start_frame + frames_to_read) < margin_frames
            {
                spawn_window_fill(
                    shared,
                    layer_id,
                    path,
                    start_frame,
                    sample_rate,
                    output_channels,
                );
            }
        }
        return Ok(result);
    }

    // Miss (no window yet, or the playhead jumped outside it after a seek). Kick off
    // a bounded background fill at this position AND stream this one chunk inline so
    // there is no audible gap while the window fills. Inline streaming a single chunk
    // is cheap (~1ms); the long ranged decode stays off the realtime thread.
    spawn_window_fill(
        shared,
        layer_id,
        path,
        start_frame,
        sample_rate,
        output_channels,
    );
    stream()
}

fn source_end_frame_for_layer(
    shared: &Arc<(Mutex<AudioShared>, Condvar)>,
    layer_id: &str,
    sample_rate: u32,
) -> Option<usize> {
    let state = shared.0.lock();
    let layer = state.scene.iter().find(|layer| layer.id == layer_id)?;
    if !layer.source_start_sec.is_finite()
        || !layer.source_range_duration_sec.is_finite()
        || layer.source_range_duration_sec <= 0.0
    {
        return None;
    }
    Some(((layer.source_start_sec + layer.source_range_duration_sec) * sample_rate as f64) as usize)
}

/// Max concurrent background window-fill decodes. Deliberately 1: each ranged
/// decode reads from a (possibly multi-GB) container, and running several at once
/// thrashes the disk so badly that the realtime producer's inline streaming reads
/// miss the 50ms chunk deadline (decode-behind → ring drain → crackle). With one at
/// a time the disk stays responsive; the clip currently playing wins the next free
/// slot because its own chunks re-request a fill every iteration.
pub(crate) const WINDOW_FILL_MAX_CONCURRENCY: usize = 1;

/// Requests a bounded background decode of one `WINDOW_SEC` look-ahead window for
/// `layer_id`, starting at `target_start_frame` (target-rate frames). Bounded
/// memory: it decodes only the window, never the whole file. Idempotent and
/// concurrency-gated; safe to call every chunk (the streaming/refill paths do).
pub(crate) fn spawn_window_fill(
    shared: &Arc<(Mutex<AudioShared>, Condvar)>,
    layer_id: &str,
    path: &str,
    target_start_frame: usize,
    sample_rate: u32,
    output_channels: usize,
) {
    {
        let mut state = shared.0.lock();
        // Already filling this exact start for this layer → nothing to do. (We do NOT
        // skip when a resident window already covers the start: refill-ahead
        // deliberately re-fills an overlapping, forward-slid window so the look-ahead
        // never runs out — the concurrency gate below still prevents pile-ups.)
        if state.window_fill_in_flight.get(layer_id) == Some(&target_start_frame) {
            return;
        }
        // Throttle concurrency. When the slot is full we don't spawn; the caller
        // re-requests next chunk, so the actively-playing layer is retried as soon
        // as a running fill finishes.
        if state.active_window_fill_count >= WINDOW_FILL_MAX_CONCURRENCY {
            return;
        }
        state
            .window_fill_in_flight
            .insert(layer_id.to_string(), target_start_frame);
        state.active_window_fill_count += 1;
    }

    let shared_thread = shared.clone();
    let layer_id_thread = layer_id.to_string();
    let path_thread = path.to_string();
    let spawned = std::thread::Builder::new()
        .name("fastcat-audio-window-fill".into())
        .spawn(move || {
            window_fill(
                shared_thread,
                layer_id_thread,
                path_thread,
                target_start_frame,
                sample_rate,
                output_channels,
            );
        });
    if spawned.is_err() {
        // Spawn failed (e.g. thread limit); release the in-flight marker + slot so a
        // later chunk can retry instead of streaming forever.
        let mut state = shared.0.lock();
        if state.window_fill_in_flight.get(layer_id) == Some(&target_start_frame) {
            state.window_fill_in_flight.remove(layer_id);
        }
        state.active_window_fill_count = state.active_window_fill_count.saturating_sub(1);
        log::warn!("[audio] failed to spawn audio window fill for {path}");
    }
}

/// RAII release of a window fill's in-flight marker + concurrency slot. Only clears
/// the marker if it still matches THIS fill's start (a newer seek may have replaced
/// it with a different start that another fill now owns).
struct WindowFillGuard {
    shared: Arc<(Mutex<AudioShared>, Condvar)>,
    layer_id: String,
    start_frame: usize,
}

impl Drop for WindowFillGuard {
    fn drop(&mut self) {
        let mut state = self.shared.0.lock();
        if state.window_fill_in_flight.get(&self.layer_id) == Some(&self.start_frame) {
            state.window_fill_in_flight.remove(&self.layer_id);
        }
        state.active_window_fill_count = state.active_window_fill_count.saturating_sub(1);
        self.shared.1.notify_all();
    }
}

fn window_fill(
    shared: Arc<(Mutex<AudioShared>, Condvar)>,
    layer_id: String,
    path: String,
    target_start_frame: usize,
    sample_rate: u32,
    output_channels: usize,
) {
    let _guard = WindowFillGuard {
        shared: shared.clone(),
        layer_id: layer_id.clone(),
        start_frame: target_start_frame,
    };

    let start_sec = target_start_frame as f64 / sample_rate.max(1) as f64;
    let result = decode_range_symphonia(&path, start_sec, WINDOW_SEC, sample_rate, output_channels);
    match result {
        Ok(samples) if !samples.is_empty() => {
            let window = AudioWindow {
                path: path.clone(),
                source_start_frame: target_start_frame,
                sample_rate,
                channels: output_channels,
                samples: Arc::new(samples),
            };
            let mut state = shared.0.lock();
            // Only store if this fill still owns the in-flight slot for this start —
            // a newer seek may have superseded us; clobbering would replace a fresher
            // window with stale audio.
            if state.window_fill_in_flight.get(&layer_id) == Some(&target_start_frame) {
                state.layer_windows.insert(layer_id, window);
                shared.1.notify_all();
            }
        }
        Ok(_) => {
            // Empty range (seek past end / no frames). Leave no window; the miss path
            // keeps streaming silence/tail for this region.
        }
        Err(error) => {
            log::warn!("[audio] audio window fill failed for {path}: {error:?}");
        }
    }
}

fn is_audio_seek_past_end(error: &symphonia::core::errors::Error) -> bool {
    matches!(
        error,
        symphonia::core::errors::Error::IoError(err)
            if err.kind() == std::io::ErrorKind::UnexpectedEof
    ) || matches!(
        error,
        symphonia::core::errors::Error::SeekError(
            symphonia::core::errors::SeekErrorKind::OutOfRange,
        )
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::shared::AudioShared;

    fn write_temp_f32_wav(
        sample_rate: u32,
        channels: usize,
        frames: usize,
    ) -> anyhow::Result<std::path::PathBuf> {
        use std::io::{Seek, Write};
        let mut path = std::env::temp_dir();
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| anyhow::anyhow!("system time error: {e}"))?
            .as_nanos();
        path.push(format!("fastcat-audio-test-{unique}.wav"));

        let mut file = std::fs::File::create(&path)?;
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
        file.write_all(&(channels as u16).to_le_bytes())?;
        file.write_all(&sample_rate.to_le_bytes())?;
        let byte_rate = sample_rate
            .saturating_mul(channels as u32)
            .saturating_mul(bytes_per_sample);
        file.write_all(&byte_rate.to_le_bytes())?;
        let block_align = (channels as u16).saturating_mul(bytes_per_sample as u16);
        file.write_all(&block_align.to_le_bytes())?;
        file.write_all(&bits_per_sample.to_le_bytes())?;
        file.write_all(b"data")?;
        file.write_all(&data_size.to_le_bytes())?;

        for frame in 0..frames {
            let sample =
                ((frame as f32 / sample_rate as f32) * 440.0 * std::f32::consts::TAU).sin() * 0.25;
            for _ in 0..channels {
                file.write_all(&sample.to_le_bytes())?;
            }
        }
        let data_size = (frames * channels * std::mem::size_of::<f32>()) as u32;
        file.seek(std::io::SeekFrom::Start(4))?;
        file.write_all(&(36u32 + data_size).to_le_bytes())?;
        file.seek(std::io::SeekFrom::Start(40))?;
        file.write_all(&data_size.to_le_bytes())?;

        Ok(path)
    }

    #[test]
    fn decode_range_symphonia_decodes_mp3() -> anyhow::Result<()> {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../test/fixtures/media/sample-1s-audio.mp3"
        );
        // 2s range covers the whole ~1s fixture.
        let samples = decode_range_symphonia(path, 0.0, 2.0, 48000, 2)?;
        assert!(!samples.is_empty(), "Decoded sample buffer is empty");
        Ok(())
    }

    #[test]
    fn decode_range_symphonia_webm_opus_uses_ffmpeg_fallback() -> anyhow::Result<()> {
        let wav_path = write_temp_f32_wav(48_000, 2, 4_800)?;
        let mut webm_path = wav_path.clone();
        webm_path.set_extension("webm");

        let status = Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-y",
                "-i",
                wav_path.to_string_lossy().as_ref(),
                "-c:a",
                "libopus",
                webm_path.to_string_lossy().as_ref(),
            ])
            .status();

        let Ok(status) = status else {
            let _ = std::fs::remove_file(wav_path);
            return Ok(());
        };
        if !status.success() {
            let _ = std::fs::remove_file(wav_path);
            let _ = std::fs::remove_file(webm_path);
            return Ok(());
        }

        let samples = decode_range_symphonia(&webm_path.to_string_lossy(), 0.0, 2.0, 48_000, 2)?;
        assert!(
            samples.len() >= 4_800 * 2,
            "decoded Opus fallback should produce PCM samples"
        );

        let _ = std::fs::remove_file(wav_path);
        let _ = std::fs::remove_file(webm_path);
        Ok(())
    }

    #[test]
    fn test_decode_symphonia_chunk() -> anyhow::Result<()> {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../test/fixtures/media/sample-1s-audio.mp3"
        );
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        let samples = decode_symphonia_chunk(DecodeSymphoniaChunkParams {
            layer_id: "layer-1",
            path,
            source_start_sec: 0.2,
            timeline_duration_sec: 0.5,
            speed: 1.0,
            target_sample_rate: 48000,
            output_channels: 2,
            reverse: false,
            shared: &shared,
        })?;
        let expected = (0.5f64 * 48000.0).round() as usize * 2;
        assert_eq!(samples.len(), expected, "chunk length must be exact");
        Ok(())
    }

    #[test]
    fn rate_mismatched_small_file_streams_instead_of_full_cache() -> anyhow::Result<()> {
        let path = write_temp_f32_wav(8000, 1, 8000)?;
        let path_str = path.to_string_lossy().to_string();
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));

        let target = AudioRenderTarget::monitor(48000, 2);
        let decoded = decode_audio_chunk(DecodeAudioChunkParams {
            layer_id: "layer-8k",
            path: &path_str,
            source_start_sec: 0.0,
            timeline_duration_sec: 0.05,
            speed: 1.0,
            target,
            reverse: false,
            shared: &shared,
        })?;

        assert_eq!(decoded.len(), (0.05f64 * 48000.0).round() as usize * 2);
        let metadata = cached_audio_source_metadata(&path_str, &shared)?;
        assert_eq!(
            metadata,
            AudioSourceMetadata {
                sample_rate: 8000,
                channels: 1,
            }
        );
        let state = shared.0.lock();
        // The producer-thread call must be served by the STREAMING decoder (proof:
        // a decoder was created for this layer), never by a synchronous whole-file
        // decode that would block the realtime thread. A bounded window fill may be
        // spawned off-thread to take over later — that's fine — so we assert the
        // streaming path was taken on this call.
        assert!(
            state.decoders.contains_key("layer-8k"),
            "rate-mismatched file must stream on the producer thread (decoder created)"
        );
        drop(state);

        let _ = std::fs::remove_file(path);
        Ok(())
    }

    /// Export is offline and mixes strictly forward, so a clip is served by the
    /// sequential STREAMING decoder — never decoded whole into memory (which would
    /// OOM on a tens-of-GB source) and never via a look-ahead window fill.
    #[test]
    fn export_streams_clip_via_streaming_decoder() -> anyhow::Result<()> {
        let path = write_temp_f32_wav(8000, 1, 8000)?;
        let path_str = path.to_string_lossy().to_string();
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));

        let decoded = decode_audio_chunk(DecodeAudioChunkParams {
            layer_id: "export-8k",
            path: &path_str,
            source_start_sec: 0.0,
            timeline_duration_sec: 0.05,
            speed: 1.0,
            target: AudioRenderTarget::export(48000, 2),
            reverse: false,
            shared: &shared,
        })?;

        assert_eq!(decoded.len(), (0.05f64 * 48000.0).round() as usize * 2);
        let state = shared.0.lock();
        assert!(
            state.decoders.contains_key("export-8k"),
            "export must stream via the sequential decoder"
        );
        assert!(
            !state.layer_windows.contains_key("export-8k"),
            "export must not build a look-ahead window"
        );
        assert!(
            !state.window_fill_in_flight.contains_key("export-8k"),
            "export must not spawn a background window fill"
        );
        drop(state);

        let _ = std::fs::remove_file(path);
        Ok(())
    }

    /// Streaming an upsampled (source rate << device rate) clip must never emit a
    /// fully-silent chunk. Before the fix, `SincFixedIn`'s 1024-frame input blocks
    /// meant the output FIFO underflowed in the valleys between resampler bursts,
    /// producing a periodic silent 50 ms chunk (heard as glitchy/"fast" playback
    /// until the background precache took over). Covers several low source rates.
    #[test]
    fn streaming_upsampled_source_never_emits_silent_chunk() -> anyhow::Result<()> {
        let chunk_sec = 0.05;
        let chunk_frames = (chunk_sec * 48000.0) as usize;
        let n = 60; // 3s of continuous streaming
        for src_rate in [8000u32, 11025, 16000, 22050] {
            // 5s source so the 3s stream (plus the loop's read-ahead) never hits EOF.
            let path = write_temp_f32_wav(src_rate, 1, src_rate as usize * 5)?;
            let path_str = path.to_string_lossy().to_string();
            let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
            for k in 0..n {
                let src = k as f64 * chunk_sec;
                let c = decode_symphonia_chunk(DecodeSymphoniaChunkParams {
                    layer_id: "diag",
                    path: &path_str,
                    source_start_sec: src,
                    timeline_duration_sec: chunk_sec,
                    speed: 1.0,
                    target_sample_rate: 48000,
                    output_channels: 2,
                    reverse: false,
                    shared: &shared,
                })?;
                assert_eq!(c.len(), chunk_frames * 2);
                // Skip the very first chunk (resampler group-delay region may be
                // partially silent by design); every subsequent chunk must carry audio.
                if k == 0 {
                    continue;
                }
                let peak = c.iter().fold(0.0f32, |a, &b| a.max(b.abs()));
                assert!(
                    peak > 0.01,
                    "src_rate {src_rate}: chunk {k} is silent (peak {peak}) — resampler FIFO underflow"
                );
                // Frequency must stay ~440Hz (no time-compression/skip): measure
                // zero-crossings of this chunk's left channel.
                let mut zc = 0usize;
                for f in 1..chunk_frames {
                    let a = c[(f - 1) * 2];
                    let b = c[f * 2];
                    if (a <= 0.0 && b > 0.0) || (a >= 0.0 && b < 0.0) {
                        zc += 1;
                    }
                }
                let freq = zc as f64 / 2.0 / chunk_sec;
                assert!(
                    (freq - 440.0).abs() < 40.0,
                    "src_rate {src_rate}: chunk {k} freq {freq} != ~440Hz (content distorted)"
                );
            }
            let _ = std::fs::remove_file(path);
        }
        Ok(())
    }

    #[test]
    fn streaming_resampler_drops_initial_filter_delay() -> anyhow::Result<()> {
        let path = write_temp_f32_wav(8000, 1, 8000)?;
        let path_str = path.to_string_lossy().to_string();
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));

        let chunk = decode_symphonia_chunk(DecodeSymphoniaChunkParams {
            layer_id: "delay-layer",
            path: &path_str,
            source_start_sec: 0.0,
            timeline_duration_sec: 0.05,
            speed: 1.0,
            target_sample_rate: 48000,
            output_channels: 2,
            reverse: false,
            shared: &shared,
        })?;
        let full = decode_range_symphonia(&path_str, 0.0, 2.0, 48000, 2)?;

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
        Ok(())
    }

    #[test]
    fn decode_chunk_primes_resampler_no_tail_silence_after_seek() -> anyhow::Result<()> {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../test/fixtures/media/sample-1s-audio.mp3"
        );
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        let chunk = decode_symphonia_chunk(DecodeSymphoniaChunkParams {
            layer_id: "seek-layer",
            path,
            source_start_sec: 0.1,
            timeline_duration_sec: 0.05,
            speed: 1.0,
            target_sample_rate: 44100,
            output_channels: 2,
            reverse: false,
            shared: &shared,
        })?;
        let frames = chunk.len() / 2;
        let expected_frames = (0.05f64 * 44100.0).round() as usize;
        assert_eq!(frames, expected_frames, "chunk length must be exact");

        let state = shared.0.lock();
        let decoder = state
            .decoders
            .get("seek-layer")
            .ok_or_else(|| anyhow::anyhow!("decoder cached"))?;
        assert!(decoder.resampler_primed, "resampler should be primed");
        assert!(
            !decoder.resample_output_remainder.is_empty(),
            "priming should leave surplus resampled audio for the next chunk"
        );
        Ok(())
    }

    #[test]
    fn decode_chunk_reverse_resampled_stays_full() -> anyhow::Result<()> {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../test/fixtures/media/sample-1s-audio.mp3"
        );
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        let expected_frames = (0.05f64 * 44100.0).round() as usize;
        for i in 0..3 {
            let src = 0.5 - i as f64 * 0.05;
            let chunk = decode_symphonia_chunk(DecodeSymphoniaChunkParams {
                layer_id: "rev-layer",
                path,
                source_start_sec: src,
                timeline_duration_sec: 0.05,
                speed: 1.0,
                target_sample_rate: 44100,
                output_channels: 2,
                reverse: true,
                shared: &shared,
            })?;
            assert_eq!(
                chunk.len() / 2,
                expected_frames,
                "reverse chunk exact length"
            );
            let state = shared.0.lock();
            let decoder = state
                .decoders
                .get("rev-layer")
                .ok_or_else(|| anyhow::anyhow!("decoder cached"))?;
            assert!(
                decoder.resampler_primed,
                "reverse resampler should be primed"
            );
            assert!(
                !decoder.resample_output_remainder.is_empty(),
                "reverse priming should leave surplus resampled audio"
            );
        }
        Ok(())
    }

    /// Offline probe (ignored): decode a real file through the streaming chunk
    /// path exactly like the producer does — fixed 0.05s chunks at the device
    /// rate — and write the concatenated result to a WAV, reporting tail-zero
    /// runs at chunk boundaries (the periodic-click fingerprint). Run with:
    ///   FASTCAT_PROBE_FILE=/abs/path.wav cargo test -p app_lib \
    ///     decode_streaming_offline_probe -- --ignored --nocapture
    #[test]
    #[ignore]
    fn decode_streaming_offline_probe() -> anyhow::Result<()> {
        let path = std::env::var("FASTCAT_PROBE_FILE")
            .map_err(|_| anyhow::anyhow!("set FASTCAT_PROBE_FILE to an absolute media path"))?;
        let target_rate = std::env::var("FASTCAT_PROBE_RATE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(44100u32);
        let out_channels = 2usize;
        let chunk_sec = 0.05f64;
        let total_sec = std::env::var("FASTCAT_PROBE_SECS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(5.0f64);

        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        let target = AudioRenderTarget::monitor(target_rate, out_channels);
        let chunk_frames = (chunk_sec * target_rate as f64).round() as usize;
        let chunk_samples = chunk_frames * out_channels;
        let n_chunks = (total_sec / chunk_sec).round() as usize;

        let mut all = Vec::<f32>::new();
        let mut boundary_zero_runs = Vec::<usize>::new();
        for k in 0..n_chunks {
            let source_start = k as f64 * chunk_sec;
            let chunk = decode_audio_chunk(DecodeAudioChunkParams {
                layer_id: "probe",
                path: &path,
                source_start_sec: source_start,
                timeline_duration_sec: chunk_sec,
                speed: 1.0,
                target,
                reverse: false,
                shared: &shared,
            })?;
            assert_eq!(chunk.len(), chunk_samples, "chunk {k} wrong length");
            // Count trailing zero frames in this chunk (a zero-padded tail = the
            // resampler-starved click fingerprint).
            let mut trailing = 0usize;
            for f in (0..chunk_frames).rev() {
                let base = f * out_channels;
                if chunk[base..base + out_channels].iter().all(|s| *s == 0.0) {
                    trailing += 1;
                } else {
                    break;
                }
            }
            boundary_zero_runs.push(trailing);
            all.extend_from_slice(&chunk);
        }

        let padded_chunks = boundary_zero_runs.iter().filter(|&&z| z > 0).count();
        let max_run = boundary_zero_runs.iter().copied().max().unwrap_or(0);
        eprintln!(
            "[probe] {path} @ {target_rate}Hz: {n_chunks} chunks, {padded_chunks} with a \
             zero-padded tail (max {max_run} frames). per-chunk tail-zeros: {:?}",
            &boundary_zero_runs[..boundary_zero_runs.len().min(40)]
        );

        // Write a WAV for listening / spectral inspection.
        let out_path = std::env::temp_dir().join("fastcat-probe-out.wav");
        write_f32_wav(&out_path, &all, target_rate, out_channels as u16)?;
        eprintln!("[probe] wrote {}", out_path.display());
        Ok(())
    }

    fn write_f32_wav(
        path: &std::path::Path,
        samples: &[f32],
        sample_rate: u32,
        channels: u16,
    ) -> anyhow::Result<()> {
        use std::io::Write;
        let mut file = std::fs::File::create(path)?;
        let data_size = (samples.len() * 4) as u32;
        let byte_rate = sample_rate * channels as u32 * 4;
        let block_align = channels * 4;
        file.write_all(b"RIFF")?;
        file.write_all(&(36 + data_size).to_le_bytes())?;
        file.write_all(b"WAVE")?;
        file.write_all(b"fmt ")?;
        file.write_all(&16u32.to_le_bytes())?;
        file.write_all(&3u16.to_le_bytes())?;
        file.write_all(&channels.to_le_bytes())?;
        file.write_all(&sample_rate.to_le_bytes())?;
        file.write_all(&byte_rate.to_le_bytes())?;
        file.write_all(&block_align.to_le_bytes())?;
        file.write_all(&32u16.to_le_bytes())?;
        file.write_all(b"data")?;
        file.write_all(&data_size.to_le_bytes())?;
        for s in samples {
            file.write_all(&s.to_le_bytes())?;
        }
        Ok(())
    }

    #[test]
    fn decode_chunk_tail_eof_keeps_cursor_on_clamped_source_start() -> anyhow::Result<()> {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../test/fixtures/media/sample-1s-audio.mp3"
        );
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        let source_start = 0.999;
        let chunk = decode_symphonia_chunk(DecodeSymphoniaChunkParams {
            layer_id: "tail-layer",
            path,
            source_start_sec: source_start,
            timeline_duration_sec: 0.05,
            speed: 1.0,
            target_sample_rate: 44100,
            output_channels: 2,
            reverse: false,
            shared: &shared,
        })?;
        let expected_samples = (0.05f64 * 44100.0).round() as usize * 2;
        assert_eq!(
            chunk.len(),
            expected_samples,
            "tail chunk length must be exact"
        );

        let state = shared.0.lock();
        let decoder = state
            .decoders
            .get("tail-layer")
            .ok_or_else(|| anyhow::anyhow!("decoder cached"))?;
        assert!(
            (decoder.last_decode_end_sec - source_start).abs() < 1e-9,
            "EOF tail cursor should stay at clamped source start"
        );
        Ok(())
    }

    #[test]
    fn decode_chunk_seek_past_end_returns_silence() -> anyhow::Result<()> {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../test/fixtures/media/sample-1s-audio.mp3"
        );
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        let chunk = decode_symphonia_chunk(DecodeSymphoniaChunkParams {
            layer_id: "past-end-layer",
            path,
            source_start_sec: 999.0,
            timeline_duration_sec: 0.05,
            speed: 1.0,
            target_sample_rate: 44100,
            output_channels: 2,
            reverse: false,
            shared: &shared,
        })?;

        let expected_samples = (0.05f64 * 44100.0).round() as usize * 2;
        assert_eq!(chunk.len(), expected_samples);
        assert!(chunk.iter().all(|sample| *sample == 0.0));
        Ok(())
    }

    #[test]
    fn test_probe_audio_source_metadata() -> anyhow::Result<()> {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../test/fixtures/media/sample-1s-audio.mp3"
        );
        let meta = probe_audio_source_metadata(path)?;
        assert_eq!(meta.channels, 2);
        assert_eq!(meta.sample_rate, 48000);
        Ok(())
    }

    /// Polls `layer_windows[layer_id]` until a window with the given start frame is
    /// resident (a background fill landed), or times out (~2s).
    fn wait_for_window(
        shared: &Arc<(Mutex<AudioShared>, Condvar)>,
        layer_id: &str,
        start_frame: usize,
    ) -> bool {
        for _ in 0..200 {
            if shared
                .0
                .lock()
                .layer_windows
                .get(layer_id)
                .is_some_and(|w| w.source_start_frame == start_frame)
            {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        false
    }

    #[test]
    fn window_hit_serves_memcpy() -> anyhow::Result<()> {
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        // Resident window [0, 5s) of a distinct ramp so we can verify the offset copy.
        let frames = 5 * 48000;
        let samples: Vec<f32> = (0..frames * 2).map(|i| i as f32 * 1e-6).collect();
        let samples = Arc::new(samples);
        shared.0.lock().layer_windows.insert(
            "w1".to_string(),
            AudioWindow {
                path: "/tmp/does-not-exist.wav".to_string(),
                source_start_frame: 0,
                sample_rate: 48000,
                channels: 2,
                samples: samples.clone(),
            },
        );

        // Request at 0.1s — well before the 4s refill margin, so no fill is spawned
        // and the fake path is never opened.
        let out = decode_audio_chunk(DecodeAudioChunkParams {
            layer_id: "w1",
            path: "/tmp/does-not-exist.wav",
            source_start_sec: 0.1,
            timeline_duration_sec: 0.05,
            speed: 1.0,
            target: AudioRenderTarget::monitor(48000, 2),
            reverse: false,
            shared: &shared,
        })?;

        let start = (0.1 * 48000.0) as usize * 2;
        let len = (0.05 * 48000.0) as usize * 2;
        assert_eq!(
            out,
            samples[start..start + len],
            "memcpy is window-relative"
        );
        let state = shared.0.lock();
        assert!(
            !state.decoders.contains_key("w1"),
            "a window hit must not create a streaming decoder"
        );
        assert!(
            !state.window_fill_in_flight.contains_key("w1"),
            "a hit far from the window end must not spawn a refill"
        );
        Ok(())
    }

    /// Regression: a resident window left from a PREVIOUS path (proxy swap / media
    /// replace under the same layer id) must NOT be served — its PCM is the wrong
    /// file's audio. The chunk must miss, stream the new file inline, and start a
    /// fresh fill for the new path.
    #[test]
    fn window_for_stale_path_is_not_served() -> anyhow::Result<()> {
        let path = write_temp_f32_wav(48000, 2, 48000 * 3)?; // 3s real NEW source
        let path_str = path.to_string_lossy().to_string();
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        // A window covering [0, 5s) but tagged with the OLD path; a distinctive ramp
        // so a (buggy) memcpy hit would be obvious.
        let frames = 5 * 48000;
        let stale: Vec<f32> = (0..frames * 2).map(|i| i as f32 * 1e-3).collect();
        shared.0.lock().layer_windows.insert(
            "p1".to_string(),
            AudioWindow {
                path: "/tmp/old-proxy.wav".to_string(),
                source_start_frame: 0,
                sample_rate: 48000,
                channels: 2,
                samples: Arc::new(stale),
            },
        );

        let out = decode_audio_chunk(DecodeAudioChunkParams {
            layer_id: "p1",
            path: &path_str,
            source_start_sec: 0.1,
            timeline_duration_sec: 0.05,
            speed: 1.0,
            target: AudioRenderTarget::monitor(48000, 2),
            reverse: false,
            shared: &shared,
        })?;

        // Served by streaming the NEW file (decoder created), not the stale window.
        assert!(
            shared.0.lock().decoders.contains_key("p1"),
            "a window with a stale path must miss and stream the new file inline"
        );
        // The new WAV is a 440Hz sine ≤ 0.25 amplitude; the stale window's ramp around
        // index 0.1s would be ~9.6. So the output must not be the stale ramp.
        assert!(
            out.iter().all(|s| s.abs() <= 0.5),
            "output must be the new file's audio, not the stale window's ramp"
        );
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    #[test]
    fn window_refill_ahead_spawns_next_window() -> anyhow::Result<()> {
        let path = write_temp_f32_wav(48000, 2, 48000 * 3)?; // 3s real source
        let path_str = path.to_string_lossy().to_string();
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        // Resident window [0, 1s); a chunk near its end is within the refill margin.
        let end_frame = 48000;
        shared.0.lock().layer_windows.insert(
            "r1".to_string(),
            AudioWindow {
                path: path_str.clone(),
                source_start_frame: 0,
                sample_rate: 48000,
                channels: 2,
                samples: Arc::new(vec![0.1f32; end_frame * 2]),
            },
        );

        let start_frame = (0.9 * 48000.0) as usize;
        let _ = decode_audio_chunk(DecodeAudioChunkParams {
            layer_id: "r1",
            path: &path_str,
            source_start_sec: 0.9,
            timeline_duration_sec: 0.05,
            speed: 1.0,
            target: AudioRenderTarget::monitor(48000, 2),
            reverse: false,
            shared: &shared,
        })?;
        let _ = end_frame;

        // Refill-ahead slides the window forward from the CURRENT playhead (so the
        // new, overlapping window still covers it), not from the old window end.
        assert!(
            wait_for_window(&shared, "r1", start_frame),
            "refill-ahead must decode and install a forward window at the playhead"
        );
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    #[test]
    fn window_refill_stops_at_known_source_end() -> anyhow::Result<()> {
        let path = write_temp_f32_wav(48000, 2, 48000 * 3)?;
        let path_str = path.to_string_lossy().to_string();
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        shared.0.lock().scene = vec![crate::monitor::scene::SceneAudioLayer {
            id: "eof".into(),
            track_id: None,
            path: path_str.clone(),
            timeline_start_sec: 0.0,
            timeline_end_sec: 1.0,
            source_start_sec: 0.0,
            source_range_duration_sec: 1.0,
            speed: 1.0,
            audio_gain: 1.0,
            audio_balance: 0.0,
            audio_fade_in_sec: 0.0,
            audio_fade_out_sec: 0.0,
            audio_fade_in_curve: crate::monitor::scene::AudioFadeCurve::Linear,
            audio_fade_out_curve: crate::monitor::scene::AudioFadeCurve::Linear,
            audio_effects: vec![],
        }];
        shared.0.lock().layer_windows.insert(
            "eof".to_string(),
            AudioWindow {
                path: path_str.clone(),
                source_start_frame: 0,
                sample_rate: 48000,
                channels: 2,
                samples: Arc::new(vec![0.1f32; 48000 * 2]),
            },
        );

        let _ = decode_audio_chunk(DecodeAudioChunkParams {
            layer_id: "eof",
            path: &path_str,
            source_start_sec: 0.9,
            timeline_duration_sec: 0.05,
            speed: 1.0,
            target: AudioRenderTarget::monitor(48000, 2),
            reverse: false,
            shared: &shared,
        })?;

        std::thread::sleep(std::time::Duration::from_millis(80));
        let state = shared.0.lock();
        assert_eq!(
            state
                .layer_windows
                .get("eof")
                .map(|window| window.source_start_frame),
            Some(0),
            "a window that already reaches the clip source end must not be refilled"
        );
        assert!(!state.window_fill_in_flight.contains_key("eof"));
        drop(state);
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    #[test]
    fn window_miss_streams_inline_and_spawns_fill() -> anyhow::Result<()> {
        let path = write_temp_f32_wav(48000, 2, 48000 * 3)?;
        let path_str = path.to_string_lossy().to_string();
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));

        // No window yet → miss: serve this chunk inline AND start a fill at start 0.
        let out = decode_audio_chunk(DecodeAudioChunkParams {
            layer_id: "m1",
            path: &path_str,
            source_start_sec: 0.0,
            timeline_duration_sec: 0.05,
            speed: 1.0,
            target: AudioRenderTarget::monitor(48000, 2),
            reverse: false,
            shared: &shared,
        })?;

        assert_eq!(out.len(), (0.05 * 48000.0) as usize * 2);
        assert!(
            shared.0.lock().decoders.contains_key("m1"),
            "a miss must stream this chunk inline (decoder created)"
        );
        assert!(
            wait_for_window(&shared, "m1", 0),
            "a miss must spawn a fill that installs the window at the requested start"
        );
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    #[test]
    fn seek_outside_window_refills_at_new_start() -> anyhow::Result<()> {
        let path = write_temp_f32_wav(48000, 2, 48000 * 3)?;
        let path_str = path.to_string_lossy().to_string();
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        // Resident window [0, 1s); the request jumps to 2s — outside it.
        shared.0.lock().layer_windows.insert(
            "s1".to_string(),
            AudioWindow {
                path: path_str.clone(),
                source_start_frame: 0,
                sample_rate: 48000,
                channels: 2,
                samples: Arc::new(vec![0.0f32; 48000 * 2]),
            },
        );

        let _ = decode_audio_chunk(DecodeAudioChunkParams {
            layer_id: "s1",
            path: &path_str,
            source_start_sec: 2.0,
            timeline_duration_sec: 0.05,
            speed: 1.0,
            target: AudioRenderTarget::monitor(48000, 2),
            reverse: false,
            shared: &shared,
        })?;

        // The fill targets the NEW seek position (2s), not the old window end.
        assert!(
            wait_for_window(&shared, "s1", 2 * 48000),
            "a seek outside the window must refill at the new position"
        );
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    #[test]
    fn decode_range_symphonia_no_leading_silence() -> anyhow::Result<()> {
        // Continuous 440Hz tone at 8kHz → decoding at 48k forces a resample, so this
        // exercises that the resampler group delay is dropped (no leading silence).
        let path = write_temp_f32_wav(8000, 1, 8000 * 2)?; // 2s tone
        let path_str = path.to_string_lossy().to_string();
        let head_frames = (0.005 * 48000.0) as usize * 2; // first 5ms
                                                          // Both from 0 (no seek) and from a mid-clip seek must open with signal.
        for start in [0.0, 0.1] {
            let out = decode_range_symphonia(&path_str, start, 0.5, 48000, 2)?;
            assert!(!out.is_empty(), "start {start}: empty");
            let head_peak = out[..head_frames]
                .iter()
                .fold(0.0f32, |a, &b| a.max(b.abs()));
            assert!(
                head_peak > 0.01,
                "start {start}: leading silence (peak {head_peak})"
            );
        }
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    #[test]
    fn decode_range_symphonia_is_bounded() -> anyhow::Result<()> {
        // 10s source; decode only a 1s range → ~1s of output, NOT the whole file.
        let path = write_temp_f32_wav(8000, 1, 8000 * 10)?;
        let path_str = path.to_string_lossy().to_string();
        let out = decode_range_symphonia(&path_str, 0.0, 1.0, 48000, 2)?;
        let out_frames = out.len() / 2;
        assert!(
            (47000..49000).contains(&out_frames),
            "expected ~1s ({}) of output, got {out_frames} frames",
            48000
        );
        // Must be far less than a whole-file decode (10s → 480000 frames).
        assert!(out_frames < 100_000, "decode was not bounded to the range");
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    #[test]
    fn window_fill_respects_concurrency_limit() -> anyhow::Result<()> {
        let path = write_temp_f32_wav(48000, 2, 48000 * 2)?;
        let path_str = path.to_string_lossy().to_string();
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));

        // Saturate the budget: a fresh fill must NOT claim a slot or spawn.
        shared.0.lock().active_window_fill_count = WINDOW_FILL_MAX_CONCURRENCY;
        spawn_window_fill(&shared, "c1", &path_str, 0, 48000, 2);
        std::thread::sleep(std::time::Duration::from_millis(30));
        {
            let state = shared.0.lock();
            assert!(
                !state.window_fill_in_flight.contains_key("c1"),
                "must not claim a slot while the budget is full"
            );
            assert!(!state.layer_windows.contains_key("c1"));
            assert_eq!(state.active_window_fill_count, WINDOW_FILL_MAX_CONCURRENCY);
        }

        // Free the budget; the same call now fills and releases the slot.
        shared.0.lock().active_window_fill_count = 0;
        spawn_window_fill(&shared, "c1", &path_str, 0, 48000, 2);
        assert!(
            wait_for_window(&shared, "c1", 0),
            "fill must run with a free slot"
        );
        assert_eq!(
            shared.0.lock().active_window_fill_count,
            0,
            "slot must be released when the fill thread finishes"
        );
        let _ = std::fs::remove_file(path);
        Ok(())
    }
}
