//! Видео-движок-singleton: владелец нативного `MonitorHandle` + `AppHandle` для эмита событий.
//!
//! Compositor + GPU-ресурсы живут ВНУТРИ потока монитора (см. `monitor::app`) — там, где
//! находятся wgpu device/surface/vello renderer, и где их безопасно мутировать.

use anyhow::Result;
use parking_lot::Mutex;
use std::sync::Arc;
use tauri::AppHandle;

use crate::monitor::MonitorHandle;

pub struct VideoEngine {
    app: AppHandle,
    monitor: Mutex<Option<Arc<MonitorHandle>>>,
}

impl VideoEngine {
    pub fn new(app: AppHandle) -> Self {
        Self { app, monitor: Mutex::new(None) }
    }

    /// Лениво создаёт окно монитора. Если предыдущее окно умерло (юзер закрыл / Close),
    /// автоматически респавнит.
    pub fn ensure_monitor(&self) -> Result<Arc<MonitorHandle>> {
        let mut guard = self.monitor.lock();
        if let Some(existing) = guard.as_ref() {
            if existing.is_alive() {
                return Ok(existing.clone());
            }
            // Стейл — выкидываем, пересоздадим ниже.
            *guard = None;
        }
        let handle = Arc::new(MonitorHandle::spawn(self.app.clone())?);
        *guard = Some(handle.clone());
        Ok(handle)
    }

    /// Возвращает текущий handle, если он есть и жив; иначе None (и чистит протухший).
    pub fn monitor(&self) -> Option<Arc<MonitorHandle>> {
        let mut guard = self.monitor.lock();
        if let Some(h) = guard.as_ref() {
            if h.is_alive() {
                return Some(h.clone());
            }
            *guard = None;
        }
        None
    }

    /// Принудительно сбрасывает handle. Использовать после Close, чтобы следующий
    /// `ensure_monitor` спавнил с нуля даже если event-loop ещё не успел упасть.
    pub fn clear_monitor(&self) {
        *self.monitor.lock() = None;
    }
}
