use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;
use std::process::{Command, Stdio};

use crate::media::decode::probe_rotation;
use crate::media::decode::gate::decoder_load_gate;
use crate::media::ffmpeg::args::*;
use crate::media::ffmpeg::hw::FfmpegHwOptions;
use crate::media::ffmpeg::runner::{emit_media_warning, run_ffmpeg_task};
pub(crate) use crate::media::ffmpeg::runner::{now_millis, spawn_stderr_drain, StderrDrain};
use crate::media::ffmpeg::utils::*;
pub use crate::media::tasks::NativeMediaTasks;
use crate::media::timeline_render::encode_rgba_as_webp;
use crate::media::types::HwAccelMode;

const DEFAULT_VIDEO_WIDTH: u32 = 1920;
const DEFAULT_VIDEO_HEIGHT: u32 = 1080;
const DEFAULT_VIDEO_FPS: f64 = 30.0;
const DEFAULT_VIDEO_BITRATE_BPS: u32 = 5_000_000;
const DEFAULT_WEBP_QUALITY: f32 = 75.0;
const THUMBNAIL_SEEK_THRESHOLD_SEC: f64 = 1.0;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMediaMetadata {
    pub duration: f64,
    pub container: String,
    pub video: Option<NativeVideoMetadata>,
    pub audio: Option<NativeAudioMetadata>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeVideoMetadata {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub codec: String,
    pub bitrate: Option<u64>,
    pub rotation: i32,
    /// Whether ffmpeg could actually decode the first frame. `None` when the
    /// caller skipped the (relatively costly) decode-validation pass; the cheap
    /// `probe_media` path used by proxy/convert leaves this unset. Mirrors the web
    /// worker's "decode one sample" check so the desktop build flags
    /// truncated/partially-corrupt sources the same way the browser build does.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_decode: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAudioMetadata {
    pub codec: String,
    pub bitrate: Option<u64>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u32>,
    /// See [`NativeVideoMetadata::can_decode`].
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_decode: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeProxyOptions {
    pub max_pixels: u32,
    pub video_bitrate_bps: u32,
    pub audio_bitrate_bps: u32,
    pub video_codec: String,
    pub copy_opus_audio: bool,

    // Hardware acceleration options
    #[serde(flatten)]
    pub hw: FfmpegHwOptions,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeConvertOptions {
    pub kind: String,
    pub format: String,
    pub video_codec: Option<String>,
    pub video_bitrate_bps: Option<u32>,
    pub audio_codec: Option<String>,
    pub audio_bitrate_bps: Option<u32>,
    pub audio: Option<bool>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
    pub audio_channels: Option<u32>,
    pub audio_sample_rate: Option<u32>,
    pub audio_reverse: Option<bool>,

    // Hardware acceleration options
    #[serde(flatten)]
    pub hw: FfmpegHwOptions,
}

pub fn probe_media(path: &Path, ffprobe_path: &str) -> Result<NativeMediaMetadata> {
    verify_ffmpeg_binary(ffprobe_path).context("ffprobe binary check failed")?;
    log::debug!("[probe_media] running ffprobe on {}", path.display());
    let output = Command::new(ffprobe_path)
        .arg("-v")
        .arg("error")
        .arg("-print_format")
        .arg("json")
        .arg("-show_streams")
        .arg("-show_format")
        .arg(path)
        .output()
        .context("failed to run ffprobe")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::warn!(
            "[probe_media] ffprobe failed for {}: {}",
            path.display(),
            stderr
        );
        return Err(anyhow!("ffprobe failed: {}", stderr));
    }

    let json: Value =
        serde_json::from_slice(&output.stdout).context("ffprobe returned invalid JSON")?;
    log::debug!(
        "[probe_media] ffprobe output keys: {:?}",
        json.as_object().map(|o| o.keys().collect::<Vec<_>>())
    );
    metadata_from_ffprobe(json)
}

fn metadata_from_ffprobe(json: Value) -> Result<NativeMediaMetadata> {
    let streams = json
        .get("streams")
        .and_then(|s| s.as_array())
        .ok_or_else(|| anyhow!("ffprobe: no streams"))?;

    let format = json.get("format").and_then(|f| f.as_object());

    let duration = format
        .and_then(|f| f.get("duration"))
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);

    let container = format
        .and_then(|f| f.get("format_name"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .split(',')
        .next()
        .unwrap_or("")
        .to_string();

    let video = streams
        .iter()
        .find(|s| s.get("codec_type").and_then(|v| v.as_str()) == Some("video"))
        .map(|stream| NativeVideoMetadata {
            width: stream.get("width").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
            height: stream.get("height").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
            fps: stream
                .get("avg_frame_rate")
                .and_then(|v| v.as_str())
                .and_then(parse_rational)
                .or_else(|| {
                    stream
                        .get("r_frame_rate")
                        .and_then(|v| v.as_str())
                        .and_then(parse_rational)
                })
                .unwrap_or(0.0),
            codec: stream
                .get("codec_name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            bitrate: stream
                .get("bit_rate")
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse::<u64>().ok()),
            rotation: probe_rotation(stream),
            can_decode: None,
        });

    let audio = streams
        .iter()
        .find(|s| s.get("codec_type").and_then(|v| v.as_str()) == Some("audio"))
        .map(|stream| NativeAudioMetadata {
            codec: stream
                .get("codec_name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            bitrate: stream
                .get("bit_rate")
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse::<u64>().ok()),
            sample_rate: stream
                .get("sample_rate")
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse::<u32>().ok()),
            channels: stream
                .get("channels")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32),
            can_decode: None,
        });

    Ok(NativeMediaMetadata {
        duration,
        container,
        video,
        audio,
    })
}

/// Which elementary stream to validate.
#[derive(Clone, Copy)]
enum StreamKind {
    Video,
    Audio,
}

/// Decodes a single frame of the requested stream with ffmpeg, discarding output.
/// Returns `true` only when ffmpeg exits cleanly with no error-level diagnostics —
/// the desktop equivalent of the web worker decoding its first sample. A container
/// that `ffprobe` parses can still have a payload ffmpeg cannot decode (truncated
/// file, unsupported codec build), so this catches the cases the metadata-only
/// probe misses.
fn validate_stream_decodes(path: &Path, ffmpeg_path: &str, kind: StreamKind) -> bool {
    let (map, frames_flag, drop_other) = match kind {
        StreamKind::Video => ("0:v:0", "-frames:v", "-an"),
        StreamKind::Audio => ("0:a:0", "-frames:a", "-vn"),
    };

    let output = Command::new(ffmpeg_path)
        .args(["-v", "error", "-nostdin"])
        .arg("-i")
        .arg(path)
        .arg(drop_other)
        .args(["-map", map, frames_flag, "1", "-f", "null", "-"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .output();

    match output {
        Ok(out) => out.status.success() && out.stderr.is_empty(),
        Err(e) => {
            log::warn!(
                "[validate_stream_decodes] ffmpeg failed to run for {}: {}",
                path.display(),
                e
            );
            false
        }
    }
}

/// Like [`probe_media`], but additionally validates that each present stream can
/// actually be decoded (one-frame decode), populating `can_decode`. Used by the
/// media-metadata IPC so the file browser flags corrupt/undecodable sources up
/// front, matching the web build. Costlier than `probe_media` (extra ffmpeg runs),
/// so the proxy/convert/audio-extract paths keep using the plain probe.
pub fn probe_media_validated(
    path: &Path,
    ffprobe_path: &str,
    ffmpeg_path: &str,
) -> Result<NativeMediaMetadata> {
    let mut metadata = probe_media(path, ffprobe_path)?;

    // Decode validation needs ffmpeg. If it's unavailable, degrade gracefully:
    // keep the (ffprobe-derived) metadata and leave `can_decode` unset rather than
    // failing the whole probe — an unset flag is treated as decodable downstream,
    // so a missing ffmpeg never falsely brands files as corrupt.
    if let Err(e) = verify_ffmpeg_binary(ffmpeg_path) {
        log::warn!(
            "[probe_media_validated] skipping decode validation, ffmpeg unavailable: {:#}",
            e
        );
        return Ok(metadata);
    }

    if let Some(video) = metadata.video.as_mut() {
        video.can_decode = Some(validate_stream_decodes(path, ffmpeg_path, StreamKind::Video));
    }
    if let Some(audio) = metadata.audio.as_mut() {
        audio.can_decode = Some(validate_stream_decodes(path, ffmpeg_path, StreamKind::Audio));
    }

    Ok(metadata)
}

pub fn generate_proxy(
    tasks: &NativeMediaTasks,
    task_id: &str,
    source_path: &Path,
    target_path: &Path,
    options: NativeProxyOptions,
    on_progress: Option<&(dyn Fn(f64) + Send + Sync)>,
) -> Result<()> {
    let metadata = probe_media(source_path, options.hw.ffprobe_cmd())?;
    metadata
        .video
        .as_ref()
        .ok_or_else(|| anyhow!("source has no video stream"))?;

    let duration = metadata.duration.max(0.0);

    let vaapi_dev = options.hw.vaapi_dev().to_string();
    let hw_decode = options.hw.hw_decode_mode();
    let hw_encode = options.hw.hw_encode_mode();

    let args = build_proxy_ffmpeg_args(
        source_path,
        target_path,
        &metadata,
        &options,
        hw_decode,
        hw_encode,
        &vaapi_dev,
    )?;

    let ffmpeg_cmd = options.hw.ffmpeg_cmd();
    match run_ffmpeg_task(
        tasks,
        task_id,
        ffmpeg_cmd,
        args,
        None,
        on_progress,
        Some(duration),
    ) {
        Ok(()) => {
            if !target_path.exists() {
                return Err(anyhow!(
                    "ffmpeg proxy did not produce output file: {}",
                    target_path.display()
                ));
            }
            Ok(())
        }
        Err(e) if hw_encode != HwAccelMode::None && !e.to_string().contains("cancelled") => {
            log::warn!("[native-media] HW proxy failed ({e}), falling back to software encoding");
            let mut sw_options = options.clone();
            sw_options.hw.enable_hardware_encoding = Some(false);
            generate_proxy(
                tasks,
                task_id,
                source_path,
                target_path,
                sw_options,
                on_progress,
            )
        }
        Err(e) => Err(e),
    }
}

pub fn convert_media(
    tasks: &NativeMediaTasks,
    task_id: &str,
    source_path: &Path,
    target_path: &Path,
    options: NativeConvertOptions,
) -> Result<()> {
    convert_media_with_warnings(
        tasks,
        task_id,
        source_path,
        target_path,
        options,
        None,
        None,
    )
}

pub fn convert_media_with_warnings(
    tasks: &NativeMediaTasks,
    task_id: &str,
    source_path: &Path,
    target_path: &Path,
    options: NativeConvertOptions,
    on_warning: Option<&(dyn Fn(String) + Send + Sync)>,
    on_progress: Option<&(dyn Fn(f64) + Send + Sync)>,
) -> Result<()> {
    let mut options = options;
    let ffprobe_cmd = options.hw.ffprobe_cmd().to_string();
    let duration = match probe_media(source_path, &ffprobe_cmd) {
        Ok(meta) => {
            if options.width.is_none() {
                options.width = meta.video.as_ref().map(|v| v.width);
            }
            if options.height.is_none() {
                options.height = meta.video.as_ref().map(|v| v.height);
            }
            if options.fps.is_none() {
                options.fps = meta.video.as_ref().map(|v| v.fps);
            }
            Some(meta.duration.max(0.0))
        }
        Err(e) => {
            log::warn!("[native-media] failed to probe source duration for progress tracking: {e}");
            None
        }
    };

    let vaapi_dev = options.hw.vaapi_dev().to_string();
    let hw_decode = options.hw.hw_decode_mode();
    let hw_encode = options.hw.hw_encode_mode();

    let args = build_convert_ffmpeg_args(
        source_path,
        target_path,
        &options,
        hw_decode,
        hw_encode,
        &vaapi_dev,
        on_warning,
    )?;

    let ffmpeg_cmd = options.hw.ffmpeg_cmd();
    match run_ffmpeg_task(
        tasks,
        task_id,
        ffmpeg_cmd,
        args,
        on_warning,
        on_progress,
        duration,
    ) {
        Ok(()) => {
            if !target_path.exists() {
                return Err(anyhow!(
                    "ffmpeg conversion did not produce output file: {}",
                    target_path.display()
                ));
            }
            Ok(())
        }
        Err(e) if hw_encode != HwAccelMode::None && !e.to_string().contains("cancelled") => {
            log::warn!(
                "[native-media] HW conversion failed ({e}), falling back to software encoding"
            );
            let mut sw_options = options.clone();
            sw_options.hw.enable_hardware_encoding = Some(false);
            convert_media_with_warnings(
                tasks,
                task_id,
                source_path,
                target_path,
                sw_options,
                on_warning,
                on_progress,
            )
        }
        Err(e) => Err(e),
    }
}

fn build_proxy_ffmpeg_args(
    source_path: &Path,
    target_path: &Path,
    metadata: &NativeMediaMetadata,
    options: &NativeProxyOptions,
    hw_decode: HwAccelMode,
    hw_encode: HwAccelMode,
    vaapi_dev: &str,
) -> Result<Vec<String>> {
    let video = metadata
        .video
        .as_ref()
        .ok_or_else(|| anyhow!("proxy args require video metadata"))?;
    // ffmpeg auto-rotates via the display matrix before the scale filter, so the
    // frame the scale target must match is the *display* (rotated) size. For a
    // quarter-turn (90/270) clip the stored dims are swapped relative to what the
    // filter chain sees; compute the proxy size from the display orientation,
    // otherwise the exact-stretch scale squishes a portrait clip into landscape.
    let rotation_deg = video.rotation.rem_euclid(360).abs();
    let is_quarter = rotation_deg == 90 || rotation_deg == 270;
    let (display_w, display_h) = if is_quarter {
        (video.height, video.width)
    } else {
        (video.width, video.height)
    };
    let (width, height) = scaled_even_size(display_w, display_h, options.max_pixels);
    let mut args = Vec::new();

    push_transcode_preamble(&mut args, hw_encode, hw_decode, vaapi_dev, true);
    args.extend(["-i".to_string(), source_path.display().to_string()]);
    args.extend([
        "-map".to_string(),
        "0:v:0".to_string(),
        "-sn".to_string(),
        "-dn".to_string(),
    ]);

    if metadata.audio.is_some() {
        args.extend(["-map".to_string(), "0:a:0?".to_string()]);
    }

    push_video_encode_filter_args(&mut args, hw_encode, width, height, false);

    // ffmpeg auto-rotates (bakes the display matrix into pixels) before the scale
    // filter above, so the proxy is already in display orientation. Some ffmpeg
    // builds/muxers still copy the source rotation flag onto the output, which the
    // monitor decoder would then apply a *second* time → squished/sideways video.
    // Force the rotation metadata to zero so the proxy is unambiguously upright.
    args.extend(["-metadata:s:v:0".to_string(), "rotate=0".to_string()]);

    let video_codec = ffmpeg_video_codec_hw(&options.video_codec, hw_encode);
    args.extend([
        "-c:v".to_string(),
        video_codec.to_string(),
        "-profile:v".to_string(),
        "high".to_string(),
        "-b:v".to_string(),
        options.video_bitrate_bps.to_string(),
    ]);

    // Software x264 benefits from a speed preset; hardware encoders have their
    // own rate-control defaults and don't accept the x264 preset names.
    if video_codec == "libx264" {
        args.extend(["-preset".to_string(), "veryfast".to_string()]);
    }

    // GOP = 2×fps for responsive seeking in the editor.
    let gop = (video.fps * 2.0).round().max(1.0) as u32;
    args.extend(["-g".to_string(), gop.to_string()]);

    args.extend(["-movflags".to_string(), "+faststart".to_string()]);

    if let Some(audio) = metadata.audio.as_ref() {
        if options.copy_opus_audio && audio.codec.to_lowercase().starts_with("opus") {
            args.extend(["-c:a".into(), "copy".into()]);
        } else {
            args.extend([
                "-c:a".into(),
                "libopus".into(),
                "-b:a".into(),
                options.audio_bitrate_bps.to_string(),
            ]);
        }
    } else {
        args.push("-an".into());
    }

    args.push(target_path.display().to_string());
    Ok(args)
}

fn build_convert_ffmpeg_args(
    source_path: &Path,
    target_path: &Path,
    options: &NativeConvertOptions,
    hw_decode: HwAccelMode,
    hw_encode: HwAccelMode,
    vaapi_dev: &str,
    on_warning: Option<&(dyn Fn(String) + Send + Sync)>,
) -> Result<Vec<String>> {
    let mut args = Vec::new();

    push_transcode_preamble(
        &mut args,
        hw_encode,
        hw_decode,
        vaapi_dev,
        options.kind == "video",
    );

    args.extend(["-i".to_string(), source_path.display().to_string()]);

    match options.kind.as_str() {
        "video" => {
            let width = options.width.unwrap_or(DEFAULT_VIDEO_WIDTH).max(1);
            let height = options.height.unwrap_or(DEFAULT_VIDEO_HEIGHT).max(1);
            let fps = format_fps(options.fps.unwrap_or(DEFAULT_VIDEO_FPS));

            args.extend(["-map".into(), "0:v:0".into(), "-sn".into(), "-dn".into()]);
            if options.audio.unwrap_or(true) {
                args.extend(["-map".into(), "0:a:0?".into()]);
            }

            push_video_encode_filter_args_with_extra(
                &mut args,
                hw_encode,
                width,
                height,
                false,
                ExtraEncodeFilters {
                    // Convert is a single-clip transcode where the user picks an output
                    // resolution that may not match the source aspect ratio; fit instead
                    // of stretching. (Proxy pre-computes an aspect-matched size, so it
                    // keeps the exact-scale path via push_video_encode_filter_args.)
                    preserve_aspect: true,
                    extra_filters: &[format!("fps={fps}")],
                    // Convert/proxy transcode a real source whose colour metadata ffmpeg
                    // already propagates; don't re-tag.
                    color: None,
                },
            );

            let raw_video_codec = options.video_codec.as_deref().unwrap_or("avc1");
            let video_codec = ffmpeg_video_codec_hw(raw_video_codec, hw_encode);

            args.extend([
                "-fps_mode".into(),
                "cfr".into(),
                "-c:v".into(),
                video_codec.to_string(),
                "-b:v".into(),
                options
                    .video_bitrate_bps
                    .unwrap_or(DEFAULT_VIDEO_BITRATE_BPS)
                    .to_string(),
            ]);

            if options.audio.unwrap_or(true) {
                args.extend(audio_args(options, on_warning));
            } else {
                args.push("-an".into());
            }
        }
        "audio" => {
            args.extend([
                "-map".into(),
                "0:a:0?".into(),
                "-vn".into(),
                "-sn".into(),
                "-dn".into(),
            ]);
            if options.audio_reverse.unwrap_or(false) {
                args.extend(["-af".into(), "areverse".into()]);
            }
            args.extend(audio_args(options, on_warning));
        }
        _ => return Err(anyhow!("unsupported conversion kind: {}", options.kind)),
    }

    if options.format == "mp4" {
        args.extend(["-movflags".into(), "+faststart".into()]);
    }
    args.push(target_path.display().to_string());
    Ok(args)
}

pub struct ExtractWebpParams<'a> {
    pub source_path: &'a Path,
    pub time_sec: f64,
    pub position_fraction: Option<f64>,
    pub max_width: u32,
    pub max_height: u32,
    pub quality: f32,
    pub hw_settings: crate::FfmpegHwSettings,
}

pub fn extract_video_frame_webp(params: ExtractWebpParams<'_>) -> Result<Vec<u8>> {
    // Throttle concurrent decoder/ffmpeg spawns the same way the monitor does, so a
    // media panel full of clips can't flood the machine with parallel ffmpeg starts.
    let _permit = decoder_load_gate()
        .acquire_with_priority(crate::media::decode::gate::LoadPriority::Background, &|| {
            false
        })
        .expect("Background without cancel always succeeds");
    let metadata = probe_media(params.source_path, &params.hw_settings.ffprobe_path)?;
    let video = metadata
        .video
        .as_ref()
        .ok_or_else(|| anyhow!("source has no video stream"))?;
    let (width, height) = video_frame_thumbnail_size(video, params.max_width, params.max_height);

    // When the caller passes a position fraction we derive the timestamp from the
    // duration we already probed here, so the JS side doesn't have to spawn its own
    // ffprobe just to compute `duration * fraction`.
    let time_sec = match params.position_fraction {
        Some(fraction) if fraction.is_finite() => {
            (metadata.duration.max(0.0) * fraction.clamp(0.0, 1.0)).max(0.0)
        }
        _ => params.time_sec.max(0.0),
    };

    let hw_accel = &params.hw_settings.hardware_acceleration_mode;
    let hw_decode = resolve_hw_decode_mode(hw_accel, &params.hw_settings.vaapi_device);

    let mut cmd = Command::new(&params.hw_settings.ffmpeg_path);
    cmd.arg("-nostdin");

    match hw_decode {
        HwAccelMode::Vaapi => {
            cmd.arg("-hwaccel")
                .arg("vaapi")
                .arg("-hwaccel_device")
                .arg(&params.hw_settings.vaapi_device);
        }
        HwAccelMode::Nvdec => {
            cmd.arg("-hwaccel").arg("nvdec");
        }
        _ => {}
    }

    cmd.arg("-v")
        .arg("error")
        .arg("-ss")
        .arg(format_time(time_sec))
        .arg("-i")
        .arg(params.source_path)
        .arg("-frames:v")
        .arg("1")
        .arg("-vf")
        .arg(format!("scale={width}:{height}"))
        .arg("-c:v")
        .arg("libwebp")
        .arg("-quality")
        .arg(webp_quality_arg(params.quality))
        .arg("-f")
        .arg("image2pipe")
        .arg("-")
        .stdin(Stdio::null());

    let output = cmd
        .output()
        .context("failed to run ffmpeg frame extraction")?;

    if !output.status.success() {
        return Err(anyhow!(
            "ffmpeg frame extraction failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    if output.stdout.is_empty() {
        return Err(anyhow!("ffmpeg frame extraction returned empty output"));
    }
    Ok(output.stdout)
}

fn video_frame_thumbnail_size(
    video: &NativeVideoMetadata,
    max_width: u32,
    max_height: u32,
) -> (u32, u32) {
    let rotation_deg = video.rotation.rem_euclid(360).abs();
    let is_quarter = rotation_deg == 90 || rotation_deg == 270;
    let (src_w, src_h) = if is_quarter {
        (video.height, video.width)
    } else {
        (video.width, video.height)
    };
    fit_even_size(src_w, src_h, max_width, max_height)
}

pub fn extract_video_frame_webps(
    source_path: &Path,
    times_sec: &[f64],
    max_width: u32,
    max_height: u32,
    quality: f32,
    seek_threshold_sec: Option<f64>,
    hw_settings: &crate::FfmpegHwSettings,
) -> Result<Vec<Option<Vec<u8>>>> {
    let mut sorted_times: Vec<(usize, f64)> = times_sec.iter().copied().enumerate().collect();
    sorted_times.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));

    let max_edge = max_width.max(max_height);
    let hw_decode = resolve_hw_decode_mode(
        &hw_settings.hardware_acceleration_mode,
        &hw_settings.vaapi_device,
    );
    let mut decoder = {
        let _permit = decoder_load_gate()
            .acquire_with_priority(crate::media::decode::gate::LoadPriority::Background, &|| {
                false
            })
            .expect("Background without cancel always succeeds");
        crate::media::decode::open(
            source_path,
            Some(max_edge),
            hw_decode,
            Some(&hw_settings.vaapi_device),
        )?
    };
    let mut results = vec![None; times_sec.len()];

    let mut last_pts = -1.0;
    let webp_quality = if quality.is_finite() {
        quality.clamp(0.0, 1.0) * 100.0
    } else {
        DEFAULT_WEBP_QUALITY
    };
    let seek_threshold_sec = sanitize_seek_threshold_sec(seek_threshold_sec);

    for (orig_idx, target_time) in sorted_times {
        let needs_seek = should_seek_for_thumbnail_time(last_pts, target_time, seek_threshold_sec);
        if needs_seek {
            if let Err(e) = decoder.seek(target_time) {
                log::warn!(
                    "[native-media] seek failed at {:.3}s for {}: {e}",
                    target_time,
                    source_path.display()
                );
                last_pts = -1.0;
                continue;
            }
        }

        let mut last_frame = None;
        loop {
            match decoder.next_frame() {
                Ok(Some(frame)) => {
                    last_pts = frame.pts_sec;
                    let current_pts = frame.pts_sec;
                    last_frame = Some(frame);
                    if current_pts >= target_time {
                        break;
                    }
                }
                Ok(None) => break, // EOF
                Err(e) => {
                    log::warn!(
                        "[native-media] decode failed at {:.3}s for {}: {e}",
                        target_time,
                        source_path.display()
                    );
                    break;
                }
            }
        }

        if let Some(frame) = last_frame {
            let rotation = decoder.info().rotation.rem_euclid(360);

            // `rotation` comes from the display matrix; only the cardinal
            // angles need a re-orientation pass, everything else encodes as-is.
            type RgbaImage = image::ImageBuffer<image::Rgba<u8>, Vec<u8>>;
            type RotateFn = fn(&RgbaImage) -> RgbaImage;
            let rotate: Option<RotateFn> = match rotation {
                90 => Some(image::imageops::rotate90),
                180 => Some(image::imageops::rotate180),
                270 => Some(image::imageops::rotate270),
                _ => None,
            };

            let encode_res: Result<Vec<u8>, anyhow::Error> = match rotate {
                Some(rotate) => {
                    match RgbaImage::from_raw(frame.width, frame.height, frame.pixels.clone()) {
                        Some(buf) => {
                            let rotated = rotate(&buf);
                            encode_rgba_as_webp(
                                rotated.as_raw(),
                                rotated.width(),
                                rotated.height(),
                                webp_quality,
                            )
                        }
                        None => Err(anyhow!("failed to create image buffer for rotation")),
                    }
                }
                None => encode_rgba_as_webp(&frame.pixels, frame.width, frame.height, webp_quality),
            };

            match encode_res {
                Ok(bytes) => {
                    results[orig_idx] = Some(bytes);
                }
                Err(e) => {
                    log::warn!(
                        "[native-media] webp encode/rotate failed at {:.3}s for {}: {e}",
                        target_time,
                        source_path.display()
                    );
                }
            }
        }
    }

    Ok(results)
}

fn sanitize_seek_threshold_sec(value: Option<f64>) -> f64 {
    value
        .filter(|v| v.is_finite() && *v >= 0.0)
        .unwrap_or(THUMBNAIL_SEEK_THRESHOLD_SEC)
}

fn should_seek_for_thumbnail_time(last_pts: f64, target_time: f64, threshold_sec: f64) -> bool {
    last_pts < 0.0 || target_time < last_pts || (target_time - last_pts) > threshold_sec
}

fn audio_args(
    options: &NativeConvertOptions,
    on_warning: Option<&(dyn Fn(String) + Send + Sync)>,
) -> Vec<String> {
    let (codec, substituted) =
        resolve_audio_encoder(options.audio_codec.as_deref(), &options.format);
    if substituted {
        let message = format!(
            "[native-media] audio codec {:?} not usable for {} container; using {codec}",
            options.audio_codec, options.format
        );
        log::warn!("{message}");
        emit_media_warning(on_warning, message);
    }
    let mut args = vec!["-c:a".to_string(), codec.to_string()];
    let is_lossless_audio = codec == "flac" || codec.starts_with("pcm");
    if !is_lossless_audio {
        args.extend([
            "-b:a".to_string(),
            options.audio_bitrate_bps.unwrap_or(128_000).to_string(),
        ]);
    }
    if let Some(channels) = options.audio_channels {
        args.extend(["-ac".into(), channels.max(1).to_string()]);
    }
    if let Some(sample_rate) = options.audio_sample_rate {
        args.extend(["-ar".into(), sample_rate.max(1).to_string()]);
    }
    args
}

fn scaled_even_size(width: u32, height: u32, max_pixels: u32) -> (u32, u32) {
    let pixels = width.saturating_mul(height);
    if max_pixels == 0 || pixels <= max_pixels {
        return (even(width), even(height));
    }
    let scale = (max_pixels as f64 / pixels as f64).sqrt();
    (
        even((width as f64 * scale).round() as u32),
        even((height as f64 * scale).round() as u32),
    )
}

fn fit_even_size(width: u32, height: u32, max_width: u32, max_height: u32) -> (u32, u32) {
    if width == 0 || height == 0 {
        return (2, 2);
    }
    let scale = (max_width.max(1) as f64 / width as f64)
        .min(max_height.max(1) as f64 / height as f64)
        .min(1.0);
    (
        even((width as f64 * scale).round() as u32),
        even((height as f64 * scale).round() as u32),
    )
}

fn webp_quality_arg(quality: f32) -> String {
    let value = if quality.is_finite() {
        quality.clamp(0.01, 1.0)
    } else {
        0.7
    };
    format!("{}", (value * 100.0).round() as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scaled_even_size_keeps_small_source() {
        assert_eq!(scaled_even_size(640, 360, 1920 * 1080), (640, 360));
    }

    #[test]
    fn scaled_even_size_downscales_to_pixel_budget() {
        let (w, h) = scaled_even_size(3840, 2160, 1920 * 1080);
        assert_eq!((w, h), (1920, 1080));
    }

    #[test]
    fn fit_even_size_fits_box_without_upscale() {
        assert_eq!(fit_even_size(1920, 1080, 320, 320), (320, 180));
        assert_eq!(fit_even_size(1080, 1920, 320, 320), (180, 320));
        assert_eq!(fit_even_size(100, 50, 320, 320), (100, 50));
    }

    #[test]
    fn video_frame_thumbnail_size_keeps_portrait_after_quarter_rotation() {
        let video = NativeVideoMetadata {
            width: 1920,
            height: 1080,
            fps: 30.0,
            codec: "h264".into(),
            bitrate: None,
            rotation: 90,
            can_decode: None,
        };

        assert_eq!(video_frame_thumbnail_size(&video, 320, 320), (180, 320));
    }

    #[test]
    fn thumbnail_seek_strategy_seeks_for_sparse_timeline_grid() {
        assert!(should_seek_for_thumbnail_time(-1.0, 0.0, 1.0));
        assert!(should_seek_for_thumbnail_time(0.0, 4.0, 1.0));
        assert!(should_seek_for_thumbnail_time(8.0, 4.0, 1.0));
    }

    #[test]
    fn thumbnail_seek_strategy_decodes_forward_for_dense_times() {
        assert!(!should_seek_for_thumbnail_time(1.0, 1.5, 1.0));
        assert!(!should_seek_for_thumbnail_time(1.0, 2.0, 1.0));
    }

    #[test]
    fn thumbnail_seek_threshold_defaults_to_thumbnail_value() {
        assert_eq!(
            sanitize_seek_threshold_sec(None),
            THUMBNAIL_SEEK_THRESHOLD_SEC
        );
        assert_eq!(
            sanitize_seek_threshold_sec(Some(f64::NAN)),
            THUMBNAIL_SEEK_THRESHOLD_SEC
        );
        assert_eq!(
            sanitize_seek_threshold_sec(Some(-1.0)),
            THUMBNAIL_SEEK_THRESHOLD_SEC
        );
        assert_eq!(sanitize_seek_threshold_sec(Some(0.5)), 0.5);
    }

    #[test]
    fn ffmpeg_video_codec_maps_browser_codec_strings() {
        assert_eq!(ffmpeg_video_codec("avc1.64001f"), "libx264");
        assert_eq!(ffmpeg_video_codec("av01.0.05M.08"), "libsvtav1");
        assert_eq!(ffmpeg_video_codec("vp09.00.10.08"), "libvpx-vp9");
        // HEVC must map to libx265, not silently downgrade to H.264.
        assert_eq!(ffmpeg_video_codec("hevc"), "libx265");
        assert_eq!(ffmpeg_video_codec("hvc1.1.6.L93.B0"), "libx265");
        assert_eq!(ffmpeg_video_codec("h265"), "libx265");
    }

    #[test]
    fn resolve_audio_encoder_remaps_unsupported_for_container() {
        // aac requested for webm → opus (substituted).
        assert_eq!(
            resolve_audio_encoder(Some("aac"), "webm"),
            ("libopus", true)
        );
        // aac for mp4 is fine.
        assert_eq!(resolve_audio_encoder(Some("aac"), "mp4"), ("aac", false));
        // opus passes through.
        assert_eq!(
            resolve_audio_encoder(Some("opus"), "webm"),
            ("libopus", false)
        );
        // flac and pcm pass through.
        assert_eq!(resolve_audio_encoder(Some("flac"), "flac"), ("flac", false));
        assert_eq!(
            resolve_audio_encoder(Some("pcm"), "wav"),
            ("pcm_s16le", false)
        );
        // Unknown codec falls back to a safe default per container.
        assert_eq!(resolve_audio_encoder(Some("garbage"), "mp4"), ("aac", true));
        assert_eq!(
            resolve_audio_encoder(Some("garbage"), "webm"),
            ("libopus", true)
        );
        // None defaults sensibly.
        assert_eq!(resolve_audio_encoder(None, "mp4"), ("aac", false));
    }

    #[test]
    fn proxy_args_map_primary_video_and_optional_audio() {
        let metadata = NativeMediaMetadata {
            duration: 10.0,
            container: "matroska".into(),
            video: Some(NativeVideoMetadata {
                width: 1920,
                height: 1080,
                fps: 30.0,
                codec: "h264".into(),
                bitrate: None,
                rotation: 0,
                can_decode: None,
            }),
            audio: Some(NativeAudioMetadata {
                codec: "aac".into(),
                bitrate: None,
                sample_rate: Some(48_000),
                channels: Some(2),
                can_decode: None,
            }),
        };
        let options = NativeProxyOptions {
            max_pixels: 1920 * 1080,
            video_bitrate_bps: 2_000_000,
            audio_bitrate_bps: 128_000,
            video_codec: "h264".into(),
            copy_opus_audio: false,
            hw: FfmpegHwOptions::default(),
        };

        let args = build_proxy_ffmpeg_args(
            Path::new("in.mkv"),
            Path::new("out.mp4"),
            &metadata,
            &options,
            HwAccelMode::None,
            HwAccelMode::None,
            DEFAULT_VAAPI_DEVICE,
        )
        .expect("proxy args build");

        assert!(args.windows(2).any(|pair| pair == ["-map", "0:v:0"]));
        assert!(args.windows(2).any(|pair| pair == ["-map", "0:a:0?"]));
        assert!(args.contains(&"-sn".to_string()));
        assert!(args.contains(&"-dn".to_string()));
        assert!(args.windows(2).any(|pair| pair == ["-profile:v", "high"]));
        assert!(args.windows(2).any(|pair| pair == ["-preset", "veryfast"]));
        // GOP = 2×fps = 2×30 = 60
        assert!(args.windows(2).any(|pair| pair == ["-g", "60"]));
    }

    #[test]
    fn proxy_args_copy_opus_audio_when_source_is_opus() {
        let metadata = NativeMediaMetadata {
            duration: 10.0,
            container: "matroska".into(),
            video: Some(NativeVideoMetadata {
                width: 1920,
                height: 1080,
                fps: 30.0,
                codec: "h264".into(),
                bitrate: None,
                rotation: 0,
                can_decode: None,
            }),
            audio: Some(NativeAudioMetadata {
                codec: "opus".into(),
                bitrate: None,
                sample_rate: Some(48_000),
                channels: Some(2),
                can_decode: None,
            }),
        };
        let options = NativeProxyOptions {
            max_pixels: 1920 * 1080,
            video_bitrate_bps: 2_000_000,
            audio_bitrate_bps: 128_000,
            video_codec: "h264".into(),
            copy_opus_audio: true,
            hw: FfmpegHwOptions::default(),
        };

        let args = build_proxy_ffmpeg_args(
            Path::new("in.mkv"),
            Path::new("out.mp4"),
            &metadata,
            &options,
            HwAccelMode::None,
            HwAccelMode::None,
            DEFAULT_VAAPI_DEVICE,
        )
        .expect("proxy args build");

        assert!(
            args.windows(2).any(|pair| pair == ["-c:a", "copy"]),
            "Opus source with copy_opus_audio should use -c:a copy"
        );
    }

    #[test]
    fn proxy_args_reencodes_audio_when_copy_opus_but_source_is_aac() {
        let metadata = NativeMediaMetadata {
            duration: 10.0,
            container: "mov".into(),
            video: Some(NativeVideoMetadata {
                width: 1920,
                height: 1080,
                fps: 30.0,
                codec: "h264".into(),
                bitrate: None,
                rotation: 0,
                can_decode: None,
            }),
            audio: Some(NativeAudioMetadata {
                codec: "aac".into(),
                bitrate: None,
                sample_rate: Some(48_000),
                channels: Some(2),
                can_decode: None,
            }),
        };
        let options = NativeProxyOptions {
            max_pixels: 1920 * 1080,
            video_bitrate_bps: 2_000_000,
            audio_bitrate_bps: 128_000,
            video_codec: "h264".into(),
            copy_opus_audio: true,
            hw: FfmpegHwOptions::default(),
        };

        let args = build_proxy_ffmpeg_args(
            Path::new("in.mov"),
            Path::new("out.mp4"),
            &metadata,
            &options,
            HwAccelMode::None,
            HwAccelMode::None,
            DEFAULT_VAAPI_DEVICE,
        )
        .expect("proxy args build");

        assert!(
            !args.windows(2).any(|pair| pair == ["-c:a", "copy"]),
            "AAC source should not use -c:a copy even with copy_opus_audio enabled"
        );
        assert!(
            args.windows(2).any(|pair| pair == ["-c:a", "libopus"]),
            "AAC source should re-encode to libopus"
        );
    }

    #[test]
    fn proxy_args_scale_follows_display_orientation_for_rotated_source() {
        // Phone-shot portrait clip: stored landscape (1920x1080) with a 90° display
        // matrix. ffmpeg auto-rotates before the scale filter, so the scale target
        // must be portrait — otherwise the exact-stretch squishes it to landscape.
        let metadata = NativeMediaMetadata {
            duration: 10.0,
            container: "mov".into(),
            video: Some(NativeVideoMetadata {
                width: 1920,
                height: 1080,
                fps: 30.0,
                codec: "h264".into(),
                bitrate: None,
                rotation: 90,
                can_decode: None,
            }),
            audio: None,
        };
        let options = NativeProxyOptions {
            max_pixels: 1920 * 1080,
            video_bitrate_bps: 2_000_000,
            audio_bitrate_bps: 128_000,
            video_codec: "h264".into(),
            copy_opus_audio: false,
            hw: FfmpegHwOptions::default(),
        };

        let args = build_proxy_ffmpeg_args(
            Path::new("in.mov"),
            Path::new("out.mp4"),
            &metadata,
            &options,
            HwAccelMode::None,
            HwAccelMode::None,
            DEFAULT_VAAPI_DEVICE,
        )
        .expect("proxy args build");

        // Source area is within budget, so dims pass through unscaled but swapped
        // to display (portrait) orientation: scale=1080:1920, never 1920:1080.
        let scale = args
            .iter()
            .find(|a| a.starts_with("scale="))
            .expect("scale filter present");
        assert_eq!(scale, "scale=1080:1920");
    }

    #[test]
    fn convert_video_args_use_fps_filter_and_explicit_maps() {
        let options = NativeConvertOptions {
            kind: "video".into(),
            format: "mp4".into(),
            video_codec: Some("avc1.64001f".into()),
            video_bitrate_bps: Some(5_000_000),
            audio_codec: Some("aac".into()),
            audio_bitrate_bps: Some(128_000),
            audio: Some(true),
            width: Some(1280),
            height: Some(720),
            fps: Some(24.0),
            audio_channels: Some(2),
            audio_sample_rate: Some(48_000),
            audio_reverse: None,
            hw: FfmpegHwOptions::default(),
        };

        let args = build_convert_ffmpeg_args(
            Path::new("in.mov"),
            Path::new("out.mp4"),
            &options,
            HwAccelMode::None,
            HwAccelMode::None,
            DEFAULT_VAAPI_DEVICE,
            None,
        )
        .unwrap();

        assert!(args.windows(2).any(|pair| pair == ["-map", "0:v:0"]));
        assert!(args.windows(2).any(|pair| pair == ["-map", "0:a:0?"]));
        assert!(args.windows(2).any(|pair| pair == ["-fps_mode", "cfr"]));
        assert!(args
            .windows(2)
            .any(|pair| pair[0] == "-vf" && pair[1].contains("fps=24.000000")));
        assert!(!args.windows(2).any(|pair| pair == ["-r", "24.000000"]));
    }

    #[test]
    fn test_actual_conversion_reverse() {
        let tasks = NativeMediaTasks::default();
        let mp3_source = Path::new("../test/fixtures/media/sample-1s-audio.mp3");
        let mp4_source = Path::new("../test/fixtures/media/sample-1s-720p.mp4");

        let test_cases = vec![
            (mp3_source, "m4a", "aac"),
            (mp3_source, "flac", "flac"),
            (mp3_source, "wav", "pcm"),
            (mp3_source, "mp3", "mp3"),
            (mp3_source, "opus", "opus"),
            (mp4_source, "m4a", "aac"),
            (mp4_source, "wav", "pcm"),
        ];

        for (source_path, format, codec) in test_cases {
            let target_filename = format!("target_test_reversed_{codec}.{format}");
            let target_path = Path::new(&target_filename);

            let options = NativeConvertOptions {
                kind: "audio".into(),
                format: format.into(),
                video_codec: None,
                video_bitrate_bps: None,
                audio_codec: Some(codec.into()),
                audio_bitrate_bps: Some(128_000),
                audio: Some(true),
                width: None,
                height: None,
                fps: None,
                audio_channels: Some(2),
                audio_sample_rate: Some(48_000),
                audio_reverse: Some(true),
            hw: FfmpegHwOptions::default(),
            };

            let result = convert_media(
                &tasks,
                &format!("test_task_reverse_{codec}"),
                source_path,
                target_path,
                options,
            );

            assert!(
                result.is_ok(),
                "Conversion failed for codec {codec}: {:?}",
                result.err()
            );
            assert!(target_path.exists());

            // Probe the file to ensure it's not corrupted
            let probe = probe_media(target_path, "ffprobe");
            assert!(
                probe.is_ok(),
                "Probe failed for codec {codec}: {:?}",
                probe.err()
            );
            let meta = probe.unwrap();
            assert!(meta.duration > 0.0);

            // Clean up
            let _ = std::fs::remove_file(target_path);
        }
    }

    #[test]
    fn conversion_lossless_audio_skips_bitrate() {
        let options = NativeConvertOptions {
            kind: "audio".into(),
            format: "flac".into(),
            video_codec: None,
            video_bitrate_bps: None,
            audio_codec: Some("flac".into()),
            audio_bitrate_bps: Some(320_000),
            audio: Some(true),
            width: None,
            height: None,
            fps: None,
            audio_channels: Some(2),
            audio_sample_rate: Some(48_000),
            audio_reverse: None,
            hw: FfmpegHwOptions::default(),
        };

        let args = build_convert_ffmpeg_args(
            Path::new("in.wav"),
            Path::new("out.flac"),
            &options,
            HwAccelMode::None,
            HwAccelMode::None,
            DEFAULT_VAAPI_DEVICE,
            None,
        )
        .unwrap();

        assert!(args.windows(2).any(|pair| pair == ["-map", "0:a:0?"]));
        assert!(args.windows(2).any(|pair| pair == ["-c:a", "flac"]));
        assert!(!args.contains(&"-b:a".to_string()));
    }

    #[test]
    fn parse_rational_handles_common_rates() {
        assert_eq!(parse_rational("30000/1001"), Some(30000.0 / 1001.0));
        assert_eq!(parse_rational("25"), Some(25.0));
        assert_eq!(parse_rational("0/0"), None);
    }
}
