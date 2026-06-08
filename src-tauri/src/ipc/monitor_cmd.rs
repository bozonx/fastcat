//! Native monitor commands (winit window + Vello).
//!
//! API model:
//!   - `monitor_set_scene` — front-end sends the current timeline snapshot (video + image layers);
//!   - `monitor_play` / `monitor_pause` — transport control by timeline time;
//!   - `monitor_seek(timeline_sec)` — seek to a timeline PTS;
//!   - `monitor_close` — close the window (event loop dies, respawned on the next set_scene).

use raw_window_handle::HasWindowHandle;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager, State};

use crate::engine::VideoEngine;
use crate::monitor::{MonitorCommand, MonitorMode, MonitorScene, SendableRawHandle};

fn send_monitor_cmd(engine: &VideoEngine, cmd: MonitorCommand) -> Result<(), String> {
    engine
        .ensure_monitor()
        .map_err(|e| e.to_string())?
        .send(cmd)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn monitor_set_scene(
    scene: MonitorScene,
    engine: State<'_, VideoEngine>,
) -> Result<(), String> {
    send_monitor_cmd(&engine, MonitorCommand::SetScene(scene))
}

#[tauri::command]
pub async fn monitor_play(engine: State<'_, VideoEngine>) -> Result<(), String> {
    send_monitor_cmd(&engine, MonitorCommand::Play)
}

#[tauri::command]
pub async fn monitor_pause(engine: State<'_, VideoEngine>) -> Result<(), String> {
    send_monitor_cmd(&engine, MonitorCommand::Pause)
}

#[tauri::command]
pub async fn monitor_seek(time_sec: f64, engine: State<'_, VideoEngine>) -> Result<(), String> {
    send_monitor_cmd(&engine, MonitorCommand::Seek(time_sec))
}

/// Sets the global transport playback speed (timeline-time multiplier). `1.0` is
/// normal, `2.0` plays at 2× (pitch-shifted audio), negative values play in
/// reverse with muted audio.
#[tauri::command]
pub async fn monitor_set_speed(speed: f64, engine: State<'_, VideoEngine>) -> Result<(), String> {
    send_monitor_cmd(&engine, MonitorCommand::SetSpeed(speed))
}

/// Forward-scrub audio preview: play a one-shot snippet at `from_sec` of length
/// `duration_sec`, only while not in normal playback (does not move transport).
#[tauri::command]
pub async fn monitor_scrub_preview(
    from_sec: f64,
    duration_sec: f64,
    engine: State<'_, VideoEngine>,
) -> Result<(), String> {
    send_monitor_cmd(
        &engine,
        MonitorCommand::ScrubPreview {
            from_sec,
            duration_sec,
        },
    )
}

#[tauri::command]
pub async fn monitor_stop_scrub_preview(engine: State<'_, VideoEngine>) -> Result<(), String> {
    send_monitor_cmd(&engine, MonitorCommand::StopScrubPreview)
}

/// Position / size of the embedded monitor child window. Coordinates are in physical pixels
/// relative to the client area of the main window (== webview viewport on desktop).
#[tauri::command]
pub async fn monitor_set_viewport(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    visible: bool,
    app: AppHandle,
    engine: State<'_, VideoEngine>,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "no main webview window".to_string())?;
    let handle = window
        .window_handle()
        .map_err(|e| format!("window_handle failed: {e}"))?
        .as_raw();
    let parent = SendableRawHandle(handle);
    engine
        .ensure_monitor()
        .map_err(|e| e.to_string())?
        .send(MonitorCommand::SetViewport {
            parent,
            x,
            y,
            width,
            height,
            visible,
        })
        .map_err(|e| e.to_string())
}

/// Switch output mode: `embedded` (X11 child) or `canvas` (offscreen → stream to HTML canvas).
#[tauri::command]
pub async fn monitor_set_mode(
    mode: MonitorMode,
    engine: State<'_, VideoEngine>,
) -> Result<(), String> {
    send_monitor_cmd(&engine, MonitorCommand::SetMode(mode))
}

/// Subscribe to the RGBA frame stream. Each channel message = bytes:
/// `u32 LE width` + `u32 LE height` + `width*height*4` RGBA8 bytes.
#[tauri::command]
pub async fn monitor_subscribe_frames(
    channel: Channel<InvokeResponseBody>,
    engine: State<'_, VideoEngine>,
) -> Result<(), String> {
    send_monitor_cmd(&engine, MonitorCommand::SetFrameChannel(channel))
}

/// Render target size in canvas mode (physical pixels).
#[tauri::command]
pub async fn monitor_set_canvas_size(
    width: u32,
    height: u32,
    engine: State<'_, VideoEngine>,
) -> Result<(), String> {
    send_monitor_cmd(&engine, MonitorCommand::SetCanvasSize { width, height })
}

#[tauri::command]
pub async fn monitor_set_audio_settings(
    buffer_size: Option<u32>,
    backend: Option<String>,
    engine: State<'_, VideoEngine>,
) -> Result<(), String> {
    use crate::audio::engine::AudioEngineSettings;
    let settings = AudioEngineSettings {
        buffer_size,
        backend,
    };
    if !engine.set_audio_settings(settings.clone()) {
        return Ok(());
    }

    if let Some(monitor) = engine.monitor() {
        monitor
            .send(MonitorCommand::SetAudioSettings(settings))
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn monitor_close(engine: State<'_, VideoEngine>) -> Result<(), String> {
    if let Some(m) = engine.monitor() {
        m.send(MonitorCommand::Close).map_err(|e| e.to_string())?;
    }
    // Reset the cache — the event loop dies asynchronously, but the next ensure_monitor
    // must see fresh state and respawn if necessary.
    engine.clear_monitor();
    Ok(())
}
