use super::ffmpeg_utils::even;
use super::types::HwAccelMode;

/// Output colour signalling for an encode. The vello export path feeds ffmpeg raw
/// **RGB** frames; swscale's default RGB→YUV matrix is BT.601 and it writes the stream
/// *untagged*, so HD players (which assume BT.709 for untagged HD) render visibly
/// shifted colours versus the monitor. We pin the conversion matrix *and* tag the
/// output with the same matrix so the round-trip is exact regardless of the player.
#[derive(Debug, Clone, Copy)]
pub struct ColorSpec {
    /// swscale `out_color_matrix` value (drives the actual RGB→YUV conversion).
    pub matrix: &'static str,
    /// `-colorspace` tag written to the container.
    pub space: &'static str,
    /// `-color_primaries` tag.
    pub primaries: &'static str,
    /// `-color_trc` tag.
    pub trc: &'static str,
}

impl ColorSpec {
    /// Resolves the conventional colour space for an output of the given height:
    /// BT.709 for HD (>576 lines), BT.601 (SMPTE-170M coefficients) for SD. The
    /// conversion matrix and the written tags always agree, so the export displays
    /// identically to the monitor whichever convention the player follows.
    pub fn for_output_height(height: u32) -> Self {
        if height > 576 {
            ColorSpec {
                matrix: "bt709",
                space: "bt709",
                primaries: "bt709",
                trc: "bt709",
            }
        } else {
            ColorSpec {
                matrix: "bt601",
                space: "smpte170m",
                primaries: "smpte170m",
                trc: "smpte170m",
            }
        }
    }
}

/// Appends the colour-signalling output tags (`-colorspace`/`-color_primaries`/
/// `-color_trc`/`-color_range`). The matrix used here matches the `out_color_matrix`
/// pinned in the filter chain, so the tag is truthful rather than aspirational.
fn push_color_tag_args(args: &mut Vec<String>, color: Option<ColorSpec>) {
    if let Some(c) = color {
        args.extend([
            "-colorspace".to_string(),
            c.space.to_string(),
            "-color_primaries".to_string(),
            c.primaries.to_string(),
            "-color_trc".to_string(),
            c.trc.to_string(),
            "-color_range".to_string(),
            "tv".to_string(),
        ]);
    }
}

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
        None,
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
    color: Option<ColorSpec>,
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
    // When a colour space is requested, pin the RGB→YUV matrix and output range on a
    // dimension-preserving `scale` step (no `w:h` ⇒ keep size). It runs before any
    // pixel-format/hwupload conversion so the conversion — not swscale's BT.601 default —
    // decides the matrix. `push_color_tag_args` then tags the stream to match.
    let color_scale = color.map(|c| format!("scale=out_color_matrix={}:out_range=tv", c.matrix));
    match hw_mode {
        HwAccelMode::Vaapi => {
            // `format` must be its own filter, not a `scale` option: the scale filter has
            // no `format` option (ffmpeg errors "Option not found"), so the conversion to
            // an upload-able pixel format goes in a separate `format=...` step before
            // `hwupload`. This is the same recipe as the no-scale branch below.
            let mut tail = String::new();
            if has_scale {
                tail.push_str(&scale_filter(width, height, preserve_aspect, ""));
                tail.push(',');
            }
            if let Some(cs) = &color_scale {
                tail.push_str(cs);
                tail.push(',');
            }
            tail.push_str("format=nv12|vaapi,hwupload");
            let vf = with_extra(tail);
            args.extend([
                "-vf".to_string(),
                vf,
                "-pix_fmt".to_string(),
                "vaapi".to_string(),
            ]);
        }
        HwAccelMode::Nvdec | HwAccelMode::Nvenc => {
            let mut parts: Vec<String> = Vec::new();
            if has_scale {
                parts.push(scale_filter(width, height, preserve_aspect, ""));
            }
            if let Some(cs) = &color_scale {
                parts.push(cs.clone());
            }
            parts.push("format=yuv420p".to_string());
            let vf = with_extra(parts.join(","));
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
            // Alpha export keeps straight RGBA→yuva420p (colour handled by the VP9 path);
            // never inject a matrix-converting scale there.
            if !export_alpha {
                if let Some(cs) = &color_scale {
                    filters.push(cs.clone());
                }
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
    if !export_alpha {
        push_color_tag_args(args, color);
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
            None,
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
            None,
        );
        let vf = args
            .windows(2)
            .find(|p| p[0] == "-vf")
            .map(|p| p[1].clone())
            .expect("expected -vf");
        assert!(
            !vf.contains(":format="),
            "format must not be a scale option: {vf}"
        );
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

    fn find_arg<'a>(args: &'a [String], flag: &str) -> Option<&'a String> {
        args.windows(2).find(|p| p[0] == flag).map(|p| &p[1])
    }

    #[test]
    fn software_color_pins_matrix_and_tags_hd_as_bt709() {
        // vello export: no resize (0×0), raw RGB in, BT.709 requested.
        let mut args = Vec::new();
        push_video_encode_filter_args_with_extra(
            &mut args,
            HwAccelMode::None,
            0,
            0,
            false,
            false,
            &[],
            Some(ColorSpec::for_output_height(1080)),
        );
        let vf = find_arg(&args, "-vf").expect("expected -vf");
        assert_eq!(vf, "scale=out_color_matrix=bt709:out_range=tv");
        assert_eq!(find_arg(&args, "-pix_fmt"), Some(&"yuv420p".to_string()));
        assert_eq!(find_arg(&args, "-colorspace"), Some(&"bt709".to_string()));
        assert_eq!(
            find_arg(&args, "-color_primaries"),
            Some(&"bt709".to_string())
        );
        assert_eq!(find_arg(&args, "-color_trc"), Some(&"bt709".to_string()));
        assert_eq!(find_arg(&args, "-color_range"), Some(&"tv".to_string()));
    }

    #[test]
    fn software_color_tags_sd_as_smpte170m() {
        let mut args = Vec::new();
        push_video_encode_filter_args_with_extra(
            &mut args,
            HwAccelMode::None,
            0,
            0,
            false,
            false,
            &[],
            Some(ColorSpec::for_output_height(480)),
        );
        let vf = find_arg(&args, "-vf").expect("expected -vf");
        assert!(vf.contains("out_color_matrix=bt601"), "got: {vf}");
        assert_eq!(
            find_arg(&args, "-colorspace"),
            Some(&"smpte170m".to_string())
        );
    }

    #[test]
    fn alpha_export_ignores_color_and_keeps_yuva420p() {
        // Even if a ColorSpec is passed, alpha export must not inject a matrix-converting
        // scale or write colour tags — VP9 yuva420p carries straight alpha.
        let mut args = Vec::new();
        push_video_encode_filter_args_with_extra(
            &mut args,
            HwAccelMode::None,
            0,
            0,
            true,
            false,
            &[],
            Some(ColorSpec::for_output_height(1080)),
        );
        assert!(
            find_arg(&args, "-vf").is_none(),
            "no scale expected: {args:?}"
        );
        assert_eq!(find_arg(&args, "-pix_fmt"), Some(&"yuva420p".to_string()));
        assert!(find_arg(&args, "-colorspace").is_none());
    }

    #[test]
    fn vaapi_color_scale_precedes_format_upload() {
        let mut args = Vec::new();
        push_video_encode_filter_args_with_extra(
            &mut args,
            HwAccelMode::Vaapi,
            0,
            0,
            false,
            false,
            &[],
            Some(ColorSpec::for_output_height(1080)),
        );
        let vf = find_arg(&args, "-vf").expect("expected -vf");
        assert_eq!(
            vf,
            "scale=out_color_matrix=bt709:out_range=tv,format=nv12|vaapi,hwupload"
        );
        assert_eq!(find_arg(&args, "-colorspace"), Some(&"bt709".to_string()));
    }
}
