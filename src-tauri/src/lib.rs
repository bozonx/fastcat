use std::path::Path;

use tauri::Manager;
use tauri_plugin_fs::FsExt;

pub mod video_render;

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

    println!("[allow_dev_directory_scope] extending scope to: {}", path);
    let result = app
        .fs_scope()
        .allow_directory(path, true)
        .map_err(|error| error.to_string());
    println!("[allow_dev_directory_scope] result: {:?}", result);
    result
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
            allow_dev_directory_scope,
            video_render::webgpu_render_engine_status
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
