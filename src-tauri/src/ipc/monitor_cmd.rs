//! Команды нативного монитора (winit-окно + Vello).

use std::path::PathBuf;

use tauri::State;

use crate::engine::VideoEngine;
use crate::monitor::MonitorCommand;

#[tauri::command]
pub async fn monitor_open(path: String, engine: State<'_, VideoEngine>) -> Result<(), String> {
    engine
        .ensure_monitor()
        .map_err(|e| e.to_string())?
        .send(MonitorCommand::Open(PathBuf::from(path)))
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
