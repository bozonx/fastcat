//! Video engine singleton: owns the native `MonitorHandle` + `AppHandle` for emitting events.
//!
//! Compositor + GPU resources live INSIDE the monitor thread (see `monitor::app`) — where
//! the wgpu device/surface/vello renderer are, and where they can be safely mutated.

use crate::audio::engine::AudioEngineSettings;
use anyhow::Result;
use parking_lot::Mutex;
use std::sync::Arc;
use tauri::AppHandle;

use crate::monitor::MonitorHandle;

pub struct VideoEngine {
    app: AppHandle,
    monitor: Mutex<Option<Arc<MonitorHandle>>>,
    audio_settings: Mutex<AudioEngineSettings>,
}

impl VideoEngine {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            monitor: Mutex::new(None),
            audio_settings: Mutex::new(AudioEngineSettings::default()),
        }
    }

    /// Stores settings used by the next native monitor/audio stream creation.
    /// Returns true when a live monitor must be recreated to apply them.
    pub fn set_audio_settings(&self, settings: AudioEngineSettings) -> bool {
        let mut guard = self.audio_settings.lock();
        let changed = *guard != settings;
        if changed {
            *guard = settings;
        }
        changed
    }

    /// Lazily creates the monitor window. If the previous window died (user closed / Close),
    /// automatically respawns it.
    pub fn ensure_monitor(&self) -> Result<Arc<MonitorHandle>> {
        let audio_settings = self.audio_settings.lock().clone();
        let mut guard = self.monitor.lock();
        if let Some(existing) = guard.as_ref() {
            if existing.is_alive() {
                log::info!("[engine] reusing alive monitor handle");
                return Ok(existing.clone());
            }
            log::info!("[engine] existing monitor handle is dead, spawning new one");
        } else {
            log::info!("[engine] no existing monitor, spawning new one");
        }
        let handle = Arc::new(MonitorHandle::spawn(self.app.clone(), audio_settings)?);
        *guard = Some(handle.clone());
        Ok(handle)
    }

    /// Returns the current handle if it exists and is alive; otherwise None (and clears the stale one).
    pub fn monitor(&self) -> Option<Arc<MonitorHandle>> {
        let mut guard = self.monitor.lock();
        if let Some(h) = guard.as_ref() {
            if h.is_alive() {
                return Some(h.clone());
            }
            log::info!("[engine] clearing dead monitor handle");
            *guard = None;
        }
        None
    }

    /// Forcefully clears the handle. Use after Close, so the next
    /// `ensure_monitor` spawns from scratch even if the event-loop hasn't died yet.
    pub fn clear_monitor(&self) {
        log::info!("[engine] clear_monitor called");
        *self.monitor.lock() = None;
    }
}
