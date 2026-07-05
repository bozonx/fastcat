//! Integration tests for native Rust media proxy generation (`generate_proxy`).
//! Validates real FFmpeg transcoding, resolution scaling, progress tracking,
//! and error handling for invalid/audio-only sources.

mod common;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use app_lib::media::ffmpeg::hw::FfmpegHwOptions;
use app_lib::media::processing::{generate_proxy, probe_media, NativeProxyOptions};
use app_lib::media::tasks::NativeMediaTasks;

#[test]
fn generate_proxy_from_video_creates_scaled_mp4_file() {
    skip_unless!(
        common::has_ffmpeg() && common::has_ffprobe(),
        "ffmpeg/ffprobe not installed"
    );

    let tmp = tempfile::tempdir().unwrap();
    let target_path = tmp.path().join("proxy_output.mp4");
    let source_path = common::fixture("video/video-h264-aac.mp4");

    let tasks = NativeMediaTasks::default();
    let options = NativeProxyOptions {
        max_pixels: 160 * 120,
        video_bitrate_bps: 500_000,
        audio_bitrate_bps: 64_000,
        video_codec: "h264".into(),
        copy_opus_audio: false,
        hw: FfmpegHwOptions::default(),
    };

    let result = generate_proxy(
        &tasks,
        "test-proxy-1",
        &source_path,
        &target_path,
        options,
        None,
    );
    assert!(
        result.is_ok(),
        "proxy generation failed: {:?}",
        result.err()
    );

    assert!(target_path.exists(), "proxy output file should exist");
    assert!(
        std::fs::metadata(&target_path).unwrap().len() > 0,
        "proxy output file should not be empty"
    );

    let meta = probe_media(&target_path, "ffprobe").expect("probe generated proxy");
    assert!(
        (meta.duration - 1.0).abs() < 0.3,
        "duration should be ~1s, got {}",
        meta.duration
    );

    let video = meta.video.expect("proxy should contain video stream");
    assert!(
        video.width <= 160 && video.height <= 120,
        "proxy dimensions should be scaled down, got {}x{}",
        video.width,
        video.height
    );
    assert!(meta.audio.is_some(), "proxy should preserve audio stream");
}

#[test]
fn generate_proxy_fails_for_audio_only_fixture() {
    skip_unless!(common::has_ffprobe(), "ffprobe not installed");

    let tmp = tempfile::tempdir().unwrap();
    let target_path = tmp.path().join("audio_proxy.mp4");
    let source_path = common::fixture("audio/audio-sine.mp3");

    let tasks = NativeMediaTasks::default();
    let options = NativeProxyOptions {
        max_pixels: 640 * 360,
        video_bitrate_bps: 1_000_000,
        audio_bitrate_bps: 96_000,
        video_codec: "h264".into(),
        copy_opus_audio: false,
        hw: FfmpegHwOptions::default(),
    };

    let result = generate_proxy(
        &tasks,
        "test-proxy-audio",
        &source_path,
        &target_path,
        options,
        None,
    );
    assert!(
        result.is_err(),
        "proxy generation should fail on audio-only source"
    );
    let err_msg = result.unwrap_err().to_string();
    assert!(
        err_msg.contains("no video stream"),
        "error should state no video stream, got: {err_msg}"
    );
}

#[test]
fn generate_proxy_invokes_progress_callback() {
    skip_unless!(
        common::has_ffmpeg() && common::has_ffprobe(),
        "ffmpeg/ffprobe not installed"
    );

    let tmp = tempfile::tempdir().unwrap();
    let target_path = tmp.path().join("proxy_progress_output.mp4");
    let source_path = common::fixture("video/video-h264-aac.mp4");

    let tasks = NativeMediaTasks::default();
    let options = NativeProxyOptions {
        max_pixels: 320 * 240,
        video_bitrate_bps: 500_000,
        audio_bitrate_bps: 64_000,
        video_codec: "h264".into(),
        copy_opus_audio: false,
        hw: FfmpegHwOptions::default(),
    };

    let progress_called = Arc::new(AtomicBool::new(false));
    let progress_flag = Arc::clone(&progress_called);

    let on_progress = move |val: f64| {
        if val > 0.0 {
            progress_flag.store(true, Ordering::SeqCst);
        }
    };

    let result = generate_proxy(
        &tasks,
        "test-proxy-progress",
        &source_path,
        &target_path,
        options,
        Some(&on_progress),
    );

    assert!(
        result.is_ok(),
        "proxy generation with progress callback failed"
    );
    assert!(
        progress_called.load(Ordering::SeqCst),
        "progress callback should have been invoked during proxy generation"
    );
}
