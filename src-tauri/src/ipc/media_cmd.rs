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

#[tauri::command]
pub async fn native_media_metadata(
    path: String,
    hw_settings: State<'_, std::sync::Mutex<crate::FfmpegHardwareSettings>>,
) -> Result<NativeMediaMetadata, String> {
    let path = PathBuf::from(path);
    let ffprobe_path = hw_settings.lock().unwrap().ffprobe_path.clone();
    tokio::task::spawn_blocking(move || probe_media(&path, &ffprobe_path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn native_media_generate_proxy(
    task_id: String,
    source_path: String,
    target_path: String,
    mut options: NativeProxyOptions,
    tasks: State<'_, NativeMediaTasks>,
    hw_settings: State<'_, std::sync::Mutex<crate::FfmpegHardwareSettings>>,
) -> Result<(), String> {
    let tasks = tasks.inner().clone();
    let source_path = PathBuf::from(source_path);
    let target_path = PathBuf::from(target_path);

    let hw = hw_settings.lock().unwrap().clone();
    options.ffmpeg_path = Some(hw.ffmpeg_path);
    options.ffprobe_path = Some(hw.ffprobe_path);
    options.hardware_acceleration_mode = Some(hw.hardware_acceleration_mode);
    options.vaapi_device = Some(hw.vaapi_device);
    options.enable_hardware_encoding = Some(hw.enable_hardware_encoding);

    tokio::task::spawn_blocking(move || {
        generate_proxy(&tasks, &task_id, &source_path, &target_path, options)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn native_media_convert(
    task_id: String,
    source_path: String,
    target_path: String,
    mut options: NativeConvertOptions,
    tasks: State<'_, NativeMediaTasks>,
    hw_settings: State<'_, std::sync::Mutex<crate::FfmpegHardwareSettings>>,
) -> Result<(), String> {
    let tasks = tasks.inner().clone();
    let source_path = PathBuf::from(source_path);
    let target_path = PathBuf::from(target_path);

    let hw = hw_settings.lock().unwrap().clone();
    options.ffmpeg_path = Some(hw.ffmpeg_path);
    options.ffprobe_path = Some(hw.ffprobe_path);
    options.hardware_acceleration_mode = Some(hw.hardware_acceleration_mode);
    options.vaapi_device = Some(hw.vaapi_device);
    options.enable_hardware_encoding = Some(hw.enable_hardware_encoding);

    tokio::task::spawn_blocking(move || {
        convert_media(&tasks, &task_id, &source_path, &target_path, options)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn native_media_cancel(task_id: String, tasks: State<'_, NativeMediaTasks>) -> bool {
    tasks.cancel(&task_id)
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
    tasks: State<'_, NativeMediaTasks>,
    hw_settings: State<'_, std::sync::Mutex<crate::FfmpegHardwareSettings>>,
) -> Result<(), String> {
    let tasks = tasks.inner().clone();
    let target_path = PathBuf::from(target_path);

    let hw = hw_settings.lock().unwrap().clone();
    options.ffmpeg_path = Some(hw.ffmpeg_path);
    options.hardware_acceleration_mode = Some(hw.hardware_acceleration_mode);
    options.vaapi_device = Some(hw.vaapi_device);
    options.enable_hardware_encoding = Some(hw.enable_hardware_encoding);

    tokio::task::spawn_blocking(move || {
        export_timeline(
            &tasks,
            &task_id,
            scene,
            options,
            &target_path,
            &|progress| {
                let _ = app.emit(
                    "native-timeline-export:progress",
                    NativeTimelineExportProgress {
                        task_id: &task_id,
                        progress,
                    },
                );
            },
        )
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn native_timeline_render_frame_to_file(
    scene: MonitorScene,
    time_sec: f64,
    width: u32,
    height: u32,
    target_path: String,
    quality: f32,
    hw_settings: tauri::State<'_, std::sync::Mutex<crate::FfmpegHardwareSettings>>,
) -> Result<(), String> {
    let target_path = PathBuf::from(target_path);
    let hw = hw_settings.lock().unwrap().clone();
    tokio::task::spawn_blocking(move || {
        render_timeline_frame_to_file(scene, time_sec, width, height, &target_path, quality, hw)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn native_timeline_render_frame_webp(
    scene: MonitorScene,
    time_sec: f64,
    width: u32,
    height: u32,
    quality: f32,
    hw_settings: tauri::State<'_, std::sync::Mutex<crate::FfmpegHardwareSettings>>,
) -> Result<Vec<u8>, String> {
    let hw = hw_settings.lock().unwrap().clone();
    tokio::task::spawn_blocking(move || {
        render_timeline_frame_to_webp(scene, time_sec, width, height, quality, hw)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn native_video_frame_webp(
    source_path: String,
    time_sec: f64,
    max_width: u32,
    max_height: u32,
    quality: f32,
    hw_settings: tauri::State<'_, std::sync::Mutex<crate::FfmpegHardwareSettings>>,
) -> Result<Vec<u8>, String> {
    let source_path = PathBuf::from(source_path);
    let hw = hw_settings.lock().unwrap().clone();
    tokio::task::spawn_blocking(move || {
        extract_video_frame_webp(&source_path, time_sec, max_width, max_height, quality, hw)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn native_video_frame_webps(
    source_path: String,
    times_sec: Vec<f64>,
    max_width: u32,
    max_height: u32,
    quality: f32,
    hw_settings: tauri::State<'_, std::sync::Mutex<crate::FfmpegHardwareSettings>>,
) -> Result<Vec<u8>, String> {
    let source_path = PathBuf::from(source_path);
    let hw = hw_settings.lock().unwrap().clone();
    let frames = tokio::task::spawn_blocking(move || {
        extract_video_frame_webps(&source_path, &times_sec, max_width, max_height, quality, hw)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

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
    for frame in frames {
        if let Some(data) = frame {
            packed.extend_from_slice(&data);
        }
    }
    packed
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
        let frames = vec![
            Some(vec![1, 2, 3]),
            None,
            Some(vec![4, 5]),
        ];
        let packed = pack_webp_frames(frames);
        
        let mut expected = Vec::new();
        expected.extend_from_slice(&3u32.to_le_bytes()); // Count = 3
        expected.extend_from_slice(&3u32.to_le_bytes()); // Frame 0 size = 3
        expected.extend_from_slice(&0u32.to_le_bytes()); // Frame 1 size = 0
        expected.extend_from_slice(&2u32.to_le_bytes()); // Frame 2 size = 2
        expected.extend_from_slice(&[1, 2, 3]);          // Frame 0 data
        expected.extend_from_slice(&[4, 5]);             // Frame 2 data
        
        assert_eq!(packed, expected);
    }
}
