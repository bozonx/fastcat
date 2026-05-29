//! Видео-движок: владелец Compositor + media pipeline + frame cache + native monitor.
//! Singleton: создаётся при старте Tauri и шарится между командами через `tauri::State`.

use anyhow::Result;
use parking_lot::Mutex;
use std::sync::Arc;

use crate::compositor::Compositor;
use crate::media::frame_cache::FrameCache;
use crate::monitor::MonitorHandle;

pub struct VideoEngine {
    pub compositor: Mutex<Compositor>,
    pub frame_cache: FrameCache,
    monitor: Mutex<Option<Arc<MonitorHandle>>>,
}

impl VideoEngine {
    pub async fn new() -> Result<Self> {
        let compositor = Compositor::new().await?;
        Ok(Self {
            compositor: Mutex::new(compositor),
            frame_cache: FrameCache::new(),
            monitor: Mutex::new(None),
        })
    }

    /// Лениво создаёт окно монитора (winit + wgpu + Vello). Окно живёт в отдельном потоке.
    pub fn ensure_monitor(&self) -> Result<Arc<MonitorHandle>> {
        let mut guard = self.monitor.lock();
        if let Some(existing) = guard.as_ref() {
            return Ok(existing.clone());
        }
        let handle = Arc::new(MonitorHandle::spawn()?);
        *guard = Some(handle.clone());
        Ok(handle)
    }

    pub fn monitor(&self) -> Option<Arc<MonitorHandle>> {
        self.monitor.lock().clone()
    }
}
