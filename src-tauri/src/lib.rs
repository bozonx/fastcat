use std::path::Path;

use tauri::Manager;
use tauri_plugin_fs::FsExt;

pub mod video_render;

pub mod compositor;
pub mod engine;
pub mod ipc;
pub mod media;
pub mod monitor;

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

#[tauri::command]
fn allow_path_scope(app: tauri::AppHandle, path: String) -> Result<(), String> {
    log::info!("[allow_path_scope] extending scope to: {path}");
    app.fs_scope()
        .allow_directory(&path, true)
        .map_err(|e| e.to_string())?;
    app.asset_protocol_scope()
        .allow_directory(&path, true)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn allow_dev_directory_scope(app: tauri::AppHandle, path: String) -> Result<(), String> {
    if !cfg!(debug_assertions) {
        return Err("dev directory scope can only be extended in debug builds".to_string());
    }

    let path_obj = Path::new(&path);

    // Reject obviously dangerous paths (system roots and home directories).
    let is_root = path_obj.parent().is_none();
    let is_home = path_obj
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.starts_with('~'))
        .unwrap_or(false);

    if is_root || is_home {
        return Err(format!(
            "refusing to extend scope to system or home directory: {}",
            path
        ));
    }

    log::info!("[allow_dev_directory_scope] extending scope to: {}", path);
    app.fs_scope()
        .allow_directory(&path, true)
        .map_err(|error| error.to_string())?;
    app.asset_protocol_scope()
        .allow_directory(&path, true)
        .map_err(|error| error.to_string())?;
    log::info!("[allow_dev_directory_scope] scope extended successfully");
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // На Linux форсируем X11 backend для GTK/webkit2gtk и winit. Это нужно для
    // встраивания нативного монитора (winit child window) в главное окно Tauri:
    // honestный `wl_subsurface` между двумя разными wl_display connections невозможен,
    // а на X11 `with_parent_window` создаёт настоящий child через XCreateWindow.
    // На Wayland-сессии оба окна поднимутся через XWayland.
    #[cfg(target_os = "linux")]
    {
        // SAFETY: вызывается до tauri::Builder и до любого взаимодействия с GTK/winit.
        unsafe {
            std::env::set_var("GDK_BACKEND", "x11");
            std::env::set_var("WINIT_UNIX_BACKEND", "x11");
        }
    }

    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = app
                .get_webview_window("main")
                .expect("no main window")
                .set_focus();
        }));
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        // Temporarily disabled to test if it interferes with runtime scope extension.
        // .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_fs_stream::init())
        .invoke_handler(tauri::generate_handler![
            allow_dropped_file_scope,
            allow_path_scope,
            allow_dev_directory_scope,
            video_render::webgpu_render_engine_status,
            ipc::monitor_cmd::monitor_set_scene,
            ipc::monitor_cmd::monitor_play,
            ipc::monitor_cmd::monitor_pause,
            ipc::monitor_cmd::monitor_seek,
            ipc::monitor_cmd::monitor_set_viewport,
            ipc::monitor_cmd::monitor_set_mode,
            ipc::monitor_cmd::monitor_subscribe_frames,
            ipc::monitor_cmd::monitor_set_canvas_size,
            ipc::monitor_cmd::monitor_close,
        ])
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
                        .build(),
                )?;
            }
            // Видео-движок-singleton; AppHandle нужен, чтобы натив мог эмитить события на фронт.
            app.manage(engine::VideoEngine::new(app.handle().clone()));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
