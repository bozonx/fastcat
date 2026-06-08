//! Тонкий handle к потоку монитора. Хранится в `VideoEngine` и шарится между Tauri-командами.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread::JoinHandle;

use anyhow::{anyhow, Result};
use raw_window_handle::RawWindowHandle;
use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::AppHandle;
use winit::event_loop::EventLoopProxy;

use crate::audio::engine::AudioEngineSettings;

use super::app::run_event_loop;
use super::scene::MonitorScene;

/// Режим вывода монитора.
/// - `Embedded` — нативное X11 child-окно поверх webview (по умолчанию, без оверлеев).
/// - `Canvas` — offscreen-рендер, стрим RGBA-кадров в HTML `<canvas>` через Tauri Channel.
///   Позволяет ставить SVG/HTML-оверлеи (transform handles, grid, timecode) поверх изображения.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[derive(Default)]
pub enum MonitorMode {
    #[default]
    Embedded,
    Canvas,
}

/// Обёртка над `RawWindowHandle` для безопасной (для нас) передачи между потоками.
/// `RawWindowHandle` содержит сырой указатель/идентификатор окна; он остаётся валидным
/// всё время жизни главного Tauri-окна, которое мы не закрываем досрочно.
#[derive(Debug, Clone, Copy)]
pub struct SendableRawHandle(pub RawWindowHandle);
// SAFETY: SendableRawHandle wraps a RawWindowHandle that is only used while the
// parent Tauri window is alive. The window is never closed early, so the raw
// handle/ID remains valid for the entire lifetime of the monitor thread.
unsafe impl Send for SendableRawHandle {}
// SAFETY: Same reasoning as Send — the raw handle is never mutated and remains
// valid as long as the parent window exists.
unsafe impl Sync for SendableRawHandle {}

pub enum MonitorCommand {
    /// Полная замена сцены — фронт шлёт текущий снимок таймлайна.
    SetScene(MonitorScene),
    Play,
    Pause,
    /// Seek по timeline-времени (секунды).
    Seek(f64),
    /// Превью звука при скрабинге вперёд: одноразовый сниппет
    /// `[from_sec, from_sec + duration_sec)`, играется только когда не идёт
    /// обычное воспроизведение и не двигает транспорт.
    ScrubPreview { from_sec: f64, duration_sec: f64 },
    /// Остановить текущее превью скрабинга (перетаскивание закончилось).
    StopScrubPreview,
    Close,
    /// Обновление настроек нативного аудио-движка.
    SetAudioSettings(crate::audio::engine::AudioEngineSettings),
    /// Обновление настроек FFmpeg/hwaccel для новых видеодекодеров.
    SetHwSettings(crate::FfmpegHardwareSettings),
    /// Фоновый поток загрузил слой — event-loop должен дренировать bg_rx.
    BgReady,
    /// Видеокадр декодирован.
    VideoFrameReady,
    /// Положение/размер встроенного child-окна монитора в координатах родителя
    /// (физические пиксели от left-top клиентской области главного окна).
    /// Первый вызов с непустым прямоугольником создаёт окно; последующие — двигают/ресайзят.
    SetViewport {
        parent: SendableRawHandle,
        x: i32,
        y: i32,
        width: u32,
        height: u32,
        visible: bool,
    },
    /// Переключение режима вывода (см. `MonitorMode`).
    SetMode(MonitorMode),
    /// Регистрация channel'а для стрима RGBA-кадров в canvas-режиме.
    /// Каждый кадр: 8-байтный header (`u32 LE width`, `u32 LE height`) + RGBA8 пиксели.
    SetFrameChannel(Channel<InvokeResponseBody>),
    /// Размер render target'а в canvas-режиме (физические пиксели). Может отличаться от `SetViewport`.
    SetCanvasSize {
        width: u32,
        height: u32,
    },
}

pub struct MonitorHandle {
    proxy: EventLoopProxy<MonitorCommand>,
    _thread: Option<JoinHandle<()>>,
    /// Сбрасывается в false, когда event-loop завершился. Быстрее Ping-round-trip.
    alive: Arc<AtomicBool>,
}

impl MonitorHandle {
    pub fn spawn(app: AppHandle, audio_settings: AudioEngineSettings) -> Result<Self> {
        let alive = Arc::new(AtomicBool::new(true));
        let alive_clone = alive.clone();
        let (tx, rx) = mpsc::channel::<Result<EventLoopProxy<MonitorCommand>, String>>();
        let thread = std::thread::Builder::new()
            .name("fastcat-monitor".into())
            .spawn(move || {
                run_event_loop(app, tx, audio_settings);
                alive_clone.store(false, Ordering::Release);
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
        if !self.is_alive() {
            return Err(anyhow!("monitor event loop is no longer alive"));
        }
        self.proxy
            .send_event(cmd)
            .map_err(|_| anyhow!("monitor event loop is gone"))
    }

    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::Acquire)
    }
}

impl Drop for MonitorHandle {
    fn drop(&mut self) {
        let _ = self.proxy.send_event(MonitorCommand::Close);
        if let Some(handle) = self._thread.take() {
            if handle.is_finished() {
                let _ = handle.join();
            }
            // If the thread is still running, we drop the JoinHandle and
            // let it become detached. The Close command above tells the event
            // loop to exit; the thread will clean itself up.
        }
    }
}
