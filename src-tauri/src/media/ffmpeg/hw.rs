//! FFmpeg/hardware-acceleration configuration, grouped in one place.
//!
//! Two shapes share the same five settings:
//!   - [`FfmpegHwSettings`] — the application-wide, fully-resolved configuration
//!     (managed Tauri state, also used by the monitor decoders).
//!   - [`FfmpegHwOptions`] — the per-request override carried inside media command
//!     options. Every field is optional and falls back to a sensible default,
//!     so the proxy/convert/export DTOs can `#[serde(flatten)]` it.

use serde::{Deserialize, Serialize};

use super::utils::{resolve_hw_decode_mode, DEFAULT_VAAPI_DEVICE};
use crate::media::types::HwAccelMode;

const DEFAULT_FFMPEG: &str = "ffmpeg";
const DEFAULT_FFPROBE: &str = "ffprobe";

/// Application-wide ffmpeg/hwaccel configuration. Managed Tauri state and shared
/// with the native monitor decoders.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegHwSettings {
    pub ffmpeg_path: String,
    pub ffprobe_path: String,
    pub hardware_acceleration_mode: HwAccelMode,
    pub vaapi_device: String,
    pub enable_hardware_encoding: bool,
}

impl Default for FfmpegHwSettings {
    fn default() -> Self {
        Self {
            ffmpeg_path: DEFAULT_FFMPEG.to_string(),
            ffprobe_path: DEFAULT_FFPROBE.to_string(),
            hardware_acceleration_mode: HwAccelMode::None,
            vaapi_device: DEFAULT_VAAPI_DEVICE.to_string(),
            enable_hardware_encoding: false,
        }
    }
}

impl FfmpegHwSettings {
    /// Resolves the concrete hardware *decode* mode for this configuration.
    pub fn hw_decode_mode(&self) -> HwAccelMode {
        resolve_hw_decode_mode(&self.hardware_acceleration_mode, &self.vaapi_device)
    }
}

/// Per-request ffmpeg/hwaccel overrides embedded into media command options via
/// `#[serde(flatten)]`. Each accessor falls back to the process default so call
/// sites never repeat the `unwrap_or(...)` boilerplate.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegHwOptions {
    #[serde(default)]
    pub ffmpeg_path: Option<String>,
    #[serde(default)]
    pub ffprobe_path: Option<String>,
    #[serde(default)]
    pub hardware_acceleration_mode: Option<HwAccelMode>,
    #[serde(default)]
    pub vaapi_device: Option<String>,
    #[serde(default)]
    pub enable_hardware_encoding: Option<bool>,
}

impl FfmpegHwOptions {
    /// Copies a fully-resolved [`FfmpegHwSettings`] into per-request overrides.
    pub fn from_settings(hw: &FfmpegHwSettings) -> Self {
        Self {
            ffmpeg_path: Some(hw.ffmpeg_path.clone()),
            ffprobe_path: Some(hw.ffprobe_path.clone()),
            hardware_acceleration_mode: Some(hw.hardware_acceleration_mode),
            vaapi_device: Some(hw.vaapi_device.clone()),
            enable_hardware_encoding: Some(hw.enable_hardware_encoding),
        }
    }

    pub fn ffmpeg_cmd(&self) -> &str {
        self.ffmpeg_path.as_deref().unwrap_or(DEFAULT_FFMPEG)
    }

    pub fn ffprobe_cmd(&self) -> &str {
        self.ffprobe_path.as_deref().unwrap_or(DEFAULT_FFPROBE)
    }

    pub fn vaapi_dev(&self) -> &str {
        self.vaapi_device.as_deref().unwrap_or(DEFAULT_VAAPI_DEVICE)
    }

    fn hw_accel(&self) -> HwAccelMode {
        self.hardware_acceleration_mode.unwrap_or(HwAccelMode::None)
    }

    /// Concrete hardware *decode* mode requested for this operation.
    pub fn hw_decode_mode(&self) -> HwAccelMode {
        resolve_hw_decode_mode(&self.hw_accel(), self.vaapi_dev())
    }

    /// Concrete hardware *encode* mode: the decode mode when HW encoding is
    /// enabled, otherwise software.
    pub fn hw_encode_mode(&self) -> HwAccelMode {
        if self.enable_hardware_encoding.unwrap_or(false) {
            self.hw_decode_mode()
        } else {
            HwAccelMode::None
        }
    }
}
