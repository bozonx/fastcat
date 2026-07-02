use std::path::Path;

use super::super::ffmpeg::hw::FfmpegHwOptions;
use super::super::ffmpeg::utils::resolve_audio_encoder;
use super::ffmpeg_args_builder::{
    build_ffmpeg_args, export_uses_alpha, is_gpu_render_error, resolve_export_hw_mode,
};
use super::options::NativeExportOptions;
use super::{export_frame_sample_time, scene_pipeline_depth};
use crate::media::types::HwAccelMode;

fn base_options() -> NativeExportOptions {
    NativeExportOptions {
        width: 1920,
        height: 1080,
        fps: 30.0,
        start_sec: 0.0,
        end_sec: 10.0,
        video_codec: "avc1.64001f".to_string(),
        video_bitrate_bps: 5_000_000,
        format: "mp4".to_string(),
        audio_enabled: false,
        audio_codec: None,
        audio_bitrate_bps: None,
        audio_channels: None,
        audio_sample_rate: None,
        video_enabled: None,
        bitrate_mode: None,
        video_max_bitrate_bps: None,
        keyframe_interval_sec: None,
        metadata_title: None,
        metadata_description: None,
        metadata_author: None,
        metadata_tags: None,
        hw: FfmpegHwOptions::default(),
        export_alpha: None,
        fast_start: None,
    }
}

#[test]
fn test_build_ffmpeg_args_webm_forces_opus() {
    let options = NativeExportOptions {
        width: 1920,
        height: 1080,
        fps: 30.0,
        start_sec: 0.0,
        end_sec: 10.0,
        video_codec: "vp9".to_string(),
        video_bitrate_bps: 5_000_000,
        format: "webm".to_string(),
        audio_enabled: true,
        audio_codec: Some("aac".to_string()),
        audio_bitrate_bps: Some(128_000),
        audio_channels: Some(2),
        audio_sample_rate: Some(48_000),
        video_enabled: None,
        bitrate_mode: None,
        video_max_bitrate_bps: None,
        keyframe_interval_sec: None,
        metadata_title: None,
        metadata_description: None,
        metadata_author: None,
        metadata_tags: None,
        hw: FfmpegHwOptions::default(),
        export_alpha: None,
        fast_start: None,
    };
    let args = build_ffmpeg_args(
        &options,
        Some(Path::new("dummy.wav")),
        1920,
        1080,
        30.0,
        5.0,
        Path::new("output.webm"),
    );
    let mut idx = 0;
    let mut found_opus = false;
    while idx < args.len() {
        if args[idx] == "-c:a" {
            assert_eq!(args[idx + 1], "libopus");
            found_opus = true;
            break;
        }
        idx += 1;
    }
    assert!(found_opus, "Audio codec argument not found");
}

#[test]
fn test_build_ffmpeg_args_video_export_matrix() {
    let cases = [
        ("mp4", "avc1.64001f", "libx264"),
        ("mp4", "vp9", "libvpx-vp9"),
        ("mp4", "av1", "libsvtav1"),
        ("mkv", "avc1.64001f", "libx264"),
        ("mkv", "vp9", "libvpx-vp9"),
        ("mkv", "av1", "libsvtav1"),
    ];

    for (format, video_codec, expected_encoder) in cases {
        let options = NativeExportOptions {
            format: format.to_string(),
            video_codec: video_codec.to_string(),
            ..base_options()
        };
        let args = build_ffmpeg_args(
            &options,
            None,
            1920,
            1080,
            30.0,
            1.0,
            Path::new(&format!("output.{format}")),
        );

        assert!(
            args.windows(2)
                .any(|pair| pair == ["-c:v", expected_encoder]),
            "{format}/{video_codec} should encode with {expected_encoder}, got {args:?}"
        );
    }
}

#[test]
fn test_build_ffmpeg_args_audio_export_matrix() {
    let cases = [
        ("aac", "aac", "aac", true),
        ("opus", "opus", "libopus", true),
        ("wav", "pcm", "pcm_s16le", false),
        ("flac", "flac", "flac", false),
        ("mp3", "mp3", "libmp3lame", true),
    ];

    for (format, audio_codec, expected_encoder, should_emit_bitrate) in cases {
        let options = NativeExportOptions {
            format: format.to_string(),
            video_enabled: Some(false),
            audio_enabled: true,
            audio_codec: Some(audio_codec.to_string()),
            audio_bitrate_bps: Some(128_000),
            audio_sample_rate: Some(48_000),
            ..base_options()
        };
        let args = build_ffmpeg_args(
            &options,
            Some(Path::new("dummy.wav")),
            2,
            2,
            30.0,
            1.0,
            Path::new(&format!("output.{format}")),
        );

        assert!(
            args.windows(2)
                .any(|pair| pair == ["-c:a", expected_encoder]),
            "{format}/{audio_codec} should encode with {expected_encoder}, got {args:?}"
        );
        assert_eq!(
            args.contains(&"-b:a".to_string()),
            should_emit_bitrate,
            "{format}/{audio_codec} bitrate arg mismatch: {args:?}"
        );
    }
}

#[test]
fn export_frame_sample_time_clamps_last_partial_frame_inside_range() {
    let start = 0.0;
    let end = 1.01;
    let fps = 30.0;

    assert_eq!(export_frame_sample_time(start, end, fps, 0), 1.0 / 60.0);
    let last = export_frame_sample_time(start, end, fps, 30);

    assert!(last < end);
    assert!(last >= end - 1e-6);
}

#[test]
fn scene_pipeline_depth_is_deeper_below_4k_and_capped_at_4k() {
    // Sub-4K resolutions get the deep buffer (smooths the decode burst at clip cuts).
    assert_eq!(scene_pipeline_depth(1280, 720, 1), 8);
    assert_eq!(scene_pipeline_depth(1920, 1080, 1), 8);
    // Just under the 4K pixel threshold is still budget-clamped when a deep queue
    // would retain more than the export scene memory budget.
    assert_eq!(scene_pipeline_depth(3840, 2159, 1), 6);
    // 4K keeps the shallow buffer; 8K is clamped further because each frame is ~126 MB.
    assert_eq!(scene_pipeline_depth(3840, 2160, 1), 4);
    assert_eq!(scene_pipeline_depth(4096, 2160, 1), 4);
    assert_eq!(scene_pipeline_depth(7680, 4320, 1), 1);
    // Portrait 4K (same pixel count, swapped axes) is treated identically.
    assert_eq!(scene_pipeline_depth(2160, 3840, 1), 4);
    // Depth must always leave room for at least the readback pipeline to stay busy.
    assert!(scene_pipeline_depth(1920, 1080, 1) >= 4);
}

#[test]
fn scene_pipeline_depth_clamps_dense_layer_scenes_by_memory_budget() {
    assert_eq!(scene_pipeline_depth(1920, 1080, 2), 8);
    assert_eq!(scene_pipeline_depth(1920, 1080, 4), 6);
    assert_eq!(scene_pipeline_depth(1920, 1080, 8), 3);
    assert_eq!(scene_pipeline_depth(1920, 1080, 32), 1);
    assert_eq!(scene_pipeline_depth(3840, 2160, 2), 3);
    assert_eq!(scene_pipeline_depth(3840, 2160, 8), 1);
    assert_eq!(scene_pipeline_depth(1920, 1080, 0), 8);
}

#[test]
fn test_build_ffmpeg_args_vp9_alpha_adds_auto_alt_ref() {
    let options = NativeExportOptions {
        width: 1920,
        height: 1080,
        fps: 30.0,
        start_sec: 0.0,
        end_sec: 10.0,
        video_codec: "vp9".to_string(),
        video_bitrate_bps: 5_000_000,
        format: "webm".to_string(),
        audio_enabled: false,
        audio_codec: None,
        audio_bitrate_bps: None,
        audio_channels: None,
        audio_sample_rate: None,
        video_enabled: None,
        bitrate_mode: None,
        video_max_bitrate_bps: None,
        keyframe_interval_sec: None,
        metadata_title: None,
        metadata_description: None,
        metadata_author: None,
        metadata_tags: None,
        hw: FfmpegHwOptions::default(),
        export_alpha: Some(true),
        fast_start: None,
    };
    let args = build_ffmpeg_args(
        &options,
        None,
        1920,
        1080,
        30.0,
        5.0,
        Path::new("output.webm"),
    );
    let mut found_yuva = false;
    let mut found_auto_alt_ref = false;
    let mut idx = 0;
    while idx < args.len() {
        if args[idx] == "-pix_fmt" && args.get(idx + 1) == Some(&"yuva420p".to_string()) {
            found_yuva = true;
        }
        if args[idx] == "-auto-alt-ref" && args.get(idx + 1) == Some(&"0".to_string()) {
            found_auto_alt_ref = true;
        }
        idx += 1;
    }
    assert!(found_yuva, "Expected yuva420p pixel format");
    assert!(found_auto_alt_ref, "Expected -auto-alt-ref 0 for VP9 alpha");
}

#[test]
fn test_build_ffmpeg_args_mp4_ignores_alpha() {
    let options = NativeExportOptions {
        width: 1920,
        height: 1080,
        fps: 30.0,
        start_sec: 0.0,
        end_sec: 10.0,
        video_codec: "avc1.64001f".to_string(),
        video_bitrate_bps: 5_000_000,
        format: "mp4".to_string(),
        audio_enabled: false,
        audio_codec: None,
        audio_bitrate_bps: None,
        audio_channels: None,
        audio_sample_rate: None,
        video_enabled: None,
        bitrate_mode: None,
        video_max_bitrate_bps: None,
        keyframe_interval_sec: None,
        metadata_title: None,
        metadata_description: None,
        metadata_author: None,
        metadata_tags: None,
        hw: FfmpegHwOptions::default(),
        export_alpha: Some(true),
        fast_start: None,
    };
    let args = build_ffmpeg_args(
        &options,
        None,
        1920,
        1080,
        30.0,
        5.0,
        Path::new("output.mp4"),
    );
    assert!(
        !args.contains(&"yuva420p".to_string()),
        "mp4 should ignore alpha flag"
    );
    assert!(
        !args.contains(&"-auto-alt-ref".to_string()),
        "mp4 should not add VP9 alpha flags"
    );
}

#[test]
fn test_build_ffmpeg_args_adds_metadata_cbr_and_keyframes() {
    let options = NativeExportOptions {
        bitrate_mode: Some("constant".to_string()),
        keyframe_interval_sec: Some(2.0),
        metadata_title: Some("Export title".to_string()),
        metadata_description: Some("Export description".to_string()),
        metadata_author: Some("Author".to_string()),
        metadata_tags: Some("one, two".to_string()),
        ..base_options()
    };
    let args = build_ffmpeg_args(
        &options,
        None,
        1920,
        1080,
        30.0,
        5.0,
        Path::new("output.mp4"),
    );

    assert!(args.windows(2).any(|pair| pair == ["-g", "60"]));
    // Software CBR pins the rate with an equal floor/ceiling, not just a cap.
    assert!(args.windows(2).any(|pair| pair == ["-minrate", "5000000"]));
    assert!(args.windows(2).any(|pair| pair == ["-maxrate", "5000000"]));
    assert!(args.windows(2).any(|pair| pair == ["-bufsize", "5000000"]));
    assert!(args
        .windows(2)
        .any(|pair| pair == ["-metadata", "title=Export title"]));
    assert!(args
        .windows(2)
        .any(|pair| pair == ["-metadata", "description=Export description"]));
    // mp4/mov muxer drops `author`/`tags`; they're mapped to the atoms that survive.
    assert!(args
        .windows(2)
        .any(|pair| pair == ["-metadata", "artist=Author"]));
    assert!(args
        .windows(2)
        .any(|pair| pair == ["-metadata", "keywords=one, two"]));
    assert!(!args.iter().any(|a| a == "author=Author"));
    assert!(!args.iter().any(|a| a == "tags=one, two"));
}

#[test]
fn test_build_ffmpeg_args_pins_cfr_and_caps_output_duration() {
    // The vello (rawvideo-stdin) path must pin a constant output frame rate and hard-cap
    // the output length, mirroring the direct path. Without these the output fps can drift
    // on fractional rates and a marginally-longer audio mix leaves a black/frozen tail.
    let options = NativeExportOptions { ..base_options() };
    let args = build_ffmpeg_args(
        &options,
        Some(Path::new("dummy.wav")),
        1920,
        1080,
        30.0,
        5.0,
        Path::new("output.mp4"),
    );
    assert!(args.windows(2).any(|p| p == ["-fps_mode", "cfr"]));
    // Output `-r` (distinct from the input `-r` on the rawvideo demuxer).
    assert!(
        args.windows(2).filter(|p| p[0] == "-r").count() >= 2,
        "expected both an input and an output -r"
    );
    assert!(args.windows(2).any(|p| p == ["-t", "5.000000"]));
}

#[test]
fn test_mkv_keeps_literal_author_and_tags_metadata() {
    // Matroska carries arbitrary tag names, so author/tags are written verbatim.
    let options = NativeExportOptions {
        format: "mkv".to_string(),
        metadata_author: Some("Author".to_string()),
        metadata_tags: Some("one, two".to_string()),
        ..base_options()
    };
    let args = build_ffmpeg_args(
        &options,
        None,
        1920,
        1080,
        30.0,
        5.0,
        Path::new("output.mkv"),
    );
    assert!(args
        .windows(2)
        .any(|pair| pair == ["-metadata", "author=Author"]));
    assert!(args
        .windows(2)
        .any(|pair| pair == ["-metadata", "tags=one, two"]));
}

#[test]
fn test_build_ffmpeg_args_audio_only_skips_rawvideo_input() {
    let options = NativeExportOptions {
        format: "wav".to_string(),
        video_enabled: Some(false),
        audio_enabled: true,
        audio_codec: Some("pcm".to_string()),
        audio_sample_rate: Some(44_100),
        ..base_options()
    };
    let args = build_ffmpeg_args(
        &options,
        Some(Path::new("dummy.wav")),
        2,
        2,
        30.0,
        5.0,
        Path::new("output.wav"),
    );

    assert!(args.windows(2).any(|pair| pair == ["-vn", "-c:a"]));
    assert!(args.windows(2).any(|pair| pair == ["-ar", "44100"]));
    assert!(!args.windows(2).any(|pair| pair == ["-f", "rawvideo"]));
    assert!(!args.contains(&"-c:v".to_string()));
    // WAV/PCM must use a PCM encoder, not silently downgrade to AAC.
    assert!(args.windows(2).any(|pair| pair == ["-c:a", "pcm_s16le"]));
    assert!(!args.contains(&"aac".to_string()));
}

#[test]
fn test_lossless_audio_skips_bitrate() {
    let options = NativeExportOptions {
        format: "flac".to_string(),
        video_enabled: Some(false),
        audio_enabled: true,
        audio_codec: Some("flac".to_string()),
        audio_bitrate_bps: Some(320_000),
        ..base_options()
    };
    let args = build_ffmpeg_args(
        &options,
        Some(Path::new("dummy.wav")),
        2,
        2,
        30.0,
        5.0,
        Path::new("output.flac"),
    );
    assert!(args.windows(2).any(|pair| pair == ["-c:a", "flac"]));
    // FLAC ignores a target bitrate; -b:a must not be emitted.
    assert!(!args.contains(&"-b:a".to_string()));
}

#[test]
fn test_alpha_mkv_av1_does_not_emit_yuva() {
    // MKV's default codec is AV1 (libsvtav1), which can't carry alpha. The
    // request must not produce a yuva420p invocation that ffmpeg would reject.
    let options = NativeExportOptions {
        video_codec: "av01.0.05M.08".to_string(),
        format: "mkv".to_string(),
        export_alpha: Some(true),
        ..base_options()
    };
    assert!(!export_uses_alpha(&options));
    let args = build_ffmpeg_args(
        &options,
        None,
        1920,
        1080,
        30.0,
        5.0,
        Path::new("output.mkv"),
    );
    assert!(!args.contains(&"yuva420p".to_string()));
    assert!(!args.contains(&"-auto-alt-ref".to_string()));
}

#[test]
fn test_alpha_mkv_vp9_emits_yuva() {
    // VP9 in MKV is the one codec/container pairing that does carry alpha.
    let options = NativeExportOptions {
        video_codec: "vp9".to_string(),
        format: "mkv".to_string(),
        export_alpha: Some(true),
        ..base_options()
    };
    assert!(export_uses_alpha(&options));
    let args = build_ffmpeg_args(
        &options,
        None,
        1920,
        1080,
        30.0,
        5.0,
        Path::new("output.mkv"),
    );
    assert!(args.contains(&"yuva420p".to_string()));
    assert!(args.windows(2).any(|pair| pair == ["-auto-alt-ref", "0"]));
    // Vello renders premultiplied alpha; ffmpeg reads rawvideo rgba as straight, so the
    // alpha export must undo the premultiply before yuva420p or edges come out too dark.
    let vf = args
        .iter()
        .position(|a| a == "-vf")
        .map(|i| args[i + 1].clone())
        .expect("alpha export must set a -vf filter");
    assert!(vf.contains("unpremultiply"), "got: {vf}");
    // Alpha keeps straight RGBA; no BT.709 matrix conversion / colour tags here.
    assert!(!vf.contains("out_color_matrix"), "got: {vf}");
    assert!(!args.contains(&"-colorspace".to_string()));
}

#[test]
fn test_build_ffmpeg_args_tags_bt709_for_hd_vello_path() {
    // The vello path streams raw RGB; without an explicit matrix the stream would be
    // untagged BT.601 and HD players would show a colour shift vs the monitor. The
    // software encode must pin BT.709 and tag the output to match.
    let options = NativeExportOptions {
        video_codec: "avc1".to_string(),
        format: "mp4".to_string(),
        ..base_options()
    };
    let args = build_ffmpeg_args(&options, None, 1920, 1080, 30.0, 5.0, Path::new("out.mp4"));
    let vf = args
        .iter()
        .position(|a| a == "-vf")
        .map(|i| args[i + 1].clone())
        .expect("vello export must set a -vf filter");
    assert!(
        vf.contains("scale=out_color_matrix=bt709:out_range=tv"),
        "got: {vf}"
    );
    assert!(args.windows(2).any(|p| p == ["-colorspace", "bt709"]));
    assert!(args.windows(2).any(|p| p == ["-color_primaries", "bt709"]));
    assert!(args.windows(2).any(|p| p == ["-color_trc", "bt709"]));
}

fn video_layer() -> crate::monitor::scene::SceneLayer {
    crate::monitor::scene::SceneLayer {
        id: "v".into(),
        kind: crate::monitor::scene::LayerKind::Video,
        path: "/tmp/clip.mp4".into(),
        timeline_start_sec: 0.0,
        timeline_end_sec: 10.0,
        source_start_sec: 0.0,
        source_range_duration_sec: 10.0,
        source_duration_sec: None,
        speed: 1.0,
        freeze_frame_source_sec: None,
        source_orientation: None,
        z: 0,
        opacity: 1.0,
        blend_mode: crate::compositor::scene::BlendMode::Normal,
        background_color: None,
        text: None,
        style: None,
        shape_type: None,
        fill_color: None,
        stroke_color: None,
        stroke_width: None,
        shape_config: None,
        transform: None,
        transition_in: None,
        transition_out: None,
        effects: Vec::new(),
    }
}

fn one_clip_scene(layer: crate::monitor::scene::SceneLayer) -> crate::monitor::scene::MonitorScene {
    crate::monitor::scene::MonitorScene {
        master_effects: Vec::new(),
        layers: vec![layer],
        video_tracks: vec![],
        audio_layers: vec![],
        audio_tracks: vec![],
        audio_master_gain: 1.0,
        audio_master_muted: false,
        audio_master_effects: Vec::new(),
        width: 1920,
        height: 1080,
        preview_scale: None,
        preview_fps: 30.0,
        preview_sync_mode: crate::monitor::scene::PreviewSyncMode::Balanced,
        preview_effect_quality: crate::compositor::effects::EffectQuality::Ultra,
        frame_cache_mode: crate::monitor::scene::NativeFrameCacheMode::Auto,
        frame_cache_custom_mb: 0,
    }
}

/// These cases must reject *before* the source probe (no real file needed): the fast
/// path may only engage on a single untouched, frame-filling clip.
#[test]
fn plan_direct_rejects_non_trivial_scenes() {
    use super::direct::{plan_direct, DirectExportParams};
    let opts = base_options();
    let call = |scene: &crate::monitor::scene::MonitorScene| {
        plan_direct(
            scene,
            &opts,
            DirectExportParams {
                width: 1920,
                height: 1080,
                start: 0.0,
                end: 10.0,
                fps: 30.0,
                frame_count: 300,
            },
        )
        .is_some()
    };

    // An effect forces real compositing.
    let mut l = video_layer();
    l.effects
        .push(crate::compositor::effects::EffectSpec::Brightness { value: 1.0 });
    assert!(!call(&one_clip_scene(l)));

    // Master effects apply after final compositing, which the direct path skips.
    let mut scene = one_clip_scene(video_layer());
    scene
        .master_effects
        .push(crate::compositor::effects::EffectSpec::Brightness { value: 1.0 });
    assert!(!call(&scene));

    // An explicit transform (scale/crop/reposition) can't be reproduced by a plain resize.
    let mut l = video_layer();
    l.transform = Some(crate::monitor::scene::SceneLayerTransform {
        x: 0.0,
        y: 0.0,
        scale_x: 1.0,
        scale_y: 1.0,
        rotation_deg: 0.0,
        anchor_x: 0.5,
        anchor_y: 0.5,
        crop_top: 0.0,
        crop_bottom: 0.0,
        crop_left: 0.0,
        crop_right: 0.0,
        flip_horizontal: false,
        flip_vertical: false,
    });
    assert!(!call(&one_clip_scene(l)));

    // Speed change needs retiming.
    let mut l = video_layer();
    l.speed = 2.0;
    assert!(!call(&one_clip_scene(l)));

    // Track compositing is applied after all clips in the track are combined.
    let mut scene = one_clip_scene(video_layer());
    scene
        .video_tracks
        .push(crate::monitor::scene::SceneVideoTrack {
            id: "track-1".into(),
            z: 0,
            layer_ids: vec!["clip".into()],
            opacity: 0.5,
            blend_mode: crate::compositor::scene::BlendMode::Normal,
            effects: Vec::new(),
        });
    assert!(!call(&scene));

    // Track effects require rendering the whole track before final compositing.
    let mut scene = one_clip_scene(video_layer());
    scene
        .video_tracks
        .push(crate::monitor::scene::SceneVideoTrack {
            id: "track-1".into(),
            z: 0,
            layer_ids: vec!["clip".into()],
            opacity: 1.0,
            blend_mode: crate::compositor::scene::BlendMode::Normal,
            effects: vec![crate::compositor::effects::EffectSpec::Brightness { value: 1.0 }],
        });
    assert!(!call(&scene));

    // Two layers must be composited.
    let scene = crate::monitor::scene::MonitorScene {
        layers: vec![video_layer(), video_layer()],
        ..one_clip_scene(video_layer())
    };
    assert!(!call(&scene));

    // Export viewport differs from the scene (vello's scene→viewport fit is non-trivial).
    assert!(plan_direct(
        &one_clip_scene(video_layer()),
        &opts,
        DirectExportParams {
            width: 1280,
            height: 720,
            start: 0.0,
            end: 10.0,
            fps: 30.0,
            frame_count: 300,
        },
    )
    .is_none());
}

#[test]
fn build_direct_args_software_resizes_trims_and_maps_streams() {
    use super::ffmpeg_args_builder::build_direct_ffmpeg_args;
    let plan = super::direct::DirectPlan {
        source: std::path::PathBuf::from("/tmp/clip.mp4"),
        source_start_sec: 2.0,
        duration_sec: 5.0,
    };
    let options = base_options();
    let args = build_direct_ffmpeg_args(
        &options,
        &plan,
        Some(Path::new("/tmp/mix.wav")),
        1920,
        1080,
        30.0,
        Path::new("out.mp4"),
    );
    // Input seek + the source as input 0, audio mix as input 1, trimmed to the range.
    assert!(args.windows(2).any(|p| p == ["-ss", "2.000000"]));
    assert!(args.windows(2).any(|p| p == ["-i", "/tmp/clip.mp4"]));
    assert!(args.windows(2).any(|p| p == ["-i", "/tmp/mix.wav"]));
    assert!(args.windows(2).any(|p| p == ["-t", "5.000000"]));
    assert!(args.windows(2).any(|p| p == ["-map", "0:v:0"]));
    assert!(args.windows(2).any(|p| p == ["-map", "1:a:0"]));
    // No rawvideo stdin input in the direct path.
    assert!(!args.iter().any(|a| a == "rawvideo"));
    // Progress on stdout drives the UI + watchdog.
    assert!(args.windows(2).any(|p| p == ["-progress", "pipe:1"]));
    // Software encode: libx264 with a CFR scale+fps filter to the output frame.
    assert!(args.windows(2).any(|p| p == ["-c:v", "libx264"]));
    assert!(args.windows(2).any(|p| p == ["-fps_mode", "cfr"]));
    let vf = args
        .iter()
        .position(|a| a == "-vf")
        .map(|i| args[i + 1].clone())
        .expect("direct path must set a -vf filter");
    assert!(vf.contains("fps=30"));
    assert!(vf.contains("scale=1920:1080"));
}

#[test]
fn build_direct_args_vaapi_uploads_for_hardware_encode() {
    use super::ffmpeg_args_builder::build_direct_ffmpeg_args;
    let plan = super::direct::DirectPlan {
        source: std::path::PathBuf::from("/tmp/clip.mp4"),
        source_start_sec: 0.0,
        duration_sec: 3.0,
    };
    let options = NativeExportOptions {
        hw: FfmpegHwOptions {
            hardware_acceleration_mode: Some(crate::media::types::HwAccelMode::Vaapi),
            enable_hardware_encoding: Some(true),
            vaapi_device: Some("/dev/dri/renderD128".into()),
            ..FfmpegHwOptions::default()
        },
        ..base_options()
    };
    let args = build_direct_ffmpeg_args(
        &options,
        &plan,
        None,
        1920,
        1080,
        30.0,
        Path::new("out.mp4"),
    );
    // Hardware decode + encode, with a software fps/scale step uploaded before the encoder.
    assert!(args.windows(2).any(|p| p == ["-hwaccel", "vaapi"]));
    assert!(args.windows(2).any(|p| p == ["-c:v", "h264_vaapi"]));
    let vf = args
        .iter()
        .position(|a| a == "-vf")
        .map(|i| args[i + 1].clone())
        .expect("vaapi direct path must set a -vf filter");
    assert!(vf.contains("hwupload"));
    assert!(vf.contains("fps=30"));
}

#[test]
fn test_mp4_flac_request_remaps_to_aac() {
    // mp4/mov can't carry FLAC/PCM — those must remap to AAC.
    assert_eq!(resolve_audio_encoder(Some("flac"), "mp4"), ("aac", true));
    assert_eq!(resolve_audio_encoder(Some("pcm"), "mov"), ("aac", true));
    // mkv keeps them.
    assert_eq!(resolve_audio_encoder(Some("flac"), "mkv"), ("flac", false));
    assert_eq!(
        resolve_audio_encoder(Some("pcm"), "mkv"),
        ("pcm_s16le", false)
    );
}

#[test]
fn test_audio_only_formats_choose_container_safe_defaults() {
    assert_eq!(resolve_audio_encoder(None, "wav"), ("pcm_s16le", true));
    assert_eq!(resolve_audio_encoder(None, "flac"), ("flac", true));
    assert_eq!(resolve_audio_encoder(None, "mp3"), ("libmp3lame", true));
    assert_eq!(resolve_audio_encoder(None, "opus"), ("libopus", false));
    assert_eq!(resolve_audio_encoder(Some("aac"), "ogg"), ("libopus", true));
    assert_eq!(resolve_audio_encoder(Some("mp3"), "ogg"), ("libopus", true));
    assert_eq!(
        resolve_audio_encoder(Some("vorbis"), "opus"),
        ("libopus", true)
    );
}

// ------------------------------------------------------------------
// resolve_export_hw_mode
// ------------------------------------------------------------------

#[test]
fn resolve_export_hw_mode_returns_none_when_hw_encoding_disabled() {
    let options = NativeExportOptions {
        hw: FfmpegHwOptions {
            enable_hardware_encoding: Some(false),
            hardware_acceleration_mode: Some(HwAccelMode::Vaapi),
            vaapi_device: Some("/dev/dri/renderD128".into()),
            ..FfmpegHwOptions::default()
        },
        ..base_options()
    };
    assert_eq!(resolve_export_hw_mode(&options), HwAccelMode::None);
}

#[test]
fn resolve_export_hw_mode_returns_none_for_alpha_export() {
    let options = NativeExportOptions {
        video_codec: "vp9".to_string(),
        format: "webm".to_string(),
        export_alpha: Some(true),
        hw: FfmpegHwOptions {
            enable_hardware_encoding: Some(true),
            hardware_acceleration_mode: Some(HwAccelMode::Vaapi),
            vaapi_device: Some("/dev/dri/renderD128".into()),
            ..FfmpegHwOptions::default()
        },
        ..base_options()
    };
    assert_eq!(resolve_export_hw_mode(&options), HwAccelMode::None);
}

#[test]
fn resolve_export_hw_mode_returns_none_when_hw_mode_is_none() {
    let options = NativeExportOptions {
        hw: FfmpegHwOptions {
            enable_hardware_encoding: Some(true),
            hardware_acceleration_mode: Some(HwAccelMode::None),
            ..FfmpegHwOptions::default()
        },
        ..base_options()
    };
    assert_eq!(resolve_export_hw_mode(&options), HwAccelMode::None);
}

// ------------------------------------------------------------------
// is_gpu_render_error
// ------------------------------------------------------------------

#[test]
fn is_gpu_render_error_matches_known_patterns() {
    assert!(is_gpu_render_error("no GPU device found"));
    assert!(is_gpu_render_error("pipelined readback failed"));
    assert!(is_gpu_render_error("vello render error"));
    assert!(is_gpu_render_error("no renderer for device 0"));
}

#[test]
fn is_gpu_render_error_rejects_encoder_errors() {
    assert!(!is_gpu_render_error("encoder error: invalid codec"));
    assert!(!is_gpu_render_error("ffmpeg exited with code 1"));
    assert!(!is_gpu_render_error(""));
}
