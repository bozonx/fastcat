use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::media::processing::{
    convert_media, extract_video_frame_webp, extract_video_frame_webps, generate_proxy,
    probe_media, NativeConvertOptions, NativeMediaMetadata, NativeMediaTasks, NativeProxyOptions,
};
use crate::media::timeline_export::{export_timeline, NativeExportOptions};
use crate::media::timeline_render::{render_timeline_frame_to_file, render_timeline_frame_to_webp};
use crate::monitor::MonitorScene;

/// Trait for structs that carry per-request hardware acceleration overrides.
pub trait ApplyHwSettings {
    fn apply_hw_settings(&mut self, hw: &crate::FfmpegHardwareSettings);
}

macro_rules! impl_apply_hw_settings {
    ($type:ty) => {
        impl ApplyHwSettings for $type {
            fn apply_hw_settings(&mut self, hw: &crate::FfmpegHardwareSettings) {
                self.ffmpeg_path = Some(hw.ffmpeg_path.clone());
                self.ffprobe_path = Some(hw.ffprobe_path.clone());
                self.hardware_acceleration_mode = Some(hw.hardware_acceleration_mode.clone());
                self.vaapi_device = Some(hw.vaapi_device.clone());
                self.enable_hardware_encoding = Some(hw.enable_hardware_encoding);
            }
        }
    };
}

impl_apply_hw_settings!(NativeProxyOptions);
impl_apply_hw_settings!(NativeConvertOptions);
impl_apply_hw_settings!(NativeExportOptions);

/// Thin service layer that wraps `NativeMediaTasks` so Tauri commands stay
/// adapter-only and the business logic is unit-testable without the IPC layer.
#[derive(Default, Clone)]
pub struct NativeMediaService {
    tasks: NativeMediaTasks,
}

impl NativeMediaService {
    pub fn new() -> Self {
        Self {
            tasks: NativeMediaTasks::default(),
        }
    }

    pub fn probe_media(
        &self,
        path: &std::path::Path,
        ffprobe_path: &str,
    ) -> anyhow::Result<NativeMediaMetadata> {
        probe_media(path, ffprobe_path)
    }

    pub fn generate_proxy(
        &self,
        task_id: &str,
        source_path: &std::path::Path,
        target_path: &std::path::Path,
        options: NativeProxyOptions,
    ) -> anyhow::Result<()> {
        generate_proxy(&self.tasks, task_id, source_path, target_path, options)
    }

    pub fn convert_media(
        &self,
        task_id: &str,
        source_path: &std::path::Path,
        target_path: &std::path::Path,
        options: NativeConvertOptions,
    ) -> anyhow::Result<()> {
        convert_media(&self.tasks, task_id, source_path, target_path, options)
    }

    pub fn cancel_task(&self, task_id: &str) -> bool {
        self.tasks.cancel(task_id)
    }

    pub fn export_timeline(
        &self,
        task_id: &str,
        scene: MonitorScene,
        options: NativeExportOptions,
        target_path: &std::path::Path,
        progress: &(dyn Fn(f64) + Send + Sync),
    ) -> anyhow::Result<()> {
        export_timeline(&self.tasks, task_id, scene, options, target_path, progress)
    }

    pub fn render_timeline_frame_to_file(
        &self,
        scene: MonitorScene,
        time_sec: f64,
        width: u32,
        height: u32,
        target_path: &std::path::Path,
        quality: f32,
    ) -> anyhow::Result<()> {
        render_timeline_frame_to_file(scene, time_sec, width, height, target_path, quality)
    }

    pub fn render_timeline_frame_to_webp(
        &self,
        scene: MonitorScene,
        time_sec: f64,
        width: u32,
        height: u32,
        quality: f32,
    ) -> anyhow::Result<Vec<u8>> {
        render_timeline_frame_to_webp(scene, time_sec, width, height, quality)
    }

    pub fn extract_video_frame_webp(
        &self,
        params: crate::media::processing::ExtractWebpParams<'_>,
    ) -> anyhow::Result<Vec<u8>> {
        extract_video_frame_webp(params)
    }

    pub fn extract_video_frame_webps(
        &self,
        source_path: &std::path::Path,
        times_sec: &[f64],
        max_width: u32,
        max_height: u32,
        quality: f32,
    ) -> anyhow::Result<Vec<u8>> {
        let frames =
            extract_video_frame_webps(source_path, times_sec, max_width, max_height, quality)?;
        Ok(pack_webp_frames(frames))
    }

    pub fn extract_peaks(
        &self,
        path: &std::path::Path,
        max_length: usize,
    ) -> anyhow::Result<Vec<u8>> {
        let peaks = crate::audio::peaks::extract_peaks(path, max_length)?;
        Ok(crate::audio::peaks::pack_peaks(&peaks))
    }
}

#[tauri::command]
pub async fn native_media_metadata(
    path: String,
    hw_settings: State<'_, parking_lot::RwLock<crate::FfmpegHardwareSettings>>,
) -> Result<NativeMediaMetadata, String> {
    let path = PathBuf::from(path);
    let ffprobe_path = hw_settings.read().ffprobe_path.clone();
    tokio::task::spawn_blocking(move || probe_media(&path, &ffprobe_path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub async fn native_media_generate_proxy(
    task_id: String,
    source_path: String,
    target_path: String,
    mut options: NativeProxyOptions,
    service: State<'_, NativeMediaService>,
    hw_settings: State<'_, parking_lot::RwLock<crate::FfmpegHardwareSettings>>,
) -> Result<(), String> {
    let service = service.inner().clone();
    let source_path = PathBuf::from(source_path);
    let target_path = PathBuf::from(target_path);

    let hw = hw_settings.read().clone();
    options.apply_hw_settings(&hw);

    tokio::task::spawn_blocking(move || {
        service.generate_proxy(&task_id, &source_path, &target_path, options)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("{e:?}"))
}

#[tauri::command]
pub async fn native_media_convert(
    task_id: String,
    source_path: String,
    target_path: String,
    mut options: NativeConvertOptions,
    service: State<'_, NativeMediaService>,
    hw_settings: State<'_, parking_lot::RwLock<crate::FfmpegHardwareSettings>>,
) -> Result<(), String> {
    let service = service.inner().clone();
    let source_path = PathBuf::from(source_path);
    let target_path = PathBuf::from(target_path);

    let hw = hw_settings.read().clone();
    options.apply_hw_settings(&hw);

    tokio::task::spawn_blocking(move || {
        service.convert_media(&task_id, &source_path, &target_path, options)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("{e:?}"))
}

#[tauri::command]
pub fn native_media_cancel(task_id: String, service: State<'_, NativeMediaService>) -> bool {
    service.cancel_task(&task_id)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeTimelineExportProgress<'a> {
    task_id: &'a str,
    progress: f64,
}

#[tauri::command]
pub async fn native_timeline_export(
    task_id: String,
    scene: MonitorScene,
    mut options: NativeExportOptions,
    target_path: String,
    app: AppHandle,
    service: State<'_, NativeMediaService>,
    hw_settings: State<'_, parking_lot::RwLock<crate::FfmpegHardwareSettings>>,
) -> Result<(), String> {
    let service = service.inner().clone();
    let target_path = PathBuf::from(target_path);

    let hw = hw_settings.read().clone();
    options.apply_hw_settings(&hw);

    tokio::task::spawn_blocking(move || {
        service.export_timeline(&task_id, scene, options, &target_path, &|progress| {
            let _ = app.emit(
                "native-timeline-export:progress",
                NativeTimelineExportProgress {
                    task_id: &task_id,
                    progress,
                },
            );
        })
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("{e:?}"))
}

#[tauri::command]
pub async fn native_timeline_render_frame_to_file(
    scene: MonitorScene,
    time_sec: f64,
    width: u32,
    height: u32,
    target_path: String,
    quality: f32,
) -> Result<(), String> {
    let target_path = PathBuf::from(target_path);
    tokio::task::spawn_blocking(move || {
        render_timeline_frame_to_file(scene, time_sec, width, height, &target_path, quality)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("{e:?}"))
}

#[tauri::command]
pub async fn native_timeline_render_frame_webp(
    scene: MonitorScene,
    time_sec: f64,
    width: u32,
    height: u32,
    quality: f32,
) -> Result<Vec<u8>, String> {
    tokio::task::spawn_blocking(move || {
        render_timeline_frame_to_webp(scene, time_sec, width, height, quality)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("{e:?}"))
}

#[tauri::command]
pub async fn native_video_frame_webp(
    source_path: String,
    time_sec: f64,
    position_fraction: Option<f64>,
    max_width: u32,
    max_height: u32,
    quality: f32,
    hw_settings: tauri::State<'_, parking_lot::RwLock<crate::FfmpegHardwareSettings>>,
) -> Result<Vec<u8>, String> {
    let source_path = PathBuf::from(source_path);
    let hw = hw_settings.read().clone();
    tokio::task::spawn_blocking(move || {
        extract_video_frame_webp(crate::media::processing::ExtractWebpParams {
            source_path: &source_path,
            time_sec,
            position_fraction,
            max_width,
            max_height,
            quality,
            hw_settings: hw,
        })
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("{e:?}"))
}

#[tauri::command]
pub async fn native_video_frame_webps(
    source_path: String,
    times_sec: Vec<f64>,
    max_width: u32,
    max_height: u32,
    quality: f32,
) -> Result<Vec<u8>, String> {
    if times_sec.len() > 1000 {
        return Err("too many frames requested (max 1000)".into());
    }
    if max_width == 0 || max_height == 0 {
        return Err("max_width and max_height must be greater than 0".into());
    }
    if !quality.is_finite() {
        return Err("quality must be a finite number".into());
    }
    let source_path = PathBuf::from(source_path);
    let frames = tokio::task::spawn_blocking(move || {
        extract_video_frame_webps(&source_path, &times_sec, max_width, max_height, quality)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("{e:?}"))?;

    Ok(pack_webp_frames(frames))
}

pub fn pack_webp_frames(frames: Vec<Option<Vec<u8>>>) -> Vec<u8> {
    let mut packed = Vec::new();
    packed.extend_from_slice(&(frames.len() as u32).to_le_bytes());
    for frame in &frames {
        match frame {
            Some(data) => packed.extend_from_slice(&(data.len() as u32).to_le_bytes()),
            None => packed.extend_from_slice(&0u32.to_le_bytes()),
        }
    }
    for data in frames.into_iter().flatten() {
        packed.extend_from_slice(&data);
    }
    packed
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegComponentDiagnostic {
    pub name: String,
    pub label: String,
    pub supported: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegCodecDiagnostic {
    pub label: String,
    pub key: String,
    pub decoders: Vec<FfmpegComponentDiagnostic>,
    pub encoders: Vec<FfmpegComponentDiagnostic>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegDiagnostics {
    pub ffmpeg_available: bool,
    pub ffmpeg_version: String,
    pub ffprobe_available: bool,
    pub ffprobe_version: String,
    pub hwaccels: Vec<String>,
    pub codecs: Vec<FfmpegCodecDiagnostic>,
}

fn parse_ffmpeg_components(output_str: &str) -> std::collections::HashSet<String> {
    let mut names = std::collections::HashSet::new();
    let mut in_list = false;

    /// Valid flag characters in the first token of an ffmpeg encoder/decoder list.
    const FLAG_CHARS: &str = ".VASFXBDELCRTHPMYOIN";

    for line in output_str.lines() {
        let line = line.trim();
        if line.starts_with("------") {
            in_list = true;
            continue;
        }
        if !in_list {
            continue;
        }

        // Lines after the separator look like:
        // "V....D av1       libaom-av1 (codec av1)"
        // The first token is exactly 6 flag characters, the second is the name.
        let mut parts = line.split_whitespace();
        let flags = parts.next();
        let name = parts.next();
        if let (Some(flags), Some(name)) = (flags, name) {
            if flags.len() == 6
                && flags.chars().all(|c| FLAG_CHARS.contains(c))
            {
                names.insert(name.to_string());
            }
        }
    }

    // Fallback: if no separator was found, scan the entire output with the same heuristic.
    if names.is_empty() {
        for line in output_str.lines() {
            let line = line.trim();
            let mut parts = line.split_whitespace();
            let flags = parts.next();
            let name = parts.next();
            if let (Some(flags), Some(name)) = (flags, name) {
                if flags.len() == 6
                    && flags.chars().all(|c| FLAG_CHARS.contains(c))
                {
                    names.insert(name.to_string());
                }
            }
        }
    }

    names
}

#[tauri::command]
pub async fn native_get_ffmpeg_diagnostics(
    ffmpeg_path: Option<String>,
    ffprobe_path: Option<String>,
) -> Result<FfmpegDiagnostics, String> {
    let ffmpeg_cmd = ffmpeg_path.as_deref().unwrap_or("ffmpeg").to_string();
    let ffprobe_cmd = ffprobe_path.as_deref().unwrap_or("ffprobe").to_string();

    tokio::task::spawn_blocking(move || {
        use std::collections::HashSet;
        use std::process::Command;

        // 1. Check ffmpeg
        let (ffmpeg_available, ffmpeg_version) =
            match Command::new(&ffmpeg_cmd).arg("-version").output() {
                Ok(output) => {
                    if output.status.success() {
                        let text = String::from_utf8_lossy(&output.stdout);
                        let version = text.lines().next().unwrap_or("").to_string();
                        (true, version)
                    } else {
                        (false, "ffmpeg returned error status".to_string())
                    }
                }
                Err(e) => (false, format!("Failed to execute: {}", e)),
            };

        // 2. Check ffprobe
        let (ffprobe_available, ffprobe_version) =
            match Command::new(&ffprobe_cmd).arg("-version").output() {
                Ok(output) => {
                    if output.status.success() {
                        let text = String::from_utf8_lossy(&output.stdout);
                        let version = text.lines().next().unwrap_or("").to_string();
                        (true, version)
                    } else {
                        (false, "ffprobe returned error status".to_string())
                    }
                }
                Err(e) => (false, format!("Failed to execute: {}", e)),
            };

        // 3. Get hwaccels, encoders, decoders
        let mut hwaccels = Vec::new();
        let mut encoders_set = HashSet::new();
        let mut decoders_set = HashSet::new();

        if ffmpeg_available {
            if let Ok(output) = Command::new(&ffmpeg_cmd).arg("-hwaccels").output() {
                if output.status.success() {
                    let text = String::from_utf8_lossy(&output.stdout);
                    hwaccels = text
                        .lines()
                        .skip(1)
                        .map(|line| line.trim().to_string())
                        .filter(|line| !line.is_empty())
                        .collect();
                }
            }

            if let Ok(output) = Command::new(&ffmpeg_cmd).arg("-encoders").output() {
                if output.status.success() {
                    encoders_set =
                        parse_ffmpeg_components(&String::from_utf8_lossy(&output.stdout));
                }
            }

            if let Ok(output) = Command::new(&ffmpeg_cmd).arg("-decoders").output() {
                if output.status.success() {
                    decoders_set =
                        parse_ffmpeg_components(&String::from_utf8_lossy(&output.stdout));
                }
            }
        }
        let has_vaapi = hwaccels.iter().any(|item| item == "vaapi");
        let has_qsv = hwaccels.iter().any(|item| item == "qsv");
        let has_nvdec = hwaccels
            .iter()
            .any(|item| item == "cuda" || item == "cuvid" || item == "nvdec");
        let supports_vaapi_decode =
            |codec: &str| has_vaapi && decoders_set.contains(codec);
        let supports_qsv_decode = |codec: &str| {
            has_qsv
                && (decoders_set.contains(&format!("{codec}_qsv"))
                    || decoders_set.contains(codec))
        };

        // 4. Populate codec diagnostics
        let codecs = vec![
            FfmpegCodecDiagnostic {
                label: "H.264 (AVC)".to_string(),
                key: "h264".to_string(),
                decoders: vec![
                    FfmpegComponentDiagnostic {
                        name: "h264".to_string(),
                        label: "Software (h264)".to_string(),
                        supported: decoders_set.contains("h264"),
                    },
                    FfmpegComponentDiagnostic {
                        name: "h264_vaapi".to_string(),
                        label: "Hardware VAAPI (AMD/Intel)".to_string(),
                        supported: supports_vaapi_decode("h264"),
                    },
                    FfmpegComponentDiagnostic {
                        name: "h264_cuvid".to_string(),
                        label: "Hardware NVDEC (Nvidia)".to_string(),
                        supported: has_nvdec && decoders_set.contains("h264_cuvid"),
                    },
                    FfmpegComponentDiagnostic {
                        name: "h264_qsv".to_string(),
                        label: "Hardware QSV (Intel)".to_string(),
                        supported: supports_qsv_decode("h264"),
                    },
                ],
                encoders: vec![
                    FfmpegComponentDiagnostic {
                        name: "libx264".to_string(),
                        label: "Software (libx264)".to_string(),
                        supported: encoders_set.contains("libx264"),
                    },
                    FfmpegComponentDiagnostic {
                        name: "h264_vaapi".to_string(),
                        label: "Hardware VAAPI (AMD/Intel)".to_string(),
                        supported: encoders_set.contains("h264_vaapi"),
                    },
                    FfmpegComponentDiagnostic {
                        name: "h264_nvenc".to_string(),
                        label: "Hardware NVENC (Nvidia)".to_string(),
                        supported: encoders_set.contains("h264_nvenc"),
                    },
                    FfmpegComponentDiagnostic {
                        name: "h264_qsv".to_string(),
                        label: "Hardware QSV (Intel)".to_string(),
                        supported: encoders_set.contains("h264_qsv"),
                    },
                ],
            },
            FfmpegCodecDiagnostic {
                label: "H.265 (HEVC)".to_string(),
                key: "hevc".to_string(),
                decoders: vec![
                    FfmpegComponentDiagnostic {
                        name: "hevc".to_string(),
                        label: "Software (hevc)".to_string(),
                        supported: decoders_set.contains("hevc"),
                    },
                    FfmpegComponentDiagnostic {
                        name: "hevc_vaapi".to_string(),
                        label: "Hardware VAAPI (AMD/Intel)".to_string(),
                        supported: supports_vaapi_decode("hevc"),
                    },
                    FfmpegComponentDiagnostic {
                        name: "hevc_cuvid".to_string(),
                        label: "Hardware NVDEC (Nvidia)".to_string(),
                        supported: has_nvdec && decoders_set.contains("hevc_cuvid"),
                    },
                    FfmpegComponentDiagnostic {
                        name: "hevc_qsv".to_string(),
                        label: "Hardware QSV (Intel)".to_string(),
                        supported: supports_qsv_decode("hevc"),
                    },
                ],
                encoders: vec![
                    FfmpegComponentDiagnostic {
                        name: "libx265".to_string(),
                        label: "Software (libx265)".to_string(),
                        supported: encoders_set.contains("libx265"),
                    },
                    FfmpegComponentDiagnostic {
                        name: "hevc_vaapi".to_string(),
                        label: "Hardware VAAPI (AMD/Intel)".to_string(),
                        supported: encoders_set.contains("hevc_vaapi"),
                    },
                    FfmpegComponentDiagnostic {
                        name: "hevc_nvenc".to_string(),
                        label: "Hardware NVENC (Nvidia)".to_string(),
                        supported: encoders_set.contains("hevc_nvenc"),
                    },
                    FfmpegComponentDiagnostic {
                        name: "hevc_qsv".to_string(),
                        label: "Hardware QSV (Intel)".to_string(),
                        supported: encoders_set.contains("hevc_qsv"),
                    },
                ],
            },
            FfmpegCodecDiagnostic {
                label: "VP9".to_string(),
                key: "vp9".to_string(),
                decoders: vec![
                    FfmpegComponentDiagnostic {
                        name: "vp9".to_string(),
                        label: "Software (vp9)".to_string(),
                        supported: decoders_set.contains("vp9"),
                    },
                    FfmpegComponentDiagnostic {
                        name: "vp9_vaapi".to_string(),
                        label: "Hardware VAAPI (AMD/Intel)".to_string(),
                        supported: supports_vaapi_decode("vp9"),
                    },
                    FfmpegComponentDiagnostic {
                        name: "vp9_cuvid".to_string(),
                        label: "Hardware NVDEC (Nvidia)".to_string(),
                        supported: has_nvdec && decoders_set.contains("vp9_cuvid"),
                    },
                    FfmpegComponentDiagnostic {
                        name: "vp9_qsv".to_string(),
                        label: "Hardware QSV (Intel)".to_string(),
                        supported: supports_qsv_decode("vp9"),
                    },
                ],
                encoders: vec![
                    FfmpegComponentDiagnostic {
                        name: "libvpx-vp9".to_string(),
                        label: "Software (libvpx-vp9)".to_string(),
                        supported: encoders_set.contains("libvpx-vp9"),
                    },
                    FfmpegComponentDiagnostic {
                        name: "vp9_vaapi".to_string(),
                        label: "Hardware VAAPI (AMD/Intel)".to_string(),
                        supported: encoders_set.contains("vp9_vaapi"),
                    },
                    FfmpegComponentDiagnostic {
                        name: "vp9_qsv".to_string(),
                        label: "Hardware QSV (Intel)".to_string(),
                        supported: encoders_set.contains("vp9_qsv"),
                    },
                ],
            },
            FfmpegCodecDiagnostic {
                label: "AV1".to_string(),
                key: "av1".to_string(),
                decoders: vec![
                    FfmpegComponentDiagnostic {
                        name: "av1".to_string(),
                        label: "Software (av1/libdav1d)".to_string(),
                        supported: decoders_set.contains("av1")
                            || decoders_set.contains("libdav1d"),
                    },
                    FfmpegComponentDiagnostic {
                        name: "av1_vaapi".to_string(),
                        label: "Hardware VAAPI (AMD/Intel)".to_string(),
                        supported: has_vaapi
                            && (decoders_set.contains("av1")
                                || decoders_set.contains("libdav1d")),
                    },
                    FfmpegComponentDiagnostic {
                        name: "av1_cuvid".to_string(),
                        label: "Hardware NVDEC (Nvidia)".to_string(),
                        supported: has_nvdec && decoders_set.contains("av1_cuvid"),
                    },
                    FfmpegComponentDiagnostic {
                        name: "av1_qsv".to_string(),
                        label: "Hardware QSV (Intel)".to_string(),
                        supported: has_qsv
                            && (decoders_set.contains("av1_qsv")
                                || decoders_set.contains("av1")
                                || decoders_set.contains("libdav1d")),
                    },
                ],
                encoders: vec![
                    FfmpegComponentDiagnostic {
                        name: "libsvtav1".to_string(),
                        label: "Software (libsvtav1)".to_string(),
                        supported: encoders_set.contains("libsvtav1"),
                    },
                    FfmpegComponentDiagnostic {
                        name: "libaom-av1".to_string(),
                        label: "Software (libaom-av1)".to_string(),
                        supported: encoders_set.contains("libaom-av1"),
                    },
                    FfmpegComponentDiagnostic {
                        name: "av1_vaapi".to_string(),
                        label: "Hardware VAAPI (AMD/Intel)".to_string(),
                        supported: encoders_set.contains("av1_vaapi"),
                    },
                    FfmpegComponentDiagnostic {
                        name: "av1_nvenc".to_string(),
                        label: "Hardware NVENC (Nvidia)".to_string(),
                        supported: encoders_set.contains("av1_nvenc"),
                    },
                    FfmpegComponentDiagnostic {
                        name: "av1_qsv".to_string(),
                        label: "Hardware QSV (Intel)".to_string(),
                        supported: encoders_set.contains("av1_qsv"),
                    },
                ],
            },
            FfmpegCodecDiagnostic {
                label: "AAC Audio".to_string(),
                key: "aac".to_string(),
                decoders: vec![FfmpegComponentDiagnostic {
                    name: "aac".to_string(),
                    label: "Software (aac)".to_string(),
                    supported: decoders_set.contains("aac"),
                }],
                encoders: vec![
                    FfmpegComponentDiagnostic {
                        name: "aac".to_string(),
                        label: "Software Native (aac)".to_string(),
                        supported: encoders_set.contains("aac"),
                    },
                    FfmpegComponentDiagnostic {
                        name: "libfdk_aac".to_string(),
                        label: "Software FDK-AAC (libfdk_aac)".to_string(),
                        supported: encoders_set.contains("libfdk_aac"),
                    },
                ],
            },
            FfmpegCodecDiagnostic {
                label: "Opus Audio".to_string(),
                key: "opus".to_string(),
                decoders: vec![
                    FfmpegComponentDiagnostic {
                        name: "opus".to_string(),
                        label: "Software Native (opus)".to_string(),
                        supported: decoders_set.contains("opus"),
                    },
                    FfmpegComponentDiagnostic {
                        name: "libopus".to_string(),
                        label: "Software Libopus (libopus)".to_string(),
                        supported: decoders_set.contains("libopus"),
                    },
                ],
                encoders: vec![
                    FfmpegComponentDiagnostic {
                        name: "opus".to_string(),
                        label: "Software Native (opus)".to_string(),
                        supported: encoders_set.contains("opus"),
                    },
                    FfmpegComponentDiagnostic {
                        name: "libopus".to_string(),
                        label: "Software Libopus (libopus)".to_string(),
                        supported: encoders_set.contains("libopus"),
                    },
                ],
            },
        ];

        Ok(FfmpegDiagnostics {
            ffmpeg_available,
            ffmpeg_version,
            ffprobe_available,
            ffprobe_version,
            hwaccels,
            codecs,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn native_media_extract_peaks(
    path: String,
    max_length: usize,
    _precision: usize,
) -> Result<Vec<u8>, String> {
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || {
        crate::audio::peaks::extract_peaks(&path, max_length)
            .map(|peaks| crate::audio::peaks::pack_peaks(&peaks))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("{e:?}"))
}

#[cfg(test)]
mod tests {

    use super::*;

    #[test]
    fn test_pack_webp_frames_empty() {
        let packed = pack_webp_frames(vec![]);
        assert_eq!(packed, 0u32.to_le_bytes().to_vec());
    }

    #[test]
    fn test_pack_webp_frames_with_data() {
        let frames = vec![Some(vec![1, 2, 3]), None, Some(vec![4, 5])];
        let packed = pack_webp_frames(frames);

        let mut expected = Vec::new();
        expected.extend_from_slice(&3u32.to_le_bytes()); // Count = 3
        expected.extend_from_slice(&3u32.to_le_bytes()); // Frame 0 size = 3
        expected.extend_from_slice(&0u32.to_le_bytes()); // Frame 1 size = 0
        expected.extend_from_slice(&2u32.to_le_bytes()); // Frame 2 size = 2
        expected.extend_from_slice(&[1, 2, 3]); // Frame 0 data
        expected.extend_from_slice(&[4, 5]); // Frame 2 data

        assert_eq!(packed, expected);
    }

    #[test]
    fn native_media_service_cancel_unknown_task_returns_false() {
        let service = NativeMediaService::new();
        assert!(!service.cancel_task("nonexistent"));
    }
}
