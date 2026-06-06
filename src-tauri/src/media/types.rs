use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[derive(Default)]
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
    #[allow(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Self {
        match s {
            "vaapi" => Self::Vaapi,
            "nvdec" | "nvenc" => Self::Nvdec,
            "auto" => Self::Auto,
            _ => Self::None,
        }
    }

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
