//! End-to-end export integration tests. These drive the real `export_timeline`
//! pipeline: offline audio mix → ffmpeg encode → file on disk, verified with
//! ffprobe. The video case also drives the GPU compositor and is skipped when
//! no wgpu adapter is available (headless CI without software Vulkan).

mod common;

use std::path::Path;

use app_lib::compositor::Compositor;
use app_lib::media::tasks::NativeMediaTasks;
use app_lib::media::timeline_export::{export_timeline, NativeExportOptions};
use app_lib::monitor::scene::MonitorScene;
use serde_json::json;

fn noop_progress(_p: f64) {}
fn noop_warning(_w: String) {}

fn audio_layer(rel: &str) -> serde_json::Value {
    let path = common::fixture(rel);
    json!({
        "id": "a1",
        "path": path.to_string_lossy(),
        "timeline_start_sec": 0.0,
        "timeline_end_sec": 1.0,
        "source_start_sec": 0.0,
    })
}

#[test]
fn audio_only_export_produces_audio_file() {
    skip_unless!(
        common::has_ffmpeg() && common::has_ffprobe(),
        "ffmpeg/ffprobe not installed"
    );

    let scene: MonitorScene = serde_json::from_value(json!({
        "layers": [],
        "audio_layers": [audio_layer("audio/audio-sine.wav")],
    }))
    .unwrap();

    let options: NativeExportOptions = serde_json::from_value(json!({
        "width": 320, "height": 240, "fps": 30.0,
        "startSec": 0.0, "endSec": 1.0,
        "videoCodec": "", "videoBitrateBps": 0, "format": "m4a",
        "audioEnabled": true, "audioCodec": "aac", "audioBitrateBps": 128_000,
        "audioChannels": 2, "audioSampleRate": 48_000,
        "videoEnabled": false,
        "ffmpegPath": "ffmpeg", "ffprobePath": "ffprobe",
    }))
    .unwrap();

    let tmp = tempfile::tempdir().unwrap();
    let target = tmp.path().join("out.m4a");
    let tasks = NativeMediaTasks::default();

    export_timeline(
        &tasks,
        "export-audio",
        scene,
        options,
        &target,
        &noop_progress,
        &noop_warning,
    )
    .expect("audio-only export should succeed");

    assert!(target.exists(), "export must write a file");
    let codec = common::ffprobe_entry(Path::new(&target), "stream=codec_type", Some("a:0"));
    assert_eq!(codec, "audio");
    let dur: f64 = common::ffprobe_entry(Path::new(&target), "format=duration", None)
        .parse()
        .unwrap_or(0.0);
    assert!((dur - 1.0).abs() < 0.3, "duration ~1s, got {dur}");
}

#[test]
fn video_export_solid_background_is_encoded() {
    skip_unless!(
        common::has_ffmpeg() && common::has_ffprobe(),
        "ffmpeg/ffprobe not installed"
    );
    skip_unless!(
        Compositor::is_gpu_available(),
        "no wgpu adapter (headless CI without software Vulkan)"
    );

    let scene: MonitorScene = serde_json::from_value(json!({
        "width": 320,
        "height": 240,
        "layers": [{
            "id": "bg",
            "kind": "background",
            "timeline_start_sec": 0.0,
            "timeline_end_sec": 1.0,
            "source_start_sec": 0.0,
            "background_color": "#3366ff",
            "z": 0,
            "opacity": 1.0,
        }],
    }))
    .unwrap();

    let options: NativeExportOptions = serde_json::from_value(json!({
        "width": 320, "height": 240, "fps": 15.0,
        "startSec": 0.0, "endSec": 1.0,
        "videoCodec": "avc1.64001f", "videoBitrateBps": 1_000_000, "format": "mp4",
        "audioEnabled": false, "audioCodec": null, "audioBitrateBps": null,
        "videoEnabled": true,
        "ffmpegPath": "ffmpeg", "ffprobePath": "ffprobe",
    }))
    .unwrap();

    let tmp = tempfile::tempdir().unwrap();
    let target = tmp.path().join("out.mp4");
    let tasks = NativeMediaTasks::default();

    export_timeline(
        &tasks,
        "export-video",
        scene,
        options,
        &target,
        &noop_progress,
        &noop_warning,
    )
    .expect("video export should succeed");

    assert!(target.exists());
    let codec = common::ffprobe_entry(Path::new(&target), "stream=codec_name", Some("v:0"));
    assert!(codec.contains("h264"), "expected h264, got '{codec}'");
    let w: u32 = common::ffprobe_entry(Path::new(&target), "stream=width", Some("v:0"))
        .parse()
        .unwrap_or(0);
    let h: u32 = common::ffprobe_entry(Path::new(&target), "stream=height", Some("v:0"))
        .parse()
        .unwrap_or(0);
    assert_eq!((w, h), (320, 240));
}
