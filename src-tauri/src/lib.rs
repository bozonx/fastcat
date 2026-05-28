use tauri::Manager;
use tauri_plugin_fs::FsExt;

pub mod video_render;

#[tauri::command]
fn allow_dev_directory_scope(app: tauri::AppHandle, path: String) -> Result<(), String> {
    if !cfg!(debug_assertions) {
        return Err("dev directory scope can only be extended in debug builds".to_string());
    }

    app.fs_scope()
        .allow_directory(path, true)
        .map_err(|error| error.to_string())
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
        .plugin(tauri_plugin_persisted_scope::init())
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
