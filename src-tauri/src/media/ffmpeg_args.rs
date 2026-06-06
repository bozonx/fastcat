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
    let has_scale = width > 0 && height > 0;
    match hw_mode {
        HwAccelMode::Vaapi => {
            let vf = if has_scale {
                format!(
                    "scale={}:{}:format=nv12|vaapi,hwupload",
                    even(width),
                    even(height)
                )
            } else {
                "format=nv12|vaapi,hwupload".to_string()
            };
            args.extend(["-vf".to_string(), vf, "-pix_fmt".to_string(), "vaapi".to_string()]);
        }
        HwAccelMode::Nvdec | HwAccelMode::Nvenc => {
            let vf = if has_scale {
                format!("scale={}:{}:format=yuv420p", even(width), even(height))
            } else {
                "format=yuv420p".to_string()
            };
            args.extend(["-vf".to_string(), vf, "-pix_fmt".to_string(), "yuv420p".to_string()]);
        }
        HwAccelMode::None | HwAccelMode::Auto => {
            if has_scale {
                args.extend([
                    "-vf".to_string(),
                    format!("scale={}:{}", even(width), even(height)),
                ]);
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
