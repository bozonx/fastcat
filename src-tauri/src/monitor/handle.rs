//! Тонкий handle к потоку монитора. Хранится в `VideoEngine` и шарится между Tauri-командами.

use std::path::PathBuf;
use std::sync::mpsc;
use std::thread::JoinHandle;

use anyhow::{anyhow, Result};
use winit::event_loop::EventLoopProxy;

use super::app::run_event_loop;

#[derive(Debug, Clone)]
pub enum MonitorCommand {
    Open(PathBuf),
    Play,
    Pause,
    Seek(f64),
    Close,
}

pub struct MonitorHandle {
    proxy: EventLoopProxy<MonitorCommand>,
    _thread: Option<JoinHandle<()>>,
}

impl MonitorHandle {
    pub fn spawn() -> Result<Self> {
        let (tx, rx) = mpsc::channel::<Result<EventLoopProxy<MonitorCommand>, String>>();
        let thread = std::thread::Builder::new()
            .name("fastcat-monitor".into())
            .spawn(move || {
                run_event_loop(tx);
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
}
