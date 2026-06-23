use std::path::Path;

use super::super::ffmpeg::args::*;
use super::super::ffmpeg::utils::*;
use super::super::types::HwAccelMode;
use super::options::NativeExportOptions;

pub(crate) fn build_ffmpeg_args(
    options: &NativeExportOptions,
    audio_input: Option<&Path>,
    width: u32,
    height: u32,
    fps: f64,
    duration_sec: f64,
    target_path: &Path,
) -> Vec<String> {
    let export_alpha = export_uses_alpha(options);
    let hw_mode = resolve_export_hw_mode(options);
    let is_video = options.video_enabled.unwrap_or(true);
    let has_audio = audio_input.is_some();
    let mut args = Vec::new();

    if hw_mode == HwAccelMode::Vaapi {
        push_vaapi_init_device_args(&mut args, options.hw.vaapi_dev());
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
        push_video_codec_rate_args(&mut args, options, hw_mode, fps, video_codec);
        // Pin constant frame rate on the OUTPUT too, mirroring the direct path. The
        // rawvideo demuxer only carries the *input* rate; without an explicit output
        // `-r` + `-fps_mode cfr`, ffmpeg's default `auto` mode can drop colliding frames
        // on a fractional/off-grid rate (e.g. 29.97 → 2997/125), which surfaces as a
        // reduced average fps in the encoded file. CFR guarantees one output frame per
        // input frame at the declared rate.
        args.extend([
            "-fps_mode".to_string(),
            "cfr".to_string(),
            "-r".to_string(),
            format!("{fps:.6}"),
        ]);
        // Hard-cap the output to the exact video length (frame_count/fps). The rendered
        // audio mix can be a few samples / a priming frame longer, and `-shortest` is
        // unreliable with `+faststart` and encoder priming — so without this cap the
        // container duration follows the slightly-longer audio and players show a
        // black/frozen tail after the last video frame. The video emits exactly this
        // many seconds, so `-t` only trims the audio overhang, never the picture.
        if duration_sec.is_finite() && duration_sec > 0.0 {
            args.extend(["-t".to_string(), format_time(duration_sec)]);
        }
        // The vello path streams raw RGB; without an explicit matrix swscale defaults to
        // BT.601 and writes the stream untagged, so HD players (assuming BT.709) show a
        // colour shift vs the monitor. Pin + tag the conventional space for the output
        // size. Alpha export skips this (handled by the VP9 yuva path).
        let color = (!export_alpha).then(|| ColorSpec::for_output_height(height));
        // Vello renders premultiplied alpha. The non-alpha path bakes that onto a black
        // background (premultiplied RGB == composite-over-black, so dropping alpha is
        // correct), but alpha export keeps the alpha channel and ffmpeg reads rawvideo
        // `rgba` as *straight* alpha — so semi-transparent pixels would come out too dark.
        // Undo the premultiply before the yuva420p conversion to restore straight alpha.
        let extra: Vec<String> = if export_alpha {
            vec!["unpremultiply=inplace=1".to_string()]
        } else {
            Vec::new()
        };
        push_video_encode_filter_args_with_extra(
            &mut args,
            hw_mode,
            0,
            0,
            export_alpha,
            false,
            &extra,
            color,
        );
    } else {
        args.push("-vn".to_string());
    }

    push_audio_metadata_output_tail(&mut args, options, is_video, has_audio, target_path);
    args
}

/// Pushes `-c:v`/`-b:v` plus rate-control, keyframe-interval and alpha flags. Shared
/// by the rawvideo-stdin export path and the direct-transcode fast path so the two
/// can never disagree on how a codec is configured.
fn push_video_codec_rate_args(
    args: &mut Vec<String>,
    options: &NativeExportOptions,
    hw_mode: HwAccelMode,
    fps: f64,
    video_codec: &str,
) {
    let export_alpha = export_uses_alpha(options);
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
            // floor so the rate is constant rather than merely bounded above. Only
            // x264/x265 honour `-minrate` as a true CBR floor; libsvtav1/libvpx-vp9
            // ignore it (and warn), so for those we keep just the maxrate/bufsize cap
            // rather than emitting a flag that does nothing.
            _ if video_codec == "libx264" || video_codec == "libx265" => {
                args.extend(["-minrate".to_string(), bitrate.clone()])
            }
            _ => {}
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
}

/// Pushes the audio encoder, metadata and container-finalisation flags plus the
/// output path. Shared by both export paths. Audio always rides as a separate input
/// (the rendered mix), so this never reads from the source's own audio stream.
fn push_audio_metadata_output_tail(
    args: &mut Vec<String>,
    options: &NativeExportOptions,
    is_video: bool,
    has_audio: bool,
    target_path: &Path,
) {
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

    // Metadata. The mp4/mov (mov) muxer only writes a fixed set of recognised keys and
    // *silently drops* the rest — `author` and `tags` among them — so map those to the
    // QuickTime-atom-backed `artist`/`keywords` that survive. `title`/`description` are
    // kept by the mov muxer directly. Other containers (mkv/webm) carry arbitrary keys,
    // so they keep the literal names.
    let is_mov_family = options.format == "mp4" || options.format == "mov";
    let author_key = if is_mov_family { "artist" } else { "author" };
    let tags_key = if is_mov_family { "keywords" } else { "tags" };
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
        args.extend(["-metadata".to_string(), format!("{author_key}={author}")]);
    }
    if let Some(tags) = options.metadata_tags.as_deref().filter(|s| !s.is_empty()) {
        args.extend(["-metadata".to_string(), format!("{tags_key}={tags}")]);
    }

    if (options.format == "mp4" || options.format == "mov") && options.fast_start.unwrap_or(true) {
        args.extend(["-movflags".to_string(), "+faststart".to_string()]);
    }

    args.push(target_path.display().to_string());
}

/// Builds the ffmpeg invocation for the direct-transcode fast path: the source video
/// is decoded, trimmed to the export range, resized to the output frame and re-encoded
/// in one process — no per-frame vello compositing or raw RGBA streaming. Audio still
/// comes from the pre-rendered mix (`audio_input`). Only valid when the scene passed
/// [`super::direct::plan_direct`], i.e. a single untouched, aspect-matching video clip.
pub(crate) fn build_direct_ffmpeg_args(
    options: &NativeExportOptions,
    plan: &super::direct::DirectPlan,
    audio_input: Option<&Path>,
    width: u32,
    height: u32,
    fps: f64,
    target_path: &Path,
) -> Vec<String> {
    let hw_encode = resolve_export_hw_mode(options);
    let vaapi_dev = options.hw.vaapi_dev().to_string();
    let hw_decode = options.hw.hw_decode_mode();
    let has_audio = audio_input.is_some();
    let mut args = Vec::new();

    if hw_encode == HwAccelMode::Vaapi {
        push_vaapi_init_device_args(&mut args, &vaapi_dev);
    }
    args.extend([
        "-y".to_string(),
        "-loglevel".to_string(),
        "error".to_string(),
        // Machine-readable progress on stdout: drives the UI and keeps the stall
        // watchdog fed (stderr stays near-silent at -loglevel error).
        "-progress".to_string(),
        "pipe:1".to_string(),
    ]);

    push_hw_accel_decode_args(&mut args, hw_decode, &vaapi_dev);
    // `-ss` before `-i` is a fast keyframe seek followed by decode-and-discard, so it
    // stays frame-accurate while skipping the bulk of the file.
    args.extend([
        "-ss".to_string(),
        format_time(plan.source_start_sec),
        "-i".to_string(),
        plan.source.display().to_string(),
    ]);
    if let Some(audio) = audio_input {
        args.extend(["-i".to_string(), audio.display().to_string()]);
    }
    // Output duration cap so the encode covers exactly the export range.
    args.extend(["-t".to_string(), format_time(plan.duration_sec)]);
    // Explicit mapping: video from the source, audio from the rendered mix (input 1).
    args.extend(["-map".to_string(), "0:v:0".to_string()]);
    if has_audio {
        args.extend(["-map".to_string(), "1:a:0".to_string()]);
    }

    let video_codec = ffmpeg_video_codec_hw(&options.video_codec, hw_encode);
    push_video_codec_rate_args(&mut args, options, hw_encode, fps, video_codec);
    args.extend(["-fps_mode".to_string(), "cfr".to_string()]);
    // `preserve_aspect` fits-by-decrease; the planner guarantees the source aspect
    // already matches the frame, so this resolves to an exact `scale=W:H`. `fps` runs
    // before any hwupload so VAAPI/NVENC see CPU frames.
    push_video_encode_filter_args_with_extra(
        &mut args,
        hw_encode,
        width,
        height,
        false,
        true,
        // `setsar=1` pins square output pixels so the geometry matches the vello path
        // (which always renders square); a normal SAR=1 source is unaffected.
        &[format!("fps={}", format_fps(fps)), "setsar=1".to_string()],
        // Direct transcode decodes a real source; ffmpeg already carries its colour
        // metadata through, so don't override it.
        None,
    );

    push_audio_metadata_output_tail(&mut args, options, true, has_audio, target_path);
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
    if !options.hw.enable_hardware_encoding.unwrap_or(false) || export_uses_alpha(options) {
        return HwAccelMode::None;
    }
    let hw_accel = options
        .hw
        .hardware_acceleration_mode
        .unwrap_or(HwAccelMode::None);
    let mode = options.hw.hw_decode_mode();
    if mode == HwAccelMode::None
        && hw_accel == HwAccelMode::Auto
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
