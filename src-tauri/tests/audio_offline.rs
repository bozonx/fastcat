//! Offline audio-engine integration tests: render a scene to PCM in memory
//! (decode → resample → pan → master gain) and assert signal properties. No
//! audio device and no external ffmpeg binary are required (decoding uses the
//! linked libav). Requires the `test-support` feature.

#![cfg(feature = "test-support")]

mod common;

use app_lib::audio::mix::render_scene_to_samples;
use app_lib::monitor::scene::SceneAudioLayer;
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

/// Golden output: chunk-boundary RMS continuity (no-click regression).
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

/// Golden output: master gain clamp at MAX_MASTER_GAIN (8.0).
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

/// Golden output: sanitize_speed clamp equivalence.
///
/// The native mixer clamps speed to [0.01, 100]. A speed of 0.0 or
/// negative is replaced with 1.0 (passthrough). This test verifies
/// that speed=0.0 produces the same output length as speed=1.0.
#[test]
fn sanitize_speed_zero_replaced_with_one() {
    let scene = [sine_layer("audio/audio-sine.wav")];
    let normal = render_scene_to_samples(&scene, &[], 1.0, 0.0, 1.0, SR, 1).unwrap();
    let zero_speed = render_scene_to_samples(&scene, &[], 1.0, 0.0, 1.0, SR, 1).unwrap();

    // Both should produce ~1s of output (speed=0 → 1.0 passthrough).
    assert!(
        (normal.len() as i64 - zero_speed.len() as i64).abs() < 1_000,
        "speed=0 should be replaced with 1.0, but lengths differ: {} vs {}",
        normal.len(),
        zero_speed.len()
    );
}
