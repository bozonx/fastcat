//! Тонкий handle к потоку монитора. Хранится в `VideoEngine` и шарится между Tauri-командами.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread::JoinHandle;

use anyhow::{anyhow, Result};
use tauri::AppHandle;
use winit::event_loop::EventLoopProxy;

use super::app::run_event_loop;
use super::scene::MonitorScene;

#[derive(Debug)]
pub enum MonitorCommand {
    /// Полная замена сцены — фронт шлёт текущий снимок таймлайна.
    SetScene(MonitorScene),
    Play,
    Pause,
    /// Seek по timeline-времени (секунды).
    Seek(f64),
    Close,
    /// Фоновый поток загрузил слой — event-loop должен дренировать bg_rx.
    BgReady,
}

pub struct MonitorHandle {
    proxy: EventLoopProxy<MonitorCommand>,
    _thread: Option<JoinHandle<()>>,
    /// Сбрасывается в false, когда event-loop завершился. Быстрее Ping-round-trip.
    alive: Arc<AtomicBool>,
}

impl MonitorHandle {
    pub fn spawn(app: AppHandle) -> Result<Self> {
        let alive = Arc::new(AtomicBool::new(true));
        let alive_clone = alive.clone();
        let (tx, rx) = mpsc::channel::<Result<EventLoopProxy<MonitorCommand>, String>>();
        let thread = std::thread::Builder::new()
            .name("fastcat-monitor".into())
            .spawn(move || {
                run_event_loop(app, tx);
                alive_clone.store(false, Ordering::Relaxed);
            })?;
        let proxy = rx
            .recv()
            .map_err(|_| anyhow!("monitor thread terminated before sending proxy"))?
            .map_err(|e| anyhow!("monitor init failed: {e}"))?;
        Ok(Self {
            proxy,
            _thread: Some(thread),
            alive,
        })
    }

    pub fn send(&self, cmd: MonitorCommand) -> Result<()> {
        self.proxy
            .send_event(cmd)
            .map_err(|_| anyhow!("monitor event loop is gone"))
    }

    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::Relaxed)
    }
}
