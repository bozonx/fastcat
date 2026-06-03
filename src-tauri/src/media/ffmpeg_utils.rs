use anyhow::{anyhow, Result};

pub fn ffmpeg_video_codec(codec: &str) -> &'static str {
    if codec.contains("av01") || codec.eq_ignore_ascii_case("av1") {
        "libsvtav1"
    } else if codec.contains("vp09") || codec.eq_ignore_ascii_case("vp9") {
        "libvpx-vp9"
    } else {
        "libx264"
    }
}

pub fn ffmpeg_video_codec_hw(codec: &str, hw_mode: &str) -> &'static str {
    if hw_mode == "vaapi" {
        if codec.contains("av01") || codec.eq_ignore_ascii_case("av1") {
            "av1_vaapi"
        } else if codec.contains("vp09") || codec.eq_ignore_ascii_case("vp9") {
            "vp9_vaapi"
        } else if codec.contains("hevc")
            || codec.eq_ignore_ascii_case("hevc")
            || codec.eq_ignore_ascii_case("h265")
        {
            "hevc_vaapi"
        } else {
            "h264_vaapi"
        }
    } else if hw_mode == "nvdec" || hw_mode == "nvenc" {
        if codec.contains("av01") || codec.eq_ignore_ascii_case("av1") {
            "av1_nvenc"
        } else if codec.contains("hevc")
            || codec.eq_ignore_ascii_case("hevc")
            || codec.eq_ignore_ascii_case("h265")
        {
            "hevc_nvenc"
        } else {
            "h264_nvenc"
        }
    } else {
        ffmpeg_video_codec(codec)
    }
}

/// Round down to an even number, minimum 2.
/// FFmpeg and many codecs require even dimensions.
pub fn even(value: u32) -> u32 {
    (value.max(2) + 1) & !1
}

pub fn format_fps(fps: f64) -> String {
    if fps.is_finite() && fps > 0.0 {
        format!("{fps:.6}")
    } else {
        "30.000000".into()
    }
}

pub fn format_time(time_sec: f64) -> String {
    if time_sec.is_finite() && time_sec > 0.0 {
        format!("{time_sec:.6}")
    } else {
        "0.000000".into()
    }
}

pub fn parse_rational(s: &str) -> Option<f64> {
    let mut parts = s.split('/');
    let num: f64 = parts.next()?.parse().ok()?;
    let den: f64 = parts.next().and_then(|d| d.parse().ok()).unwrap_or(1.0);
    if den == 0.0 {
        return None;
    }
    Some(num / den)
}
