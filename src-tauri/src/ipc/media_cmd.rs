use std::path::PathBuf;

use tauri::State;

use crate::media::processing::{
    convert_media, extract_video_frame_webp, extract_video_frame_webps, generate_proxy,
    probe_media, NativeConvertOptions, NativeMediaMetadata, NativeMediaTasks, NativeProxyOptions,
};
use crate::media::timeline_render::{render_timeline_frame_to_file, render_timeline_frame_to_webp};
use crate::monitor::MonitorScene;

#[tauri::command]
pub async fn native_media_metadata(path: String) -> Result<NativeMediaMetadata, String> {
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || probe_media(&path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn native_media_generate_proxy(
    task_id: String,
    source_path: String,
    target_path: String,
    options: NativeProxyOptions,
    tasks: State<'_, NativeMediaTasks>,
) -> Result<(), String> {
    let tasks = tasks.inner().clone();
    let source_path = PathBuf::from(source_path);
    let target_path = PathBuf::from(target_path);
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
    options: NativeConvertOptions,
    tasks: State<'_, NativeMediaTasks>,
) -> Result<(), String> {
    let tasks = tasks.inner().clone();
    let source_path = PathBuf::from(source_path);
    let target_path = PathBuf::from(target_path);
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
    .map_err(|e| e.to_string())
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
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn native_video_frame_webp(
    source_path: String,
    time_sec: f64,
    max_width: u32,
    max_height: u32,
    quality: f32,
) -> Result<Vec<u8>, String> {
    let source_path = PathBuf::from(source_path);
    tokio::task::spawn_blocking(move || {
        extract_video_frame_webp(&source_path, time_sec, max_width, max_height, quality)
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
) -> Result<Vec<Option<Vec<u8>>>, String> {
    let source_path = PathBuf::from(source_path);
    tokio::task::spawn_blocking(move || {
        extract_video_frame_webps(&source_path, &times_sec, max_width, max_height, quality)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}
