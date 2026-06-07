use anyhow::{anyhow, Result};

/// Builds the SincFixedIn resampler used everywhere in the engine. Centralised so
/// every call site (one-shot, cached streaming, and the eager pre-decode build
/// used for delay-line priming) shares identical filter parameters and block
/// size; otherwise their group delays would differ and priming maths would be
/// wrong.
pub(crate) const RESAMPLER_CHUNK_SIZE: usize = 1024;

pub(crate) fn make_sinc_resampler(
    ratio: f64,
    num_channels: usize,
) -> Result<rubato::SincFixedIn<f32>> {
    use rubato::{SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction};
    let params = SincInterpolationParameters {
        // sinc_len was 256; lowered to 128 for preview to cut CPU load in half.
        // Quality difference is inaudible for monitoring; export uses the same
        // resampler so it still sounds clean.
        sinc_len: 128,
        f_cutoff: 0.95,
        interpolation: SincInterpolationType::Linear,
        oversampling_factor: 160,
        window: WindowFunction::BlackmanHarris2,
    };
    let max_ratio_factor = ratio.max(2.0);
    SincFixedIn::<f32>::new(
        ratio,
        max_ratio_factor,
        params,
        RESAMPLER_CHUNK_SIZE,
        num_channels,
    )
    .map_err(|e| anyhow!("failed to create resampler: {:?}", e))
}

pub(crate) fn resample_planar_with_speed(
    input: Vec<Vec<f32>>,
    source_rate: u32,
    target_rate: u32,
    speed: f64,
    num_channels: usize,
) -> Result<Vec<Vec<f32>>> {
    use rubato::Resampler;

    let ratio = target_rate as f64 / (source_rate as f64 * speed);

    if (ratio - 1.0).abs() < 1e-6 && source_rate == target_rate {
        return Ok(input);
    }

    if input.is_empty() || input[0].is_empty() {
        return Ok(input);
    }

    let chunk_size = RESAMPLER_CHUNK_SIZE;
    let mut resampler = make_sinc_resampler(ratio, num_channels)?;

    let input_len = input[0].len();
    let mut output = vec![Vec::new(); num_channels];
    let mut offset = 0;

    while offset < input_len {
        let copy_len = (input_len - offset).min(chunk_size);
        let mut chunk = vec![vec![0.0f32; chunk_size]; num_channels];
        for (ch, inp) in chunk.iter_mut().zip(input.iter()) {
            ch[..copy_len].copy_from_slice(&inp[offset..offset + copy_len]);
        }

        let out_chunk = resampler
            .process(&chunk, None)
            .map_err(|e| anyhow!("failed to resample chunk: {:?}", e))?;

        for (out, och) in output.iter_mut().zip(out_chunk.iter()) {
            out.extend_from_slice(och);
        }
        offset += copy_len;
    }

    // Flush the resampler's group-delay tail. `SincFixedIn` emits a fixed-size
    // output for EVERY full input block and never returns empty, so the old
    // "loop until empty" never terminated — it hung the producer thread (and thus
    // all audio) whenever a cached file's rate differed from the device, e.g. an
    // 8 kHz clip on a 44.1 kHz device. Instead, collect exactly the expected
    // number of frames: the correctly resampled stream is `input_len * ratio`
    // frames long but arrives delayed by `output_delay`, so we gather
    // `delay + expected` frames, drop the leading delay, and trim to `expected`.
    let delay = resampler.output_delay();
    let expected_out = (input_len as f64 * ratio).round() as usize;
    let target_total = delay + expected_out;
    let flush = vec![vec![0.0f32; chunk_size]; num_channels];
    while output[0].len() < target_total {
        let out_chunk = resampler
            .process(&flush, None)
            .map_err(|e| anyhow!("failed to flush resampler: {:?}", e))?;
        if out_chunk.iter().all(|ch| ch.is_empty()) {
            break;
        }
        for (out, och) in output.iter_mut().zip(out_chunk.iter()) {
            out.extend_from_slice(och);
        }
    }
    for out in output.iter_mut().take(num_channels) {
        if out.len() > delay {
            out.drain(0..delay);
        } else {
            out.clear();
        }
        out.truncate(expected_out);
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
pub(crate) fn resample_planar_cached(
    input: Vec<Vec<f32>>,
    source_rate: u32,
    target_rate: u32,
    speed: f64,
    num_channels: usize,
    cached_resampler: &mut Option<Box<rubato::SincFixedIn<f32>>>,
    remainder: &mut Vec<Vec<f32>>,
) -> Result<Vec<Vec<f32>>> {
    use rubato::Resampler;

    let ratio = target_rate as f64 / (source_rate as f64 * speed);

    if (ratio - 1.0).abs() < 1e-6 && source_rate == target_rate {
        return Ok(input);
    }

    if num_channels == 0 {
        return Ok(input);
    }

    if cached_resampler.is_none() {
        let resampler = make_sinc_resampler(ratio, num_channels)?;
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
    for (rem, src) in remainder.iter_mut().zip(input.iter()) {
        let mut channel = std::mem::take(rem);
        channel.extend_from_slice(src);
        pending.push(channel);
    }
    let pending_len = pending.first().map(|c| c.len()).unwrap_or(0);

    let mut output = vec![Vec::new(); num_channels];
    let mut offset = 0;
    while offset + chunk_size <= pending_len {
        let mut chunk = vec![vec![0.0f32; chunk_size]; num_channels];
        for (ch, pen) in chunk.iter_mut().zip(pending.iter()) {
            ch.copy_from_slice(&pen[offset..offset + chunk_size]);
        }
        let out_chunk = resampler
            .process(&chunk, None)
            .map_err(|e| anyhow!("failed to resample chunk: {:?}", e))?;
        for (out, och) in output.iter_mut().zip(out_chunk.iter()) {
            out.extend_from_slice(och);
        }
        offset += chunk_size;
    }

    // Stash the unconsumed tail (< chunk_size frames) for the next call.
    for (rem, pen) in remainder.iter_mut().zip(pending.iter()) {
        *rem = pen[offset..].to_vec();
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
#[allow(clippy::needless_range_loop)]
pub(crate) fn planar_to_interleaved(planar: &[Vec<f32>], out_channels: usize) -> Vec<f32> {
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
        // Mono source: duplicate into the front L/R pair. Scale by 1/√2 so the
        // summed acoustic power of the two correlated copies matches the original
        // mono level instead of being ~3 dB louder than a native stereo clip.
        let front = out_channels.min(2);
        let scale = if front >= 2 {
            std::f32::consts::FRAC_1_SQRT_2
        } else {
            1.0
        };
        for f in 0..num_frames {
            let val = planar[0][f] * scale;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn planar_to_interleaved_duplicates_mono_to_front_pair() {
        let planar = vec![vec![1.0, 2.0, 3.0]];
        let interleaved = planar_to_interleaved(&planar, 6);
        // Mono is duplicated into the front L/R pair, scaled by 1/√2 to preserve
        // acoustic power; all further channels stay silent.
        let g = std::f32::consts::FRAC_1_SQRT_2;
        assert_eq!(
            interleaved,
            vec![
                1.0 * g,
                1.0 * g,
                0.0,
                0.0,
                0.0,
                0.0,
                2.0 * g,
                2.0 * g,
                0.0,
                0.0,
                0.0,
                0.0,
                3.0 * g,
                3.0 * g,
                0.0,
                0.0,
                0.0,
                0.0,
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
}
