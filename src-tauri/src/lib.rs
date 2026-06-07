use std::path::{Path, PathBuf};

use tauri::Manager;
use tauri_plugin_fs::FsExt;

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
/// `allow_path_scope("/")` and read the whole disk. Callers should pass an
/// already-resolved absolute path.
fn reject_dangerous_scope_path(path: &Path) -> Result<(), String> {
    // A path with no parent is a filesystem root (`/`, `C:\`).
    if path.parent().is_none() {
        return Err(format!(
            "refusing to extend scope to filesystem root: {path:?}"
        ));
    }

    if let Some(home) = user_home_dir() {
        if path == home {
            return Err(format!(
                "refusing to extend scope to the home directory: {path:?}"
            ));
        }
    }

    Ok(())
}

pub mod audio;
pub mod compositor;
pub mod engine;
pub mod ipc;
pub mod media;
pub mod monitor;

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegHardwareSettings {
    pub ffmpeg_path: String,
    pub ffprobe_path: String,
    pub hardware_acceleration_mode: String,
    pub vaapi_device: String,
    pub enable_hardware_encoding: bool,
}

impl Default for FfmpegHardwareSettings {
    fn default() -> Self {
        Self {
            ffmpeg_path: "ffmpeg".to_string(),
            ffprobe_path: "ffprobe".to_string(),
            hardware_acceleration_mode: "none".to_string(),
            vaapi_device: "/dev/dri/renderD128".to_string(),
            enable_hardware_encoding: false,
        }
    }
}

#[tauri::command]
fn native_update_ffmpeg_settings(
    settings: FfmpegHardwareSettings,
    state: tauri::State<'_, parking_lot::RwLock<FfmpegHardwareSettings>>,
) {
    *state.write() = settings;
}

/// Extends the fs scope to allow reading a file dropped from the OS.
/// Required for drag-and-drop imports from arbitrary filesystem locations.
#[tauri::command]
fn allow_dropped_file_scope(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use std::path::Path;
    let p = Path::new(&path);

    // Reject directories — only individual files should be allowed this way.
    if p.extension().is_none() && p.is_dir() {
        return Err(format!("path is a directory: {path}"));
    }

    log::info!("[allow_dropped_file_scope] extending scope to: {path}");
    app.fs_scope()
        .allow_file(&path)
        .map_err(|e| e.to_string())?;
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|e| e.to_string())
}

fn allow_directory_scope(app: &tauri::AppHandle, path: &str) -> Result<(), String> {
    app.fs_scope()
        .allow_directory(path, true)
        .map_err(|e| e.to_string())?;
    app.asset_protocol_scope()
        .allow_directory(path, true)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn allow_path_scope(app: tauri::AppHandle, path: String) -> Result<(), String> {
    reject_dangerous_scope_path(Path::new(&path))?;

    log::info!("[allow_path_scope] extending scope to: {path}");
    allow_directory_scope(&app, &path)
}

#[tauri::command]
fn allow_dev_directory_scope(app: tauri::AppHandle, path: String) -> Result<(), String> {
    if !cfg!(debug_assertions) {
        return Err("dev directory scope can only be extended in debug builds".to_string());
    }

    reject_dangerous_scope_path(Path::new(&path))?;

    log::info!("[allow_dev_directory_scope] extending scope to: {}", path);
    allow_directory_scope(&app, &path)?;
    log::info!("[allow_dev_directory_scope] scope extended successfully");
    Ok(())
}

/// Platform-specific environment variables that must be set before any windowing
/// or GPU subsystem is initialized.
pub fn init_env_vars() {
    #[cfg(target_os = "linux")]
    {
        // SAFETY: Called before tauri::Builder and before any GTK/winit interaction.
        unsafe {
            std::env::set_var("GDK_BACKEND", "x11");
            std::env::set_var("WINIT_UNIX_BACKEND", "x11");
        }
    }
    // Force wgpu to prefer the high-performance adapter (dGPU on hybrid laptops).
    // Vello's RenderContext uses `initialize_adapter_from_env_or_default`, which
    // falls back on `PowerPreference::from_env().unwrap_or_default()` — default
    // is LowPower. We override it here so we never silently land on iGPU.
    std::env::set_var("WGPU_POWER_PREF", "high");
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
