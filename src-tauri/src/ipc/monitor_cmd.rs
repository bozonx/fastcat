//! Команды нативного монитора (winit-окно + Vello).
//!
//! Модель API:
//!   - `monitor_set_scene` — фронт шлёт текущий снимок таймлайна (video+image слои);
//!   - `monitor_play` / `monitor_pause` — транспорт по timeline-времени;
//!   - `monitor_seek(timeline_sec)` — позиционирование по timeline-PTS;
//!   - `monitor_close` — закрыть окно (event-loop умрёт, респавн на следующем set_scene).

use raw_window_handle::HasWindowHandle;
use tauri::{AppHandle, Manager, State};

use crate::engine::VideoEngine;
use crate::monitor::{MonitorCommand, MonitorScene, SendableRawHandle};

#[tauri::command]
pub async fn monitor_set_scene(
    scene: MonitorScene,
    engine: State<'_, VideoEngine>,
) -> Result<(), String> {
    engine
        .ensure_monitor()
        .map_err(|e| e.to_string())?
        .send(MonitorCommand::SetScene(scene))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn monitor_play(engine: State<'_, VideoEngine>) -> Result<(), String> {
    engine
        .ensure_monitor()
        .map_err(|e| e.to_string())?
        .send(MonitorCommand::Play)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn monitor_pause(engine: State<'_, VideoEngine>) -> Result<(), String> {
    engine
        .ensure_monitor()
        .map_err(|e| e.to_string())?
        .send(MonitorCommand::Pause)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn monitor_seek(time_sec: f64, engine: State<'_, VideoEngine>) -> Result<(), String> {
    engine
        .ensure_monitor()
        .map_err(|e| e.to_string())?
        .send(MonitorCommand::Seek(time_sec))
        .map_err(|e| e.to_string())
}

/// Положение/размер встроенного child-окна монитора. Координаты — в физических пикселях
/// относительно клиентской области главного окна (== viewport вебвью на десктопе).
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

#[tauri::command]
pub async fn monitor_close(engine: State<'_, VideoEngine>) -> Result<(), String> {
    if let Some(m) = engine.monitor() {
        m.send(MonitorCommand::Close).map_err(|e| e.to_string())?;
    }
    // Сбрасываем кэш — event-loop умрёт асинхронно, но новый ensure_monitor должен
    // увидеть свежее состояние и при необходимости спавнить заново.
    engine.clear_monitor();
    Ok(())
}
