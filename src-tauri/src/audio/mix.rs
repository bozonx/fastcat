use std::collections::HashMap;
use std::io::{Seek, Write};
use std::path::Path;
use std::sync::Arc;

use anyhow::Context;
use parking_lot::{Condvar, Mutex};

use crate::audio::decode::decode_audio_chunk;
use crate::audio::shared::{AudioShared, CHUNK_DURATION_SEC};
use crate::monitor::scene::{AudioFadeCurve, SceneAudioLayer, SceneAudioTrack};

/// Renders the audio scene to an f32 WAV file.
///
/// `output_channels` selects the file's channel layout (1 = mono, 2 = stereo).
/// Export is intentionally limited to mono/stereo for now.
pub fn render_scene_to_wav(
    scene: &[SceneAudioLayer],
    tracks: &[SceneAudioTrack],
    master_gain: f64,
    start_sec: f64,
    end_sec: f64,
    sample_rate: u32,
    output_channels: usize,
    target_path: &Path,
) -> anyhow::Result<()> {
    let output_channels = output_channels.clamp(1, 2);
    let start = if start_sec.is_finite() {
        start_sec.max(0.0)
    } else {
        0.0
    };
    let end = if end_sec.is_finite() {
        end_sec.max(start)
    } else {
        start
    };
    let estimated_frames = ((end - start) * sample_rate as f64).round().max(1.0) as u64;
    let mut file = std::fs::File::create(target_path)
        .with_context(|| format!("create audio wav {}", target_path.display()))?;

    // Write placeholder header (will be patched after we know actual size).
    write_wav_f32_header_placeholder(&mut file, sample_rate, output_channels as u16)?;

    let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));

    let mut written_frames = 0u64;
    while written_frames < estimated_frames {
        let chunk_frames = ((CHUNK_DURATION_SEC * sample_rate as f64).round() as u64)
            .min(estimated_frames - written_frames)
            .max(1);
        let chunk_duration = chunk_frames as f64 / sample_rate as f64;
        let chunk_start = start + written_frames as f64 / sample_rate as f64;
        let chunk = mix_chunk(
            scene,
            tracks,
            master_gain,
            chunk_start,
            chunk_duration,
            sample_rate,
            output_channels,
            &shared,
            true,
        );
        let samples_to_write = chunk_frames as usize * output_channels;
        for sample in chunk.into_iter().take(samples_to_write) {
            file.write_all(&sample.to_le_bytes())?;
        }
        written_frames = written_frames.saturating_add(chunk_frames);
    }

    // Patch header with actual frame count.
    let data_size = written_frames
        .saturating_mul(output_channels as u64)
        .saturating_mul(4);
    if data_size > u32::MAX as u64 {
        return Err(anyhow::anyhow!(
            "WAV data size {} exceeds 32-bit limit ({}). Use a shorter export range or lower sample rate.",
            data_size,
            u32::MAX
        ));
    }
    let riff_size = 36u64.saturating_add(data_size);
    file.seek(std::io::SeekFrom::Start(4))?;
    file.write_all(&(riff_size as u32).to_le_bytes())?;
    file.seek(std::io::SeekFrom::Start(40))?;
    file.write_all(&(data_size.min(u32::MAX as u64) as u32).to_le_bytes())?;
    Ok(())
}

fn write_wav_f32_header_placeholder(
    file: &mut std::fs::File,
    sample_rate: u32,
    channels: u16,
) -> anyhow::Result<()> {
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

pub(crate) fn mix_chunk(
    scene: &[SceneAudioLayer],
    tracks: &[SceneAudioTrack],
    master_gain: f64,
    chunk_start_sec: f64,
    chunk_duration_sec: f64,
    sample_rate: u32,
    output_channels: usize,
    shared: &Arc<(Mutex<AudioShared>, Condvar)>,
    is_export: bool,
) -> Vec<f32> {
    let output_channels = output_channels.max(1);
    let frames = (chunk_duration_sec * sample_rate as f64).round().max(1.0) as usize;
    let mut mixed = vec![0.0f32; frames * output_channels];
    let chunk_end_sec = chunk_start_sec + chunk_duration_sec;

    // 1. Check the solo state of tracks.
    let has_solo = tracks.iter().any(|t| t.audio_solo);

    // 2. Group layers by track_id. Layers without a matching track are mixed
    // directly into the master bus ("orphan" layers, kept for compatibility).
    let mut track_layers: HashMap<String, Vec<&SceneAudioLayer>> = HashMap::new();
    let mut orphan_layers: Vec<&SceneAudioLayer> = Vec::new();

    for layer in scene {
        let tid = layer.track_id.as_deref().unwrap_or("");
        match resolve_track_for_layer(tid, tracks) {
            Some(track) => track_layers
                .entry(track.id.clone())
                .or_default()
                .push(layer),
            None => orphan_layers.push(layer),
        }
    }

    // 3. Mix track buses. Solo takes precedence over mute: when any track is
    // soloed, only soloed tracks are heard and the per-track `audio_muted` flag
    // is ignored (a soloed-and-muted track still plays). When nothing is soloed,
    // muted tracks are dropped. Reused across tracks to avoid a per-track
    // allocation every chunk; zeroed at the start of each iteration.
    let mut track_mixed = vec![0.0f32; frames * output_channels];
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

        track_mixed.iter_mut().for_each(|s| *s = 0.0);
        let mut has_audio_on_track = false;

        for layer in layers {
            has_audio_on_track |= mix_layer_into(
                &mut track_mixed,
                layer,
                chunk_start_sec,
                chunk_end_sec,
                frames,
                sample_rate,
                output_channels,
                is_export,
                shared,
            );
        }

        if has_audio_on_track {
            apply_bus_gain_balance(
                &mut mixed,
                &track_mixed,
                frames,
                output_channels,
                track.audio_gain,
                track.audio_balance,
            );
        }
    }

    // 4. Mix orphan layers (no owning track) directly into the master bus.
    // They have no track to solo, so any active solo silences them entirely.
    if !has_solo {
        for layer in orphan_layers {
            mix_layer_into(
                &mut mixed,
                layer,
                chunk_start_sec,
                chunk_end_sec,
                frames,
                sample_rate,
                output_channels,
                is_export,
                shared,
            );
        }
    }

    apply_master_gain(&mut mixed, master_gain);
    soft_clip(&mut mixed);
    mixed
}

/// Resolves the bus track that owns a layer. An empty `tid` is never matched
/// (the layer is treated as orphan). Matching is exact, or `tid` may use the
/// `"{track_id}_..."` suffix form; the most specific (longest) track id wins to
/// keep routing deterministic.
fn resolve_track_for_layer<'a>(
    tid: &str,
    tracks: &'a [SceneAudioTrack],
) -> Option<&'a SceneAudioTrack> {
    if tid.is_empty() {
        return None;
    }
    tracks
        .iter()
        .filter(|t| {
            tid == t.id
                || tid
                    .strip_prefix(t.id.as_str())
                    .is_some_and(|rest| rest.starts_with('_'))
        })
        .max_by_key(|t| t.id.len())
}

/// Decodes, optionally reverses, and mixes a single layer into `buffer`.
/// Returns `true` if the layer contributed audio to this chunk.
#[allow(clippy::too_many_arguments)]
fn mix_layer_into(
    buffer: &mut [f32],
    layer: &SceneAudioLayer,
    chunk_start_sec: f64,
    chunk_end_sec: f64,
    frames: usize,
    sample_rate: u32,
    output_channels: usize,
    is_export: bool,
    shared: &Arc<(Mutex<AudioShared>, Condvar)>,
) -> bool {
    if layer.timeline_end_sec <= chunk_start_sec || layer.timeline_start_sec >= chunk_end_sec {
        return false;
    }
    let raw_segment_start = chunk_start_sec.max(layer.timeline_start_sec);
    let raw_segment_end = chunk_end_sec.min(layer.timeline_end_sec);
    let (write_start_frame, frames_to_write) = chunk_write_range(
        chunk_start_sec,
        raw_segment_start,
        raw_segment_end,
        sample_rate,
        frames,
    );
    if frames_to_write == 0 {
        return false;
    }
    let segment_start = chunk_start_sec + write_start_frame as f64 / sample_rate as f64;
    let segment_duration = frames_to_write as f64 / sample_rate as f64;
    let segment_end = segment_start + segment_duration;

    let reversed = layer.speed < 0.0;
    if !is_export && reversed {
        // Reverse audio is muted in preview/monitor; only rendered on export.
        return false;
    }

    let speed = sanitize_speed(layer.speed.abs());
    let source_start = if reversed {
        layer.source_pts_at(segment_end)
    } else {
        layer.source_pts_at(segment_start)
    };

    let mut decoded = match decode_audio_chunk(
        &layer.id,
        &layer.path,
        source_start,
        segment_duration,
        speed,
        sample_rate,
        output_channels,
        reversed,
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
            return false;
        }
    };

    if reversed {
        reverse_frames(&mut decoded, output_channels);
    }

    let frames_to_write = frames_to_write.min(decoded.len() / output_channels);
    debug_assert!(
        write_start_frame + frames_to_write <= buffer.len() / output_channels,
        "layer write range exceeds mix buffer"
    );
    apply_layer_mix(
        buffer,
        &decoded,
        write_start_frame,
        frames_to_write,
        sample_rate,
        layer,
        segment_start,
        output_channels,
    );
    true
}

fn chunk_write_range(
    chunk_start_sec: f64,
    segment_start_sec: f64,
    segment_end_sec: f64,
    sample_rate: u32,
    chunk_frames: usize,
) -> (usize, usize) {
    if segment_end_sec <= segment_start_sec || chunk_frames == 0 {
        return (0, 0);
    }

    let sample_rate = sample_rate as f64;
    let chunk_start_frame = (chunk_start_sec * sample_rate).round() as i64;
    let segment_start_frame = (segment_start_sec * sample_rate).round() as i64;
    let segment_end_frame = (segment_end_sec * sample_rate).round() as i64;

    let write_start = segment_start_frame
        .saturating_sub(chunk_start_frame)
        .clamp(0, chunk_frames as i64) as usize;
    let write_end = segment_end_frame
        .saturating_sub(chunk_start_frame)
        .clamp(write_start as i64, chunk_frames as i64) as usize;

    (write_start, write_end.saturating_sub(write_start))
}

/// Reverses an interleaved buffer frame-by-frame, preserving channel order
/// within each frame, for any channel count.
fn reverse_frames(decoded: &mut [f32], channels: usize) {
    if channels == 0 {
        return;
    }
    let num_frames = decoded.len() / channels;
    for i in 0..num_frames / 2 {
        let j = num_frames - 1 - i;
        for ch in 0..channels {
            decoded.swap(i * channels + ch, j * channels + ch);
        }
    }
}

/// Applies a track bus gain and stereo balance, then accumulates into the
/// master `mixed` buffer. Balance only affects the front L/R pair (channels 0
/// and 1); any further channels are passed through with gain only. Mono output
/// ignores balance entirely.
fn apply_bus_gain_balance(
    mixed: &mut [f32],
    track_mixed: &[f32],
    frames: usize,
    channels: usize,
    audio_gain: f64,
    audio_balance: f64,
) {
    let gain = audio_gain.max(0.0) as f32;
    if channels >= 2 {
        let (ll, lr, rl, rr) = stereo_pan_matrix(audio_balance);
        let (ll, lr, rl, rr) = (ll as f32, lr as f32, rl as f32, rr as f32);
        for i in 0..frames {
            let base = i * channels;
            let left = track_mixed[base] * gain;
            let right = track_mixed[base + 1] * gain;
            mixed[base] += ll * left + lr * right;
            mixed[base + 1] += rl * left + rr * right;
            for ch in 2..channels {
                mixed[base + ch] += track_mixed[base + ch] * gain;
            }
        }
    } else {
        for i in 0..frames {
            mixed[i] += track_mixed[i] * gain;
        }
    }
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

/// Smooth soft-knee limiter. Below the knee the signal is untouched; above it,
/// magnitudes are mapped asymptotically toward (but never reaching) 1.0 with a
/// single continuous tanh curve, so loud mixes are gracefully compressed instead
/// of hard-clipped. The curve is continuous everywhere: at `mag == KNEE` it
/// equals `KNEE` (`tanh(0) == 0`) and as `mag → ∞` it approaches 1.0. The
/// previous implementation special-cased `mag >= 1.0 → 1.0`, which introduced a
/// ~0.05 jump (audible distortion) right at unity. Non-finite inputs are flushed
/// to silence to keep the output bounded.
fn soft_clip(samples: &mut [f32]) {
    const KNEE: f32 = 0.8;
    for sample in samples {
        let s = *sample;
        if !s.is_finite() {
            *sample = 0.0;
            continue;
        }
        let mag = s.abs();
        if mag <= KNEE {
            continue;
        }
        let over = (mag - KNEE) / (1.0 - KNEE);
        let limited = KNEE + (1.0 - KNEE) * over.tanh();
        *sample = limited.copysign(s);
    }
}

/// Applies the per-layer gain envelope and stereo balance, then accumulates the
/// `decoded` interleaved samples into `mixed`. Balance only affects the front
/// L/R pair; extra channels are passed through with gain. Mono output ignores
/// balance entirely.
#[allow(clippy::too_many_arguments)]
fn apply_layer_mix(
    mixed: &mut [f32],
    decoded: &[f32],
    write_start_frame: usize,
    frames_to_write: usize,
    sample_rate: u32,
    layer: &SceneAudioLayer,
    segment_start_sec: f64,
    channels: usize,
) {
    if channels == 0 || frames_to_write == 0 {
        return;
    }
    debug_assert!(
        write_start_frame + frames_to_write <= mixed.len() / channels,
        "write range ({}, {}) exceeds mixed buffer capacity ({})",
        write_start_frame,
        frames_to_write,
        mixed.len() / channels
    );
    debug_assert!(
        frames_to_write <= decoded.len() / channels,
        "decoded buffer too small for frames_to_write ({} > {})",
        frames_to_write,
        decoded.len() / channels
    );
    let stereo = channels >= 2;
    let (ll, lr, rl, rr) = if stereo {
        let (ll, lr, rl, rr) = stereo_pan_matrix(layer.audio_balance);
        (ll as f32, lr as f32, rl as f32, rr as f32)
    } else {
        (1.0, 0.0, 0.0, 1.0)
    };

    // If the whole write range sits outside both fade zones the gain is constant,
    // so skip the per-sample envelope evaluation (incl. the fade `sin()`).
    let duration = (layer.timeline_end_sec - layer.timeline_start_sec).max(0.0);
    let (fade_in, fade_out) = effective_fades(layer, duration);
    let clip_start = (segment_start_sec - layer.timeline_start_sec).max(0.0);
    let clip_end = clip_start + frames_to_write.saturating_sub(1) as f64 / sample_rate as f64;
    let constant_gain = duration > 0.0 && clip_start >= fade_in && {
        let fade_out_start = (duration - fade_out).max(0.0);
        fade_out <= 0.0 || clip_end < fade_out_start
    };

    for i in 0..frames_to_write {
        let gain = if constant_gain {
            layer.audio_gain.max(0.0) as f32
        } else {
            let timeline_sec = segment_start_sec + i as f64 / sample_rate as f64;
            let clip_sec = (timeline_sec - layer.timeline_start_sec).max(0.0);
            gain_at_clip_time(layer, clip_sec) as f32
        };
        if gain == 0.0 {
            continue;
        }
        let src = i * channels;
        let dst = (write_start_frame + i) * channels;
        if stereo {
            let left = decoded[src] * gain;
            let right = decoded[src + 1] * gain;
            mixed[dst] += ll * left + lr * right;
            mixed[dst + 1] += rl * left + rr * right;
            for ch in 2..channels {
                mixed[dst + ch] += decoded[src + ch] * gain;
            }
        } else {
            mixed[dst] += decoded[src] * gain;
        }
    }
}

/// Resolves the effective fade-in / fade-out lengths for a layer. Each fade is
/// clamped to the clip duration, and when the two together would exceed the
/// duration they are scaled down proportionally so they meet rather than
/// overlap. Without this, an over-long fade-in and fade-out both stay active in
/// the middle of the clip and *multiply*, punching an unintended hole in the
/// gain envelope.
fn effective_fades(layer: &SceneAudioLayer, duration: f64) -> (f64, f64) {
    if duration <= 0.0 {
        return (0.0, 0.0);
    }
    let fade_in = layer.audio_fade_in_sec.max(0.0).min(duration);
    let fade_out = layer.audio_fade_out_sec.max(0.0).min(duration);
    let total = fade_in + fade_out;
    if total > duration && total > 0.0 {
        let scale = duration / total;
        (fade_in * scale, fade_out * scale)
    } else {
        (fade_in, fade_out)
    }
}

fn gain_at_clip_time(layer: &SceneAudioLayer, clip_sec: f64) -> f64 {
    let mut gain = layer.audio_gain.max(0.0);
    let duration = (layer.timeline_end_sec - layer.timeline_start_sec).max(0.0);
    if duration <= 0.0 {
        return 0.0;
    }
    let (fade_in, fade_out) = effective_fades(layer, duration);
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

/// Stereo balance matrix (diagonal — no channel cross-feed). A balance control
/// must be unity at the centre: `balance = 0` leaves both channels untouched,
/// and moving toward one side linearly attenuates the *opposite* channel down to
/// silence. This is deliberately NOT the equal-power pan law (which dips the
/// centre by ~3 dB) — applying that law per layer *and* per bus compounded into
/// a ~6 dB loss on every default-balance clip.
fn stereo_pan_matrix(balance: f64) -> (f64, f64, f64, f64) {
    let pan = balance.clamp(-1.0, 1.0);
    let left_gain = (1.0 - pan).min(1.0);
    let right_gain = (1.0 + pan).min(1.0);
    (left_gain, 0.0, 0.0, right_gain)
}

fn sanitize_speed(speed: f64) -> f64 {
    if speed.is_finite() && speed > 0.0 {
        speed.clamp(0.01, 100.0)
    } else {
        1.0
    }
}

/// Upper bound for master gain (~+18 dB). Above this the soft-clip limiter would
/// simply flatten the entire mix into distortion, so we cap rather than trust an
/// arbitrarily large value coming from the UI / scene payload.
const MAX_MASTER_GAIN: f64 = 8.0;

pub(crate) fn sanitize_master_gain(gain: f64) -> f64 {
    if gain.is_finite() {
        gain.clamp(0.0, MAX_MASTER_GAIN)
    } else {
        1.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::monitor::scene::{AudioFadeCurve, SceneAudioLayer, SceneAudioTrack};

    fn layer() -> SceneAudioLayer {
        SceneAudioLayer {
            id: "a1".into(),
            track_id: Some("track-a".into()),
            path: "/tmp/a.wav".into(),
            timeline_start_sec: 0.0,
            timeline_end_sec: 10.0,
            source_start_sec: 0.0,
            source_range_duration_sec: 0.0,
            speed: 1.0,
            audio_gain: 1.0,
            audio_balance: 0.0,
            audio_fade_in_sec: 2.0,
            audio_fade_out_sec: 2.0,
            audio_fade_in_curve: AudioFadeCurve::Linear,
            audio_fade_out_curve: AudioFadeCurve::Linear,
        }
    }

    fn track(id: &str) -> SceneAudioTrack {
        SceneAudioTrack {
            id: id.into(),
            audio_gain: 1.0,
            audio_balance: 0.0,
            audio_muted: false,
            audio_solo: false,
        }
    }

    // ------------------------------------------------------------------
    // Gain / Fade
    // ------------------------------------------------------------------

    #[test]
    fn gain_envelope_applies_linear_fades() {
        let l = layer();
        assert_eq!(gain_at_clip_time(&l, 0.0), 0.0);
        assert!((gain_at_clip_time(&l, 1.0) - 0.5).abs() < 1e-9);
        assert!((gain_at_clip_time(&l, 5.0) - 1.0).abs() < 1e-9);
        assert!((gain_at_clip_time(&l, 9.0) - 0.5).abs() < 1e-9);
    }

    #[test]
    fn logarithmic_fade_reaches_unity() {
        assert_eq!(fade_curve(0.0, AudioFadeCurve::Logarithmic), 0.0);
        assert!((fade_curve(1.0, AudioFadeCurve::Logarithmic) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn overlapping_fades_are_scaled_to_meet_without_dipping() {
        let mut l = layer();
        l.audio_fade_in_sec = 12.0;
        l.audio_fade_out_sec = 12.0;
        assert!((gain_at_clip_time(&l, 5.0) - 1.0).abs() < 1e-9);
        assert!((gain_at_clip_time(&l, 2.5) - 0.5).abs() < 1e-9);
        assert!((gain_at_clip_time(&l, 7.5) - 0.5).abs() < 1e-9);
    }

    #[test]
    fn effective_fades_scales_overlap_proportionally() {
        let mut l = layer();
        l.audio_fade_in_sec = 6.0;
        l.audio_fade_out_sec = 9.0;
        let (fade_in, fade_out) = effective_fades(&l, 10.0);
        assert!((fade_in - 4.0).abs() < 1e-9);
        assert!((fade_out - 6.0).abs() < 1e-9);
    }

    // ------------------------------------------------------------------
    // Stereo Pan / Balance
    // ------------------------------------------------------------------

    #[test]
    fn stereo_balance_center_is_unity() {
        let (ll, lr, rl, rr) = stereo_pan_matrix(0.0);
        assert!((ll - 1.0).abs() < 1e-9);
        assert_eq!(lr, 0.0);
        assert_eq!(rl, 0.0);
        assert!((rr - 1.0).abs() < 1e-9);
    }

    #[test]
    fn stereo_balance_full_left() {
        let (ll, lr, rl, rr) = stereo_pan_matrix(-1.0);
        assert!((ll - 1.0).abs() < 1e-9);
        assert_eq!(lr, 0.0);
        assert_eq!(rl, 0.0);
        assert!((rr - 0.0).abs() < 1e-9);
    }

    #[test]
    fn stereo_balance_full_right() {
        let (ll, lr, rl, rr) = stereo_pan_matrix(1.0);
        assert!((ll - 0.0).abs() < 1e-9);
        assert_eq!(lr, 0.0);
        assert_eq!(rl, 0.0);
        assert!((rr - 1.0).abs() < 1e-9);
    }

    #[test]
    fn stereo_balance_half_left_attenuates_right() {
        let (ll, _, _, rr) = stereo_pan_matrix(-0.5);
        assert!((ll - 1.0).abs() < 1e-9);
        assert!((rr - 0.5).abs() < 1e-9);
    }

    #[test]
    fn stereo_balance_no_boost() {
        let (ll, _lr, _rl, rr) = stereo_pan_matrix(0.0);
        assert!(ll <= 1.0 + 1e-9);
        assert!(rr <= 1.0 + 1e-9);
    }

    // ------------------------------------------------------------------
    // Master Gain / Soft Clip
    // ------------------------------------------------------------------

    #[test]
    fn master_gain_is_applied_after_layer_mix() {
        let mut samples = vec![0.25, -0.5, 1.0];
        apply_master_gain(&mut samples, 0.5);
        assert_eq!(samples, vec![0.125, -0.25, 0.5]);
    }

    #[test]
    fn sanitize_master_gain_clamps_range_and_non_finite() {
        assert_eq!(sanitize_master_gain(-1.0), 0.0);
        assert_eq!(sanitize_master_gain(2.0), 2.0);
        assert_eq!(sanitize_master_gain(1000.0), MAX_MASTER_GAIN);
        assert_eq!(sanitize_master_gain(f64::NAN), 1.0);
        assert_eq!(sanitize_master_gain(f64::INFINITY), 1.0);
    }

    #[test]
    fn soft_clip_is_continuous_around_unity() {
        let mut below = vec![0.999f32];
        let mut above = vec![1.001f32];
        soft_clip(&mut below);
        soft_clip(&mut above);
        assert!(below[0] < 1.0 && above[0] < 1.0);
        assert!((above[0] - below[0]).abs() < 1e-3);
    }

    #[test]
    fn soft_clip_preserves_in_band() {
        let mut samples = vec![-0.5, 0.0, 0.5, 0.8, -0.8];
        soft_clip(&mut samples);
        assert!((samples[0] - (-0.5)).abs() < 1e-6);
        assert!((samples[1] - 0.0).abs() < 1e-6);
        assert!((samples[2] - 0.5).abs() < 1e-6);
        assert!((samples[3] - 0.8).abs() < 1e-6);
        assert!((samples[4] - (-0.8)).abs() < 1e-6);
    }

    #[test]
    fn soft_clip_limits_out_of_band() {
        let mut samples = vec![2.0, -2.0];
        soft_clip(&mut samples);
        assert!(samples[0] >= 0.8 && samples[0] <= 1.0);
        assert!(samples[1] <= -0.8 && samples[1] >= -1.0);
    }

    #[test]
    fn soft_clip_flushes_non_finite_samples() {
        let mut samples = vec![f32::NAN, f32::INFINITY, f32::NEG_INFINITY];
        soft_clip(&mut samples);
        assert_eq!(samples, vec![0.0, 0.0, 0.0]);
    }

    #[test]
    fn sanitize_speed_rejects_non_positive() {
        assert_eq!(sanitize_speed(0.0), 1.0);
        assert_eq!(sanitize_speed(-1.0), 1.0);
        assert_eq!(sanitize_speed(f64::NAN), 1.0);
        assert_eq!(sanitize_speed(f64::INFINITY), 1.0);
        assert_eq!(sanitize_speed(0.005), 0.01);
        assert_eq!(sanitize_speed(101.0), 100.0);
    }

    // ------------------------------------------------------------------
    // Mix / Integration
    // ------------------------------------------------------------------

    #[test]
    fn mix_chunk_with_solo_mutes_others() {
        let mut l1 = layer();
        l1.id = "l1".into();
        l1.track_id = Some("t1".into());
        let mut l2 = layer();
        l2.id = "l2".into();
        l2.track_id = Some("t2".into());
        l2.timeline_start_sec = 0.0;
        l2.timeline_end_sec = 1.0;

        let mut t1 = track("t1");
        t1.audio_solo = true;
        let t2 = track("t2");

        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        let chunk = mix_chunk(
            &[l1, l2],
            &[t1, t2],
            1.0,
            0.0,
            1.0,
            48000,
            2,
            &shared,
            false,
        );
        assert_eq!(chunk.len(), (1.0f64 * 48000.0).round() as usize * 2);
    }

    #[test]
    fn mix_chunk_clamps_prevent_inf() {
        let mut l = layer();
        l.audio_gain = 1000.0;
        let mut l2 = layer();
        l2.id = "l2".into();
        l2.audio_gain = 1000.0;

        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        let chunk = mix_chunk(&[l, l2], &[], 10.0, 0.0, 0.01, 48000, 2, &shared, false);
        assert!(
            chunk.iter().all(|s| s.is_finite()),
            "mix produced non-finite sample"
        );
    }

    #[test]
    fn apply_layer_mix_zero_gain_skips() {
        let mut mixed = vec![0.0f32; 4];
        let decoded = vec![1.0f32, 2.0f32, 3.0f32, 4.0f32];
        let mut l = layer();
        l.audio_gain = 0.0;
        apply_layer_mix(&mut mixed, &decoded, 0, 2, 48000, &l, 0.0, 2);
        assert_eq!(mixed, vec![0.0, 0.0, 0.0, 0.0]);
    }

    #[test]
    fn apply_layer_mix_allows_headroom_for_later_clamp() {
        let mut mixed = vec![0.0f32; 4];
        let decoded = vec![10.0f32, 10.0f32, 10.0f32, 10.0f32];
        let mut l = layer();
        l.audio_gain = 5.0;
        l.audio_fade_in_sec = 0.0;
        l.audio_fade_out_sec = 0.0;
        apply_layer_mix(&mut mixed, &decoded, 0, 2, 48000, &l, 0.0, 2);
        let expected = 10.0f32 * 5.0;
        assert!((mixed[0] - expected).abs() < 1e-4);
        assert!((mixed[1] - expected).abs() < 1e-4);
        assert!((mixed[2] - expected).abs() < 1e-4);
        assert!((mixed[3] - expected).abs() < 1e-4);
    }

    #[test]
    fn apply_layer_mix_passes_extra_channels_through() {
        let mut mixed = vec![0.0f32; 8];
        let decoded = vec![1.0f32, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0];
        let mut l = layer();
        l.audio_fade_in_sec = 0.0;
        l.audio_fade_out_sec = 0.0;

        apply_layer_mix(&mut mixed, &decoded, 0, 2, 48000, &l, 0.0, 4);

        let expected = vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0];
        assert_eq!(mixed, expected);
    }

    #[test]
    fn apply_layer_mix_supports_mono_output() {
        let mut mixed = vec![0.0f32; 2];
        let decoded = vec![1.0f32, 2.0];
        let mut l = layer();
        l.audio_fade_in_sec = 0.0;
        l.audio_fade_out_sec = 0.0;

        apply_layer_mix(&mut mixed, &decoded, 0, 2, 48000, &l, 0.0, 1);

        assert_eq!(mixed, decoded);
    }

    #[test]
    fn resolve_track_requires_exact_or_underscore_suffix() {
        let tracks = vec![track("a"), track("abc")];
        assert_eq!(resolve_track_for_layer("abc", &tracks).unwrap().id, "abc");
        assert_eq!(resolve_track_for_layer("a_take", &tracks).unwrap().id, "a");
        assert!(resolve_track_for_layer("ab", &tracks).is_none());
    }

    #[test]
    fn reverse_frames_flips_interleaved_buffer() {
        let mut buf = vec![1.0f32, 1.1, 2.0, 2.1, 3.0, 3.1, 4.0, 4.1];
        reverse_frames(&mut buf, 2);
        assert_eq!(buf, vec![4.0, 4.1, 3.0, 3.1, 2.0, 2.1, 1.0, 1.1]);
    }

    #[test]
    fn reverse_frames_mono_works() {
        let mut buf = vec![1.0f32, 2.0, 3.0, 4.0];
        reverse_frames(&mut buf, 1);
        assert_eq!(buf, vec![4.0, 3.0, 2.0, 1.0]);
    }

    #[test]
    fn reversed_source_start_computes_from_timeline_end() {
        let l = SceneAudioLayer {
            id: "rev".into(),
            track_id: None,
            path: "/tmp/x.wav".into(),
            timeline_start_sec: 0.0,
            timeline_end_sec: 10.0,
            source_start_sec: 5.0,
            source_range_duration_sec: 0.0,
            speed: -1.0,
            audio_gain: 1.0,
            audio_balance: 0.0,
            audio_fade_in_sec: 0.0,
            audio_fade_out_sec: 0.0,
            audio_fade_in_curve: AudioFadeCurve::Linear,
            audio_fade_out_curve: AudioFadeCurve::Linear,
        };
        let segment_end = 0.05;
        let source_start = l.source_pts_at(segment_end);
        assert!(
            (source_start - 14.949).abs() < 1e-9,
            "expected 14.949, got {}",
            source_start
        );
    }

    #[test]
    fn reversed_layer_is_muted_in_preview() {
        let l = SceneAudioLayer {
            id: "rev".into(),
            track_id: None,
            path: "/tmp/x.wav".into(),
            timeline_start_sec: 0.0,
            timeline_end_sec: 10.0,
            source_start_sec: 0.0,
            source_range_duration_sec: 0.0,
            speed: -1.0,
            audio_gain: 1.0,
            audio_balance: 0.0,
            audio_fade_in_sec: 0.0,
            audio_fade_out_sec: 0.0,
            audio_fade_in_curve: AudioFadeCurve::Linear,
            audio_fade_out_curve: AudioFadeCurve::Linear,
        };
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        let preview_result = mix_layer_into(
            &mut vec![0.0f32; 4800],
            &l,
            0.0,
            0.05,
            2400,
            48000,
            2,
            false,
            &shared,
        );
        assert!(!preview_result, "reverse audio should be muted in preview");
    }

    #[test]
    fn reversed_layer_is_enabled_in_export() {
        let path = "../test/fixtures/media/sample-1s-audio.mp3";
        let l = SceneAudioLayer {
            id: "rev".into(),
            track_id: None,
            path: path.into(),
            timeline_start_sec: 0.0,
            timeline_end_sec: 10.0,
            source_start_sec: 0.0,
            source_range_duration_sec: 0.0,
            speed: -1.0,
            audio_gain: 1.0,
            audio_balance: 0.0,
            audio_fade_in_sec: 0.0,
            audio_fade_out_sec: 0.0,
            audio_fade_in_curve: AudioFadeCurve::Linear,
            audio_fade_out_curve: AudioFadeCurve::Linear,
        };
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        let export_result = mix_layer_into(
            &mut vec![0.0f32; 4800],
            &l,
            0.0,
            0.05,
            2400,
            48000,
            2,
            true,
            &shared,
        );
        assert!(export_result, "reverse audio should be enabled in export");
    }

    #[test]
    fn chunk_write_range_uses_contiguous_absolute_frame_grid() {
        let sample_rate = 48_000;
        let chunk_frames = 2_400;
        let first = chunk_write_range(0.0, 0.0, 0.05, sample_rate, chunk_frames);
        let second = chunk_write_range(0.05, 0.05, 0.1, sample_rate, chunk_frames);

        assert_eq!(first, (0, 2_400));
        assert_eq!(second, (0, 2_400));
    }

    #[test]
    fn chunk_write_range_clips_layer_boundary_inside_chunk() {
        let sample_rate = 48_000;
        let chunk_frames = 2_400;
        let range = chunk_write_range(1.0, 1.01, 1.03, sample_rate, chunk_frames);

        assert_eq!(range, (480, 960));
    }

    // ------------------------------------------------------------------
    // WAV Export
    // ------------------------------------------------------------------

    #[test]
    fn render_scene_to_wav_produces_valid_header() {
        let tmp =
            std::env::temp_dir().join(format!("fastcat-audit-wav-test-{}.wav", std::process::id()));
        let l = layer();
        render_scene_to_wav(&[l], &[], 1.0, 0.0, 0.01, 48000, 1, &tmp).unwrap();

        let bytes = std::fs::read(&tmp).unwrap();
        assert!(bytes.len() >= 44);
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        assert_eq!(&bytes[12..16], b"fmt ");
        assert_eq!(u16::from_le_bytes(bytes[22..24].try_into().unwrap()), 1);

        let data_size = u32::from_le_bytes(bytes[40..44].try_into().unwrap()) as u64;
        let riff_size = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as u64;
        assert_eq!(riff_size, 36 + data_size);

        let _ = std::fs::remove_file(&tmp);
    }
}
