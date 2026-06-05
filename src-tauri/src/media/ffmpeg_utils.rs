/// Default VAAPI render node. Centralised so the fallback path is not duplicated
/// across export/proxy/convert/thumbnail and can be overridden in one place.
pub const DEFAULT_VAAPI_DEVICE: &str = "/dev/dri/renderD128";

/// True for codec strings that denote HEVC/H.265 (browser `hvc1.*`/`hev1.*`,
/// ffprobe `hevc`, or the bare `h265` alias).
pub fn is_hevc_codec(codec: &str) -> bool {
    codec.contains("hevc")
        || codec.contains("hvc1")
        || codec.contains("hev1")
        || codec.eq_ignore_ascii_case("h265")
}

pub fn ffmpeg_video_codec(codec: &str) -> &'static str {
    if codec.contains("av01") || codec.eq_ignore_ascii_case("av1") {
        "libsvtav1"
    } else if codec.contains("vp09") || codec.eq_ignore_ascii_case("vp9") {
        "libvpx-vp9"
    } else if is_hevc_codec(codec) {
        // Software HEVC must map to libx265, not silently downgrade to H.264.
        "libx265"
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
        } else if is_hevc_codec(codec) {
            "hevc_vaapi"
        } else {
            "h264_vaapi"
        }
    } else if hw_mode == "nvdec" || hw_mode == "nvenc" {
        if codec.contains("av01") || codec.eq_ignore_ascii_case("av1") {
            "av1_nvenc"
        } else if is_hevc_codec(codec) {
            "hevc_nvenc"
        } else {
            "h264_nvenc"
        }
    } else {
        ffmpeg_video_codec(codec)
    }
}

/// Round up to the nearest even number, minimum 2.
/// FFmpeg and many codecs require even dimensions.
pub fn even(value: u32) -> u32 {
    let v = value.max(2);
    if v >= u32::MAX - 1 {
        return v & !1;
    }
    (v + 1) & !1
}

/// Resolves hardware decode mode string (auto/vaapi/nvdec/none).
pub fn resolve_hw_decode_mode<'a>(hw_accel: &'a str, vaapi_device: &'a str) -> &'a str {
    if hw_accel != "none" {
        if hw_accel == "auto" {
            if std::path::Path::new(vaapi_device).exists() {
                "vaapi"
            } else {
                "none"
            }
        } else {
            match hw_accel {
                "vaapi" => "vaapi",
                "nvdec" | "nvenc" => "nvdec",
                _ => "none",
            }
        }
    } else {
        "none"
    }
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

use anyhow::{anyhow, Result};
use std::collections::HashSet;
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};

/// Maps a requested audio codec to a concrete ffmpeg encoder name, taking the
/// container into account. Unknown/unsupported values fall back to a safe default
/// instead of being passed verbatim to `-c:a` (which would make ffmpeg abort).
/// Returns the encoder name and whether the original request had to be substituted.
pub fn resolve_audio_encoder(requested: Option<&str>, format: &str) -> (&'static str, bool) {
    let is_webm = format == "webm";
    match requested.map(|s| s.trim().to_ascii_lowercase()).as_deref() {
        Some("opus") | Some("libopus") => ("libopus", false),
        // webm only carries opus/vorbis; AAC requests are remapped to opus.
        Some("aac") | None => {
            if is_webm {
                ("libopus", requested.is_some())
            } else {
                ("aac", false)
            }
        }
        Some("libfdk_aac") => {
            if is_webm {
                ("libopus", true)
            } else {
                ("aac", true)
            }
        }
        Some("vorbis") | Some("libvorbis") => ("libvorbis", false),
        Some("mp3") | Some("libmp3lame") => ("libmp3lame", false),
        // Anything else is not something we can safely hand to ffmpeg unchecked.
        Some(_) => {
            if is_webm {
                ("libopus", true)
            } else {
                ("aac", true)
            }
        }
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

/// Verify that the ffmpeg/ffprobe binary is available and executable.
///
/// The result is memoised per path: a successful check spawns `-version` only
/// once, so the hot media paths (per-frame thumbnail, per export attempt) don't
/// pay an extra process spawn on every call.
pub fn verify_ffmpeg_binary(path: &str) -> Result<()> {
    static VERIFIED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    let verified = VERIFIED.get_or_init(|| Mutex::new(HashSet::new()));
    if verified.lock().unwrap().contains(path) {
        return Ok(());
    }
    let result = Command::new(path)
        .arg("-version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    match result {
        Ok(status) if status.success() => {
            verified.lock().unwrap().insert(path.to_string());
            Ok(())
        }
        Ok(_) => Err(anyhow!("{path} returned non-zero status")),
        Err(e) => Err(anyhow!("failed to run {path}: {e}")),
    }
}
