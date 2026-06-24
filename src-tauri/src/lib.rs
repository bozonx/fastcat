use tauri::Manager;

pub mod video_render;

pub mod audio;
pub mod compositor;
pub mod engine;
pub mod ipc;
pub mod media;
pub mod monitor;

pub use crate::media::ffmpeg::FfmpegHwSettings;

#[tauri::command]
fn native_update_ffmpeg_settings(
    settings: FfmpegHwSettings,
    state: tauri::State<'_, parking_lot::RwLock<FfmpegHwSettings>>,
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

/// Environment variables that must be set before any GPU subsystem is initialized.
pub fn init_env_vars() {
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
        // Do NOT enable: incompatible with capability-scope (`fs:scope` with globs
        // like `$HOME/**/*` etc.). The plugin canonicalizes/escapes paths and globs
        // on save (UNC form `\\?\C:`, escaping `?`,`(`), and on restore the mangled
        // patterns no longer match real paths → any path becomes "forbidden path"
        // (verified: writing to project `_images/` failed with VfsPermissionError).
        // The static scope already covers the workspace ($HOME/**/*), and access to
        // files outside it is granted at runtime (`allow_dropped_file_scope`).
        // .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_fs_stream::init())
        .invoke_handler(tauri::generate_handler![
            ipc::fs_scope_cmd::allow_dropped_file_scope,
            ipc::fs_scope_cmd::allow_path_scope,
            ipc::fs_scope_cmd::allow_dev_directory_scope,
            video_render::webgpu_render_engine_status,
            ipc::media_cmd::native_media_metadata,
            ipc::media_cmd::native_media_extract_peaks,
            ipc::media_cmd::native_media_generate_proxy,
            ipc::media_cmd::native_media_convert,
            ipc::media_cmd::native_media_extract_audio,
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
            ipc::monitor_cmd::monitor_open_native_window,
            ipc::monitor_cmd::monitor_set_mode,
            ipc::monitor_cmd::monitor_subscribe_frames,
            ipc::monitor_cmd::monitor_unsubscribe_frames,
            ipc::monitor_cmd::monitor_set_canvas_size,
            ipc::monitor_cmd::monitor_set_audio_settings,
            ipc::monitor_cmd::monitor_set_output_gain,
            ipc::monitor_cmd::monitor_set_master_gain,
            ipc::monitor_cmd::monitor_close,
            ipc::monitor_cmd::monitor_reset,
            native_update_ffmpeg_settings,
            ipc::media_cmd::native_get_ffmpeg_diagnostics,
            ipc::fonts_cmd::native_system_fonts,
        ])
        .manage(ipc::media_cmd::NativeMediaService::new())
        .manage(parking_lot::RwLock::new(FfmpegHwSettings::default()))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        // On Wayland + GL backend wgpu_hal logs `EGL 'eglSwapInterval'
                        // code 0x300d` (EGL_BAD_SURFACE) every frame — this is a
                        // harmless warning (swapInterval cannot be reconfigured on
                        // the fly), but it clutters the terminal. Raise the threshold
                        // specifically for it.
                        .level_for("wgpu_hal::gles::egl", log::LevelFilter::Off)
                        .level_for("wgpu_hal::gles", log::LevelFilter::Warn)
                        // symphonia_format_isomp4 logs [WARN] ignoring stss atom
                        // when demuxing MP4 containers. stss is a video atom (key
                        // frames), harmless for audio decoding, but clutters the log.
                        .level_for("symphonia_format_isomp4", log::LevelFilter::Error)
                        .build(),
                )?;
            }
            // Video engine singleton; AppHandle is needed so the native side can emit events to the frontend.
            app.manage(engine::VideoEngine::new(app.handle().clone()));
            // Reclaim ephemeral temp files orphaned by a previous crashed/killed
            // run. Off-thread so a slow temp FS can't delay window creation.
            std::thread::spawn(media::temp::sweep_orphans);
            Ok(())
        });
    let result = builder.run(tauri::generate_context!());
    if let Err(e) = result {
        log::error!("error while running tauri application: {e}");
    }
}
