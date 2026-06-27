//! Offline audio-engine integration tests: render a scene to PCM in memory
//! (decode → resample → pan → master gain) and assert signal properties. No
//! audio device and no external ffmpeg binary are required (decoding uses the
//! linked libav). Requires the `test-support` feature.

#![cfg(feature = "test-support")]

mod common;

use app_lib::audio::mix::render_scene_to_samples;
use app_lib::monitor::scene::{AudioFadeCurve, SceneAudioLayer, SceneAudioTrack};
use serde_json::json;

const SR: u32 = 48_000;

fn sine_layer(rel_fixture: &str) -> SceneAudioLayer {
    let path = common::fixture(rel_fixture);
    serde_json::from_value(json!({
        "id": "layer-1",
        "path": path.to_string_lossy(),
        "timeline_start_sec": 0.0,
        "timeline_end_sec": 1.0,
        "source_start_sec": 0.0,
    }))
    .expect("SceneAudioLayer should deserialize")
}

fn sine_layer_on_track(rel_fixture: &str, track_id: &str) -> SceneAudioLayer {
    let mut layer = sine_layer(rel_fixture);
    layer.track_id = Some(track_id.to_string());
    layer
}

fn audio_track(id: &str) -> SceneAudioTrack {
    serde_json::from_value(json!({
        "id": id,
        "audio_gain": 1.0,
        "audio_balance": 0.0,
        "audio_muted": false,
        "audio_solo": false,
    }))
    .expect("SceneAudioTrack should deserialize")
}

/// RMS of an interleaved/mono buffer.
fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f64 = samples.iter().map(|s| (*s as f64) * (*s as f64)).sum();
    (sum / samples.len() as f64).sqrt() as f32
}

/// Count sign changes — for a pure tone this is ~2*frequency per second.
fn zero_crossings(samples: &[f32]) -> usize {
    samples
        .windows(2)
        .filter(|w| (w[0] <= 0.0) != (w[1] <= 0.0))
        .count()
}

fn channel_samples(samples: &[f32], channel: usize, channels: usize) -> Vec<f32> {
    samples
        .chunks_exact(channels)
        .map(|frame| frame[channel])
        .collect()
}

#[test]
fn renders_mono_sine_with_expected_length_and_frequency() {
    let scene = [sine_layer("audio/audio-sine.wav")];
    let pcm = render_scene_to_samples(&scene, &[], 1.0, 0.0, 1.0, SR, 1).unwrap();

    // ~1 second of mono at 48 kHz.
    assert!(
        (pcm.len() as i64 - SR as i64).abs() < 1_000,
        "expected ~{SR} mono samples, got {}",
        pcm.len()
    );
    assert!(
        rms(&pcm) > 0.02,
        "decoded sine should carry energy, rms={}",
        rms(&pcm)
    );

    // The 440 Hz fixture crosses zero ~880 times per second.
    let zc = zero_crossings(&pcm);
    assert!(
        (800..=960).contains(&zc),
        "expected ~880 zero-crossings for 440 Hz, got {zc}"
    );
}

#[test]
fn empty_scene_renders_silence() {
    let pcm = render_scene_to_samples(&[], &[], 1.0, 0.0, 1.0, SR, 1).unwrap();
    assert!(
        rms(&pcm) < 1e-4,
        "empty scene must be silent, rms={}",
        rms(&pcm)
    );
}

#[test]
fn master_gain_scales_amplitude() {
    let scene = [sine_layer("audio/audio-sine.wav")];
    let full = rms(&render_scene_to_samples(&scene, &[], 1.0, 0.0, 1.0, SR, 1).unwrap());
    let half = rms(&render_scene_to_samples(&scene, &[], 0.5, 0.0, 1.0, SR, 1).unwrap());

    let ratio = half / full;
    assert!(
        (ratio - 0.5).abs() < 0.05,
        "0.5 gain should halve RMS, ratio={ratio}"
    );
}

#[test]
fn zero_master_gain_is_silent() {
    let scene = [sine_layer("audio/audio-sine.wav")];
    let pcm = render_scene_to_samples(&scene, &[], 0.0, 0.0, 1.0, SR, 1).unwrap();
    assert!(rms(&pcm) < 1e-3, "zero gain should mute, rms={}", rms(&pcm));
}

#[test]
fn renders_stereo_output_interleaved() {
    let scene = [sine_layer("audio/audio-sine.wav")];
    let pcm = render_scene_to_samples(&scene, &[], 1.0, 0.0, 1.0, SR, 2).unwrap();

    // Stereo → roughly twice the sample count of mono.
    assert!(
        (pcm.len() as i64 - 2 * SR as i64).abs() < 2_000,
        "expected ~{} stereo samples, got {}",
        2 * SR,
        pcm.len()
    );
    assert!(rms(&pcm) > 0.02);
}

/// Regression output: chunk-boundary RMS continuity (no-click check).
///
/// The export path renders in 50 ms chunks. A discontinuity at a chunk
/// boundary (caused by a resampler reset, a dropped packet tail, or a
/// seek mismatch) produces a click — a single-sample spike whose energy
/// dwarfs the surrounding signal. This test renders a continuous 440 Hz
/// tone and checks that the RMS energy in a narrow window around each
/// 50 ms chunk boundary matches the RMS in the interior of the adjacent
/// chunks. A click would show up as a localized RMS spike.
#[test]
fn chunk_boundary_rms_continuity_no_click() {
    let scene = [sine_layer("audio/audio-sine.wav")];
    let pcm = render_scene_to_samples(&scene, &[], 1.0, 0.0, 1.0, SR, 1).unwrap();

    let chunk_frames = (0.05 * SR as f64).round() as usize; // 2400 frames
    let boundary_window = 16; // ±16 samples around the boundary

    let interior_rms = rms(&pcm[chunk_frames..chunk_frames + 480]);

    // Check every 50ms boundary within the 1s render.
    for boundary in (chunk_frames..pcm.len().saturating_sub(boundary_window)).step_by(chunk_frames)
    {
        let start = boundary.saturating_sub(boundary_window);
        let end = (boundary + boundary_window).min(pcm.len());
        let boundary_rms = rms(&pcm[start..end]);

        // The boundary RMS should be in the same ballpark as the interior.
        // A click would produce a spike 2× or more above the interior level.
        let ratio = boundary_rms / interior_rms;
        assert!(
            ratio > 0.5 && ratio < 2.0,
            "RMS spike at chunk boundary {boundary}: boundary={boundary_rms:.6}, interior={interior_rms:.6}, ratio={ratio:.3}"
        );
    }
}

/// Regression output: master gain clamp at MAX_MASTER_GAIN (8.0).
///
/// The native mixer clamps master gain to [0, 8]. A gain above the cap
/// must be clamped, not passed through, to prevent clipping the output
/// device. This test verifies that gain=10.0 produces the same output
/// level as gain=8.0 (the cap).
#[test]
fn master_gain_above_cap_is_clamped_to_max() {
    let scene = [sine_layer("audio/audio-sine.wav")];
    let at_cap = rms(&render_scene_to_samples(&scene, &[], 8.0, 0.0, 1.0, SR, 1).unwrap());
    let above_cap = rms(&render_scene_to_samples(&scene, &[], 10.0, 0.0, 1.0, SR, 1).unwrap());

    // 10.0 should be clamped to 8.0, so the RMS must be identical.
    let ratio = above_cap / at_cap;
    assert!(
        (ratio - 1.0).abs() < 0.05,
        "gain=10.0 should be clamped to 8.0, but ratio={ratio:.4}"
    );
}

/// Regression output: sanitize_speed clamp equivalence.
///
/// The native mixer clamps speed to [0.01, 100]. A speed of 0.0 or
/// negative is replaced with 1.0 (passthrough). This test verifies
/// that speed=0.0 produces the same output length as speed=1.0.
#[test]
fn sanitize_speed_zero_replaced_with_one() {
    let scene = [sine_layer("audio/audio-sine.wav")];
    let mut zero_speed_layer = sine_layer("audio/audio-sine.wav");
    zero_speed_layer.speed = 0.0;
    let zero_speed_scene = [zero_speed_layer];

    let normal = render_scene_to_samples(&scene, &[], 1.0, 0.0, 1.0, SR, 1).unwrap();
    let zero_speed = render_scene_to_samples(&zero_speed_scene, &[], 1.0, 0.0, 1.0, SR, 1).unwrap();

    // Both should produce ~1s of output (speed=0 → 1.0 passthrough).
    assert!(
        (normal.len() as i64 - zero_speed.len() as i64).abs() < 1_000,
        "speed=0 should be replaced with 1.0, but lengths differ: {} vs {}",
        normal.len(),
        zero_speed.len()
    );
    let ratio = rms(&zero_speed) / rms(&normal);
    assert!(
        (ratio - 1.0).abs() < 0.05,
        "speed=0 should preserve normal-speed RMS, ratio={ratio:.4}"
    );
}

#[test]
fn speed_two_doubles_sine_frequency_when_source_range_is_available() {
    let mut layer = sine_layer("audio/audio-sine.wav");
    layer.timeline_end_sec = 0.5;
    layer.speed = 2.0;
    let pcm = render_scene_to_samples(&[layer], &[], 1.0, 0.0, 0.5, SR, 1).unwrap();

    assert!(
        (pcm.len() as i64 - (SR / 2) as i64).abs() < 1_000,
        "timeline duration should stay ~0.5s, got {} samples",
        pcm.len()
    );
    let zc = zero_crossings(&pcm);
    assert!(
        (800..=960).contains(&zc),
        "2x speed over 0.5s should produce ~880 zero-crossings for 880 Hz, got {zc}"
    );
}

#[test]
fn track_gain_scales_owned_layer_amplitude() {
    let layer = sine_layer_on_track("audio/audio-sine.wav", "track-a");
    let mut half_track = audio_track("track-a");
    half_track.audio_gain = 0.5;

    let full = rms(&render_scene_to_samples(
        std::slice::from_ref(&layer),
        &[audio_track("track-a")],
        1.0,
        0.0,
        1.0,
        SR,
        1,
    )
    .unwrap());
    let half =
        rms(&render_scene_to_samples(&[layer], &[half_track], 1.0, 0.0, 1.0, SR, 1).unwrap());

    let ratio = half / full;
    assert!(
        (ratio - 0.5).abs() < 0.05,
        "0.5 track gain should halve RMS, ratio={ratio:.4}"
    );
}

#[test]
fn muted_track_silences_owned_layer() {
    let layer = sine_layer_on_track("audio/audio-sine.wav", "track-a");
    let mut track = audio_track("track-a");
    track.audio_muted = true;

    let pcm = render_scene_to_samples(&[layer], &[track], 1.0, 0.0, 1.0, SR, 1).unwrap();
    assert!(
        rms(&pcm) < 1e-4,
        "muted track should be silent, rms={}",
        rms(&pcm)
    );
}

#[test]
fn solo_track_mutes_other_tracks() {
    let audible = sine_layer_on_track("audio/audio-sine.wav", "track-a");
    let muted_by_solo = sine_layer_on_track("audio/audio-sine.wav", "track-b");
    let mut solo = audio_track("track-a");
    solo.audio_solo = true;
    let other = audio_track("track-b");

    let solo_mix = rms(&render_scene_to_samples(
        &[audible.clone(), muted_by_solo],
        &[solo, other],
        1.0,
        0.0,
        1.0,
        SR,
        1,
    )
    .unwrap());
    let one_clip =
        rms(
            &render_scene_to_samples(&[audible], &[audio_track("track-a")], 1.0, 0.0, 1.0, SR, 1)
                .unwrap(),
        );

    let ratio = solo_mix / one_clip;
    assert!(
        (ratio - 1.0).abs() < 0.05,
        "solo mix should match the soloed track only, ratio={ratio:.4}"
    );
}

#[test]
fn linear_fades_reduce_edge_energy_and_preserve_middle() {
    let mut layer = sine_layer("audio/audio-sine.wav");
    layer.audio_fade_in_sec = 0.25;
    layer.audio_fade_out_sec = 0.25;
    layer.audio_fade_in_curve = AudioFadeCurve::Linear;
    layer.audio_fade_out_curve = AudioFadeCurve::Linear;

    let pcm = render_scene_to_samples(&[layer], &[], 1.0, 0.0, 1.0, SR, 1).unwrap();
    let edge_frames = (0.05 * SR as f64) as usize;
    let middle_start = (0.45 * SR as f64) as usize;
    let edge_rms = rms(&pcm[..edge_frames]);
    let middle_rms = rms(&pcm[middle_start..middle_start + edge_frames]);
    let tail_rms = rms(&pcm[pcm.len() - edge_frames..]);

    assert!(
        edge_rms < middle_rms * 0.35,
        "fade-in edge should be quieter than middle: edge={edge_rms:.6}, middle={middle_rms:.6}"
    );
    assert!(
        tail_rms < middle_rms * 0.35,
        "fade-out edge should be quieter than middle: tail={tail_rms:.6}, middle={middle_rms:.6}"
    );
    assert!(
        middle_rms > 0.02,
        "middle should retain audible sine energy"
    );
}

#[test]
fn hard_left_balance_folds_stereo_energy_into_left_channel() {
    let mut layer = sine_layer("audio/audio-sine.wav");
    layer.audio_balance = -1.0;

    let pcm = render_scene_to_samples(&[layer], &[], 1.0, 0.0, 1.0, SR, 2).unwrap();
    let left = channel_samples(&pcm, 0, 2);
    let right = channel_samples(&pcm, 1, 2);

    assert!(rms(&left) > 0.02, "left channel should carry folded energy");
    assert!(
        rms(&right) < 1e-4,
        "hard-left balance should silence the right channel, rms={}",
        rms(&right)
    );
}
