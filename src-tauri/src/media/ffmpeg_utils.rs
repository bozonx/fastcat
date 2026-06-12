use anyhow::{anyhow, Result};
use std::collections::HashSet;
use std::process::{Command, Stdio};
use std::sync::OnceLock;

use parking_lot::Mutex;

use super::types::HwAccelMode;

/// Verifies that an ffmpeg/ffprobe binary is available and executable.
///
/// Results are memoised per path so hot media paths don't pay an extra
/// process spawn on every call.
#[derive(Default)]
pub struct FfmpegBinaryVerifier {
    verified: Mutex<HashSet<String>>,
}

impl FfmpegBinaryVerifier {
    pub fn new() -> Self {
        Self {
            verified: Mutex::new(HashSet::new()),
        }
    }

    pub fn verify(&self, path: &str) -> Result<()> {
        if self.verified.lock().contains(path) {
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
                self.verified.lock().insert(path.to_string());
                Ok(())
            }
            Ok(_) => Err(anyhow!("{path} returned non-zero status")),
            Err(e) => Err(anyhow!("failed to run {path}: {e}")),
        }
    }
}

static GLOBAL_VERIFIER: OnceLock<FfmpegBinaryVerifier> = OnceLock::new();

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

pub fn ffmpeg_video_codec_hw(codec: &str, hw_mode: HwAccelMode) -> &'static str {
    match hw_mode {
        HwAccelMode::Vaapi => {
            if codec.contains("av01") || codec.eq_ignore_ascii_case("av1") {
                "av1_vaapi"
            } else if codec.contains("vp09") || codec.eq_ignore_ascii_case("vp9") {
                "vp9_vaapi"
            } else if is_hevc_codec(codec) {
                "hevc_vaapi"
            } else {
                "h264_vaapi"
            }
        }
        HwAccelMode::Nvdec | HwAccelMode::Nvenc => {
            if codec.contains("av01") || codec.eq_ignore_ascii_case("av1") {
                "av1_nvenc"
            } else if is_hevc_codec(codec) {
                "hevc_nvenc"
            } else {
                "h264_nvenc"
            }
        }
        HwAccelMode::None | HwAccelMode::Auto => ffmpeg_video_codec(codec),
    }
}

/// True if the rotation is a quarter-turn (90° or 270°), which swaps width/height.
pub fn is_quarter_turn(rotation_deg: f64) -> bool {
    let normalized = rotation_deg.rem_euclid(360.0).abs();
    normalized == 90.0 || normalized == 270.0
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

/// Resolves hardware decode mode into a concrete decode enum variant.
pub fn resolve_hw_decode_mode(hw_accel: &HwAccelMode, vaapi_device: &str) -> HwAccelMode {
    hw_accel.decode_mode(vaapi_device)
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

/// Maps a requested audio codec to a concrete ffmpeg encoder name, taking the
/// container into account. Unknown/unsupported values fall back to a safe default
/// instead of being passed verbatim to `-c:a` (which would make ffmpeg abort).
/// Returns the encoder name and whether the original request had to be substituted.
pub fn resolve_audio_encoder(requested: Option<&str>, format: &str) -> (&'static str, bool) {
    let is_webm = format == "webm";
    let is_ogg = format == "ogg" || format == "opus";
    match requested.map(|s| s.trim().to_ascii_lowercase()).as_deref() {
        Some("opus") | Some("libopus") => ("libopus", false),
        // FLAC/PCM ride in mkv/flac/wav containers, but mp4/mov and webm can't
        // carry them — remap to the container's safe lossy default rather than
        // handing ffmpeg an invalid stream/container pairing.
        Some("flac") => {
            if is_webm || is_ogg {
                ("libopus", true)
            } else if format == "mp4" || format == "mov" {
                ("aac", true)
            } else {
                ("flac", false)
            }
        }
        Some("pcm") => {
            if is_webm || is_ogg {
                ("libopus", true)
            } else if format == "mp4" || format == "mov" {
                ("aac", true)
            } else {
                ("pcm_s16le", false)
            }
        }
        // webm/ogg only carry Opus/Vorbis in our exporter; AAC requests are remapped.
        Some("aac") | None => {
            if is_webm || is_ogg {
                ("libopus", requested.is_some())
            } else if requested.is_none() {
                match format {
                    "wav" | "pcm" => ("pcm_s16le", true),
                    "flac" => ("flac", true),
                    "mp3" => ("libmp3lame", true),
                    "aac" => ("aac", false),
                    _ => ("aac", false),
                }
            } else {
                ("aac", false)
            }
        }
        Some("libfdk_aac") => {
            if is_webm || is_ogg {
                ("libopus", true)
            } else {
                ("aac", true)
            }
        }
        Some("vorbis") | Some("libvorbis") => {
            if format == "opus" {
                ("libopus", true)
            } else {
                ("libvorbis", false)
            }
        }
        Some("mp3") | Some("libmp3lame") => {
            if is_webm || is_ogg {
                ("libopus", true)
            } else {
                ("libmp3lame", false)
            }
        }
        // Anything else is not something we can safely hand to ffmpeg unchecked.
        Some(_) => {
            if is_webm || is_ogg {
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

/// Convenience wrapper around the global [`FfmpegBinaryVerifier`].
pub fn verify_ffmpeg_binary(path: &str) -> Result<()> {
    GLOBAL_VERIFIER
        .get_or_init(FfmpegBinaryVerifier::new)
        .verify(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_quarter_turn_detects_90_and_270() {
        assert!(is_quarter_turn(90.0));
        assert!(is_quarter_turn(270.0));
        assert!(is_quarter_turn(-90.0));
        assert!(is_quarter_turn(450.0));
        assert!(!is_quarter_turn(0.0));
        assert!(!is_quarter_turn(180.0));
        assert!(!is_quarter_turn(45.0));
    }

    #[test]
    fn verifier_caches_successful_check() {
        let v = FfmpegBinaryVerifier::new();
        let first = v.verify("ffmpeg");
        let second = v.verify("ffmpeg");
        assert_eq!(first.is_ok(), second.is_ok());
        // If the first call succeeded, the set must contain "ffmpeg".
        if first.is_ok() {
            assert!(v.verified.lock().contains("ffmpeg"));
        }
    }

    #[test]
    fn verifier_rejects_nonexistent_binary() {
        let v = FfmpegBinaryVerifier::new();
        assert!(v.verify("this_binary_does_not_exist_12345").is_err());
    }
}
