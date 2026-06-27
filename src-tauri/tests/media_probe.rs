//! Integration tests for the media probe / decode entry points against the
//! real synthetic fixtures. These run `ffprobe` and the `image` decoder and
//! touch the filesystem.

mod common;

use std::path::Path;

use app_lib::media::audio_extract::extract_audio_stream;
use app_lib::media::image_decode::decode_image;
use app_lib::media::processing::probe_media;
use app_lib::media::tasks::NativeMediaTasks;

#[test]
fn probe_h264_mp4_reports_video_and_audio() {
    skip_unless!(common::has_ffprobe(), "ffprobe not installed");

    let meta = probe_media(&common::fixture("video/video-h264-aac.mp4"), "ffprobe").unwrap();

    assert!(
        (meta.duration - 1.0).abs() < 0.2,
        "duration ~1s, got {}",
        meta.duration
    );
    let video = meta.video.expect("should have a video stream");
    assert_eq!((video.width, video.height), (320, 240));
    assert!(
        video.codec.contains("h264") || video.codec.contains("avc"),
        "codec={}",
        video.codec
    );
    assert!(video.fps > 0.0);

    let audio = meta.audio.expect("should have an audio stream");
    assert!(audio.codec.contains("aac"), "audio codec={}", audio.codec);
    assert_eq!(audio.channels, Some(1));
}

#[test]
fn probe_audio_only_flac_has_no_video() {
    skip_unless!(common::has_ffprobe(), "ffprobe not installed");

    let meta = probe_media(&common::fixture("audio/audio-sine.flac"), "ffprobe").unwrap();

    assert!(meta.video.is_none(), "flac must not report a video stream");
    let audio = meta.audio.expect("flac must report an audio stream");
    assert!(audio.codec.contains("flac"), "codec={}", audio.codec);
    assert_eq!(audio.sample_rate, Some(48_000));
}

#[test]
fn probe_covers_the_video_container_matrix() {
    skip_unless!(common::has_ffprobe(), "ffprobe not installed");

    for rel in [
        "video/video-h264-aac.mov",
        "video/video-h264-aac.m4v",
        "video/video-mpeg4-mp3.avi",
        "video/video-vp9-opus.webm",
        "video/video-vp8-vorbis.webm",
        "video/video-av1-opus.mkv",
        "video/video-prores.mov",
    ] {
        let meta = probe_media(&common::fixture(rel), "ffprobe")
            .unwrap_or_else(|e| panic!("probe {rel} failed: {e}"));
        let video = meta
            .video
            .unwrap_or_else(|| panic!("{rel} should have video"));
        assert_eq!((video.width, video.height), (320, 240), "{rel} dimensions");
        assert!(meta.duration > 0.5, "{rel} duration {}", meta.duration);
    }
}

#[test]
fn probe_alpha_vp9_webm_reports_video() {
    skip_unless!(common::has_ffprobe(), "ffprobe not installed");

    // The alpha compositing fixture is 200x200 (see generate-test-fixtures.sh)
    // and carries a real alpha plane used by the compositor parity path.
    let meta = probe_media(&common::fixture("video/video-alpha-vp9.webm"), "ffprobe")
        .expect("alpha-vp9 should probe");
    let video = meta.video.expect("alpha-vp9 should have a video stream");
    assert_eq!((video.width, video.height), (200, 200), "alpha-vp9 dimensions");
    assert!(meta.duration > 0.5, "alpha-vp9 duration {}", meta.duration);
}

#[test]
fn probe_covers_the_audio_format_matrix() {
    skip_unless!(common::has_ffprobe(), "ffprobe not installed");

    // Every audio container/codec FastCat advertises (AUDIO_EXTENSIONS in
    // src/utils/media-types.ts). Each is a 440 Hz mono sine — see
    // scripts/generate-test-fixtures.sh. The substring is the ffprobe codec
    // name we expect inside that container.
    for (rel, codec_substr) in [
        ("audio/audio-sine.mp3", "mp3"),
        ("audio/audio-sine.wav", "pcm"),
        ("audio/audio-sine.aac", "aac"),
        ("audio/audio-sine.flac", "flac"),
        ("audio/audio-sine.ogg", "vorbis"),
        ("audio/audio-sine.opus", "opus"),
        ("audio/audio-sine.m4a", "aac"),
        ("audio/audio-sine.weba", "opus"),
    ] {
        let meta = probe_media(&common::fixture(rel), "ffprobe")
            .unwrap_or_else(|e| panic!("probe {rel} failed: {e}"));

        assert!(meta.video.is_none(), "{rel} must not report a video stream");
        let audio = meta
            .audio
            .unwrap_or_else(|| panic!("{rel} should have an audio stream"));
        assert!(
            audio.codec.contains(codec_substr),
            "{rel} codec={} (expected to contain {codec_substr})",
            audio.codec,
        );
        assert!(
            audio.sample_rate.unwrap_or(0) > 0,
            "{rel} should report a positive sample rate",
        );
        assert_eq!(audio.channels, Some(1), "{rel} channels");
        assert!(meta.duration > 0.5, "{rel} duration {}", meta.duration);
    }
}

#[test]
fn decode_image_matrix_reports_dimensions() {
    // The native decoder is built with the `image` crate's png/jpeg/webp
    // features only (see src-tauri/Cargo.toml); bmp/tiff/avif are handled
    // elsewhere (browser side), so they are intentionally not covered here.
    for (rel, w, h) in [
        ("image/image.jpg", 320, 240),
        ("image/image-rgba.png", 320, 240),
        ("image/image.webp", 320, 240),
    ] {
        let decoded = decode_image(&common::fixture(rel))
            .unwrap_or_else(|e| panic!("decode {rel} failed: {e}"));
        assert_eq!((decoded.width, decoded.height), (w, h), "{rel}");
    }
}

#[test]
fn extract_audio_from_video_produces_probeable_file() {
    skip_unless!(
        common::has_ffmpeg() && common::has_ffprobe(),
        "ffmpeg/ffprobe not installed"
    );

    let tmp = tempfile::tempdir().unwrap();
    let target = tmp.path().join("extracted.m4a");
    let tasks = NativeMediaTasks::default();

    extract_audio_stream(
        &tasks,
        "test-extract",
        &common::fixture("video/video-h264-aac.mp4"),
        &target,
        "ffmpeg",
        "ffprobe",
    )
    .expect("audio extraction should succeed");

    assert!(target.exists());
    let codec = common::ffprobe_entry(Path::new(&target), "stream=codec_type", Some("a:0"));
    assert_eq!(codec, "audio");
}
