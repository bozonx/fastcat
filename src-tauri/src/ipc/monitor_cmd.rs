//! Команды нативного монитора (winit-окно + Vello).
//!
//! Модель API:
//!   - `monitor_set_scene` — фронт шлёт текущий снимок таймлайна (video+image слои);
//!   - `monitor_play` / `monitor_pause` — транспорт по timeline-времени;
//!   - `monitor_seek(timeline_sec)` — позиционирование по timeline-PTS;
//!   - `monitor_close` — закрыть окно (event-loop умрёт, респавн на следующем set_scene).

use tauri::State;

use crate::engine::VideoEngine;
use crate::monitor::{MonitorCommand, MonitorScene};

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
