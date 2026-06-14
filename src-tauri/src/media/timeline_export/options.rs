use serde::Deserialize;

use crate::media::types::HwAccelMode;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeExportOptions {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    /// Export range in timeline seconds. `end` is exclusive.
    pub start_sec: f64,
    pub end_sec: f64,
    /// Browser codec string (avc1.* / vp09.* / av01.*), mapped to an ffmpeg encoder.
    pub video_codec: String,
    pub video_bitrate_bps: u32,
    pub format: String,
    #[serde(default)]
    pub audio_enabled: bool,
    pub audio_codec: Option<String>,
    pub audio_bitrate_bps: Option<u32>,
    #[serde(default)]
    pub audio_channels: Option<u32>,
    #[serde(default)]
    pub audio_sample_rate: Option<u32>,
    #[serde(default)]
    pub video_enabled: Option<bool>,
    #[serde(default)]
    pub bitrate_mode: Option<String>,
    #[serde(default)]
    pub keyframe_interval_sec: Option<f64>,
    #[serde(default)]
    pub metadata_title: Option<String>,
    #[serde(default)]
    pub metadata_description: Option<String>,
    #[serde(default)]
    pub metadata_author: Option<String>,
    #[serde(default)]
    pub metadata_tags: Option<String>,

    // Hardware Acceleration Settings
    #[serde(default)]
    pub ffmpeg_path: Option<String>,
    #[serde(default)]
    pub hardware_acceleration_mode: Option<HwAccelMode>,
    #[serde(default)]
    pub vaapi_device: Option<String>,
    #[serde(default)]
    pub enable_hardware_encoding: Option<bool>,
    #[serde(default)]
    pub ffprobe_path: Option<String>,
    #[serde(default)]
    pub export_alpha: Option<bool>,
    #[serde(default)]
    pub fast_start: Option<bool>,
}
