use super::ffmpeg_utils::even;
use super::types::HwAccelMode;

/// Appends hardware-accelerated decode CLI flags to an ffmpeg argument vector.
pub fn push_hw_accel_decode_args(args: &mut Vec<String>, hw_mode: HwAccelMode, vaapi_device: &str) {
    match hw_mode {
        HwAccelMode::Vaapi => {
            args.extend([
                "-hwaccel".to_string(),
                "vaapi".to_string(),
                "-hwaccel_device".to_string(),
                vaapi_device.to_string(),
            ]);
        }
        HwAccelMode::Nvdec => {
            args.extend(["-hwaccel".to_string(), "nvdec".to_string()]);
        }
        _ => {}
    }
}

/// Appends video encoding and pixel-format/filter arguments based on the active
/// hardware mode and whether alpha is requested.
pub fn push_video_encode_filter_args(
    args: &mut Vec<String>,
    hw_mode: HwAccelMode,
    width: u32,
    height: u32,
    export_alpha: bool,
) {
    push_video_encode_filter_args_with_extra(
        args,
        hw_mode,
        width,
        height,
        export_alpha,
        false,
        &[],
    );
}

/// Builds the `scale=W:H[...]` filter. When `preserve_aspect` is set, the target
/// is treated as a bounding box: the source is fitted into `W×H` without changing
/// its aspect ratio (`force_original_aspect_ratio=decrease`) and rounded to even
/// dimensions (`force_divisible_by=2`, required by yuv420p). Without it the source
/// is stretched to exactly `W×H` — correct only when the caller already picked an
/// aspect-matching size (e.g. the proxy path).
fn scale_filter(width: u32, height: u32, preserve_aspect: bool, extra_opts: &str) -> String {
    let aspect = if preserve_aspect {
        ":force_original_aspect_ratio=decrease:force_divisible_by=2"
    } else {
        ""
    };
    format!("scale={}:{}{aspect}{extra_opts}", even(width), even(height))
}

/// Same as [`push_video_encode_filter_args`], but prepends additional software
/// filters before the scale/format/hwupload step. Useful for CFR conversion:
/// `fps=...` must run before hardware upload, otherwise VAAPI/NVENC paths cannot
/// see CPU frames. `preserve_aspect` letterboxes-by-fit instead of stretching.
pub fn push_video_encode_filter_args_with_extra(
    args: &mut Vec<String>,
    hw_mode: HwAccelMode,
    width: u32,
    height: u32,
    export_alpha: bool,
    preserve_aspect: bool,
    extra_filters: &[String],
) {
    let has_scale = width > 0 && height > 0;
    let with_extra = |tail: String| {
        if extra_filters.is_empty() {
            tail
        } else if tail.is_empty() {
            extra_filters.join(",")
        } else {
            format!("{},{}", extra_filters.join(","), tail)
        }
    };
    match hw_mode {
        HwAccelMode::Vaapi => {
            // `format` must be its own filter, not a `scale` option: the scale filter has
            // no `format` option (ffmpeg errors "Option not found"), so the conversion to
            // an upload-able pixel format goes in a separate `format=...` step before
            // `hwupload`. This is the same recipe as the no-scale branch below.
            let tail = if has_scale {
                format!(
                    "{},format=nv12|vaapi,hwupload",
                    scale_filter(width, height, preserve_aspect, "")
                )
            } else {
                "format=nv12|vaapi,hwupload".to_string()
            };
            let vf = with_extra(tail);
            args.extend([
                "-vf".to_string(),
                vf,
                "-pix_fmt".to_string(),
                "vaapi".to_string(),
            ]);
        }
        HwAccelMode::Nvdec | HwAccelMode::Nvenc => {
            let tail = if has_scale {
                scale_filter(width, height, preserve_aspect, ":format=yuv420p")
            } else {
                "format=yuv420p".to_string()
            };
            let vf = with_extra(tail);
            args.extend([
                "-vf".to_string(),
                vf,
                "-pix_fmt".to_string(),
                "yuv420p".to_string(),
            ]);
        }
        HwAccelMode::None | HwAccelMode::Auto => {
            let mut filters = extra_filters.to_vec();
            if has_scale {
                filters.push(scale_filter(width, height, preserve_aspect, ""));
            }
            if !filters.is_empty() {
                args.extend(["-vf".to_string(), filters.join(",")]);
            }
            if export_alpha {
                args.extend(["-pix_fmt".to_string(), "yuva420p".to_string()]);
            } else {
                args.extend(["-pix_fmt".to_string(), "yuv420p".to_string()]);
            }
        }
    }
}

/// Appends VAAPI-specific device initialisation flags required when *encoding*
/// through VAAPI (not just decoding).
pub fn push_vaapi_init_device_args(args: &mut Vec<String>, vaapi_device: &str) {
    args.extend([
        "-init_hw_device".to_string(),
        format!("vaapi=gpu:{vaapi_device}"),
        "-filter_hw_device".to_string(),
        "gpu".to_string(),
    ]);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scale_filter_exact_stretches_to_target() {
        assert_eq!(scale_filter(1280, 720, false, ""), "scale=1280:720");
    }

    #[test]
    fn scale_filter_preserve_fits_and_keeps_even() {
        assert_eq!(
            scale_filter(1280, 720, true, ""),
            "scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2"
        );
    }

    #[test]
    fn scale_filter_preserve_keeps_trailing_format_option() {
        assert_eq!(
            scale_filter(1920, 1080, true, ":format=nv12|vaapi"),
            "scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2:format=nv12|vaapi"
        );
    }

    #[test]
    fn convert_software_scale_preserves_aspect() {
        let mut args = Vec::new();
        push_video_encode_filter_args_with_extra(
            &mut args,
            HwAccelMode::None,
            1280,
            720,
            false,
            true,
            &["fps=24".to_string()],
        );
        let vf = args
            .windows(2)
            .find(|p| p[0] == "-vf")
            .map(|p| p[1].clone());
        let vf = vf.expect("expected -vf");
        assert!(vf.contains("fps=24"));
        assert!(
            vf.contains("scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2")
        );
    }

    #[test]
    fn vaapi_scale_emits_format_as_separate_filter() {
        // Regression: the scale filter has no `format` option on ffmpeg 8.x, so the
        // pixel-format conversion must be a standalone `format=...` filter before
        // `hwupload` — not `scale=...:format=...` (which errors "Option not found").
        let mut args = Vec::new();
        push_video_encode_filter_args_with_extra(
            &mut args,
            HwAccelMode::Vaapi,
            1920,
            1080,
            false,
            true,
            &["fps=30".to_string()],
        );
        let vf = args
            .windows(2)
            .find(|p| p[0] == "-vf")
            .map(|p| p[1].clone())
            .expect("expected -vf");
        assert!(!vf.contains(":format="), "format must not be a scale option: {vf}");
        assert!(vf.contains(",format=nv12|vaapi,hwupload"), "got: {vf}");
        assert!(vf.starts_with("fps=30,scale=1920:1080"), "got: {vf}");
    }

    #[test]
    fn exact_scale_path_has_no_aspect_preservation() {
        let mut args = Vec::new();
        push_video_encode_filter_args(&mut args, HwAccelMode::None, 1920, 1080, false);
        let vf = args
            .windows(2)
            .find(|p| p[0] == "-vf")
            .map(|p| p[1].clone())
            .expect("expected -vf");
        assert_eq!(vf, "scale=1920:1080");
    }
}
