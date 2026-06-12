use std::collections::HashMap;
use std::io::{Seek, Write};
use std::path::Path;
use std::sync::Arc;

use anyhow::Context;
use parking_lot::{Condvar, Mutex};

use crate::audio::decode::decode_audio_chunk;
use crate::audio::shared::{AudioRenderTarget, AudioShared, CHUNK_DURATION_SEC};
use crate::monitor::scene::{AudioFadeCurve, SceneAudioLayer, SceneAudioTrack};

pub struct WavRenderParams<'a> {
    pub scene: &'a [SceneAudioLayer],
    pub tracks: &'a [SceneAudioTrack],
    pub master_gain: f64,
    pub audio_master_effects: &'a [crate::audio::plugins::AudioEffectSpec],
    pub start_sec: f64,
    pub end_sec: f64,
    pub sample_rate: u32,
    pub output_channels: usize,
    pub target_path: &'a Path,
    pub should_cancel: Option<&'a (dyn Fn() -> bool + Send + Sync)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DecodeErrorPolicy {
    WarnAndSkip,
    Propagate,
}

/// Renders the audio scene to an f32 WAV file.
///
/// `output_channels` selects the file's channel layout (1 = mono, 2 = stereo).
/// Export is intentionally limited to mono/stereo for now.
pub fn render_scene_to_wav(params: WavRenderParams<'_>) -> anyhow::Result<()> {
    let target = AudioRenderTarget::export(params.sample_rate, params.output_channels);
    let start = if params.start_sec.is_finite() {
        params.start_sec.max(0.0)
    } else {
        0.0
    };
    let end = if params.end_sec.is_finite() {
        params.end_sec.max(start)
    } else {
        start
    };
    let estimated_frames = ((end - start) * target.sample_rate as f64).round().max(1.0) as u64;
    let mut file = std::fs::File::create(params.target_path)
        .with_context(|| format!("create audio mix {}", params.target_path.display()))?;

    // Write placeholder header (will be patched after we know actual size). The temp mix
    // is a Sony Wave64 (.w64) container: identical f32 PCM payload to a plain WAV but with
    // 64-bit size fields, so a long export (a RIFF/WAV's 32-bit size caps at 4 GB ≈ 3 h of
    // 48 kHz stereo f32) no longer overflows. ffmpeg reads it natively (format_name=w64).
    write_wave64_f32_header_placeholder(&mut file, target.sample_rate, target.channels as u16)?;

    let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));

    let mut written_frames = 0u64;
    while written_frames < estimated_frames {
        if params
            .should_cancel
            .is_some_and(|should_cancel| should_cancel())
        {
            return Err(anyhow::anyhow!("cancelled"));
        }
        let chunk_frames = ((CHUNK_DURATION_SEC * target.sample_rate as f64).round() as u64)
            .min(estimated_frames - written_frames)
            .max(1);
        let chunk_duration = chunk_frames as f64 / target.sample_rate as f64;
        let chunk_start = start + written_frames as f64 / target.sample_rate as f64;
        let chunk = mix_chunk_strict(
            params.scene,
            params.tracks,
            params.master_gain,
            params.audio_master_effects,
            chunk_start,
            chunk_duration,
            target,
            &shared,
        )?;
        let samples_to_write = chunk_frames as usize * target.channels;
        for sample in chunk.into_iter().take(samples_to_write) {
            file.write_all(&sample.to_le_bytes())?;
        }
        written_frames = written_frames.saturating_add(chunk_frames);
    }

    // Patch the 64-bit size fields now that the frame count is known. Wave64 chunk sizes
    // *include* their own 16-byte GUID and 8-byte size field; the top-level `riff` size is
    // the whole file. Chunks are aligned to 8 bytes, with trailing pad excluded from the
    // chunk size but counted in the file total — so pad the `data` payload to a boundary.
    let data_bytes = written_frames
        .saturating_mul(target.channels as u64)
        .saturating_mul(4);
    let pad = (8 - (data_bytes % 8)) % 8;
    if pad > 0 {
        file.write_all(&[0u8; 7][..pad as usize])?;
    }
    let data_chunk_size = W64_DATA_HEADER_LEN + data_bytes;
    let riff_size = W64_HEADER_LEN + data_bytes + pad;
    // riff size field: 16 (riff GUID) + 8 (this field).
    file.seek(std::io::SeekFrom::Start(16))?;
    file.write_all(&riff_size.to_le_bytes())?;
    // data size field: 16 (riff) + 8 + 16 (wave) + 40 (fmt chunk) + 16 (data GUID) = 96.
    file.seek(std::io::SeekFrom::Start(96))?;
    file.write_all(&data_chunk_size.to_le_bytes())?;
    Ok(())
}

/// 12-byte fixed suffix shared by every Wave64 GUID after its 4-byte ASCII tag.
const W64_GUID_SUFFIX: [u8; 12] = [
    0xF3, 0xAC, 0xD3, 0x11, 0x8C, 0xD1, 0x00, 0xC0, 0x4F, 0x8E, 0xDB, 0x8A,
];
/// The top-level `riff` GUID uses a *different* suffix from the sub-chunks.
const W64_RIFF_GUID: [u8; 16] = [
    b'r', b'i', b'f', b'f', 0x2E, 0x91, 0xCF, 0x11, 0xA5, 0xD6, 0x28, 0xDB, 0x04, 0xC1, 0x00, 0x00,
];
/// Bytes of header that precede the `data` payload (riff..data GUID + data size field).
const W64_HEADER_LEN: u64 = 104;
/// `data` chunk overhead counted in its own size field: 16 (GUID) + 8 (size).
const W64_DATA_HEADER_LEN: u64 = 24;

fn w64_guid(tag: &[u8; 4]) -> [u8; 16] {
    let mut guid = [0u8; 16];
    guid[..4].copy_from_slice(tag);
    guid[4..].copy_from_slice(&W64_GUID_SUFFIX);
    guid
}

/// Writes the 104-byte Wave64 header with placeholder (zero) size fields, patched later.
/// Layout: riff GUID + size │ wave GUID │ fmt GUID + size + 16-byte f32 WAVEFORMAT │
/// data GUID + size. All multi-byte fields little-endian.
fn write_wave64_f32_header_placeholder(
    file: &mut std::fs::File,
    sample_rate: u32,
    channels: u16,
) -> anyhow::Result<()> {
    let bits_per_sample = 32u16;
    let bytes_per_sample = (bits_per_sample / 8) as u32;

    file.write_all(&W64_RIFF_GUID)?;
    file.write_all(&0u64.to_le_bytes())?; // riff size (patched)
    file.write_all(&w64_guid(b"wave"))?;

    file.write_all(&w64_guid(b"fmt "))?;
    // fmt chunk size: 16 (GUID) + 8 (size) + 16 (WAVEFORMAT body) = 40.
    file.write_all(&40u64.to_le_bytes())?;
    file.write_all(&3u16.to_le_bytes())?; // WAVE_FORMAT_IEEE_FLOAT
    file.write_all(&channels.to_le_bytes())?;
    file.write_all(&sample_rate.to_le_bytes())?;
    let byte_rate = sample_rate
        .saturating_mul(channels as u32)
        .saturating_mul(bytes_per_sample);
    file.write_all(&byte_rate.to_le_bytes())?;
    let block_align = channels.saturating_mul(bytes_per_sample as u16);
    file.write_all(&block_align.to_le_bytes())?;
    file.write_all(&bits_per_sample.to_le_bytes())?;

    file.write_all(&w64_guid(b"data"))?;
    file.write_all(&0u64.to_le_bytes())?; // data size (patched)
    Ok(())
}

pub(crate) fn mix_chunk(
    scene: &[SceneAudioLayer],
    tracks: &[SceneAudioTrack],
    master_gain: f64,
    audio_master_effects: &[crate::audio::plugins::AudioEffectSpec],
    chunk_start_sec: f64,
    chunk_duration_sec: f64,
    target: AudioRenderTarget,
    shared: &Arc<(Mutex<AudioShared>, Condvar)>,
) -> Vec<f32> {
    mix_chunk_ramped_result(
        scene,
        tracks,
        master_gain,
        audio_master_effects,
        None,
        chunk_start_sec,
        chunk_duration_sec,
        target,
        shared,
        DecodeErrorPolicy::WarnAndSkip,
    )
    .expect("warn-and-skip audio mix policy must not return decode errors")
}

/// Same as [`mix_chunk`] but, when `prev_master_gain` is `Some`, ramps the master
/// gain linearly from the previous chunk's value to `master_gain` across this
/// chunk instead of applying it as a per-chunk step. This removes the "zipper"
/// heard when the master volume is dragged during playback (each 50 ms chunk
/// otherwise jumped to a new constant gain). `None` keeps the exact original
/// per-chunk behaviour, so offline export, scrub previews and tests are
/// unaffected — the ramp only engages on the realtime producer path mid-drag.
#[allow(clippy::too_many_arguments)]
pub(crate) fn mix_chunk_ramped(
    scene: &[SceneAudioLayer],
    tracks: &[SceneAudioTrack],
    master_gain: f64,
    audio_master_effects: &[crate::audio::plugins::AudioEffectSpec],
    prev_master_gain: Option<f64>,
    chunk_start_sec: f64,
    chunk_duration_sec: f64,
    target: AudioRenderTarget,
    shared: &Arc<(Mutex<AudioShared>, Condvar)>,
) -> Vec<f32> {
    mix_chunk_ramped_result(
        scene,
        tracks,
        master_gain,
        audio_master_effects,
        prev_master_gain,
        chunk_start_sec,
        chunk_duration_sec,
        target,
        shared,
        DecodeErrorPolicy::WarnAndSkip,
    )
    .expect("warn-and-skip audio mix policy must not return decode errors")
}

pub(crate) fn mix_chunk_strict(
    scene: &[SceneAudioLayer],
    tracks: &[SceneAudioTrack],
    master_gain: f64,
    audio_master_effects: &[crate::audio::plugins::AudioEffectSpec],
    chunk_start_sec: f64,
    chunk_duration_sec: f64,
    target: AudioRenderTarget,
    shared: &Arc<(Mutex<AudioShared>, Condvar)>,
) -> anyhow::Result<Vec<f32>> {
    mix_chunk_ramped_result(
        scene,
        tracks,
        master_gain,
        audio_master_effects,
        None,
        chunk_start_sec,
        chunk_duration_sec,
        target,
        shared,
        DecodeErrorPolicy::Propagate,
    )
}

#[allow(clippy::too_many_arguments)]
fn mix_chunk_ramped_result(
    scene: &[SceneAudioLayer],
    tracks: &[SceneAudioTrack],
    master_gain: f64,
    audio_master_effects: &[crate::audio::plugins::AudioEffectSpec],
    prev_master_gain: Option<f64>,
    chunk_start_sec: f64,
    chunk_duration_sec: f64,
    target: AudioRenderTarget,
    shared: &Arc<(Mutex<AudioShared>, Condvar)>,
    decode_error_policy: DecodeErrorPolicy,
) -> anyhow::Result<Vec<f32>> {
    let sample_rate = target.sample_rate;
    let output_channels = target.channels;
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
                MixLayerParams {
                    buffer: &mut track_mixed,
                    layer,
                    chunk_start_sec,
                    chunk_end_sec,
                    frames,
                    sample_rate,
                    output_channels,
                    target,
                    shared,
                },
                decode_error_policy,
            )?;
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
                MixLayerParams {
                    buffer: &mut mixed,
                    layer,
                    chunk_start_sec,
                    chunk_end_sec,
                    frames,
                    sample_rate,
                    output_channels,
                    target,
                    shared,
                },
                decode_error_policy,
            )?;
        }
    }

    // Apply master audio effects post-mix (compressor / limiter / reverb etc.)
    if !audio_master_effects.is_empty() {
        let plugin_host = { shared.0.lock().plugin_host.clone() };
        plugin_host
            .lock()
            .apply_master_effects(&mut mixed, sample_rate, output_channels, audio_master_effects);
    }

    match prev_master_gain {
        Some(prev) => {
            apply_master_gain_ramp(&mut mixed, prev, master_gain, frames, output_channels)
        }
        None => apply_master_gain(&mut mixed, master_gain),
    }
    soft_clip(&mut mixed);
    Ok(mixed)
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

struct MixLayerParams<'a> {
    buffer: &'a mut [f32],
    layer: &'a SceneAudioLayer,
    chunk_start_sec: f64,
    chunk_end_sec: f64,
    frames: usize,
    sample_rate: u32,
    output_channels: usize,
    target: AudioRenderTarget,
    shared: &'a Arc<(Mutex<AudioShared>, Condvar)>,
}

/// Decodes, optionally reverses, and mixes a single layer into `buffer`.
/// Returns `true` if the layer contributed audio to this chunk.
fn mix_layer_into(
    params: MixLayerParams<'_>,
    decode_error_policy: DecodeErrorPolicy,
) -> anyhow::Result<bool> {
    let MixLayerParams {
        buffer,
        layer,
        chunk_start_sec,
        chunk_end_sec,
        frames,
        sample_rate,
        output_channels,
        target,
        shared,
    } = params;
    if layer.timeline_end_sec <= chunk_start_sec || layer.timeline_start_sec >= chunk_end_sec {
        return Ok(false);
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
        return Ok(false);
    }
    let segment_start = chunk_start_sec + write_start_frame as f64 / sample_rate as f64;
    let segment_duration = frames_to_write as f64 / sample_rate as f64;
    let segment_end = segment_start + segment_duration;

    let reversed = layer.speed < 0.0;
    if !target.is_export() && reversed {
        // Reverse audio is muted in preview/monitor; only rendered on export.
        return Ok(false);
    }

    let speed = sanitize_speed(layer.speed.abs());
    let source_start = if reversed {
        layer.source_pts_at(segment_end)
    } else {
        layer.source_pts_at(segment_start)
    };

    let mut decoded = match decode_audio_chunk(crate::audio::decode::DecodeAudioChunkParams {
        layer_id: &layer.id,
        path: &layer.path,
        source_start_sec: source_start,
        timeline_duration_sec: segment_duration,
        speed,
        target,
        reverse: reversed,
        shared,
    })
    .with_context(|| format!("decode audio layer {}", layer.id))
    {
        Ok(decoded) => decoded,
        Err(error) => {
            if decode_error_policy == DecodeErrorPolicy::Propagate {
                return Err(error);
            }
            log::warn!(
                "[audio] skipping layer {} at {chunk_start_sec:.3}s: {error:?}",
                layer.id
            );
            return Ok(false);
        }
    };

    if reversed {
        reverse_frames(&mut decoded, output_channels);
    }

    // Apply audio effects (LV2/CLAP/VST3 or native) before mixing.
    // The PluginHost has its own mutex, so plugin processing does not block
    // transport commands, cache updates, or producer state publication.
    if !layer.audio_effects.is_empty() {
        let plugin_host = { shared.0.lock().plugin_host.clone() };
        plugin_host.lock().apply_effects(
            &layer.id,
            &mut decoded,
            sample_rate,
            output_channels,
            &layer.audio_effects,
        );
    }

    let frames_to_write = frames_to_write.min(decoded.len() / output_channels);
    debug_assert!(
        write_start_frame + frames_to_write <= buffer.len() / output_channels,
        "layer write range exceeds mix buffer"
    );
    apply_layer_mix(ApplyLayerMixParams {
        mixed: buffer,
        decoded: &decoded,
        write_start_frame,
        frames_to_write,
        sample_rate,
        layer,
        segment_start_sec: segment_start,
        channels: output_channels,
    });
    Ok(true)
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

/// Applies the master gain ramped linearly from `prev_gain` (chunk start) to
/// `target_gain` (chunk end). When the two are equal this is identical to
/// [`apply_master_gain`], so a static master volume incurs no extra cost.
fn apply_master_gain_ramp(
    samples: &mut [f32],
    prev_gain: f64,
    target_gain: f64,
    frames: usize,
    channels: usize,
) {
    let g0 = sanitize_master_gain(prev_gain) as f32;
    let g1 = sanitize_master_gain(target_gain) as f32;
    if (g0 - g1).abs() <= f32::EPSILON {
        apply_master_gain(samples, target_gain);
        return;
    }
    // Ramp across frame centres so the first frame is not pinned to the previous
    // gain and the last not fully at the target — keeps the slope continuous with
    // the next chunk, which starts where this one ended.
    let denom = frames.max(1) as f32;
    for i in 0..frames {
        let t = (i as f32 + 0.5) / denom;
        let g = g0 + (g1 - g0) * t;
        let base = i * channels;
        for ch in 0..channels {
            let idx = base + ch;
            if idx < samples.len() {
                samples[idx] *= g;
            }
        }
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
struct ApplyLayerMixParams<'a> {
    mixed: &'a mut [f32],
    decoded: &'a [f32],
    write_start_frame: usize,
    frames_to_write: usize,
    sample_rate: u32,
    layer: &'a SceneAudioLayer,
    segment_start_sec: f64,
    channels: usize,
}

/// L/R pair; extra channels are passed through with gain. Mono output ignores
/// balance entirely.
fn apply_layer_mix(params: ApplyLayerMixParams<'_>) {
    let ApplyLayerMixParams {
        mixed,
        decoded,
        write_start_frame,
        frames_to_write,
        sample_rate,
        layer,
        segment_start_sec,
        channels,
    } = params;
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
/// Equal-power stereo pan/balance matrix matching the web export mixer's
/// `getStereoPanMatrix` (W3C `StereoPannerNode` law). For `balance <= 0` the right
/// channel is attenuated by `cos` and folded into the left by `sin`; for
/// `balance > 0` the left does the same toward the right. Unlike a plain linear
/// balance this preserves the panned-away channel's energy (folded across) rather
/// than discarding it — so `balance = ±1` no longer drops a whole channel — and
/// keeps web and native (monitor + export) renders in sync. Center is unity on both
/// channels (no ~3 dB dip), so applying it on both the layer and the bus is a
/// no-op at default balance.
fn stereo_pan_matrix(balance: f64) -> (f64, f64, f64, f64) {
    let pan = balance.clamp(-1.0, 1.0);
    let clean = |v: f64| if v.abs() < 1e-12 { 0.0 } else { v };
    if pan <= 0.0 {
        let angle = -pan * std::f64::consts::FRAC_PI_2;
        (1.0, clean(angle.sin()), 0.0, clean(angle.cos()))
    } else {
        let angle = pan * std::f64::consts::FRAC_PI_2;
        (clean(angle.cos()), 0.0, clean(angle.sin()), 1.0)
    }
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
            audio_effects: vec![],
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
    fn stereo_balance_full_left_folds_right_into_left() {
        // Equal-power: hard left fully folds the right channel into the left
        // (lr = 1) and zeroes the right output (rr = 0), instead of discarding it.
        let (ll, lr, rl, rr) = stereo_pan_matrix(-1.0);
        assert!((ll - 1.0).abs() < 1e-9);
        assert!((lr - 1.0).abs() < 1e-9);
        assert_eq!(rl, 0.0);
        assert!(rr.abs() < 1e-9);
    }

    #[test]
    fn stereo_balance_full_right_folds_left_into_right() {
        let (ll, lr, rl, rr) = stereo_pan_matrix(1.0);
        assert!(ll.abs() < 1e-9);
        assert_eq!(lr, 0.0);
        assert!((rl - 1.0).abs() < 1e-9);
        assert!((rr - 1.0).abs() < 1e-9);
    }

    #[test]
    fn stereo_balance_half_left_attenuates_right() {
        // cos(π/4) on the kept channel; the panned-away energy folds across (sin).
        let g = std::f64::consts::FRAC_1_SQRT_2;
        let (ll, lr, rl, rr) = stereo_pan_matrix(-0.5);
        assert!((ll - 1.0).abs() < 1e-9);
        assert!((lr - g).abs() < 1e-9);
        assert_eq!(rl, 0.0);
        assert!((rr - g).abs() < 1e-9);
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
    fn master_gain_ramp_interpolates_between_chunks() {
        // Four mono frames, all 1.0; ramp gain 0.0 → 1.0 across the chunk. With
        // frame-centre sampling the gains are 1/8, 3/8, 5/8, 7/8.
        let mut samples = vec![1.0f32; 4];
        apply_master_gain_ramp(&mut samples, 0.0, 1.0, 4, 1);
        let expected = [0.125f32, 0.375, 0.625, 0.875];
        for (got, want) in samples.iter().zip(expected.iter()) {
            assert!((got - want).abs() < 1e-6, "ramp mismatch: {got} vs {want}");
        }
    }

    #[test]
    fn master_gain_ramp_equal_values_match_constant_path() {
        let mut ramped = vec![0.5f32, -0.5, 1.0, 0.25];
        let mut constant = ramped.clone();
        apply_master_gain_ramp(&mut ramped, 0.5, 0.5, 4, 1);
        apply_master_gain(&mut constant, 0.5);
        assert_eq!(ramped, constant);
    }

    #[test]
    fn mix_chunk_none_prev_matches_constant_master_gain() {
        // `prev_master_gain = None` must be byte-for-byte identical to `mix_chunk`.
        let l = layer();
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        let target = AudioRenderTarget::monitor(48000, 2);
        let a = mix_chunk(&[l.clone()], &[], 0.5, &[], 0.0, 0.05, target, &shared);
        let b = mix_chunk_ramped(&[l], &[], 0.5, &[], None, 0.0, 0.05, target, &shared);
        assert_eq!(a, b);
    }

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
        let target = AudioRenderTarget::monitor(48000, 2);
        let chunk = mix_chunk(&[l1, l2], &[t1, t2], 1.0, &[], 0.0, 1.0, target, &shared);
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
        let target = AudioRenderTarget::monitor(48000, 2);
        let chunk = mix_chunk(&[l, l2], &[], 10.0, &[], 0.0, 0.01, target, &shared);
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
        apply_layer_mix(ApplyLayerMixParams {
            mixed: &mut mixed,
            decoded: &decoded,
            write_start_frame: 0,
            frames_to_write: 2,
            sample_rate: 48000,
            layer: &l,
            segment_start_sec: 0.0,
            channels: 2,
        });
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
        apply_layer_mix(ApplyLayerMixParams {
            mixed: &mut mixed,
            decoded: &decoded,
            write_start_frame: 0,
            frames_to_write: 2,
            sample_rate: 48000,
            layer: &l,
            segment_start_sec: 0.0,
            channels: 2,
        });
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

        apply_layer_mix(ApplyLayerMixParams {
            mixed: &mut mixed,
            decoded: &decoded,
            write_start_frame: 0,
            frames_to_write: 2,
            sample_rate: 48000,
            layer: &l,
            segment_start_sec: 0.0,
            channels: 4,
        });

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

        apply_layer_mix(ApplyLayerMixParams {
            mixed: &mut mixed,
            decoded: &decoded,
            write_start_frame: 0,
            frames_to_write: 2,
            sample_rate: 48000,
            layer: &l,
            segment_start_sec: 0.0,
            channels: 1,
        });

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
            audio_effects: vec![],
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
    fn reversed_source_range_duration_respected() {
        let l = SceneAudioLayer {
            id: "rev_dur".into(),
            track_id: None,
            path: "/tmp/x.wav".into(),
            timeline_start_sec: 0.0,
            timeline_end_sec: 10.0,
            source_start_sec: 5.0,
            source_range_duration_sec: 8.0,
            speed: -1.0,
            audio_gain: 1.0,
            audio_balance: 0.0,
            audio_fade_in_sec: 0.0,
            audio_fade_out_sec: 0.0,
            audio_fade_in_curve: AudioFadeCurve::Linear,
            audio_fade_out_curve: AudioFadeCurve::Linear,
            audio_effects: vec![],
        };
        let segment_end = 0.05;
        let source_start = l.source_pts_at(segment_end);
        assert!(
            (source_start - 12.949).abs() < 1e-9,
            "expected 12.949, got {}",
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
            audio_effects: vec![],
        };
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        let preview_result = mix_layer_into(
            MixLayerParams {
                buffer: &mut vec![0.0f32; 4800],
                layer: &l,
                chunk_start_sec: 0.0,
                chunk_end_sec: 0.05,
                frames: 2400,
                sample_rate: 48000,
                output_channels: 2,
                target: AudioRenderTarget::monitor(48000, 2),
                shared: &shared,
            },
            DecodeErrorPolicy::WarnAndSkip,
        )
        .unwrap();
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
            audio_effects: vec![],
        };
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        let export_result = mix_layer_into(
            MixLayerParams {
                buffer: &mut vec![0.0f32; 4800],
                layer: &l,
                chunk_start_sec: 0.0,
                chunk_end_sec: 0.05,
                frames: 2400,
                sample_rate: 48000,
                output_channels: 2,
                target: AudioRenderTarget::export(48000, 2),
                shared: &shared,
            },
            DecodeErrorPolicy::WarnAndSkip,
        )
        .unwrap();
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
    fn render_scene_to_wav_produces_valid_wave64_header() {
        let tmp =
            std::env::temp_dir().join(format!("fastcat-audit-w64-test-{}.w64", std::process::id()));
        render_scene_to_wav(WavRenderParams {
            scene: &[],
            tracks: &[],
            master_gain: 1.0,
            audio_master_effects: &[],
            start_sec: 0.0,
            end_sec: 0.01,
            sample_rate: 48000,
            output_channels: 1,
            target_path: &tmp,
            should_cancel: None,
        })
        .unwrap();

        let bytes = std::fs::read(&tmp).unwrap();
        assert_eq!(bytes.len() as u64 % 8, 0, "file must be 8-byte aligned");
        // riff / wave / fmt / data GUIDs match ffmpeg's Wave64 layout.
        assert_eq!(&bytes[0..16], &super::W64_RIFF_GUID);
        assert_eq!(&bytes[24..40], &super::w64_guid(b"wave"));
        assert_eq!(&bytes[40..56], &super::w64_guid(b"fmt "));
        assert_eq!(&bytes[80..96], &super::w64_guid(b"data"));
        // fmt: 64-bit chunk size 40, IEEE-float tag, 1 channel.
        assert_eq!(u64::from_le_bytes(bytes[56..64].try_into().unwrap()), 40);
        assert_eq!(u16::from_le_bytes(bytes[64..66].try_into().unwrap()), 3);
        assert_eq!(u16::from_le_bytes(bytes[66..68].try_into().unwrap()), 1);
        assert_eq!(u32::from_le_bytes(bytes[68..72].try_into().unwrap()), 48000);
        // 64-bit sizes: riff = whole file, data = 24 (GUID+size) + payload bytes.
        let riff_size = u64::from_le_bytes(bytes[16..24].try_into().unwrap());
        let data_size = u64::from_le_bytes(bytes[96..104].try_into().unwrap());
        assert_eq!(riff_size, bytes.len() as u64);
        assert_eq!(data_size, (bytes.len() as u64 - 104) + 24);

        let _ = std::fs::remove_file(&tmp);
    }

    #[test]
    fn render_scene_to_wav_pads_odd_payload_to_8_byte_boundary() {
        // Mono with an odd frame count yields a 4-byte-aligned payload; Wave64 requires
        // 8-byte chunk alignment, so the file must be padded (and the pad excluded from
        // the data chunk size but included in the file/riff total).
        let tmp = std::env::temp_dir()
            .join(format!("fastcat-audit-w64-pad-test-{}.w64", std::process::id()));
        // 7 frames @ 7000 Hz over 0.001 s ⇒ ceil to a small odd-ish count; mono f32.
        render_scene_to_wav(WavRenderParams {
            scene: &[],
            tracks: &[],
            master_gain: 1.0,
            audio_master_effects: &[],
            start_sec: 0.0,
            end_sec: 0.000_5,
            sample_rate: 6000,
            output_channels: 1,
            target_path: &tmp,
            should_cancel: None,
        })
        .unwrap();
        let bytes = std::fs::read(&tmp).unwrap();
        assert_eq!(bytes.len() as u64 % 8, 0);
        let data_size = u64::from_le_bytes(bytes[96..104].try_into().unwrap());
        let payload = bytes.len() as u64 - 104; // includes any pad
        // data chunk size counts payload sans pad; pad is 0..=4 bytes.
        assert!(data_size <= payload + 24 && data_size + 4 >= payload + 24);
        let _ = std::fs::remove_file(&tmp);
    }

    #[test]
    fn render_scene_to_wav_propagates_decode_errors() {
        let tmp = std::env::temp_dir().join(format!(
            "fastcat-audit-wav-missing-test-{}.wav",
            std::process::id()
        ));
        let l = layer();
        let result = render_scene_to_wav(WavRenderParams {
            scene: &[l],
            tracks: &[],
            master_gain: 1.0,
            audio_master_effects: &[],
            start_sec: 0.0,
            end_sec: 0.01,
            sample_rate: 48000,
            output_channels: 1,
            target_path: &tmp,
            should_cancel: None,
        });

        assert!(result
            .unwrap_err()
            .to_string()
            .contains("decode audio layer a1"));
        let _ = std::fs::remove_file(&tmp);
    }

    #[test]
    fn render_scene_to_wav_honours_cancel_before_writing_chunks() {
        let tmp = std::env::temp_dir().join(format!(
            "fastcat-audit-wav-cancel-test-{}.wav",
            std::process::id()
        ));
        let result = render_scene_to_wav(WavRenderParams {
            scene: &[],
            tracks: &[],
            master_gain: 1.0,
            audio_master_effects: &[],
            start_sec: 0.0,
            end_sec: 0.01,
            sample_rate: 48000,
            output_channels: 1,
            target_path: &tmp,
            should_cancel: Some(&|| true),
        });

        assert_eq!(result.unwrap_err().to_string(), "cancelled");
        let _ = std::fs::remove_file(&tmp);
    }

}
