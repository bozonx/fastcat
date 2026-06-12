//! winit ApplicationHandler: optional native window + PlaybackClock + LayerRuntimeManager.
//!
//! Architecture:
//!   MonitorApp — winit ApplicationHandler; holds WindowState and deferred data until
//!               the first SetViewport / resumed.
//!   WindowState — thin coordinator: compositor + optional native window + clock + layers.
//!   PlaybackClock  → `clock.rs`
//!   LayerRuntimeManager → `runtime.rs`

use std::sync::mpsc::{self, Receiver, Sender};
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use vello::util::RenderSurface;
use winit::application::ApplicationHandler;
use winit::dpi::{PhysicalPosition, PhysicalSize};
use winit::event::{StartCause, WindowEvent};
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop, EventLoopProxy};
use winit::window::{Window, WindowId};

use crate::audio::engine::{AudioEngineSettings, NativeAudioEngine};
use crate::compositor::{Compositor, PipelinedReadback};

use super::clock::{Clock, PlaybackClock};
use super::handle::{MonitorCommand, MonitorMode};
use super::layer_runtime::{emit_layer_failed, BgLayerResult};
use super::runtime::LayerRuntimeManager;
use super::scene::{MonitorScene, SceneAudioLayer, SceneAudioTrack};
use tauri::ipc::{Channel, InvokeResponseBody};

const DEFAULT_TITLE: &str = "FastCat Monitor";
const EVT_TIME: &str = "monitor:time";
const EVT_ENDED: &str = "monitor:ended";

/// Жёсткий потолок ожидания прогрева. Если декодер не успел (очень тяжёлый источник,
/// ошибка открытия, медленный диск/сеть) — стартуем как есть, чтобы Play никогда не
/// зависал. Реальные сцены проходят проверку раньше: порог готовности для каждого
/// видеослоя рассчитывается динамически в `active_videos_ready` через
/// `expected_preroll_duration()` с учётом лимита памяти на кадры.
const PREBUFFER_TIMEOUT: Duration = Duration::from_millis(3000);
/// Polling cadence while warming up before playback. Video readiness is normally
/// driven by `VideoFrameReady`/`BgReady` events, but audio-only scenes (or audio
/// finishing its prime after video) emit no such event, so we also wake on this
/// interval to re-check both gates and start promptly instead of at the timeout.
const PREBUFFER_POLL_INTERVAL: Duration = Duration::from_millis(10);

/// Заказ положения offscreen/native-окна монитора в физических пикселях.
#[derive(Debug, Clone, Copy)]
struct ViewportSpec {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    visible: bool,
}

// ---------------------------------------------------------------------------
// Event loop
// ---------------------------------------------------------------------------

pub fn run_event_loop(
    app: AppHandle,
    proxy_tx: Sender<Result<EventLoopProxy<MonitorCommand>, String>>,
    audio_settings: AudioEngineSettings,
) {
    log::info!("[monitor] run_event_loop starting");
    let event_loop = match build_event_loop() {
        Ok(el) => el,
        Err(e) => {
            let _ = proxy_tx.send(Err(e.to_string()));
            return;
        }
    };
    let proxy = event_loop.create_proxy();
    if proxy_tx.send(Ok(proxy.clone())).is_err() {
        return;
    }

    let (bg_tx, bg_rx) = mpsc::channel::<BgLayerResult>();
    let mut app_handler = MonitorApp::new(app, proxy, bg_tx, bg_rx, audio_settings);
    event_loop.set_control_flow(ControlFlow::Wait);
    if let Err(e) = event_loop.run_app(&mut app_handler) {
        log::error!("[monitor] event loop terminated: {e:?}");
    }
    log::info!("[monitor] run_event_loop exiting");
}

fn build_event_loop() -> Result<EventLoop<MonitorCommand>> {
    log::info!("[monitor] building EventLoop...");
    let mut builder = EventLoop::<MonitorCommand>::with_user_event();

    #[cfg(target_os = "linux")]
    {
        use winit::platform::wayland::EventLoopBuilderExtWayland;
        use winit::platform::x11::EventLoopBuilderExtX11;
        EventLoopBuilderExtWayland::with_any_thread(&mut builder, true);
        EventLoopBuilderExtX11::with_any_thread(&mut builder, true);
        // Монитор крутит winit-event-loop в отдельном потоке (см. MonitorHandle::spawn),
        // а не в главном. Wayland-backend winit в этом контексте не инициализируется и
        // `build()` падает с "EventLoop::build failed" — а раз WAYLAND_DISPLAY выставлен,
        // winit выбирает Wayland и НЕ откатывается на X11 сам. Форсируем X11: на Wayland-
        // сессии это XWayland, который надёжно поднимается из потока. GTK/Tauri-оболочка
        // при этом остаётся на нативном Wayland (GDK_BACKEND не трогаем) — монитор по
        // умолчанию offscreen (Canvas), а standalone-окно как XWayland пользователю
        // неотличимо от нативного.
        EventLoopBuilderExtX11::with_x11(&mut builder);
    }
    #[cfg(target_os = "windows")]
    {
        use winit::platform::windows::EventLoopBuilderExtWindows;
        builder.with_any_thread(true);
    }

    let result = builder.build().context("winit EventLoop::build failed");
    match &result {
        Ok(_) => log::info!("[monitor] EventLoop built successfully"),
        Err(e) => log::error!("[monitor] EventLoop build failed: {e:?}"),
    }
    result
}

// ---------------------------------------------------------------------------
// MonitorApp (ApplicationHandler)
// ---------------------------------------------------------------------------

struct MonitorApp {
    app: AppHandle,
    proxy: EventLoopProxy<MonitorCommand>,
    bg_tx: Sender<BgLayerResult>,
    bg_rx: Receiver<BgLayerResult>,
    state: Option<WindowState>,
    /// Сцена, пришедшая до первого SetViewport.
    pending_scene: Option<MonitorScene>,
    /// Последний viewport. Если окна ещё нет — создадим по нему в resumed/SetViewport.
    pending_viewport: Option<ViewportSpec>,
    /// Команды canvas-режима могут прийти раньше первого SetViewport, когда WindowState
    /// ещё не создан. Храним их, чтобы первичная canvas-подписка не терялась.
    pending_mode: MonitorMode,
    pending_frame_channel: Option<Channel<InvokeResponseBody>>,
    pending_canvas_size: Option<(u32, u32)>,
    /// True после первого вызова `resumed` — до него create_window падает.
    resumed: bool,
    audio_settings: AudioEngineSettings,
    next_redraw_at: Option<Instant>,
}

impl MonitorApp {
    fn new(
        app: AppHandle,
        proxy: EventLoopProxy<MonitorCommand>,
        bg_tx: Sender<BgLayerResult>,
        bg_rx: Receiver<BgLayerResult>,
        audio_settings: AudioEngineSettings,
    ) -> Self {
        Self {
            app,
            proxy,
            bg_tx,
            bg_rx,
            state: None,
            pending_scene: None,
            pending_viewport: None,
            pending_mode: MonitorMode::Canvas,
            pending_frame_channel: None,
            pending_canvas_size: None,
            resumed: false,
            audio_settings,
            next_redraw_at: None,
        }
    }

    /// Опрашивает прогрев декодеров. Если воспроизведение только что стартовало —
    /// взводит сетку пейсинга и перерисовывает. Вызывается из источников, которые
    /// двигают прогрев: декодированные кадры, открытие декодера, таймаут.
    fn drive_prebuffer(&mut self) {
        let started = match self.state.as_mut() {
            Some(s) => s.poll_prebuffer(),
            None => return,
        };
        if started {
            self.next_redraw_at = Some(Instant::now());
            if let Some(s) = self.state.as_mut() {
                s.render_current_frame();
            }
        }
    }

    fn is_prebuffering(&self) -> bool {
        self.state
            .as_ref()
            .map(|s| s.pending_play_deadline.is_some())
            .unwrap_or(false)
    }

    fn try_create_state(&mut self) {
        if self.state.is_some() || !self.resumed {
            return;
        }
        let Some(vp) = self.pending_viewport else {
            return;
        };
        match init_state(
            self.app.clone(),
            self.proxy.clone(),
            self.bg_tx.clone(),
            vp,
            self.audio_settings.clone(),
        ) {
            Ok(state) => {
                self.state = Some(state);
                if let Some(s) = self.state.as_mut() {
                    if let Some(channel) = self.pending_frame_channel.take() {
                        s.frame_channel = Some(channel);
                    }
                    if let Some((width, height)) = self.pending_canvas_size.take() {
                        s.canvas_size = (width.max(1), height.max(1));
                    }
                    s.set_mode(self.pending_mode);
                    if self.pending_mode == MonitorMode::Canvas {
                        s.render_current_frame();
                    }
                }
                if let Some(scene) = self.pending_scene.take() {
                    if let Some(s) = self.state.as_mut() {
                        s.apply_scene(scene);
                    }
                }
            }
            Err(e) => log::error!("[monitor] init failed: {e:?}"),
        }
    }
}

impl ApplicationHandler<MonitorCommand> for MonitorApp {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        self.resumed = true;
        let _ = event_loop;
        self.try_create_state();
    }

    fn new_events(&mut self, _event_loop: &ActiveEventLoop, cause: StartCause) {
        // Кадр воспроизведения отрисовываем строго когда истёк WaitUntil-дедлайн,
        // выставленный в about_to_wait — это и есть пейсинг по preview_fps.
        //
        // ИНВАРИАНТ ПЕЙСИНГА МОНИТОРА (история: монитор тормозил до ~10fps на 4K/XWayland,
        // см. memory monitor-playback-seek-thrash). Три связанных правила, ломать порознь нельзя:
        //   1) рендерим ЗДЕСЬ, напрямую, а не через `request_redraw` (та под XWayland добавляет
        //      ~65мс латентности доставки RedrawRequested);
        //   2) дедлайн следующего кадра двигаем ТОЛЬКО здесь, после рендера;
        //   3) `about_to_wait` дедлайн НЕ пересчитывает, лишь пере-взводит сохранённый —
        //      иначе посторонние пробуждения (WaitCancelled) сдвигают сетку и роняют fps вдвое.
        if matches!(cause, StartCause::ResumeTimeReached { .. }) {
            // Таймаут прогрева перед стартом: дедлайн истёк — стартуем воспроизведение,
            // даже если декодер не успел декодировать кадры впереди (фоллбэк от зависания).
            if self.is_prebuffering() {
                self.drive_prebuffer();
            }
            let is_playing = self
                .state
                .as_ref()
                .map(|s| s.clock.is_playing())
                .unwrap_or(false);
            if is_playing {
                // Рендерим НАПРЯМУЮ по таймеру пейсинга. Путь `request_redraw` →
                // `RedrawRequested` под X11/XWayland добавляет ~65мс латентности на доставку
                // (замерено), упирая монитор в ~10fps. Таймер уже пейсит (см. about_to_wait),
                // поэтому busy-loop не возникает.
                let frame_duration = self
                    .state
                    .as_ref()
                    .map(|s| Duration::from_secs_f64(1.0 / s.layers.preview_fps.max(1.0)))
                    .unwrap_or_else(|| Duration::from_millis(33));
                if let Some(s) = self.state.as_mut() {
                    s.tick_and_render();
                }
                // Дедлайн следующего кадра продвигаем ТОЛЬКО после реального рендера. Иначе
                // посторонние пробуждения (WaitCancelled от IPC фронта, приходящие прямо у
                // дедлайна) заставляли `about_to_wait` перескакивать сетку на +кадр и ронять
                // каждый второй кадр (fps вдвое). about_to_wait теперь лишь пере-взводит это.
                let base = self.next_redraw_at.unwrap_or_else(Instant::now);
                self.next_redraw_at = Some(next_redraw_deadline(
                    Some(base),
                    Instant::now(),
                    frame_duration,
                ));
            }
        }
    }

    fn user_event(&mut self, event_loop: &ActiveEventLoop, cmd: MonitorCommand) {
        match cmd {
            MonitorCommand::SetScene(scene) => {
                if let Some(s) = self.state.as_mut() {
                    s.apply_scene(scene);
                } else {
                    self.pending_scene = Some(scene);
                    self.try_create_state();
                }
            }
            MonitorCommand::Play => {
                if let Some(s) = self.state.as_mut() {
                    s.play();
                    // Если старт мгновенный (нет видео для прогрева) — взводим сетку пейсинга.
                    // Иначе прогрев двигают VideoFrameReady/таймаут (см. drive_prebuffer),
                    // а about_to_wait спит до дедлайна прогрева.
                    if s.clock.is_playing() {
                        self.next_redraw_at = Some(Instant::now());
                    }
                    s.render_current_frame();
                }
            }
            MonitorCommand::Pause => {
                if let Some(s) = self.state.as_mut() {
                    s.pause();
                    // Рендерим точный стоп-кадр синхронно: во время воспроизведения
                    // canvas-стрим идёт через pipelined readback (1 кадр латентности),
                    // поэтому последний показанный кадр на 1 позади точки паузы. Этот
                    // синхронный рендер (путь !is_playing) ставит ровно кадр playhead'а.
                    s.render_current_frame();
                }
                self.next_redraw_at = None;
            }
            MonitorCommand::Seek { time_sec, explicit } => {
                if let Some(s) = self.state.as_mut() {
                    s.seek(time_sec, explicit);
                    s.render_current_frame();
                }
            }
            MonitorCommand::SetSpeed(speed) => {
                if let Some(s) = self.state.as_mut() {
                    let playing = s.clock.is_playing();
                    s.set_speed(speed);
                    // Реверс/изменение скорости должны немедленно тикать клок — пере-взводим
                    // дедлайн, иначе при ранее остановленном таймере кадр не обновится.
                    if playing {
                        self.next_redraw_at = Some(Instant::now());
                    }
                    s.render_current_frame();
                }
            }
            MonitorCommand::ScrubPreview {
                from_sec,
                duration_sec,
            } => {
                if let Some(audio) = self.state.as_ref().and_then(|s| s.audio.as_ref()) {
                    audio.scrub_preview(from_sec, duration_sec);
                }
            }
            MonitorCommand::StopScrubPreview => {
                if let Some(audio) = self.state.as_ref().and_then(|s| s.audio.as_ref()) {
                    audio.stop_scrub_preview();
                }
            }
            MonitorCommand::SetAudioSettings(settings) => {
                self.audio_settings = settings.clone();
                if let Some(s) = self.state.as_mut() {
                    s.recreate_audio(settings);
                }
            }
            MonitorCommand::SetHwSettings(settings) => {
                if let Some(s) = self.state.as_mut() {
                    s.update_hw_settings(settings);
                    s.render_current_frame();
                }
            }
            MonitorCommand::Close => {
                log::info!("[monitor] received Close command, exiting event loop");
                event_loop.exit();
            }
            MonitorCommand::BgReady => {
                while let Ok(result) = self.bg_rx.try_recv() {
                    if let Some(s) = self.state.as_mut() {
                        s.layers.apply_bg_result(result);
                    }
                }
                // Декодер мог только что открыться во время прогрева — двигаем его.
                if self.is_prebuffering() {
                    self.drive_prebuffer();
                } else if let Some(s) = self.state.as_mut() {
                    if s.clock.is_playing() {
                        s.render_current_frame();
                    } else {
                        s.refresh_paused_display();
                    }
                }
            }
            MonitorCommand::VideoFrameReady => {
                // Прогрев перед стартом: каждый декодированный кадр — повод проверить,
                // не накопили ли мы достаточно впереди playhead'а, чтобы стартовать.
                if self.is_prebuffering() {
                    self.drive_prebuffer();
                } else if let Some(s) = self.state.as_mut() {
                    // Во время play кадры забираются на следующем тике, отмеренном таймером
                    // (см. about_to_wait/new_events) — лишний redraw тут только раскручивал бы
                    // цикл. Нужен он лишь на паузе/скрабе, чтобы показать догнавший кадр.
                    if !s.clock.is_playing() {
                        s.refresh_paused_display();
                    }
                }
            }
            MonitorCommand::SetViewport {
                x,
                y,
                width,
                height,
                visible,
            } => {
                let vp = ViewportSpec {
                    x,
                    y,
                    width: width.max(1),
                    height: height.max(1),
                    visible,
                };
                self.pending_viewport = Some(vp);
                if let Some(s) = self.state.as_mut() {
                    s.apply_viewport(vp);
                } else {
                    self.try_create_state();
                }
            }
            MonitorCommand::OpenNativeWindow => {
                log::info!("[monitor] open native window requested");
                if self.pending_viewport.is_none() {
                    self.pending_viewport = Some(default_native_window_viewport());
                }
                if let Some(s) = self.state.as_mut() {
                    if let Err(error) = s.open_native_window(event_loop) {
                        log::error!("[monitor] open native window failed: {error:?}");
                    }
                    s.render_current_frame();
                } else {
                    self.try_create_state();
                    if let Some(s) = self.state.as_mut() {
                        if let Err(error) = s.open_native_window(event_loop) {
                            log::error!("[monitor] open native window failed: {error:?}");
                        }
                        s.render_current_frame();
                    }
                }
            }
            MonitorCommand::SetMode(mode) => {
                self.pending_mode = mode;
                if let Some(s) = self.state.as_mut() {
                    s.set_mode(mode);
                    s.render_current_frame();
                }
            }
            MonitorCommand::SetFrameChannel(ch) => {
                if let Some(s) = self.state.as_mut() {
                    s.frame_channel = Some(ch);
                    s.render_current_frame();
                } else {
                    self.pending_frame_channel = Some(ch);
                    self.try_create_state();
                }
            }
            MonitorCommand::SetCanvasSize { width, height } => {
                let size = (width.max(1), height.max(1));
                self.pending_canvas_size = Some(size);
                if let Some(s) = self.state.as_mut() {
                    s.canvas_size = size;
                    if s.mode == MonitorMode::Canvas {
                        s.render_current_frame();
                    }
                }
            }
        }
    }

    fn window_event(
        &mut self,
        _event_loop: &ActiveEventLoop,
        window_id: WindowId,
        event: WindowEvent,
    ) {
        let Some(state) = self.state.as_mut() else {
            return;
        };
        if state.is_native_window(window_id) {
            match event {
                WindowEvent::CloseRequested => {
                    log::info!("[monitor] native window close requested");
                    state.close_native_window();
                }
                WindowEvent::Resized(size) => {
                    state.resize_native_window(size.width.max(1), size.height.max(1));
                    state.render_current_frame();
                }
                WindowEvent::RedrawRequested => {
                    state.render_current_frame();
                }
                _ => {}
            }
            return;
        }
        let _ = event;
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        let Some(state) = self.state.as_ref() else {
            return;
        };
        if !state.clock.is_playing() {
            self.next_redraw_at = None;
            match state.pending_play_deadline {
                // Прогрев перед стартом: периодически опрашиваем готовность видео И аудио
                // (см. PREBUFFER_POLL_INTERVAL) — аудио-only сцены не шлют VideoFrameReady,
                // иначе старт ждал бы полного таймаута. Не позже самого дедлайна прогрева.
                Some(deadline) => {
                    let poll_at = (Instant::now() + PREBUFFER_POLL_INTERVAL).min(deadline);
                    event_loop.set_control_flow(ControlFlow::WaitUntil(poll_at));
                }
                None => event_loop.set_control_flow(ControlFlow::Wait),
            }
            return;
        }
        // ИНВАРИАНТ ПЕЙСИНГА (парно с new_events, см. там): дедлайн продвигается ТОЛЬКО
        // после рендера (в new_events). Здесь мы лишь (пере-)взводим уже сохранённый дедлайн —
        // пересчёт на каждом пробуждении позволял бы посторонним событиям (WaitCancelled)
        // сдвигать сетку и ронять fps вдвое. Рендер происходит в new_events(ResumeTimeReached),
        // а не тут, иначе redraw диспатчился бы сразу (busy-loop, 100% GPU).
        let deadline = match self.next_redraw_at {
            Some(d) => d,
            None => {
                let frame_duration =
                    Duration::from_secs_f64(1.0 / state.layers.preview_fps.max(1.0));
                let d = Instant::now() + frame_duration;
                self.next_redraw_at = Some(d);
                d
            }
        };
        event_loop.set_control_flow(ControlFlow::WaitUntil(deadline));
    }
}

/// Отправляет RGBA-кадр фронту через canvas-канал: 8-байтный заголовок
/// (`u32 LE width`, `u32 LE height`) + плотные RGBA8-пиксели.
fn send_canvas_frame(
    channel: &Channel<InvokeResponseBody>,
    width: u32,
    height: u32,
    pixels: Vec<u8>,
) {
    let mut payload = Vec::with_capacity(8 + pixels.len());
    payload.extend_from_slice(&width.to_le_bytes());
    payload.extend_from_slice(&height.to_le_bytes());
    payload.extend_from_slice(&pixels);
    if let Err(e) = channel.send(InvokeResponseBody::Raw(payload)) {
        log::warn!("[monitor] frame channel send: {e:?}");
    }
}

fn next_redraw_deadline(
    previous_deadline: Option<Instant>,
    now: Instant,
    frame_duration: Duration,
) -> Instant {
    let mut deadline = previous_deadline.unwrap_or(now);
    loop {
        deadline += frame_duration;
        if deadline > now {
            return deadline;
        }
    }
}

// ---------------------------------------------------------------------------
// WindowState
// ---------------------------------------------------------------------------

struct NativeWindowState {
    window: Arc<Window>,
    surface: RenderSurface<'static>,
}

struct WindowState {
    app: AppHandle,
    compositor: Compositor,

    clock: Box<dyn Clock>,
    layers: LayerRuntimeManager,
    audio: Option<NativeAudioEngine>,
    audio_layers: Vec<SceneAudioLayer>,
    audio_tracks: Vec<SceneAudioTrack>,
    audio_master_gain: f64,

    last_emit_pts: f64,
    last_viewport: ViewportSpec,
    mode: MonitorMode,
    /// Канал для стрима RGBA-кадров фронту (только в режиме Canvas).
    frame_channel: Option<Channel<InvokeResponseBody>>,
    /// Размер render target'а в canvas-режиме (физические пиксели).
    canvas_size: (u32, u32),
    /// dev_id wgpu для offscreen-рендера; берём из существующего surface'а.
    offscreen_dev_id: usize,
    /// Pipelined (async-map) readback для canvas-стрима во время воспроизведения.
    /// Снимает блокирующий `device.poll(wait_indefinitely)` с event-loop'а ценой
    /// одного кадра латентности. На паузе/скрабе НЕ используется (там нужен
    /// гарантированный кадр синхронно), и сбрасывается в `None`, освобождая GPU-буферы.
    canvas_readback: Option<PipelinedReadback>,
    /// Дедлайн прогрева декодеров перед стартом часов. `Some` — Play запрошен, но
    /// воспроизведение ещё не началось (ждём кадры впереди playhead'а или таймаут).
    /// `None` — либо играем, либо стоим на паузе.
    pending_play_deadline: Option<Instant>,
    native_window: Option<NativeWindowState>,
}

impl WindowState {
    fn apply_scene(&mut self, scene: MonitorScene) {
        let master_gain = if scene.audio_master_muted {
            0.0
        } else {
            scene.audio_master_gain
        };
        self.audio_layers.clone_from(&scene.audio_layers);
        self.audio_tracks.clone_from(&scene.audio_tracks);
        self.audio_master_gain = master_gain;

        if let Some(audio) = self.audio.as_ref() {
            audio.set_scene(&scene.audio_layers, &scene.audio_tracks, master_gain);
        }
        self.layers.apply_scene(scene);
        // На паузе сразу спавним/позиционируем декодеры активных видеослоёв на playhead,
        // иначе они не создавались бы до первого Play (декодеры спавнятся только здесь и в
        // tick): монитор был бы чёрным на загрузке, а первый Play стартовал бы в пустоту.
        // Во время воспроизведения tick сам поднимает рантаймы — повторный прогрев не нужен.
        if !self.clock.is_playing() {
            self.refresh_paused_display();
        } else {
            self.render_current_frame();
        }
    }

    fn recreate_audio(&mut self, settings: AudioEngineSettings) {
        let playing = self.clock.is_playing();
        let pts = self.clock.current_pts();
        self.audio = match NativeAudioEngine::new(&settings) {
            Ok(audio) => {
                audio.set_scene(
                    &self.audio_layers,
                    &self.audio_tracks,
                    self.audio_master_gain,
                );
                if playing {
                    audio.play(pts);
                } else {
                    // Reseat the freshly-created engine at the current position. Paused
                    // (playing=false) seeks bypass the echo guard regardless, so the
                    // explicit flag is immaterial here; pass true for clarity.
                    audio.seek(pts, false, true);
                }
                Some(audio)
            }
            Err(error) => {
                log::warn!("[audio] disabled after settings update: {error:?}");
                None
            }
        };
    }

    fn update_hw_settings(&mut self, settings: crate::FfmpegHardwareSettings) {
        let t = self.clock.current_pts();
        let playing = self.clock.is_playing();
        if self.layers.update_hw_settings(settings) {
            if playing {
                // Во время воспроизведения декодеры пересоздаст ближайший `tick`
                // (он зовёт `ensure_runtime_for`), здесь только перепозиционируем.
                self.layers.seek(t, playing);
            } else {
                // На паузе `tick` не идёт, а `layers.seek` НЕ создаёт рантаймы — после
                // дропа видеодекодеров (смена hwaccel сбрасывает их) сцена осталась бы
                // без декодеров и монитор чёрным до следующего Play/скраба. Идём через
                // refresh_paused_display: он гарантированно спавнит декодеры на playhead.
                self.refresh_paused_display();
            }
        }
    }

    fn set_mode(&mut self, mode: MonitorMode) {
        self.mode = mode;
    }

    fn apply_viewport(&mut self, vp: ViewportSpec) {
        let prev = self.last_viewport;
        log::info!(
            "[monitor] apply_viewport pos=({},{}) size={}x{} visible={}",
            vp.x,
            vp.y,
            vp.width,
            vp.height,
            vp.visible
        );
        self.last_viewport = vp;
        let _ = prev;
    }

    fn is_native_window(&self, window_id: WindowId) -> bool {
        self.native_window
            .as_ref()
            .is_some_and(|native| native.window.id() == window_id)
    }

    fn open_native_window(&mut self, event_loop: &ActiveEventLoop) -> Result<()> {
        if let Some(native) = self.native_window.as_ref() {
            native.window.set_visible(true);
            native.window.focus_window();
            return Ok(());
        }

        let window = Arc::new(
            event_loop
                .create_window(
                    Window::default_attributes()
                        .with_title(DEFAULT_TITLE)
                        .with_decorations(true)
                        .with_resizable(true)
                        // Создаём окно скрытым: показываем его только после первого рендера
                        // в surface (ниже). Иначе WM мапит окно до того, как в swapchain
                        // попал первый кадр, и оно вспыхивает чёрным на 1–2 кадра в начале.
                        .with_visible(false)
                        .with_inner_size(PhysicalSize::new(1280, 720))
                        .with_position(PhysicalPosition::new(80, 80)),
                )
                .context("create native monitor window failed")?,
        );
        let size = window.inner_size();
        let surface = pollster::block_on(self.compositor.create_window_surface(
            window.clone(),
            size.width.max(1),
            size.height.max(1),
        ))?;
        self.native_window = Some(NativeWindowState { window, surface });
        // Первый кадр рисуем в surface ДО показа окна — тогда оно появляется уже с
        // картинкой, без чёрной вспышки.
        self.render_current_frame();
        if let Some(native) = self.native_window.as_ref() {
            native.window.set_visible(true);
            native.window.focus_window();
        }
        Ok(())
    }

    fn close_native_window(&mut self) {
        self.native_window = None;
    }

    fn resize_native_window(&mut self, width: u32, height: u32) {
        if let Some(native) = self.native_window.as_mut() {
            self.compositor
                .resize_surface(&mut native.surface, width, height);
        }
    }

    fn render_current_frame(&mut self) {
        let t = self.clock.current_pts();
        self.render(t);
    }

    /// На паузе: подтягивает догнавшие playhead кадры в `current` и перерисовывает.
    /// Без этого кадр, декодированный уже после seek/открытия декодера, оставался бы в
    /// кеше непоказанным, а монитор — чёрным до первого Play.
    fn refresh_paused_display(&mut self) {
        let t = self.clock.current_pts();
        let dev_id = self.offscreen_dev_id;
        let device = self.compositor.device(dev_id);
        let queue = self.compositor.queue(dev_id);
        self.layers.refresh_display(t, device, queue);
        self.render(t);
    }

    /// Запрашивает воспроизведение. Для сцен с видео сначала прогревает декодеры до
    /// playhead'а (prebuffer), а часы/аудио стартуют позже в `begin_playback`, когда
    /// кадры уже декодированы вперёд — иначе 4К фризит на старте, пока декодится GOP.
    /// Для сцен без активного видео (только аудио/картинки) старт мгновенный.
    fn play(&mut self) {
        if self.clock.is_playing() || self.pending_play_deadline.is_some() {
            return;
        }
        let has_audio = self.audio.as_ref().is_some_and(|a| !a.is_empty());
        if self.layers.is_empty() && !has_audio {
            return;
        }
        let t = self.clock.current_pts();
        log::info!(
            "[monitor] play requested at pts={t:.3}s has_audio={has_audio} has_video={}",
            self.layers.has_active_video(t)
        );
        // Заводим декодеры: говорим им играть и перепозиционируем на playhead, чтобы
        // forward-стрим был корректным после скраба по кешу. Часы при этом ещё стоят.
        self.layers.set_playing(true);
        self.layers.resync_active_videos(t);

        // Прогреваем аудио параллельно видео: продюсер наполняет кольцо до полного
        // префетча, но вывод держится беззвучным (hold_output) до `begin_playback`.
        // Так первый Play после холодной загрузки стартует с полным буфером, а не с
        // мгновенным underrun (треск + ускоренный звук).
        if has_audio {
            if let Some(audio) = self.audio.as_ref() {
                audio.start_priming(t.max(0.0));
            }
        }

        // Нечего прогревать (нет ни активного видео, ни аудио) — стартуем сразу.
        if !self.layers.has_active_video(t) && !has_audio {
            self.begin_playback();
            return;
        }
        self.pending_play_deadline = Some(Instant::now() + PREBUFFER_TIMEOUT);
    }

    /// Фактический старт воспроизведения: запускает мастер-часы и аудио от текущего
    /// playhead'а. Декодеры уже играют и спозиционированы (см. `play`).
    fn begin_playback(&mut self) {
        let pts = self.clock.current_pts();
        log::info!("[monitor] begin_playback at pts={pts:.3}s");
        self.pending_play_deadline = None;
        // Start wall-clock first so the audio output and video layers share the
        // exact same origin. Reversing the order lets audio buffer ahead of the
        // visual timeline, making the waveform lag behind the voice.
        self.clock.play();
        if let Some(audio) = self.audio.as_ref() {
            // The ring was primed during the warmup window (see `play`): just lift
            // the hold gate so it becomes audible from a full buffer. If priming
            // never ran (no audio scene) this is a harmless no-op.
            audio.release_output();
        }
    }

    /// Опрашивает прогрев. Возвращает `true`, если воспроизведение только что стартовало
    /// (часы пошли) — вызывающий код должен взвести сетку пейсинга и перерисовать.
    /// Стартует по готовности кадров впереди playhead'а либо по таймауту.
    fn poll_prebuffer(&mut self) -> bool {
        let Some(deadline) = self.pending_play_deadline else {
            return false;
        };
        let t = self.clock.current_pts();
        let video_ready = self.layers.active_videos_ready(t);
        // Audio warmup runs in parallel: don't start the master clock until the ring
        // is primed too, otherwise the cold producer underruns on the first chunks
        // (crackle + resync skip = sped-up audio). `is_primed` is true when there is
        // nothing to prime (no/empty audio, reverse speed).
        let audio_ready = self.audio.as_ref().is_none_or(NativeAudioEngine::is_primed);
        let ready = video_ready && audio_ready;
        log::trace!(
            "[monitor] poll_prebuffer: video_ready={video_ready} audio_ready={audio_ready} \
             ready={ready} deadline_in={:?}",
            deadline.saturating_duration_since(Instant::now()),
        );
        if ready || Instant::now() >= deadline {
            if !ready {
                log::warn!(
                    "[monitor] prebuffer timed out after {:.1}s — starting playback with \
                     video_ready={video_ready} audio_ready={audio_ready}",
                    PREBUFFER_TIMEOUT.as_secs_f64()
                );
            } else {
                log::info!(
                    "[monitor] prebuffer complete — starting playback \
                     (video_ready={video_ready} audio_ready={audio_ready})"
                );
            }
            self.begin_playback();
            true
        } else {
            // Ещё греемся. Стоп-кадр playhead'а уже на экране: его отрисовал
            // синхронный путь при входе в Play/Seek (render_current_frame), а во время
            // прогрева `current` не меняется (poll лишь тянет кадры в кеш, не двигая
            // отображаемый кадр). Поэтому НЕ перерисовываем здесь — иначе на каждом
            // poll (каждые ~10мс + на каждый VideoFrameReady) шёл бы полный композит с
            // блокирующим GPU-readback одного и того же кадра, отбирая ресурсы у
            // декодера ровно в момент прогрева (особенно больно на 4K).
            false
        }
    }

    /// Глобальная скорость транспорта. Переанкоривает мастер-клок и аудио-движок на
    /// текущую позицию, чтобы переключение было бесшовным. Реверс (<0) и не-1× аудио
    /// обрабатываются ниже по тракту (клок/producer).
    fn set_speed(&mut self, speed: f64) {
        self.clock.set_speed(speed);
        // The clock is the authoritative timeline position and stays correct even
        // across reverse spans (where audio is silent), so anchor audio to it.
        let anchor = self.clock.current_pts().max(0.0);
        if let Some(audio) = self.audio.as_ref() {
            audio.set_speed(speed, anchor);
        }
    }

    fn pause(&mut self) {
        // Прогрев прерван запросом паузы — отменяем отложенный старт.
        self.pending_play_deadline = None;
        // На реверсе/не-аудибельной скорости аудио молчит и мастер-клок — это сам
        // PlaybackClock, поэтому замораживаем его позицию. На обычном forward-аудио
        // источник истины — звуковой ринг, поэтому подтягиваемся к audible-позиции.
        let reverse = self.clock.speed() < 0.0;
        if let Some(audio) = self.audio.as_ref() {
            let audio_pts = audio.pause();
            // Stop the clock first, then sync its paused position to audio.
            // Using seek() alone leaves wall_origin set, so the clock keeps
            // ticking and the event loop never stops emitting monitor:time.
            self.clock.pause();
            if !reverse {
                self.clock.seek(audio_pts);
            }
        } else {
            self.clock.pause();
        }
        self.layers.set_playing(false);
    }

    fn seek(&mut self, timeline_sec: f64, explicit: bool) {
        let had_pending = self.pending_play_deadline.is_some();
        // Seek во время прогрева отменяет отложенный старт: позиция сменилась, пользователь
        // повторит Play от новой точки. Иначе стартовали бы от устаревшего playhead'а.
        if had_pending {
            self.pending_play_deadline = None;
            self.layers.set_playing(false);
        }
        let t = timeline_sec.max(0.0);
        log::trace!(
            "[monitor] seek to {t:.3}s, explicit={explicit}, playing={}",
            self.clock.is_playing()
        );
        self.clock.seek(t);
        let playing = self.clock.is_playing();
        if let Some(audio) = self.audio.as_ref() {
            audio.seek(t, playing, explicit);
        }
        self.layers.seek(t, playing);

        // After a real user seek during playback the audio ring was flushed and the
        // callback stopped. If we let the clock keep running, video races ahead while
        // the producer refills the ring. When the callback restarts (after only
        // START_PREBUFFER_CHUNKS chunks) the ring can underrun under decoder-seek load
        // → crackle + sped-up resync. So we do a micro-prime: freeze the video clock,
        // refill the ring, and restart both together once audio is fully primed.
        if playing && explicit {
            if let Some(audio) = self.audio.as_ref() {
                if !audio.is_empty() {
                    log::info!("[monitor] micro-priming audio after explicit seek to {t:.3}s");
                    self.clock.pause();
                    audio.start_priming(t);
                    self.layers.set_playing(true);
                    self.layers.resync_active_videos(t);
                    self.pending_play_deadline = Some(Instant::now() + PREBUFFER_TIMEOUT);
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Главный тик
    // -----------------------------------------------------------------------

    fn tick_and_render(&mut self) {
        // ИНВАРИАНТ ИСТОЧНИКА ВРЕМЕНИ: для выбора кадра берём СГЛАЖЕННЫЙ `clock.current_pts()`,
        // НЕ сырой `audio_pts`. `current_pts` (audible position) джиттерит на величину аудио-чанка
        // (~50мс), т.к. вычитает мгновенную заполненность ринга — при выводе напрямую кадры
        // скачут назад. `PlaybackClock` идёт по wall-clock и подтягивается к аудио только при
        // значимом дрейфе (см. `sync_to_audio_pts`), поэтому `t` монотонный и плавный.
        if let Some(audio_pts) = self.audio.as_ref().and_then(NativeAudioEngine::current_pts) {
            self.clock.sync_to_audio_pts(audio_pts);
        }
        let t = self.clock.current_pts();

        // Реверс достиг начала таймлайна — останавливаемся на нуле.
        if self.clock.is_playing() && self.clock.speed() < 0.0 && t <= 0.0 {
            self.clock.seek(0.0);
            self.pause();
            let _ = self.app.emit(EVT_ENDED, ());
            self.emit_time(0.0);
            self.render(0.0);
            return;
        }

        // Детектируем конец сцены во время воспроизведения (только forward).
        if self.clock.is_playing() && self.clock.speed() > 0.0 {
            let video_end = self.layers.scene_end();
            let audio_end = self
                .audio
                .as_ref()
                .map(NativeAudioEngine::scene_end)
                .unwrap_or(0.0);
            let scene_end = video_end.max(audio_end);
            if scene_end > 0.0 && t >= scene_end {
                self.pause();
                let _ = self.app.emit(EVT_ENDED, ());
                self.emit_time(scene_end);
                // covers() — полуоткрытый интервал [start; end): при t == scene_end ни один
                // слой не активен и сцена была бы пустой (чёрный кадр). Рендерим на 1 мс
                // раньше конца, чтобы удержать последний кадр клипа.
                let last_frame_t = (scene_end - 0.001).max(0.0);
                self.render(last_frame_t);
                return;
            }
        }

        let dev_id = self.offscreen_dev_id;
        let device = self.compositor.device(dev_id);
        let queue = self.compositor.queue(dev_id);
        self.layers.tick(t, device, queue);
        self.render(t);
        self.emit_time(t);
    }

    fn emit_time(&mut self, t: f64) {
        // Подавляем дубли: на паузе/повторных redraw'ах не шлём тот же PTS дважды.
        if (t - self.last_emit_pts).abs() < 1e-6 {
            return;
        }
        self.last_emit_pts = t;
        let _ = self.app.emit(EVT_TIME, t);
    }

    // -----------------------------------------------------------------------
    // Рендер
    // -----------------------------------------------------------------------

    fn render(&mut self, t: f64) {
        match self.mode {
            MonitorMode::Embedded => {
                if let Some(native) = self.native_window.as_mut() {
                    let width = native.surface.config.width;
                    let height = native.surface.config.height;
                    let scene = self.layers.build_compositor_scene(t);
                    if let Err(e) = self.compositor.render_scene_to_surface(
                        &scene,
                        &mut native.surface,
                        width,
                        height,
                    ) {
                        log::error!("[monitor] compositor render: {e:?}");
                        emit_layer_failed(&self.app, "<surface>", "render", &e.to_string());
                    }
                }
            }
            MonitorMode::Canvas => {
                // Build the compositor snapshot once; both the optional native-window
                // surface and the offscreen canvas readback render the same scene.
                let scene = self.layers.build_compositor_scene(t);
                if let Some(native) = self.native_window.as_mut() {
                    let surface_width = native.surface.config.width;
                    let surface_height = native.surface.config.height;
                    if let Err(e) = self.compositor.render_scene_to_surface(
                        &scene,
                        &mut native.surface,
                        surface_width,
                        surface_height,
                    ) {
                        log::error!("[monitor] compositor render: {e:?}");
                        emit_layer_failed(&self.app, "<surface>", "render", &e.to_string());
                    }
                }
                let Some(channel) = self.frame_channel.clone() else {
                    self.canvas_readback = None;
                    return;
                };
                let (width, height) = self.canvas_size;
                if width == 0 || height == 0 {
                    return;
                }
                let dev_id = self.offscreen_dev_id;

                if self.clock.is_playing() {
                    // Воспроизведение: непрерывный поток кадров — используем pipelined
                    // async-readback, чтобы НЕ блокировать event-loop на `device.poll`
                    // (иначе IPC/аудио/события декодеров ждут весь readback; больно на
                    // высоком preview_fps и тяжёлых сценах). Цена — 1 кадр латентности.
                    let need_new = match &self.canvas_readback {
                        Some(s) => !s.matches(dev_id, width, height),
                        None => true,
                    };
                    if need_new {
                        match self.compositor.begin_pipelined_readback(dev_id, width, height, 2) {
                            Ok(session) => self.canvas_readback = Some(session),
                            Err(e) => {
                                log::error!("[monitor] pipelined readback init: {e:?}");
                                self.canvas_readback = None;
                            }
                        }
                    }
                    if let Some(mut session) = self.canvas_readback.take() {
                        let result = self
                            .compositor
                            .render_scene_to_pixels_pipelined(&mut session, &scene);
                        self.canvas_readback = Some(session);
                        match result {
                            // Самый старый готовый кадр (предыдущий) — отдаём фронту.
                            Ok(Some(pixels)) => send_canvas_frame(&channel, width, height, pixels),
                            // GPU ещё не догнал (первый кадр после старта) — пропускаем,
                            // на экране держится последний синхронный стоп-кадр.
                            Ok(None) => {}
                            Err(e) => {
                                log::error!("[monitor] pipelined offscreen render: {e:?}");
                                emit_layer_failed(
                                    &self.app,
                                    "<offscreen>",
                                    "render",
                                    &e.to_string(),
                                );
                            }
                        }
                    }
                } else {
                    // Пауза/скраб/одиночный кадр: нужен ГАРАНТИРОВАННЫЙ кадр прямо сейчас
                    // (следующего рендера может не быть), поэтому синхронный readback.
                    // Освобождаем pipelined-сессию — её GPU-буферы не нужны на паузе.
                    self.canvas_readback = None;
                    match self
                        .compositor
                        .render_scene_to_pixels(dev_id, &scene, width, height)
                    {
                        Ok(pixels) => send_canvas_frame(&channel, width, height, pixels),
                        Err(e) => {
                            log::error!("[monitor] offscreen render: {e:?}");
                            emit_layer_failed(&self.app, "<offscreen>", "render", &e.to_string());
                        }
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Инициализация окна
// ---------------------------------------------------------------------------

fn init_state(
    app: AppHandle,
    proxy: EventLoopProxy<MonitorCommand>,
    bg_tx: Sender<BgLayerResult>,
    viewport: ViewportSpec,
    audio_settings: AudioEngineSettings,
) -> Result<WindowState> {
    let mut compositor = Compositor::new();
    let offscreen_dev_id = compositor.ensure_offscreen_device()?;
    let audio = match NativeAudioEngine::new(&audio_settings) {
        Ok(engine) => Some(engine),
        Err(error) => {
            log::warn!("[audio] disabled: {error:?}");
            None
        }
    };
    let hw_settings = app
        .state::<parking_lot::RwLock<crate::FfmpegHardwareSettings>>()
        .read()
        .clone();
    Ok(WindowState {
        app: app.clone(),
        compositor,
        clock: Box::new(PlaybackClock::new()),
        layers: LayerRuntimeManager::new(app.clone(), bg_tx, proxy, hw_settings),
        audio,
        audio_layers: Vec::new(),
        audio_tracks: Vec::new(),
        audio_master_gain: 1.0,
        last_emit_pts: -1.0,
        last_viewport: viewport,
        mode: MonitorMode::Canvas,
        frame_channel: None,
        canvas_size: (viewport.width.max(1), viewport.height.max(1)),
        offscreen_dev_id,
        canvas_readback: None,
        pending_play_deadline: None,
        native_window: None,
    })
}

fn default_native_window_viewport() -> ViewportSpec {
    ViewportSpec {
        x: 80,
        y: 80,
        width: 1280,
        height: 720,
        visible: true,
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::next_redraw_deadline;

    #[test]
    fn next_redraw_deadline_starts_one_frame_after_now() {
        let now = Instant::now();
        let frame = Duration::from_millis(33);

        assert_eq!(next_redraw_deadline(None, now, frame), now + frame);
    }

    #[test]
    fn next_redraw_deadline_keeps_previous_pacing_after_render_cost() {
        let start = Instant::now();
        let frame = Duration::from_millis(33);
        let previous = start + frame;
        let now_after_render = previous + Duration::from_millis(8);

        assert_eq!(
            next_redraw_deadline(Some(previous), now_after_render, frame),
            start + frame + frame
        );
    }

    #[test]
    fn next_redraw_deadline_skips_missed_frames_after_long_stall() {
        let start = Instant::now();
        let frame = Duration::from_millis(33);
        let previous = start + frame;
        let stalled_now = previous + Duration::from_millis(90);

        assert_eq!(
            next_redraw_deadline(Some(previous), stalled_now, frame),
            start + frame * 4
        );
    }
}
