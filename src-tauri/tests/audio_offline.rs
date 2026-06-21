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
