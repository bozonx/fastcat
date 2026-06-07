use std::path::Path;

use super::super::ffmpeg_utils::resolve_audio_encoder;
use super::ffmpeg_args_builder::{build_ffmpeg_args, export_uses_alpha};
use super::options::NativeExportOptions;

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
        keyframe_interval_sec: None,
        metadata_title: None,
        metadata_description: None,
        metadata_author: None,
        metadata_tags: None,
        ffmpeg_path: None,
        ffprobe_path: None,
        hardware_acceleration_mode: None,
        vaapi_device: None,
        enable_hardware_encoding: None,
        export_alpha: None,
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
        keyframe_interval_sec: None,
        metadata_title: None,
        metadata_description: None,
        metadata_author: None,
        metadata_tags: None,
        ffmpeg_path: None,
        ffprobe_path: None,
        hardware_acceleration_mode: None,
        vaapi_device: None,
        enable_hardware_encoding: None,
        export_alpha: None,
    };
    let args = build_ffmpeg_args(
        &options,
        Some(Path::new("dummy.wav")),
        1920,
        1080,
        30.0,
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
        keyframe_interval_sec: None,
        metadata_title: None,
        metadata_description: None,
        metadata_author: None,
        metadata_tags: None,
        ffmpeg_path: None,
        ffprobe_path: None,
        hardware_acceleration_mode: None,
        vaapi_device: None,
        enable_hardware_encoding: None,
        export_alpha: Some(true),
    };
    let args = build_ffmpeg_args(&options, None, 1920, 1080, 30.0, Path::new("output.webm"));
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
        keyframe_interval_sec: None,
        metadata_title: None,
        metadata_description: None,
        metadata_author: None,
        metadata_tags: None,
        ffmpeg_path: None,
        ffprobe_path: None,
        hardware_acceleration_mode: None,
        vaapi_device: None,
        enable_hardware_encoding: None,
        export_alpha: Some(true),
    };
    let args = build_ffmpeg_args(&options, None, 1920, 1080, 30.0, Path::new("output.mp4"));
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
    let args = build_ffmpeg_args(&options, None, 1920, 1080, 30.0, Path::new("output.mp4"));

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
    let args = build_ffmpeg_args(&options, None, 1920, 1080, 30.0, Path::new("output.mkv"));
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
    let args = build_ffmpeg_args(&options, None, 1920, 1080, 30.0, Path::new("output.mkv"));
    assert!(args.contains(&"yuva420p".to_string()));
    assert!(args.windows(2).any(|pair| pair == ["-auto-alt-ref", "0"]));
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
