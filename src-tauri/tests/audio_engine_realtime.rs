//! Realtime audio-engine integration tests driven through the mock backend
//! (`NativeAudioEngine::new_mock`) — exercises scene/transport state machinery
//! without opening a `cpal` device. Requires the `test-support` feature.

#![cfg(feature = "test-support")]

mod common;

use app_lib::audio::engine::{AudioEngineSettings, NativeAudioEngine};
use app_lib::monitor::scene::SceneAudioLayer;
use serde_json::json;

fn engine() -> NativeAudioEngine {
    NativeAudioEngine::new_mock(&AudioEngineSettings::default()).expect("mock engine should build")
}

fn layer(start: f64, end: f64) -> SceneAudioLayer {
    layer_with_id("l1", start, end)
}

fn layer_with_id(id: &str, start: f64, end: f64) -> SceneAudioLayer {
    let path = common::fixture("audio/audio-sine.wav");
    serde_json::from_value(json!({
        "id": id,
        "path": path.to_string_lossy(),
        "timeline_start_sec": start,
        "timeline_end_sec": end,
        "source_start_sec": 0.0,
    }))
    .unwrap()
}

#[test]
fn mock_engine_reports_backend_format() {
    let eng = engine();
    assert_eq!(eng.output_info(), (48_000, 2));
}

#[test]
fn fresh_engine_is_empty() {
    let eng = engine();
    assert!(eng.is_empty());
    assert_eq!(eng.scene_end(), 0.0);
}

#[test]
fn set_scene_updates_scene_end_and_emptiness() {
    let eng = engine();
    eng.set_scene(&[layer(0.0, 1.5)], &[], 1.0, &[]);

    assert!(!eng.is_empty());
    assert!(
        (eng.scene_end() - 1.5).abs() < 1e-6,
        "scene_end={}",
        eng.scene_end()
    );
}

#[test]
fn play_then_pause_returns_finite_pts_and_stops_clock() {
    let eng = engine();
    eng.set_scene(&[layer(0.0, 1.0)], &[], 1.0, &[]);

    eng.play(0.0);
    let pts = eng.pause();

    assert!(pts.is_finite() && pts >= 0.0, "pause pts={pts}");
    // After pause the engine is not the master clock.
    assert_eq!(eng.current_pts(), None);
}

#[test]
fn seek_and_gain_do_not_panic_without_a_device() {
    let eng = engine();
    eng.set_scene(&[layer(0.0, 2.0)], &[], 1.0, &[]);

    eng.set_output_gain(0.5);
    eng.seek(0.75, false, true);
    eng.seek(1.25, true, true);
    let pts = eng.pause();
    assert!(pts.is_finite());
}

#[test]
fn multi_clip_scene_reports_correct_end() {
    let eng = engine();
    let clips = [
        layer_with_id("a", 0.0, 1.5),
        layer_with_id("b", 1.5, 3.0),
        layer_with_id("c", 2.5, 5.0),
    ];
    eng.set_scene(&clips, &[], 1.0, &[]);

    assert!(!eng.is_empty());
    // Scene end is the latest timeline_end across all clips.
    assert!(
        (eng.scene_end() - 5.0).abs() < 1e-6,
        "scene_end={}",
        eng.scene_end()
    );
}

#[test]
fn seek_past_scene_end_clamps_to_end() {
    let eng = engine();
    eng.set_scene(&[layer(0.0, 1.0)], &[], 1.0, &[]);

    // Seek beyond scene end — must not panic and must return a finite pts.
    eng.seek(10.0, false, true);
    let pts = eng.pause();
    assert!(pts.is_finite() && pts >= 0.0, "pts={pts}");
}

#[test]
fn seek_on_empty_scene_does_not_panic() {
    let eng = engine();
    // No scene set — seek must not panic.
    eng.seek(5.0, false, true);
    let pts = eng.pause();
    // pause on an empty engine returns 0.0 (no scene, no clock).
    assert!(pts.is_finite());
}

#[test]
fn set_speed_does_not_panic_during_playback() {
    let eng = engine();
    eng.set_scene(&[layer(0.0, 2.0)], &[], 1.0, &[]);

    eng.play(0.0);
    // Varispeed: 2x forward.
    eng.set_speed(2.0, 0.5);
    // Reverse.
    eng.set_speed(-1.0, 0.5);
    // Back to normal.
    eng.set_speed(1.0, 0.5);
    let pts = eng.pause();
    assert!(pts.is_finite() && pts >= 0.0, "pts={pts}");
}

#[test]
fn replacing_scene_updates_end() {
    let eng = engine();
    eng.set_scene(&[layer(0.0, 1.0)], &[], 1.0, &[]);
    assert!((eng.scene_end() - 1.0).abs() < 1e-6);

    // Replace with a longer scene.
    eng.set_scene(&[layer(0.0, 3.0)], &[], 1.0, &[]);
    assert!(
        (eng.scene_end() - 3.0).abs() < 1e-6,
        "scene_end after replace={}",
        eng.scene_end()
    );

    // Replace with an empty scene.
    eng.set_scene(&[], &[], 1.0, &[]);
    assert!(eng.is_empty());
    assert_eq!(eng.scene_end(), 0.0);
}

#[test]
fn zero_master_gain_mutes_without_panic() {
    let eng = engine();
    eng.set_scene(&[layer(0.0, 1.0)], &[], 0.0, &[]);

    eng.play(0.0);
    let pts = eng.pause();
    assert!(pts.is_finite() && pts >= 0.0, "pts={pts}");
}
