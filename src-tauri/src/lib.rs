use std::path::{Path, PathBuf};

use tauri::Manager;
use tauri_plugin_fs::FsExt;

use crate::media::types::HwAccelMode;

pub mod video_render;

/// Best-effort resolution of the current user's home directory without pulling
/// in extra crates. Returns `None` if neither the platform-specific nor the
/// generic environment variables are set.
fn user_home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .filter(|p| !p.as_os_str().is_empty())
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .filter(|p| !p.as_os_str().is_empty())
    }
}

/// Rejects scope-extension targets that would hand the webview far more of the
/// filesystem than any single operation needs: filesystem roots and the bare
/// home directory. A compromised renderer must not be able to call
/// `allow_path_scope("/")` and read the whole disk.
fn reject_dangerous_scope_path(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err(format!("scope path must be absolute: {path:?}"));
    }

    // A path with no parent is a filesystem root (`/`, `C:\`).
    if path.parent().is_none() {
        return Err(format!(
            "refusing to extend scope to filesystem root: {path:?}"
        ));
    }

    if let Some(home) = canonical_user_home_dir() {
        if path == home {
            return Err(format!(
                "refusing to extend scope to the home directory: {path:?}"
            ));
        }
    }

    // Reject paths that contain sensitive directory components.
    for component in path.components() {
        if let std::path::Component::Normal(name) = component {
            let name = name.to_string_lossy();
            if matches!(
                name.as_ref(),
                ".git" | ".gitignore" | "node_modules" | ".env" | ".ssh"
            ) {
                return Err(format!(
                    "refusing to extend scope to a path containing sensitive component: {path:?}"
                ));
            }
        }
    }

    Ok(())
}

fn canonical_user_home_dir() -> Option<PathBuf> {
    user_home_dir().map(|home| home.canonicalize().unwrap_or(home))
}

fn canonicalize_scope_path(path: &str) -> Result<PathBuf, String> {
    Path::new(path)
        .canonicalize()
        .map_err(|e| format!("failed to resolve scope path {path:?}: {e}"))
}

pub mod audio;
pub mod compositor;
pub mod engine;
pub mod ipc;
pub mod media;
pub mod monitor;

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegHardwareSettings {
    pub ffmpeg_path: String,
    pub ffprobe_path: String,
    pub hardware_acceleration_mode: HwAccelMode,
    pub vaapi_device: String,
    pub enable_hardware_encoding: bool,
}

impl Default for FfmpegHardwareSettings {
    fn default() -> Self {
        Self {
            ffmpeg_path: "ffmpeg".to_string(),
            ffprobe_path: "ffprobe".to_string(),
            hardware_acceleration_mode: HwAccelMode::None,
            vaapi_device: "/dev/dri/renderD128".to_string(),
            enable_hardware_encoding: false,
        }
    }
}

#[tauri::command]
fn native_update_ffmpeg_settings(
    settings: FfmpegHardwareSettings,
    state: tauri::State<'_, parking_lot::RwLock<FfmpegHardwareSettings>>,
    engine: tauri::State<'_, engine::VideoEngine>,
) {
    let changed = {
        let mut guard = state.write();
        let changed = *guard != settings;
        if changed {
            *guard = settings.clone();
        }
        changed
    };
    if changed {
        if let Some(monitor) = engine.monitor() {
            let _ = monitor.send(monitor::MonitorCommand::SetHwSettings(settings));
        }
    }
}

/// Extends the fs scope to allow reading a file dropped from the OS.
/// Required for drag-and-drop imports from arbitrary filesystem locations.
#[tauri::command]
fn allow_dropped_file_scope(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let path = canonicalize_scope_path(&path)?;
    reject_dangerous_scope_path(&path)?;

    if !path.is_file() {
        return Err(format!("scope path is not a regular file: {path:?}"));
    }

    log::info!(
        "[allow_dropped_file_scope] extending scope to: {}",
        path.display()
    );
    app.fs_scope()
        .allow_file(&path)
        .map_err(|e| e.to_string())?;
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|e| e.to_string())
}

fn allow_directory_scope(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    app.fs_scope()
        .allow_directory(path, true)
        .map_err(|e| e.to_string())?;
    app.asset_protocol_scope()
        .allow_directory(path, true)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn allow_path_scope(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let path = canonicalize_scope_path(&path)?;
    reject_dangerous_scope_path(&path)?;

    log::info!("[allow_path_scope] extending scope to: {}", path.display());
    allow_directory_scope(&app, &path)
}

#[tauri::command]
fn allow_dev_directory_scope(app: tauri::AppHandle, path: String) -> Result<(), String> {
    if !cfg!(debug_assertions) {
        return Err("dev directory scope can only be extended in debug builds".to_string());
    }

    let path = canonicalize_scope_path(&path)?;
    reject_dangerous_scope_path(&path)?;

    log::info!(
        "[allow_dev_directory_scope] extending scope to: {}",
        path.display()
    );
    allow_directory_scope(&app, &path)?;
    log::info!("[allow_dev_directory_scope] scope extended successfully");
    Ok(())
}

/// Platform-specific environment variables that must be set before any windowing
/// or GPU subsystem is initialized.
pub fn init_env_vars() {
    #[cfg(target_os = "linux")]
    {
        // SAFETY: These must be set before any GTK or winit initialization.
        // Called from `run()` before `tauri::Builder`; no other threads are
        // running, satisfying the `std::env::set_var` safety contract.
        unsafe {
            std::env::set_var("GDK_BACKEND", "x11");
            std::env::set_var("WINIT_UNIX_BACKEND", "x11");
        }
    }
    // Force wgpu to prefer the high-performance adapter (dGPU on hybrid laptops).
    // SAFETY: No wgpu code is running concurrently; the variable is read later
    // during adapter enumeration on the same thread.
    unsafe {
        std::env::set_var("WGPU_POWER_PREF", "high");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_focus();
            }
        }));
    }

    builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        // НЕ включать: несовместим с capability-scope (`fs:scope` с glob'ами `$HOME/**/*` и т.п.).
        // Плагин при сохранении канонизирует/экранирует пути и glob'ы (UNC-форма `\\?\C:`,
        // экранирование `?`,`(`), а при восстановлении искажённые паттерны уже не матчат реальные
        // пути → любой путь становится "forbidden path" (проверено: запись в project `_images/`
        // падала с VfsPermissionError). Статический scope уже покрывает workspace ($HOME/**/*),
        // а доступ к файлам вне его выдаётся рантаймом (`allow_dropped_file_scope`).
        // .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_fs_stream::init())
        .invoke_handler(tauri::generate_handler![
            allow_dropped_file_scope,
            allow_path_scope,
            allow_dev_directory_scope,
            video_render::webgpu_render_engine_status,
            ipc::media_cmd::native_media_metadata,
            ipc::media_cmd::native_media_extract_peaks,
            ipc::media_cmd::native_media_generate_proxy,
            ipc::media_cmd::native_media_convert,
            ipc::media_cmd::native_media_cancel,
            ipc::media_cmd::native_timeline_export,
            ipc::media_cmd::native_timeline_render_frame_to_file,
            ipc::media_cmd::native_timeline_render_frame_webp,
            ipc::media_cmd::native_video_frame_webp,
            ipc::media_cmd::native_video_frame_webps,
            ipc::monitor_cmd::monitor_set_scene,
            ipc::monitor_cmd::monitor_play,
            ipc::monitor_cmd::monitor_pause,
            ipc::monitor_cmd::monitor_seek,
            ipc::monitor_cmd::monitor_set_speed,
            ipc::monitor_cmd::monitor_scrub_preview,
            ipc::monitor_cmd::monitor_stop_scrub_preview,
            ipc::monitor_cmd::monitor_set_viewport,
            ipc::monitor_cmd::monitor_set_mode,
            ipc::monitor_cmd::monitor_subscribe_frames,
            ipc::monitor_cmd::monitor_set_canvas_size,
            ipc::monitor_cmd::monitor_set_audio_settings,
            ipc::monitor_cmd::monitor_close,
            native_update_ffmpeg_settings,
            ipc::media_cmd::native_get_ffmpeg_diagnostics,
            ipc::fonts_cmd::native_system_fonts,
        ])
        .manage(ipc::media_cmd::NativeMediaService::new())
        .manage(parking_lot::RwLock::new(FfmpegHardwareSettings::default()))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        // На Wayland + GL backend wgpu_hal каждое кадра логирует
                        // `EGL 'eglSwapInterval' code 0x300d` (EGL_BAD_SURFACE) — это
                        // безвредный варнинг (swapInterval не настраивается на лету),
                        // но он засоряет терминал. Поднимаем порог именно для него.
                        .level_for("wgpu_hal::gles::egl", log::LevelFilter::Off)
                        .level_for("wgpu_hal::gles", log::LevelFilter::Warn)
                        // symphonia_format_isomp4 логирует [WARN] ignoring stss atom
                        // при демуксе MP4-контейнеров. stss — это видео-атом (ключевые
                        // кадры), для аудио-декодинга он безвреден, но засоряет лог.
                        .level_for("symphonia_format_isomp4", log::LevelFilter::Error)
                        .build(),
                )?;
            }
            // Видео-движок-singleton; AppHandle нужен, чтобы натив мог эмитить события на фронт.
            app.manage(engine::VideoEngine::new(app.handle().clone()));
            Ok(())
        });
    let result = builder.run(tauri::generate_context!());
    if let Err(e) = result {
        log::error!("error while running tauri application: {e}");
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{canonicalize_scope_path, reject_dangerous_scope_path};

    fn unique_temp_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("fastcat-{name}-{}-{unique}", std::process::id()))
    }

    #[test]
    fn canonicalize_scope_path_resolves_parent_segments_before_policy_check() {
        let root = unique_temp_dir("scope-canonical");
        let safe = root.join("safe");
        fs::create_dir_all(&safe).expect("create temp scope dir");

        let raw = safe.join("..").join("safe");
        let resolved = canonicalize_scope_path(&raw.to_string_lossy()).expect("canonical path");

        assert_eq!(resolved, safe.canonicalize().expect("canonical safe dir"));
        reject_dangerous_scope_path(&resolved).expect("safe canonical dir");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn scope_policy_rejects_sensitive_components_after_canonicalization() {
        let root = unique_temp_dir("scope-sensitive");
        let safe = root.join("safe");
        let sensitive = root.join(".git").join("objects");
        fs::create_dir_all(&safe).expect("create safe temp dir");
        fs::create_dir_all(&sensitive).expect("create sensitive temp dir");

        let raw = safe.join("..").join(".git").join("objects");
        let resolved = canonicalize_scope_path(&raw.to_string_lossy()).expect("canonical path");
        let error = reject_dangerous_scope_path(&resolved).expect_err("sensitive path rejected");

        assert!(error.contains("sensitive component"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn scope_policy_rejects_relative_paths() {
        let error = reject_dangerous_scope_path(std::path::Path::new("relative/path"))
            .expect_err("relative path rejected");

        assert!(error.contains("absolute"));
    }
}
