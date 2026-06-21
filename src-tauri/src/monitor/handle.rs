//! Тонкий handle к потоку монитора. Хранится в `VideoEngine` и шарится между Tauri-командами.

use std::panic;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::AppHandle;
use winit::event_loop::EventLoopProxy;

use crate::audio::engine::AudioEngineSettings;

use super::app::run_event_loop;
use super::scene::MonitorScene;

/// Режим вывода монитора.
/// - `Embedded` — нативное окно монитора как отдельное platform window.
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

/// Latest-wins слот цели скраба, разделяемый между `MonitorHandle` (писатель) и
/// event-loop'ом (читатель). Каждая `Seek`-команда перезаписывает его перед отправкой
/// события; обработчик в цикле read-and-clear'ит, схлопывая серию скраб-seek'ов в
/// последнюю позицию (см. `MonitorApp::scrub_target`).
pub type ScrubTarget = Arc<Mutex<Option<(f64, bool)>>>;

pub enum MonitorCommand {
    /// Полная замена сцены — фронт шлёт текущий снимок таймлайна.
    SetScene(MonitorScene),
    Play,
    Pause,
    /// Seek по timeline-времени (секунды). `explicit` — это явный пользовательский
    /// скраб (клик/драг плейхеда), который НИКОГДА не должен быть проглочен guard'ом
    /// от эхо-сиков. `false` — программный/возможно-эхо seek (страховочный путь).
    Seek {
        time_sec: f64,
        explicit: bool,
    },
    /// Глобальная скорость транспорта (мультипликатор таймлайн-времени).
    /// >0 — вперёд (1.0 норма), <0 — реверс (аудио глушится).
    SetSpeed(f64),
    /// Превью звука при скрабинге вперёд: одноразовый сниппет
    /// `[from_sec, from_sec + duration_sec)`, играется только когда не идёт
    /// обычное воспроизведение и не двигает транспорт.
    ScrubPreview {
        from_sec: f64,
        duration_sec: f64,
    },
    /// Остановить текущее превью скрабинга (перетаскивание закончилось).
    StopScrubPreview,
    Close,
    /// Обновление настроек нативного аудио-движка.
    SetAudioSettings(crate::audio::engine::AudioEngineSettings),
    /// Post-mix monitor output gain/mute. Applies only to live monitor output.
    SetOutputGain(f64),
    /// Timeline master gain. Updates the live mixer without replacing the scene.
    SetMasterGain(f64),
    /// Обновление настроек FFmpeg/hwaccel для новых видеодекодеров.
    SetHwSettings(crate::FfmpegHardwareSettings),
    /// Фоновый поток загрузил слой — event-loop должен дренировать bg_rx.
    BgReady,
    /// Видеокадр декодирован.
    VideoFrameReady,
    /// Положение/размер offscreen/native-окна монитора в физических пикселях.
    /// Первый вызов с непустым прямоугольником создаёт окно; последующие — двигают/ресайзят.
    SetViewport {
        x: i32,
        y: i32,
        width: u32,
        height: u32,
        visible: bool,
    },
    /// Показать standalone-окно нативного монитора.
    OpenNativeWindow,
    /// Переключение режима вывода (см. `MonitorMode`).
    SetMode(MonitorMode),
    /// Регистрация channel'а для стрима RGBA-кадров в canvas-режиме.
    /// Каждый кадр: 8-байтный header (`u32 LE width`, `u32 LE height`) + RGBA8 пиксели.
    SetFrameChannel(Channel<InvokeResponseBody>),
    /// Сброс channel'а стрима RGBA-кадров (например, при unmount canvas-элемента).
    UnsetFrameChannel,
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
    /// Latest-wins цель скраба (см. `ScrubTarget`). Пишется в `send` перед каждой
    /// `Seek`, читается event-loop'ом.
    scrub_target: ScrubTarget,
}

impl MonitorHandle {
    pub fn spawn(app: AppHandle, audio_settings: AudioEngineSettings) -> Result<Self> {
        let alive = Arc::new(AtomicBool::new(true));
        let alive_clone = alive.clone();
        let scrub_target: ScrubTarget = Arc::new(Mutex::new(None));
        let scrub_target_loop = scrub_target.clone();
        let (tx, rx) = mpsc::channel::<Result<EventLoopProxy<MonitorCommand>, String>>();
        let thread = std::thread::Builder::new()
            .name("fastcat-monitor".into())
            .spawn(move || {
                let result = panic::catch_unwind(panic::AssertUnwindSafe(|| {
                    run_event_loop(app, tx, audio_settings, scrub_target_loop);
                }));
                if let Err(e) = result {
                    if let Some(s) = e.downcast_ref::<&str>() {
                        log::error!("[monitor] thread panicked: {s}");
                    } else if let Some(s) = e.downcast_ref::<String>() {
                        log::error!("[monitor] thread panicked: {s}");
                    } else {
                        log::error!("[monitor] thread panicked with unknown payload");
                    }
                }
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
            scrub_target,
        })
    }

    pub fn send(&self, cmd: MonitorCommand) -> Result<()> {
        if !self.is_alive() {
            return Err(anyhow!("monitor event loop is no longer alive"));
        }
        // Фиксируем последнюю цель скраба ДО отправки события: пока event-loop синхронно
        // рендерит один кадр, более свежие `Seek`'и перезаписывают слот, а устаревшие
        // события находят его пустым и схлопываются в no-op (см. `ScrubTarget`).
        if let MonitorCommand::Seek { time_sec, explicit } = &cmd {
            if let Ok(mut slot) = self.scrub_target.lock() {
                *slot = Some((*time_sec, *explicit));
            }
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
        let close_sent = self.proxy.send_event(MonitorCommand::Close);
        match close_sent {
            Ok(()) => log::info!("[monitor] Drop: Close event sent successfully"),
            Err(_) => log::info!("[monitor] Drop: Close event failed (event loop closed)"),
        }
        if let Some(handle) = self._thread.take() {
            let start = std::time::Instant::now();
            if let Err(e) = handle.join() {
                log::warn!("[monitor] thread panicked on drop: {e:?}");
            }
            log::info!("[monitor] Drop: join took {:?}", start.elapsed());
        }
    }
}
