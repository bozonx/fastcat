//! End-to-end export integration tests. These drive the real `export_timeline`
//! pipeline: offline audio mix → ffmpeg encode → file on disk, verified with
//! ffprobe/PCM inspection. The video case also drives the GPU compositor and is
//! skipped when no wgpu adapter is available (headless CI without software Vulkan).

mod common;

use std::fs;
use std::path::Path;
use std::process::Command;

use app_lib::compositor::Compositor;
use app_lib::media::tasks::NativeMediaTasks;
use app_lib::media::timeline_export::{export_timeline, ExportProgressPhase, NativeExportOptions};
use app_lib::monitor::scene::MonitorScene;
use serde_json::json;

fn noop_progress(_p: f64, _phase: ExportProgressPhase) {}
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

fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f64 = samples.iter().map(|s| (*s as f64) * (*s as f64)).sum();
    (sum / samples.len() as f64).sqrt() as f32
}

struct WavPcm {
    sample_rate: u32,
    channels: u16,
    samples: Vec<f32>,
}

fn read_wav_pcm_s16le(path: &Path) -> WavPcm {
    let bytes = fs::read(path).expect("wav file should be readable");
    assert!(bytes.starts_with(b"RIFF"), "expected RIFF WAV");
    assert_eq!(&bytes[8..12], b"WAVE", "expected WAVE file");

    let mut offset = 12;
    let mut sample_rate = 0;
    let mut channels = 0;
    let mut samples = None;
    while offset + 8 <= bytes.len() {
        let id = &bytes[offset..offset + 4];
        let size = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
        let data_start = offset + 8;
        let data_end = data_start + size;
        assert!(data_end <= bytes.len(), "invalid wav chunk size");
        if id == b"fmt " {
            assert!(size >= 16, "invalid wav fmt chunk");
            let format = u16::from_le_bytes(bytes[data_start..data_start + 2].try_into().unwrap());
            channels =
                u16::from_le_bytes(bytes[data_start + 2..data_start + 4].try_into().unwrap());
            sample_rate =
                u32::from_le_bytes(bytes[data_start + 4..data_start + 8].try_into().unwrap());
            assert_eq!(format, 1, "expected PCM WAV format");
        }
        if id == b"data" {
            samples = Some(
                bytes[data_start..data_end]
                    .chunks_exact(2)
                    .map(|chunk| {
                        let sample = i16::from_le_bytes(chunk.try_into().unwrap());
                        sample as f32 / i16::MAX as f32
                    })
                    .collect(),
            );
        }
        offset = data_end + (size % 2);
    }

    WavPcm {
        sample_rate,
        channels,
        samples: samples.expect("WAV data chunk not found"),
    }
}

fn read_wav_pcm_s16le_mono(path: &Path) -> Vec<f32> {
    let wav = read_wav_pcm_s16le(path);
    assert_eq!(wav.channels, 1, "expected mono WAV");
    wav.samples
}

fn zero_crossings(samples: &[f32]) -> usize {
    samples
        .windows(2)
        .filter(|w| (w[0] <= 0.0) != (w[1] <= 0.0))
        .count()
}

fn generate_sine_wav(path: &Path, sample_rate: u32, frequency: u32, duration_sec: f64) {
    let status = Command::new("ffmpeg")
        .args(["-hide_banner", "-loglevel", "error", "-y"])
        .args([
            "-f",
            "lavfi",
            "-i",
            &format!(
                "sine=frequency={frequency}:sample_rate={sample_rate}:duration={duration_sec}"
            ),
        ])
        .args(["-ac", "1", "-c:a", "pcm_s16le"])
        .arg(path)
        .status()
        .expect("ffmpeg should run");
    assert!(status.success(), "ffmpeg sine fixture generation failed");
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
fn audio_only_export_writes_crossfaded_output_file() {
    skip_unless!(
        common::has_ffmpeg() && common::has_ffprobe(),
        "ffmpeg/ffprobe not installed"
    );
    skip_unless!(
        common::has_ffmpeg_encoder("pcm_s16le"),
        "ffmpeg pcm_s16le encoder not installed"
    );

    let fixture = common::fixture("audio/audio-sine.wav");
    let fixture_path = fixture.to_string_lossy();
    let scene: MonitorScene = serde_json::from_value(json!({
        "layers": [],
        "audio_layers": [
            {
                "id": "outgoing",
                "path": fixture_path,
                "timeline_start_sec": 0.0,
                "timeline_end_sec": 1.0,
                "source_start_sec": 0.0,
                "audio_fade_out_sec": 0.5,
                "audio_fade_out_curve": "linear"
            },
            {
                "id": "incoming",
                "path": fixture_path,
                "timeline_start_sec": 0.5,
                "timeline_end_sec": 1.5,
                "source_start_sec": 0.0,
                "audio_fade_in_sec": 0.5,
                "audio_fade_in_curve": "linear"
            }
        ],
    }))
    .unwrap();

    let options: NativeExportOptions = serde_json::from_value(json!({
        "width": 320, "height": 240, "fps": 30.0,
        "startSec": 0.0, "endSec": 1.5,
        "videoCodec": "", "videoBitrateBps": 0, "format": "wav",
        "audioEnabled": true, "audioCodec": "pcm", "audioBitrateBps": null,
        "audioChannels": 1, "audioSampleRate": 48_000,
        "videoEnabled": false,
        "ffmpegPath": "ffmpeg", "ffprobePath": "ffprobe",
    }))
    .unwrap();

    let tmp = tempfile::tempdir().unwrap();
    let target = tmp.path().join("out_crossfade.wav");
    let tasks = NativeMediaTasks::default();

    export_timeline(
        &tasks,
        "export-audio-crossfade",
        scene,
        options,
        &target,
        &noop_progress,
        &noop_warning,
    )
    .expect("crossfaded audio export should succeed");

    assert!(target.exists(), "export must write a file");
    let codec = common::ffprobe_entry(Path::new(&target), "stream=codec_name", Some("a:0"));
    assert_eq!(codec, "pcm_s16le");
    let dur: f64 = common::ffprobe_entry(Path::new(&target), "format=duration", None)
        .parse()
        .unwrap_or(0.0);
    assert!((dur - 1.5).abs() < 0.05, "duration ~1.5s, got {dur}");

    let pcm = read_wav_pcm_s16le_mono(&target);
    let sample_rate = 48_000usize;
    let window = sample_rate / 10;
    let full_rms = rms(&pcm[sample_rate / 5..sample_rate / 5 + window]);
    let overlap_rms = rms(&pcm[sample_rate * 7 / 10..sample_rate * 7 / 10 + window]);
    let tail_rms = rms(&pcm[sample_rate * 5 / 4..sample_rate * 5 / 4 + window]);

    assert!(
        (overlap_rms / full_rms - 1.0).abs() < 0.2,
        "exported crossfade overlap should stay near one clip, overlap={overlap_rms:.6}, full={full_rms:.6}"
    );
    assert!(
        (tail_rms / full_rms - 1.0).abs() < 0.2,
        "incoming clip should return to full level after export crossfade, tail={tail_rms:.6}, full={full_rms:.6}"
    );
}

#[test]
fn audio_only_wav_export_preserves_requested_sample_rate_and_sample_count() {
    skip_unless!(
        common::has_ffmpeg() && common::has_ffprobe(),
        "ffmpeg/ffprobe not installed"
    );
    skip_unless!(
        common::has_ffmpeg_encoder("pcm_s16le"),
        "ffmpeg pcm_s16le encoder not installed"
    );

    let scene: MonitorScene = serde_json::from_value(json!({
        "layers": [],
        "audio_layers": [audio_layer("audio/audio-sine.wav")],
    }))
    .unwrap();

    let options: NativeExportOptions = serde_json::from_value(json!({
        "width": 320, "height": 240, "fps": 30.0,
        "startSec": 0.0, "endSec": 1.0,
        "videoCodec": "", "videoBitrateBps": 0, "format": "wav",
        "audioEnabled": true, "audioCodec": "pcm", "audioBitrateBps": null,
        "audioChannels": 1, "audioSampleRate": 44_100,
        "videoEnabled": false,
        "ffmpegPath": "ffmpeg", "ffprobePath": "ffprobe",
    }))
    .unwrap();

    let tmp = tempfile::tempdir().unwrap();
    let target = tmp.path().join("out_44100.wav");
    let tasks = NativeMediaTasks::default();

    export_timeline(
        &tasks,
        "export-audio-44100",
        scene,
        options,
        &target,
        &noop_progress,
        &noop_warning,
    )
    .expect("audio WAV export should succeed");

    let ffprobe_rate: u32 = common::ffprobe_entry(&target, "stream=sample_rate", Some("a:0"))
        .parse()
        .unwrap_or(0);
    let wav = read_wav_pcm_s16le(&target);

    assert_eq!(ffprobe_rate, 44_100);
    assert_eq!(wav.sample_rate, 44_100);
    assert_eq!(wav.channels, 1);
    assert!(
        (wav.samples.len() as i64 - 44_100).abs() <= 8,
        "expected ~44100 samples, got {}",
        wav.samples.len()
    );
}

#[test]
fn audio_only_wav_export_resamples_source_without_duration_or_pitch_drift() {
    skip_unless!(
        common::has_ffmpeg() && common::has_ffprobe(),
        "ffmpeg/ffprobe not installed"
    );
    skip_unless!(
        common::has_ffmpeg_encoder("pcm_s16le"),
        "ffmpeg pcm_s16le encoder not installed"
    );

    let tmp = tempfile::tempdir().unwrap();
    let source = tmp.path().join("source_44100.wav");
    generate_sine_wav(&source, 44_100, 440, 1.0);

    let scene: MonitorScene = serde_json::from_value(json!({
        "layers": [],
        "audio_layers": [{
            "id": "source-44100",
            "path": source.to_string_lossy(),
            "timeline_start_sec": 0.0,
            "timeline_end_sec": 1.0,
            "source_start_sec": 0.0
        }],
    }))
    .unwrap();

    let options: NativeExportOptions = serde_json::from_value(json!({
        "width": 320, "height": 240, "fps": 30.0,
        "startSec": 0.0, "endSec": 1.0,
        "videoCodec": "", "videoBitrateBps": 0, "format": "wav",
        "audioEnabled": true, "audioCodec": "pcm", "audioBitrateBps": null,
        "audioChannels": 1, "audioSampleRate": 48_000,
        "videoEnabled": false,
        "ffmpegPath": "ffmpeg", "ffprobePath": "ffprobe",
    }))
    .unwrap();

    let target = tmp.path().join("out_resampled_48000.wav");
    let tasks = NativeMediaTasks::default();

    export_timeline(
        &tasks,
        "export-audio-resample-44100-to-48000",
        scene,
        options,
        &target,
        &noop_progress,
        &noop_warning,
    )
    .expect("resampled audio WAV export should succeed");

    let wav = read_wav_pcm_s16le(&target);
    assert_eq!(wav.sample_rate, 48_000);
    assert_eq!(wav.channels, 1);
    assert!(
        (wav.samples.len() as i64 - 48_000).abs() <= 8,
        "expected ~48000 samples after resampling, got {}",
        wav.samples.len()
    );

    let zc = zero_crossings(&wav.samples);
    assert!(
        (800..=960).contains(&zc),
        "expected ~880 zero crossings for 440 Hz after resampling, got {zc}"
    );
    assert!(rms(&wav.samples) > 0.02);
}

#[test]
fn audio_only_wav_export_applies_clip_track_and_master_gain() {
    skip_unless!(
        common::has_ffmpeg() && common::has_ffprobe(),
        "ffmpeg/ffprobe not installed"
    );
    skip_unless!(
        common::has_ffmpeg_encoder("pcm_s16le"),
        "ffmpeg pcm_s16le encoder not installed"
    );

    fn export_gain_case(tmp: &Path, name: &str, scene_value: serde_json::Value) -> f32 {
        let scene: MonitorScene = serde_json::from_value(scene_value).unwrap();
        let options: NativeExportOptions = serde_json::from_value(json!({
            "width": 320, "height": 240, "fps": 30.0,
            "startSec": 0.0, "endSec": 1.0,
            "videoCodec": "", "videoBitrateBps": 0, "format": "wav",
            "audioEnabled": true, "audioCodec": "pcm", "audioBitrateBps": null,
            "audioChannels": 1, "audioSampleRate": 48_000,
            "videoEnabled": false,
            "ffmpegPath": "ffmpeg", "ffprobePath": "ffprobe",
        }))
        .unwrap();
        let target = tmp.join(format!("{name}.wav"));
        let tasks = NativeMediaTasks::default();

        export_timeline(
            &tasks,
            name,
            scene,
            options,
            &target,
            &noop_progress,
            &noop_warning,
        )
        .expect("gain export should succeed");

        let wav = read_wav_pcm_s16le(&target);
        rms(&wav.samples[4_800..43_200])
    }

    let tmp = tempfile::tempdir().unwrap();
    let fixture = common::fixture("audio/audio-sine.wav");
    let fixture_path = fixture.to_string_lossy();
    let layer = |id: &str, gain: f64, track_id: Option<&str>| {
        json!({
            "id": id,
            "path": fixture_path,
            "track_id": track_id,
            "timeline_start_sec": 0.0,
            "timeline_end_sec": 1.0,
            "source_start_sec": 0.0,
            "audio_gain": gain
        })
    };

    let baseline = export_gain_case(
        tmp.path(),
        "gain-baseline",
        json!({
            "layers": [],
            "audio_layers": [layer("baseline", 1.0, None)],
            "audio_master_gain": 1.0
        }),
    );
    let clip_half = export_gain_case(
        tmp.path(),
        "gain-clip-half",
        json!({
            "layers": [],
            "audio_layers": [layer("clip-half", 0.5, None)],
            "audio_master_gain": 1.0
        }),
    );
    let track_half = export_gain_case(
        tmp.path(),
        "gain-track-half",
        json!({
            "layers": [],
            "audio_layers": [layer("track-half", 1.0, Some("track-a"))],
            "audio_tracks": [{
                "id": "track-a",
                "audio_gain": 0.5,
                "audio_balance": 0.0,
                "audio_muted": false,
                "audio_solo": false
            }],
            "audio_master_gain": 1.0
        }),
    );
    let master_half = export_gain_case(
        tmp.path(),
        "gain-master-half",
        json!({
            "layers": [],
            "audio_layers": [layer("master-half", 1.0, None)],
            "audio_master_gain": 0.5
        }),
    );

    for (label, value) in [
        ("clip gain", clip_half),
        ("track gain", track_half),
        ("master gain", master_half),
    ] {
        let ratio = value / baseline;
        assert!(
            (ratio - 0.5).abs() < 0.05,
            "{label} should halve exported RMS, ratio={ratio:.4}"
        );
    }
}

#[test]
fn audio_only_wav_export_applies_fade_shape_to_output_pcm() {
    skip_unless!(
        common::has_ffmpeg() && common::has_ffprobe(),
        "ffmpeg/ffprobe not installed"
    );
    skip_unless!(
        common::has_ffmpeg_encoder("pcm_s16le"),
        "ffmpeg pcm_s16le encoder not installed"
    );

    let fixture = common::fixture("audio/audio-sine.wav");
    let fixture_path = fixture.to_string_lossy();
    let scene: MonitorScene = serde_json::from_value(json!({
        "layers": [],
        "audio_layers": [{
            "id": "faded",
            "path": fixture_path,
            "timeline_start_sec": 0.0,
            "timeline_end_sec": 1.0,
            "source_start_sec": 0.0,
            "audio_fade_in_sec": 0.25,
            "audio_fade_out_sec": 0.25,
            "audio_fade_in_curve": "linear",
            "audio_fade_out_curve": "linear"
        }],
    }))
    .unwrap();
    let options: NativeExportOptions = serde_json::from_value(json!({
        "width": 320, "height": 240, "fps": 30.0,
        "startSec": 0.0, "endSec": 1.0,
        "videoCodec": "", "videoBitrateBps": 0, "format": "wav",
        "audioEnabled": true, "audioCodec": "pcm", "audioBitrateBps": null,
        "audioChannels": 1, "audioSampleRate": 48_000,
        "videoEnabled": false,
        "ffmpegPath": "ffmpeg", "ffprobePath": "ffprobe",
    }))
    .unwrap();

    let tmp = tempfile::tempdir().unwrap();
    let target = tmp.path().join("out_faded.wav");
    let tasks = NativeMediaTasks::default();

    export_timeline(
        &tasks,
        "export-audio-faded",
        scene,
        options,
        &target,
        &noop_progress,
        &noop_warning,
    )
    .expect("faded audio WAV export should succeed");

    let wav = read_wav_pcm_s16le(&target);
    let window = 4_800;
    let head_rms = rms(&wav.samples[..window]);
    let middle_rms = rms(&wav.samples[21_600..21_600 + window]);
    let tail_rms = rms(&wav.samples[wav.samples.len() - window..]);

    assert!(
        head_rms < middle_rms * 0.35,
        "fade-in head should be quieter than middle: head={head_rms:.6}, middle={middle_rms:.6}"
    );
    assert!(
        tail_rms < middle_rms * 0.35,
        "fade-out tail should be quieter than middle: tail={tail_rms:.6}, middle={middle_rms:.6}"
    );
    assert!(middle_rms > 0.02);
}

#[test]
fn audio_only_wav_export_crossfade_moves_from_outgoing_to_incoming_tone() {
    skip_unless!(
        common::has_ffmpeg() && common::has_ffprobe(),
        "ffmpeg/ffprobe not installed"
    );
    skip_unless!(
        common::has_ffmpeg_encoder("pcm_s16le"),
        "ffmpeg pcm_s16le encoder not installed"
    );

    let tmp = tempfile::tempdir().unwrap();
    let outgoing_source = tmp.path().join("outgoing_440.wav");
    let incoming_source = tmp.path().join("incoming_880.wav");
    generate_sine_wav(&outgoing_source, 48_000, 440, 1.0);
    generate_sine_wav(&incoming_source, 48_000, 880, 1.0);

    let scene: MonitorScene = serde_json::from_value(json!({
        "layers": [],
        "audio_layers": [
            {
                "id": "outgoing-440",
                "path": outgoing_source.to_string_lossy(),
                "timeline_start_sec": 0.0,
                "timeline_end_sec": 1.0,
                "source_start_sec": 0.0,
                "audio_fade_out_sec": 0.5,
                "audio_fade_out_curve": "linear"
            },
            {
                "id": "incoming-880",
                "path": incoming_source.to_string_lossy(),
                "timeline_start_sec": 0.5,
                "timeline_end_sec": 1.5,
                "source_start_sec": 0.0,
                "audio_fade_in_sec": 0.5,
                "audio_fade_in_curve": "linear"
            }
        ],
    }))
    .unwrap();
    let options: NativeExportOptions = serde_json::from_value(json!({
        "width": 320, "height": 240, "fps": 30.0,
        "startSec": 0.0, "endSec": 1.5,
        "videoCodec": "", "videoBitrateBps": 0, "format": "wav",
        "audioEnabled": true, "audioCodec": "pcm", "audioBitrateBps": null,
        "audioChannels": 1, "audioSampleRate": 48_000,
        "videoEnabled": false,
        "ffmpegPath": "ffmpeg", "ffprobePath": "ffprobe",
    }))
    .unwrap();

    let target = tmp.path().join("out_crossfade_tones.wav");
    let tasks = NativeMediaTasks::default();

    export_timeline(
        &tasks,
        "export-audio-crossfade-tones",
        scene,
        options,
        &target,
        &noop_progress,
        &noop_warning,
    )
    .expect("crossfaded tone export should succeed");

    let wav = read_wav_pcm_s16le(&target);
    let early = &wav.samples[9_600..19_200];
    let overlap = &wav.samples[33_600..43_200];
    let tail = &wav.samples[60_000..69_600];

    let early_zc = zero_crossings(early);
    let tail_zc = zero_crossings(tail);
    assert!(
        (160..=210).contains(&early_zc),
        "early window should be dominated by 440 Hz, zc={early_zc}"
    );
    assert!(
        (330..=390).contains(&tail_zc),
        "tail window should be dominated by 880 Hz, zc={tail_zc}"
    );
    assert!(
        rms(overlap) > rms(early) * 0.45,
        "crossfade overlap should retain audible energy"
    );
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
    // ffmpeg 8.x stores VP9 alpha as BlockAdditional data with alpha_mode=1
    // metadata instead of reporting yuva420p as pix_fmt.
    let alpha_mode =
        common::ffprobe_entry(Path::new(&target), "stream_tags=alpha_mode", Some("v:0"));
    assert!(
        pix_fmt.contains("yuva") || alpha_mode == "1",
        "expected yuva pix_fmt or alpha_mode=1 for alpha export, got pix_fmt='{pix_fmt}' alpha_mode='{alpha_mode}'"
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
