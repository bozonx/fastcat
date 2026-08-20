use serde::{Deserialize, Serialize};
use std::str::FromStr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum HwAccelMode {
    #[serde(rename = "none")]
    #[default]
    None,
    #[serde(rename = "auto")]
    Auto,
    #[serde(rename = "vaapi")]
    Vaapi,
    #[serde(rename = "nvdec")]
    Nvdec,
    #[serde(rename = "nvenc")]
    Nvenc,
}

impl HwAccelMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Auto => "auto",
            Self::Vaapi => "vaapi",
            Self::Nvdec => "nvdec",
            Self::Nvenc => "nvenc",
        }
    }

    /// Returns the mode effective for hardware decoding.
    pub fn decode_mode(&self, vaapi_device: &str) -> Self {
        match self {
            Self::Auto => {
                if std::path::Path::new(vaapi_device).exists() {
                    Self::Vaapi
                } else {
                    Self::None
                }
            }
            Self::Nvenc => Self::Nvdec,
            other => *other,
        }
    }

    /// Returns true if any hardware acceleration is enabled.
    pub fn is_enabled(&self) -> bool {
        !matches!(self, Self::None)
    }
}

impl FromStr for HwAccelMode {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "vaapi" => Ok(Self::Vaapi),
            "nvdec" | "nvenc" => Ok(Self::Nvdec),
            "auto" => Ok(Self::Auto),
            _ => Ok(Self::None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_mode_auto_resolves_to_vaapi_when_device_exists() {
        // /dev/dri/renderD128 is the standard VAAPI render node on Linux.
        // If it doesn't exist on the test machine, Auto → None.
        let mode = HwAccelMode::Auto.decode_mode("/dev/dri/renderD128");
        if std::path::Path::new("/dev/dri/renderD128").exists() {
            assert_eq!(mode, HwAccelMode::Vaapi);
        } else {
            assert_eq!(mode, HwAccelMode::None);
        }
    }

    #[test]
    fn decode_mode_auto_resolves_to_none_when_device_missing() {
        assert_eq!(
            HwAccelMode::Auto.decode_mode("/nonexistent/device/path"),
            HwAccelMode::None
        );
    }

    #[test]
    fn decode_mode_nvenc_maps_to_nvdec() {
        assert_eq!(
            HwAccelMode::Nvenc.decode_mode("/dev/dri/renderD128"),
            HwAccelMode::Nvdec
        );
    }

    #[test]
    fn decode_mode_none_passes_through() {
        assert_eq!(
            HwAccelMode::None.decode_mode("/dev/dri/renderD128"),
            HwAccelMode::None
        );
    }

    #[test]
    fn decode_mode_vaapi_passes_through() {
        assert_eq!(
            HwAccelMode::Vaapi.decode_mode("/dev/dri/renderD128"),
            HwAccelMode::Vaapi
        );
    }

    #[test]
    fn decode_mode_nvdec_passes_through() {
        assert_eq!(
            HwAccelMode::Nvdec.decode_mode("/dev/dri/renderD128"),
            HwAccelMode::Nvdec
        );
    }

    #[test]
    fn is_enabled_true_for_all_except_none() {
        assert!(!HwAccelMode::None.is_enabled());
        assert!(HwAccelMode::Auto.is_enabled());
        assert!(HwAccelMode::Vaapi.is_enabled());
        assert!(HwAccelMode::Nvdec.is_enabled());
        assert!(HwAccelMode::Nvenc.is_enabled());
    }

    #[test]
    fn as_str_round_trips_through_from_str() {
        for mode in [
            HwAccelMode::None,
            HwAccelMode::Auto,
            HwAccelMode::Vaapi,
            HwAccelMode::Nvdec,
            HwAccelMode::Nvenc,
        ] {
            let s = mode.as_str();
            let parsed = HwAccelMode::from_str(s).unwrap();
            // Nvenc parses to Nvdec by design (encode-only mode maps to decode equivalent).
            let expected = if matches!(mode, HwAccelMode::Nvenc) {
                HwAccelMode::Nvdec
            } else {
                mode
            };
            assert_eq!(parsed, expected, "round-trip failed for {s}");
        }
    }

    #[test]
    fn from_str_unknown_defaults_to_none() {
        assert_eq!(HwAccelMode::from_str("unknown").unwrap(), HwAccelMode::None);
        assert_eq!(HwAccelMode::from_str("").unwrap(), HwAccelMode::None);
    }
}
