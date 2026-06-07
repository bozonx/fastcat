use std::path::Path;

use super::super::ffmpeg_args::*;
use super::super::ffmpeg_utils::*;
use super::super::types::HwAccelMode;
use super::options::NativeExportOptions;

pub(crate) fn build_ffmpeg_args(
    options: &NativeExportOptions,
    audio_input: Option<&Path>,
    width: u32,
    height: u32,
    fps: f64,
    target_path: &Path,
) -> Vec<String> {
    let export_alpha = export_uses_alpha(options);
    let hw_mode = resolve_export_hw_mode(options);
    let is_video = options.video_enabled.unwrap_or(true);
    let has_audio = audio_input.is_some();
    let mut args = Vec::new();

    if hw_mode == HwAccelMode::Vaapi {
        let vaapi_dev = options
            .vaapi_device
            .as_deref()
            .unwrap_or(DEFAULT_VAAPI_DEVICE);
        push_vaapi_init_device_args(&mut args, vaapi_dev);
    }

    args.extend([
        "-y".to_string(),
        "-loglevel".to_string(),
        "error".to_string(),
    ]);

    // Audio-only path: no rawvideo stdin.
    if is_video {
        args.extend([
            // Video comes from stdin as raw RGBA.
            "-f".to_string(),
            "rawvideo".to_string(),
            "-pix_fmt".to_string(),
            "rgba".to_string(),
            "-s".to_string(),
            format!("{width}x{height}"),
            "-r".to_string(),
            format!("{fps:.6}"),
            "-i".to_string(),
            "-".to_string(),
        ]);
    }

    if let Some(audio) = audio_input {
        args.extend(["-i".to_string(), audio.display().to_string()]);
    }

    if is_video {
        let video_codec = ffmpeg_video_codec_hw(&options.video_codec, hw_mode);
        args.extend([
            "-c:v".to_string(),
            video_codec.to_string(),
            "-b:v".to_string(),
            options.video_bitrate_bps.max(1).to_string(),
        ]);

        // Bitrate mode. CBR must actually pin the rate, not just select a mode flag
        // on one backend and a peak cap on another. Combine the backend-specific
        // rate-control selector with a shared HRD buffer (maxrate == bufsize ==
        // bitrate) so every encoder targets the same constant rate.
        let is_cbr = options.bitrate_mode.as_deref() == Some("constant");
        if is_cbr {
            let bitrate = options.video_bitrate_bps.max(1).to_string();
            match hw_mode {
                HwAccelMode::Nvdec | HwAccelMode::Nvenc => {
                    args.extend(["-rc".to_string(), "cbr".to_string()])
                }
                HwAccelMode::Vaapi => args.extend(["-rc_mode".to_string(), "CBR".to_string()]),
                // Software encoders only get a *cap* from maxrate/bufsize; add an equal
                // floor so the rate is constant rather than merely bounded above.
                _ => args.extend(["-minrate".to_string(), bitrate.clone()]),
            }
            args.extend([
                "-maxrate".to_string(),
                bitrate.clone(),
                "-bufsize".to_string(),
                bitrate,
            ]);
        }

        // Keyframe interval
        if let Some(interval_sec) = options.keyframe_interval_sec {
            if interval_sec.is_finite() && interval_sec > 0.0 {
                let gop = (fps * interval_sec).round() as u32;
                if gop > 0 {
                    args.extend(["-g".to_string(), gop.to_string()]);
                }
            }
        }

        if export_alpha && video_codec == "libvpx-vp9" {
            args.extend(["-auto-alt-ref".to_string(), "0".to_string()]);
        }

        push_video_encode_filter_args(&mut args, hw_mode, 0, 0, export_alpha);
    } else {
        args.push("-vn".to_string());
    }

    if has_audio {
        let (codec, substituted) =
            resolve_audio_encoder(options.audio_codec.as_deref(), &options.format);
        if substituted {
            log::warn!(
                "[native-export] audio codec {:?} not usable for {} container; using {codec}",
                options.audio_codec,
                options.format
            );
        }
        args.extend(["-c:a".to_string(), codec.to_string()]);
        // Lossless encoders ignore (and warn about) a target bitrate.
        let is_lossless_audio = codec == "flac" || codec.starts_with("pcm");
        if !is_lossless_audio {
            if let Some(bitrate) = options.audio_bitrate_bps {
                args.extend(["-b:a".to_string(), bitrate.max(1).to_string()]);
            }
        }
        if let Some(sample_rate) = options.audio_sample_rate {
            let sr = sample_rate.clamp(8_000, 192_000);
            args.extend(["-ar".to_string(), sr.to_string()]);
        }
        if is_video {
            // Trim to the shorter stream; video duration is the reference.
            args.push("-shortest".to_string());
        }
    } else if is_video {
        args.push("-an".to_string());
    }

    // Metadata
    if let Some(title) = options.metadata_title.as_deref().filter(|s| !s.is_empty()) {
        args.extend(["-metadata".to_string(), format!("title={title}")]);
    }
    if let Some(description) = options
        .metadata_description
        .as_deref()
        .filter(|s| !s.is_empty())
    {
        args.extend([
            "-metadata".to_string(),
            format!("description={description}"),
        ]);
    }
    if let Some(author) = options.metadata_author.as_deref().filter(|s| !s.is_empty()) {
        args.extend(["-metadata".to_string(), format!("author={author}")]);
    }
    if let Some(tags) = options.metadata_tags.as_deref().filter(|s| !s.is_empty()) {
        args.extend(["-metadata".to_string(), format!("tags={tags}")]);
    }

    if options.format == "mp4" || options.format == "mov" {
        args.extend(["-movflags".to_string(), "+faststart".to_string()]);
    }

    args.push(target_path.display().to_string());
    args
}

/// Alpha export is only meaningful for containers/codecs that carry it (webm/mkv);
/// it also forces software encoding (HW VAAPI/NVENC paths here don't emit alpha).
///
/// The only encoder path that actually emits alpha is VP9 software (yuva420p +
/// libvpx-vp9). MKV's default codec is AV1 (libsvtav1), which rejects yuva420p, so
/// gate on the resolved codec too — otherwise an alpha+MKV request would slip past
/// the validation in `export_timeline` and produce a broken ffmpeg invocation.
pub(crate) fn export_uses_alpha(options: &NativeExportOptions) -> bool {
    options.export_alpha.unwrap_or(false)
        && (options.format == "webm" || options.format == "mkv")
        && ffmpeg_video_codec(&options.video_codec) == "libvpx-vp9"
}

/// Resolves the export hardware mode to a concrete `"vaapi" | "nvdec" | "none"`,
/// applying the same auto-detection used to build the ffmpeg args. Centralised so
/// the fallback decision and the arg builder can never disagree.
pub(crate) fn resolve_export_hw_mode(options: &NativeExportOptions) -> HwAccelMode {
    if !options.enable_hardware_encoding.unwrap_or(false) || export_uses_alpha(options) {
        return HwAccelMode::None;
    }
    let hw_accel = options
        .hardware_acceleration_mode
        .as_deref()
        .unwrap_or("none");
    let vaapi_device = options
        .vaapi_device
        .as_deref()
        .unwrap_or(DEFAULT_VAAPI_DEVICE);
    let mode = resolve_hw_decode_mode(hw_accel, vaapi_device);
    if mode == HwAccelMode::None
        && hw_accel == "auto"
        && std::path::Path::new("/dev/nvidia0").exists()
    {
        // No VAAPI render node, but an NVIDIA device is present — use NVENC
        // instead of silently dropping to software.
        HwAccelMode::Nvdec
    } else {
        mode
    }
}

/// True for errors raised by the GPU render path rather than the ffmpeg encoder.
/// A software fallback only swaps the encoder, so such failures would recur and a
/// full re-render would be wasted work — see the fallback guard in `export_timeline`.
pub(crate) fn is_gpu_render_error(message: &str) -> bool {
    message.contains("no GPU device")
        || message.contains("pipelined readback")
        || message.contains("vello render")
        || message.contains("no renderer for device")
}
