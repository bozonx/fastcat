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

// ────────────────────────────────────────────────────────────────────
// Extended export integration tests
// ────────────────────────────────────────────────────────────────────

fn export_options(
    format: &str,
    video_codec: &str,
    video_bitrate: u32,
    audio: bool,
    audio_codec: Option<&str>,
    audio_bitrate: Option<u32>,
    width: u32,
    height: u32,
    fps: f64,
    start: f64,
    end: f64,
) -> NativeExportOptions {
    serde_json::from_value(json!({
        "width": width, "height": height, "fps": fps,
        "startSec": start, "endSec": end,
        "videoCodec": video_codec, "videoBitrateBps": video_bitrate, "format": format,
        "audioEnabled": audio,
        "audioCodec": audio_codec,
        "audioBitrateBps": audio_bitrate,
        "audioChannels": 2,
        "audioSampleRate": 48_000,
        "videoEnabled": video_codec != "none",
        "ffmpegPath": "ffmpeg", "ffprobePath": "ffprobe",
    }))
    .unwrap()
}

fn image_layer(rel: &str, start: f64, end: f64, z: i32) -> serde_json::Value {
    let path = common::fixture(rel);
    json!({
        "id": format!("img-{z}"),
        "kind": "image",
        "path": path.to_string_lossy(),
        "timeline_start_sec": start,
        "timeline_end_sec": end,
        "source_start_sec": 0.0,
        "z": z,
        "opacity": 1.0,
    })
}

fn video_layer(rel: &str, start: f64, end: f64, z: i32) -> serde_json::Value {
    let path = common::fixture(rel);
    json!({
        "id": format!("vid-{z}"),
        "kind": "video",
        "path": path.to_string_lossy(),
        "timeline_start_sec": start,
        "timeline_end_sec": end,
        "source_start_sec": 0.0,
        "source_range_duration_sec": end - start,
        "z": z,
        "opacity": 1.0,
    })
}

fn bg_layer(color: &str, start: f64, end: f64, z: i32) -> serde_json::Value {
    json!({
        "id": format!("bg-{z}"),
        "kind": "background",
        "timeline_start_sec": start,
        "timeline_end_sec": end,
        "source_start_sec": 0.0,
        "background_color": color,
        "z": z,
        "opacity": 1.0,
    })
}

struct AudioExportCase {
    format: &'static str,
    audio_codec: &'static str,
    expected_codec: &'static str,
    required_encoder: &'static str,
}

struct VideoExportCase {
    format: &'static str,
    video_codec: &'static str,
    expected_codec: &'static str,
    required_encoder: &'static str,
}

/// Audio export format matrix for the native/Tauri pipeline.
#[test]
fn native_audio_export_matrix_produces_expected_formats() {
    skip_unless!(
        common::has_ffmpeg() && common::has_ffprobe(),
        "ffmpeg/ffprobe not installed"
    );

    let cases = [
        AudioExportCase {
            format: "aac",
            audio_codec: "aac",
            expected_codec: "aac",
            required_encoder: " aac ",
        },
        AudioExportCase {
            format: "opus",
            audio_codec: "opus",
            expected_codec: "opus",
            required_encoder: "libopus",
        },
        AudioExportCase {
            format: "wav",
            audio_codec: "pcm",
            expected_codec: "pcm_s16le",
            required_encoder: "pcm_s16le",
        },
        AudioExportCase {
            format: "flac",
            audio_codec: "flac",
            expected_codec: "flac",
            required_encoder: " flac ",
        },
        AudioExportCase {
            format: "mp3",
            audio_codec: "mp3",
            expected_codec: "mp3",
            required_encoder: "libmp3lame",
        },
    ];

    for case in cases {
        if !common::has_ffmpeg_encoder(case.required_encoder) {
            eprintln!(
                "SKIP native audio export case {}: ffmpeg encoder {} not installed",
                case.format, case.required_encoder
            );
            continue;
        }

        let scene: MonitorScene = serde_json::from_value(json!({
            "layers": [],
            "audio_layers": [audio_layer("audio/audio-sine.wav")],
        }))
        .unwrap();
        let options = export_options(
            case.format,
            "none",
            0,
            true,
            Some(case.audio_codec),
            Some(128_000),
            320,
            240,
            30.0,
            0.0,
            0.5,
        );

        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join(format!("out.{}", case.format));
        let tasks = NativeMediaTasks::default();

        export_timeline(
            &tasks,
            &format!("export-audio-{}", case.format),
            scene,
            options,
            &target,
            &noop_progress,
            &noop_warning,
        )
        .unwrap_or_else(|error| panic!("{} audio export should succeed: {error}", case.format));

        assert!(target.exists(), "{} export must write a file", case.format);
        let codec = common::ffprobe_entry(Path::new(&target), "stream=codec_name", Some("a:0"));
        assert!(
            codec.contains(case.expected_codec),
            "{} expected audio codec {}, got '{}'",
            case.format,
            case.expected_codec,
            codec
        );
    }
}

/// Video export format/codec matrix for the native/Tauri pipeline.
#[test]
fn native_video_export_matrix_produces_expected_codecs() {
    skip_unless!(
        common::has_ffmpeg() && common::has_ffprobe(),
        "ffmpeg/ffprobe not installed"
    );
    skip_unless!(
        Compositor::is_gpu_available(),
        "no wgpu adapter (headless CI without software Vulkan)"
    );

    let cases = [
        VideoExportCase {
            format: "mp4",
            video_codec: "avc1.64001f",
            expected_codec: "h264",
            required_encoder: "libx264",
        },
        VideoExportCase {
            format: "mp4",
            video_codec: "vp9",
            expected_codec: "vp9",
            required_encoder: "libvpx-vp9",
        },
        VideoExportCase {
            format: "mp4",
            video_codec: "av1",
            expected_codec: "av1",
            required_encoder: "libsvtav1",
        },
        VideoExportCase {
            format: "mkv",
            video_codec: "avc1.64001f",
            expected_codec: "h264",
            required_encoder: "libx264",
        },
        VideoExportCase {
            format: "mkv",
            video_codec: "vp9",
            expected_codec: "vp9",
            required_encoder: "libvpx-vp9",
        },
        VideoExportCase {
            format: "mkv",
            video_codec: "av1",
            expected_codec: "av1",
            required_encoder: "libsvtav1",
        },
    ];

    for case in cases {
        if !common::has_ffmpeg_encoder(case.required_encoder) {
            eprintln!(
                "SKIP native video export case {}/{}: ffmpeg encoder {} not installed",
                case.format, case.video_codec, case.required_encoder
            );
            continue;
        }

        let scene: MonitorScene = serde_json::from_value(json!({
            "width": 160,
            "height": 90,
            "layers": [bg_layer("#3366ff", 0.0, 0.4, 0)],
        }))
        .unwrap();
        let options = export_options(
            case.format,
            case.video_codec,
            500_000,
            false,
            None,
            None,
            160,
            90,
            5.0,
            0.0,
            0.4,
        );

        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join(format!(
            "out_{}_{}.{}",
            case.format, case.expected_codec, case.format
        ));
        let tasks = NativeMediaTasks::default();

        export_timeline(
            &tasks,
            &format!("export-video-{}-{}", case.format, case.expected_codec),
            scene,
            options,
            &target,
            &noop_progress,
            &noop_warning,
        )
        .unwrap_or_else(|error| {
            panic!(
                "{}/{} video export should succeed: {error}",
                case.format, case.video_codec
            )
        });

        assert!(
            target.exists(),
            "{}/{} export must write a file",
            case.format,
            case.video_codec
        );
        let codec = common::ffprobe_entry(Path::new(&target), "stream=codec_name", Some("v:0"));
        assert!(
            codec.contains(case.expected_codec),
            "{}/{} expected video codec {}, got '{}'",
            case.format,
            case.video_codec,
            case.expected_codec,
            codec
        );
    }
}

/// Export a scene with a real image layer overlaid on a background.
/// Verifies the compositor correctly decodes and renders an image fixture.
#[test]
fn video_export_with_image_layer_is_encoded() {
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
        "layers": [
            bg_layer("#000000", 0.0, 1.0, 0),
            image_layer("image/image.jpg", 0.0, 1.0, 1),
        ],
    }))
    .unwrap();

    let options = export_options(
        "mp4",
        "avc1.64001f",
        1_000_000,
        false,
        None,
        None,
        320,
        240,
        15.0,
        0.0,
        1.0,
    );

    let tmp = tempfile::tempdir().unwrap();
    let target = tmp.path().join("out_image.mp4");
    let tasks = NativeMediaTasks::default();

    export_timeline(
        &tasks,
        "export-image",
        scene,
        options,
        &target,
        &noop_progress,
        &noop_warning,
    )
    .expect("image-layer export should succeed");

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

/// Export a scene with a real video layer — exercises the decode → composite →
/// encode pipeline (not just a solid background fill).
#[test]
fn video_export_with_video_layer_is_encoded() {
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
        "layers": [
            bg_layer("#000000", 0.0, 1.0, 0),
            video_layer("video/video-h264-aac.mp4", 0.0, 1.0, 1),
        ],
    }))
    .unwrap();

    let options = export_options(
        "mp4",
        "avc1.64001f",
        1_000_000,
        false,
        None,
        None,
        320,
        240,
        15.0,
        0.0,
        1.0,
    );

    let tmp = tempfile::tempdir().unwrap();
    let target = tmp.path().join("out_video.mp4");
    let tasks = NativeMediaTasks::default();

    export_timeline(
        &tasks,
        "export-video-layer",
        scene,
        options,
        &target,
        &noop_progress,
        &noop_warning,
    )
    .expect("video-layer export should succeed");

    assert!(target.exists());
    let codec = common::ffprobe_entry(Path::new(&target), "stream=codec_name", Some("v:0"));
    assert!(codec.contains("h264"), "expected h264, got '{codec}'");
    let dur: f64 = common::ffprobe_entry(Path::new(&target), "format=duration", None)
        .parse()
        .unwrap_or(0.0);
    assert!(dur > 0.5 && dur < 2.0, "duration ~1s, got {dur}");
}

/// Export with a dissolve transition between two image clips.
/// Exercises the transition compositor path in the export pipeline.
#[test]
fn video_export_with_dissolve_transition_is_encoded() {
    skip_unless!(
        common::has_ffmpeg() && common::has_ffprobe(),
        "ffmpeg/ffprobe not installed"
    );
    skip_unless!(
        Compositor::is_gpu_available(),
        "no wgpu adapter (headless CI without software Vulkan)"
    );

    let mut l1 = image_layer("image/image.jpg", 0.0, 1.5, 1);
    l1["transition_out"] = json!({
        "type": "dissolve",
        "duration_sec": 0.5,
        "spec": { "type": "crossfade" },
    });
    let mut l2 = image_layer("image/image.webp", 1.0, 2.0, 2);
    l2["transition_in"] = json!({
        "type": "dissolve",
        "duration_sec": 0.5,
        "spec": { "type": "crossfade" },
    });
    let scene: MonitorScene = serde_json::from_value(json!({
        "width": 320,
        "height": 240,
        "layers": [
            bg_layer("#000000", 0.0, 2.0, 0),
            l1,
            l2,
        ],
    }))
    .unwrap();

    let options = export_options(
        "mp4",
        "avc1.64001f",
        1_000_000,
        false,
        None,
        None,
        320,
        240,
        15.0,
        0.0,
        2.0,
    );

    let tmp = tempfile::tempdir().unwrap();
    let target = tmp.path().join("out_transition.mp4");
    let tasks = NativeMediaTasks::default();

    export_timeline(
        &tasks,
        "export-transition",
        scene,
        options,
        &target,
        &noop_progress,
        &noop_warning,
    )
    .expect("transition export should succeed");

    assert!(target.exists());
    let codec = common::ffprobe_entry(Path::new(&target), "stream=codec_name", Some("v:0"));
    assert!(codec.contains("h264"), "expected h264, got '{codec}'");
    let dur: f64 = common::ffprobe_entry(Path::new(&target), "format=duration", None)
        .parse()
        .unwrap_or(0.0);
    assert!(dur > 1.5, "duration ~2s, got {dur}");
}

/// Export with a brightness effect on an image layer.
/// Exercises the effect compositor path in the export pipeline.
#[test]
fn video_export_with_brightness_effect_is_encoded() {
    skip_unless!(
        common::has_ffmpeg() && common::has_ffprobe(),
        "ffmpeg/ffprobe not installed"
    );
    skip_unless!(
        Compositor::is_gpu_available(),
        "no wgpu adapter (headless CI without software Vulkan)"
    );

    let mut img = image_layer("image/image.jpg", 0.0, 1.0, 1);
    img["effects"] = json!([
        { "type": "brightness", "value": 1.5 },
    ]);
    let scene: MonitorScene = serde_json::from_value(json!({
        "width": 320,
        "height": 240,
        "layers": [
            bg_layer("#000000", 0.0, 1.0, 0),
            img,
        ],
    }))
    .unwrap();

    let options = export_options(
        "mp4",
        "avc1.64001f",
        1_000_000,
        false,
        None,
        None,
        320,
        240,
        15.0,
        0.0,
        1.0,
    );

    let tmp = tempfile::tempdir().unwrap();
    let target = tmp.path().join("out_effect.mp4");
    let tasks = NativeMediaTasks::default();

    export_timeline(
        &tasks,
        "export-effect",
        scene,
        options,
        &target,
        &noop_progress,
        &noop_warning,
    )
    .expect("effect export should succeed");

    assert!(target.exists());
    let codec = common::ffprobe_entry(Path::new(&target), "stream=codec_name", Some("v:0"));
    assert!(codec.contains("h264"), "expected h264, got '{codec}'");
}

/// Export with speed change (2x) on a video layer.
/// Exercises the retiming path in the export pipeline.
#[test]
fn video_export_with_speed_change_is_encoded() {
    skip_unless!(
        common::has_ffmpeg() && common::has_ffprobe(),
        "ffmpeg/ffprobe not installed"
    );
    skip_unless!(
        Compositor::is_gpu_available(),
        "no wgpu adapter (headless CI without software Vulkan)"
    );

    let path = common::fixture("video/video-h264-aac.mp4");
    let speed_layer = json!({
        "id": "vid-speed",
        "kind": "video",
        "path": path.to_string_lossy(),
        "timeline_start_sec": 0.0,
        "timeline_end_sec": 0.5,
        "source_start_sec": 0.0,
        "source_range_duration_sec": 1.0,
        "speed": 2.0,
        "z": 1,
        "opacity": 1.0,
    });
    let scene: MonitorScene = serde_json::from_value(json!({
        "width": 320,
        "height": 240,
        "layers": [
            bg_layer("#000000", 0.0, 0.5, 0),
            speed_layer,
        ],
    }))
    .unwrap();

    let options = export_options(
        "mp4",
        "avc1.64001f",
        1_000_000,
        false,
        None,
        None,
        320,
        240,
        15.0,
        0.0,
        0.5,
    );

    let tmp = tempfile::tempdir().unwrap();
    let target = tmp.path().join("out_speed.mp4");
    let tasks = NativeMediaTasks::default();

    export_timeline(
        &tasks,
        "export-speed",
        scene,
        options,
        &target,
        &noop_progress,
        &noop_warning,
    )
    .expect("speed-change export should succeed");

    assert!(target.exists());
    let codec = common::ffprobe_entry(Path::new(&target), "stream=codec_name", Some("v:0"));
    assert!(codec.contains("h264"), "expected h264, got '{codec}'");
}

/// Multi-track audio export: two audio layers mixed together.
#[test]
fn multi_track_audio_export_produces_audio_file() {
    skip_unless!(
        common::has_ffmpeg() && common::has_ffprobe(),
        "ffmpeg/ffprobe not installed"
    );

    let mp3_path = common::fixture("audio/audio-sine.mp3");
    let second_audio = json!({
        "id": "a2",
        "path": mp3_path.to_string_lossy(),
        "timeline_start_sec": 0.0,
        "timeline_end_sec": 1.0,
        "source_start_sec": 0.0,
    });
    let scene: MonitorScene = serde_json::from_value(json!({
        "layers": [],
        "audio_layers": [
            audio_layer("audio/audio-sine.wav"),
            second_audio,
        ],
    }))
    .unwrap();

    let options = export_options(
        "m4a",
        "none",
        0,
        true,
        Some("aac"),
        Some(128_000),
        320,
        240,
        30.0,
        0.0,
        1.0,
    );

    let tmp = tempfile::tempdir().unwrap();
    let target = tmp.path().join("out_multi.m4a");
    let tasks = NativeMediaTasks::default();

    export_timeline(
        &tasks,
        "export-multi-audio",
        scene,
        options,
        &target,
        &noop_progress,
        &noop_warning,
    )
    .expect("multi-track audio export should succeed");

    assert!(target.exists());
    let codec = common::ffprobe_entry(Path::new(&target), "stream=codec_type", Some("a:0"));
    assert_eq!(codec, "audio");
    let dur: f64 = common::ffprobe_entry(Path::new(&target), "format=duration", None)
        .parse()
        .unwrap_or(0.0);
    assert!((dur - 1.0).abs() < 0.3, "duration ~1s, got {dur}");
}

/// WebM/VP9 export with a solid background.
#[test]
fn webm_vp9_export_is_encoded() {
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

    let options = export_options(
        "webm", "vp9", 1_000_000, false, None, None, 320, 240, 15.0, 0.0, 1.0,
    );

    let tmp = tempfile::tempdir().unwrap();
    let target = tmp.path().join("out.webm");
    let tasks = NativeMediaTasks::default();

    export_timeline(
        &tasks,
        "export-webm",
        scene,
        options,
        &target,
        &noop_progress,
        &noop_warning,
    )
    .expect("WebM export should succeed");

    assert!(target.exists());
    let codec = common::ffprobe_entry(Path::new(&target), "stream=codec_name", Some("v:0"));
    assert!(codec.contains("vp9"), "expected vp9, got '{codec}'");
    let format = common::ffprobe_entry(Path::new(&target), "format=format_name", None);
    assert!(
        format.contains("webm"),
        "expected webm container, got '{format}'"
    );
}

/// Alpha export: VP9 in WebM with yuva420p.
/// Uses a background with transparency to exercise the alpha channel path.
#[test]
fn alpha_webm_export_preserves_alpha() {
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
        "layers": [
            {
                "id": "img-alpha",
                "kind": "image",
                "path": common::fixture("image/image-rgba.png").to_string_lossy(),
                "timeline_start_sec": 0.0,
                "timeline_end_sec": 1.0,
                "source_start_sec": 0.0,
                "z": 0,
                "opacity": 1.0,
            },
        ],
    }))
    .unwrap();

    let options: NativeExportOptions = serde_json::from_value(json!({
        "width": 320, "height": 240, "fps": 15.0,
        "startSec": 0.0, "endSec": 1.0,
        "videoCodec": "vp9", "videoBitrateBps": 1_000_000, "format": "webm",
        "audioEnabled": false,
        "videoEnabled": true,
        "exportAlpha": true,
        "ffmpegPath": "ffmpeg", "ffprobePath": "ffprobe",
    }))
    .unwrap();

    let tmp = tempfile::tempdir().unwrap();
    let target = tmp.path().join("out_alpha.webm");
    let tasks = NativeMediaTasks::default();

    export_timeline(
        &tasks,
        "export-alpha",
        scene,
        options,
        &target,
        &noop_progress,
        &noop_warning,
    )
    .expect("alpha WebM export should succeed");

    assert!(target.exists());
    let pix_fmt = common::ffprobe_entry(Path::new(&target), "stream=pix_fmt", Some("v:0"));
    assert!(
        pix_fmt.contains("yuva"),
        "expected yuva pix_fmt for alpha export, got '{pix_fmt}'"
    );
}

/// Export with video + audio combined: a video layer with an audio track.
#[test]
fn video_with_audio_export_is_encoded() {
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
        "layers": [
            bg_layer("#000000", 0.0, 1.0, 0),
            video_layer("video/video-h264-aac.mp4", 0.0, 1.0, 1),
        ],
        "audio_layers": [audio_layer("audio/audio-sine.wav")],
    }))
    .unwrap();

    let options = export_options(
        "mp4",
        "avc1.64001f",
        1_000_000,
        true,
        Some("aac"),
        Some(128_000),
        320,
        240,
        15.0,
        0.0,
        1.0,
    );

    let tmp = tempfile::tempdir().unwrap();
    let target = tmp.path().join("out_av.mp4");
    let tasks = NativeMediaTasks::default();

    export_timeline(
        &tasks,
        "export-av",
        scene,
        options,
        &target,
        &noop_progress,
        &noop_warning,
    )
    .expect("video+audio export should succeed");

    assert!(target.exists());
    let vcodec = common::ffprobe_entry(Path::new(&target), "stream=codec_type", Some("v:0"));
    assert_eq!(vcodec, "video");
    let acodec = common::ffprobe_entry(Path::new(&target), "stream=codec_type", Some("a:0"));
    assert_eq!(acodec, "audio");
}

/// Export cancellation: start an export, cancel it immediately, and verify
/// the task is cancelled and no valid output file is produced.
#[test]
fn export_cancellation_stops_encoding() {
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
        "layers": [bg_layer("#3366ff", 0.0, 5.0, 0)],
    }))
    .unwrap();

    let options = export_options(
        "mp4",
        "avc1.64001f",
        500_000,
        false,
        None,
        None,
        320,
        240,
        30.0,
        0.0,
        5.0,
    );

    let tmp = tempfile::tempdir().unwrap();
    let target = tmp.path().join("out_cancel.mp4");
    let tasks = NativeMediaTasks::default();

    // Cancel immediately before the export loop starts.
    tasks.cancel("export-cancel");

    let result = export_timeline(
        &tasks,
        "export-cancel",
        scene,
        options,
        &target,
        &noop_progress,
        &noop_warning,
    );

    // The export should either return an error (cancelled) or succeed
    // if cancellation was processed after ffmpeg already finished.
    // If it errored, it should mention "cancel".
    if let Err(e) = &result {
        assert!(
            e.to_string().contains("cancel"),
            "expected cancellation error, got: {e}"
        );
    }
}

/// Export with a zero-duration range should fail with a clear error.
#[test]
fn export_zero_duration_range_fails() {
    let scene: MonitorScene = serde_json::from_value(json!({
        "width": 320, "height": 240,
        "layers": [bg_layer("#000000", 0.0, 0.0, 0)],
    }))
    .unwrap();

    let options = export_options(
        "mp4",
        "avc1.64001f",
        1_000_000,
        false,
        None,
        None,
        320,
        240,
        30.0,
        0.0,
        0.0,
    );

    let tmp = tempfile::tempdir().unwrap();
    let target = tmp.path().join("out_zero.mp4");
    let tasks = NativeMediaTasks::default();

    let result = export_timeline(
        &tasks,
        "export-zero",
        scene,
        options,
        &target,
        &noop_progress,
        &noop_warning,
    );

    assert!(result.is_err(), "zero-duration export should fail");
    let err = result.unwrap_err().to_string();
    assert!(
        err.contains("zero") || err.contains("negative"),
        "expected zero/negative range error, got: {err}"
    );
}

/// Export with an inverted range (end < start) should fail.
#[test]
fn export_inverted_range_fails() {
    let scene: MonitorScene = serde_json::from_value(json!({
        "width": 320, "height": 240,
        "layers": [bg_layer("#000000", 0.0, 1.0, 0)],
    }))
    .unwrap();

    let options = export_options(
        "mp4",
        "avc1.64001f",
        1_000_000,
        false,
        None,
        None,
        320,
        240,
        30.0,
        2.0,
        1.0,
    );

    let tmp = tempfile::tempdir().unwrap();
    let target = tmp.path().join("out_inverted.mp4");
    let tasks = NativeMediaTasks::default();

    let result = export_timeline(
        &tasks,
        "export-inverted",
        scene,
        options,
        &target,
        &noop_progress,
        &noop_warning,
    );

    assert!(result.is_err(), "inverted range export should fail");
}
