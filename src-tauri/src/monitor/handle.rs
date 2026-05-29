//! Тонкий handle к потоку монитора. Хранится в `VideoEngine` и шарится между Tauri-командами.

use std::sync::mpsc;
use std::thread::JoinHandle;

use anyhow::{anyhow, Result};
use tauri::AppHandle;
use winit::event_loop::EventLoopProxy;

use super::app::run_event_loop;
use super::scene::MonitorScene;

#[derive(Debug, Clone)]
pub enum MonitorCommand {
    /// Полная замена сцены — фронт шлёт текущий снимок таймлайна, монитор сам
    /// решает, какие декодеры открыть/закрыть.
    SetScene(MonitorScene),
    Play,
    Pause,
    /// Seek по timeline-времени (секунды). Каждый видеослой пересчитывает в clip-local.
    Seek(f64),
    Close,
    /// Пинг для is_alive(): event-loop игнорирует, но send_event() вернёт Err
    /// если loop уже закрыт. Дёшево и достаточно.
    Ping,
}

pub struct MonitorHandle {
    proxy: EventLoopProxy<MonitorCommand>,
    _thread: Option<JoinHandle<()>>,
}

impl MonitorHandle {
    pub fn spawn(app: AppHandle) -> Result<Self> {
        let (tx, rx) = mpsc::channel::<Result<EventLoopProxy<MonitorCommand>, String>>();
        let thread = std::thread::Builder::new()
            .name("fastcat-monitor".into())
            .spawn(move || {
                run_event_loop(app, tx);
            })?;
        let proxy = rx
            .recv()
            .map_err(|_| anyhow!("monitor thread terminated before sending proxy"))?
            .map_err(|e| anyhow!("monitor init failed: {e}"))?;
        Ok(Self {
            proxy,
            _thread: Some(thread),
        })
    }

    pub fn send(&self, cmd: MonitorCommand) -> Result<()> {
        self.proxy
            .send_event(cmd)
            .map_err(|_| anyhow!("monitor event loop is gone"))
    }

    pub fn is_alive(&self) -> bool {
        self.proxy.send_event(MonitorCommand::Ping).is_ok()
    }
}
