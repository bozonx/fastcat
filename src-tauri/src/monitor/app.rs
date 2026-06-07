//! ApplicationHandler winit: окно + PlaybackClock + LayerRuntimeManager.
//!
//! Архитектура:
//!   MonitorApp — winit ApplicationHandler; хранит WindowState и отложенные данные до
//!               первого SetViewport / resumed.
//!   WindowState — тонкий coordinator: window, surface, compositor + clock + layers.
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
use crate::compositor::Compositor;

use super::clock::{Clock, PlaybackClock};
use super::handle::{MonitorCommand, MonitorMode, SendableRawHandle};
use super::layer_runtime::{emit_layer_failed, BgLayerResult};
use super::runtime::LayerRuntimeManager;
use super::scene::{MonitorScene, SceneAudioLayer, SceneAudioTrack};
use tauri::ipc::{Channel, InvokeResponseBody};

const DEFAULT_TITLE: &str = "FastCat Monitor";
const EVT_TIME: &str = "monitor:time";
const EVT_ENDED: &str = "monitor:ended";

/// Заказ положения child-окна от фронта (физические пиксели в координатах родителя).
#[derive(Debug, Clone, Copy)]
struct ViewportSpec {
    parent: SendableRawHandle,
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
}

fn build_event_loop() -> Result<EventLoop<MonitorCommand>> {
    let mut builder = EventLoop::<MonitorCommand>::with_user_event();

    #[cfg(target_os = "linux")]
    {
        use winit::platform::wayland::EventLoopBuilderExtWayland;
        use winit::platform::x11::EventLoopBuilderExtX11;
        EventLoopBuilderExtWayland::with_any_thread(&mut builder, true);
        EventLoopBuilderExtX11::with_any_thread(&mut builder, true);
        // Форсируем X11: WINIT_UNIX_BACKEND env var в winit 0.30 не работает.
        // Без этого на Wayland-сессии winit игнорирует X11-родителя и создаёт
        // собственное Wayland-toplevel — встраивание в Tauri-окно ломается.
        EventLoopBuilderExtX11::with_x11(&mut builder);
    }
    #[cfg(target_os = "windows")]
    {
        use winit::platform::windows::EventLoopBuilderExtWindows;
        builder.with_any_thread(true);
    }

    builder.build().context("winit EventLoop::build failed")
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
            pending_mode: MonitorMode::Embedded,
            pending_frame_channel: None,
            pending_canvas_size: None,
            resumed: false,
            audio_settings,
        }
    }

    fn try_create_window(&mut self, event_loop: &ActiveEventLoop) {
        if self.state.is_some() || !self.resumed {
            return;
        }
        let Some(vp) = self.pending_viewport else {
            return;
        };
        match init_window(
            event_loop,
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
                        s.window.request_redraw();
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
        self.try_create_window(event_loop);
    }

    fn new_events(&mut self, _event_loop: &ActiveEventLoop, cause: StartCause) {
        // Кадр воспроизведения запрашиваем строго когда истёк WaitUntil-дедлайн,
        // выставленный в about_to_wait. Это и есть пейсинг по preview_fps: request_redraw
        // прямо в about_to_wait немедленно диспатчился бы и обнулял таймер (busy-loop).
        if matches!(cause, StartCause::ResumeTimeReached { .. }) {
            if let Some(s) = self.state.as_ref() {
                if s.clock.is_playing() {
                    s.window.request_redraw();
                }
            }
        }
    }

    fn user_event(&mut self, event_loop: &ActiveEventLoop, cmd: MonitorCommand) {
        match cmd {
            MonitorCommand::SetScene(scene) => {
                if let Some(s) = self.state.as_mut() {
                    s.apply_scene(scene);
                    s.window.request_redraw();
                } else {
                    self.pending_scene = Some(scene);
                }
            }
            MonitorCommand::Play => {
                if let Some(s) = self.state.as_mut() {
                    s.play();
                    s.window.request_redraw();
                }
            }
            MonitorCommand::Pause => {
                if let Some(s) = self.state.as_mut() {
                    s.pause();
                }
            }
            MonitorCommand::Seek(t) => {
                if let Some(s) = self.state.as_mut() {
                    s.seek(t);
                    s.window.request_redraw();
                }
            }
            MonitorCommand::SetAudioSettings(settings) => {
                self.audio_settings = settings.clone();
                if let Some(s) = self.state.as_mut() {
                    s.recreate_audio(settings);
                }
            }
            MonitorCommand::Close => {
                event_loop.exit();
            }
            MonitorCommand::BgReady => {
                while let Ok(result) = self.bg_rx.try_recv() {
                    if let Some(s) = self.state.as_mut() {
                        s.layers.apply_bg_result(result);
                    }
                }
                if let Some(s) = self.state.as_ref() {
                    s.window.request_redraw();
                }
            }
            MonitorCommand::VideoFrameReady => {
                // Во время play кадры забираются на следующем тике, отмеренном таймером
                // (см. about_to_wait/new_events) — лишний redraw тут только раскручивал бы
                // цикл. Нужен он лишь на паузе/скрабе, чтобы показать догнавший кадр.
                if let Some(s) = self.state.as_ref() {
                    if !s.clock.is_playing() {
                        s.window.request_redraw();
                    }
                }
            }
            MonitorCommand::SetViewport {
                parent,
                x,
                y,
                width,
                height,
                visible,
            } => {
                let vp = ViewportSpec {
                    parent,
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
                    self.try_create_window(event_loop);
                }
            }
            MonitorCommand::SetMode(mode) => {
                self.pending_mode = mode;
                if let Some(s) = self.state.as_mut() {
                    s.set_mode(mode);
                    s.window.request_redraw();
                }
            }
            MonitorCommand::SetFrameChannel(ch) => {
                if let Some(s) = self.state.as_mut() {
                    s.frame_channel = Some(ch);
                } else {
                    self.pending_frame_channel = Some(ch);
                }
            }
            MonitorCommand::SetCanvasSize { width, height } => {
                let size = (width.max(1), height.max(1));
                self.pending_canvas_size = Some(size);
                if let Some(s) = self.state.as_mut() {
                    s.canvas_size = size;
                    if s.mode == MonitorMode::Canvas {
                        s.window.request_redraw();
                    }
                }
            }
        }
    }

    fn window_event(
        &mut self,
        _event_loop: &ActiveEventLoop,
        _window_id: WindowId,
        event: WindowEvent,
    ) {
        let Some(state) = self.state.as_mut() else {
            return;
        };
        match event {
            WindowEvent::CloseRequested => {
                state.window.set_visible(false);
                state.pause();
            }
            WindowEvent::Resized(size) => {
                state.resize(size.width.max(1), size.height.max(1));
                state.window.request_redraw();
            }
            WindowEvent::RedrawRequested => {
                state.tick_and_render();
            }
            _ => {}
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        let Some(state) = self.state.as_ref() else {
            return;
        };
        if !state.clock.is_playing() {
            event_loop.set_control_flow(ControlFlow::Wait);
            return;
        }
        let frame_duration = Duration::from_secs_f64(1.0 / state.layers.preview_fps);
        // Только ставим дедлайн. Redraw произойдёт в new_events(ResumeTimeReached), иначе
        // ожидающий redraw диспатчится сразу и WaitUntil не пейсит рендер (busy-loop, 100% GPU).
        event_loop.set_control_flow(ControlFlow::WaitUntil(Instant::now() + frame_duration));
    }
}

// ---------------------------------------------------------------------------
// WindowState
// ---------------------------------------------------------------------------

struct WindowState {
    app: AppHandle,
    window: Arc<Window>,
    compositor: Compositor,
    surface: RenderSurface<'static>,

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
    offscreen_dev_id: Option<usize>,
}

impl WindowState {
    fn resize(&mut self, width: u32, height: u32) {
        self.compositor
            .resize_surface(&mut self.surface, width, height);
    }

    fn apply_scene(&mut self, scene: MonitorScene) {
        let master_gain = if scene.audio_master_muted {
            0.0
        } else {
            scene.audio_master_gain
        };
        self.audio_layers = scene.audio_layers.clone();
        self.audio_tracks = scene.audio_tracks.clone();
        self.audio_master_gain = master_gain;

        if let Some(audio) = self.audio.as_ref() {
            audio.set_scene(
                self.audio_layers.clone(),
                self.audio_tracks.clone(),
                master_gain,
            );
        }
        self.layers.apply_scene(scene);
        self.window.request_redraw();
    }

    fn recreate_audio(&mut self, settings: AudioEngineSettings) {
        let playing = self.clock.is_playing();
        let pts = self.clock.current_pts();
        self.audio = match NativeAudioEngine::new(&settings) {
            Ok(audio) => {
                audio.set_scene(
                    self.audio_layers.clone(),
                    self.audio_tracks.clone(),
                    self.audio_master_gain,
                );
                if playing {
                    audio.play(pts);
                } else {
                    audio.seek(pts, false);
                }
                Some(audio)
            }
            Err(error) => {
                log::warn!("[audio] disabled after settings update: {error:?}");
                None
            }
        };
    }

    fn set_mode(&mut self, mode: MonitorMode) {
        if self.mode == mode {
            return;
        }
        self.mode = mode;
        match mode {
            MonitorMode::Embedded => {
                if self.last_viewport.visible {
                    self.window.set_visible(true);
                }
            }
            MonitorMode::Canvas => {
                // X11 child скрываем — рендер пойдёт offscreen.
                self.window.set_visible(false);
            }
        }
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
        if (prev.x, prev.y) != (vp.x, vp.y) {
            self.window
                .set_outer_position(PhysicalPosition::new(vp.x, vp.y));
        }
        if (prev.width, prev.height) != (vp.width, vp.height) {
            let _ = self
                .window
                .request_inner_size(PhysicalSize::new(vp.width, vp.height));
            // С override_redirect WM не управляет окном — WindowEvent::Resized может
            // не прийти синхронно, поэтому ресайзим surface сразу.
            self.resize(vp.width, vp.height);
        }
        if prev.visible != vp.visible {
            self.window.set_visible(vp.visible);
        }
        self.last_viewport = vp;
        if vp.visible {
            self.window.request_redraw();
        }
    }

    fn play(&mut self) {
        if self.layers.is_empty() && self.audio.as_ref().is_none_or(NativeAudioEngine::is_empty) {
            return;
        }
        // Start wall-clock first so audio.play() and video layers share the
        // exact same origin. Reversing the order lets audio buffer ahead of
        // the visual timeline, making the waveform lag behind the voice.
        self.clock.play();
        let pts = self.clock.current_pts();
        if let Some(audio) = self.audio.as_ref() {
            audio.play(pts);
        }
        self.layers.set_playing(true);
        // После скраба по кешу декодеры могут стоять не на текущей позиции —
        // перепозиционируем, чтобы forward-стрим воспроизведения был корректным.
        self.layers.resync_active_videos(self.clock.current_pts());
    }

    fn pause(&mut self) {
        if let Some(audio) = self.audio.as_ref() {
            let audio_pts = audio.pause();
            // Stop the clock first, then sync its paused position to audio.
            // Using seek() alone leaves wall_origin set, so the clock keeps
            // ticking and the event loop never stops emitting monitor:time.
            self.clock.pause();
            self.clock.seek(audio_pts);
        } else {
            self.clock.pause();
        }
        self.layers.set_playing(false);
    }

    fn seek(&mut self, timeline_sec: f64) {
        let t = timeline_sec.max(0.0);
        self.clock.seek(t);
        let playing = self.clock.is_playing();
        if let Some(audio) = self.audio.as_ref() {
            audio.seek(t, playing);
        }
        self.layers.seek(t, playing);
    }

    // -----------------------------------------------------------------------
    // Главный тик
    // -----------------------------------------------------------------------

    fn tick_and_render(&mut self) {
        let t =
            if let Some(audio_pts) = self.audio.as_ref().and_then(NativeAudioEngine::current_pts) {
                self.clock.sync_to_audio_pts(audio_pts);
                audio_pts
            } else {
                self.clock.current_pts()
            };

        // Детектируем конец сцены во время воспроизведения.
        if self.clock.is_playing() {
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

        let dev_id = self.offscreen_dev_id.unwrap_or(self.surface.dev_id);
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
                let width = self.surface.config.width;
                let height = self.surface.config.height;
                let scene = self.layers.build_compositor_scene(t);
                if let Err(e) = self.compositor.render_scene_to_surface(
                    &scene,
                    &mut self.surface,
                    width,
                    height,
                ) {
                    log::error!("[monitor] compositor render: {e:?}");
                    emit_layer_failed(&self.app, "<surface>", "render", &e.to_string());
                }
            }
            MonitorMode::Canvas => {
                let Some(channel) = self.frame_channel.clone() else {
                    return;
                };
                let (width, height) = self.canvas_size;
                if width == 0 || height == 0 {
                    return;
                }
                let Some(dev_id) = self.offscreen_dev_id else {
                    return;
                };
                let scene = self.layers.build_compositor_scene(t);
                // NOTE: `render_scene_to_pixels` блокирует event-loop на GPU readback
                // (~1-5 мс при 1080p). При бюджете 33 мс (30 fps) это приемлемо.
                // Если понадобится ≥ 60 fps или экспорт — перейти на async-readback:
                // submit, зарегистрировать callback через `map_async`, проверять готовность
                // в `about_to_wait`.
                match self
                    .compositor
                    .render_scene_to_pixels(dev_id, &scene, width, height)
                {
                    Ok(pixels) => {
                        let mut payload = Vec::with_capacity(8 + pixels.len());
                        payload.extend_from_slice(&width.to_le_bytes());
                        payload.extend_from_slice(&height.to_le_bytes());
                        payload.extend_from_slice(&pixels);
                        if let Err(e) = channel.send(InvokeResponseBody::Raw(payload)) {
                            log::warn!("[monitor] frame channel send: {e:?}");
                        }
                    }
                    Err(e) => {
                        log::error!("[monitor] offscreen render: {e:?}");
                        emit_layer_failed(&self.app, "<offscreen>", "render", &e.to_string());
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Инициализация окна
// ---------------------------------------------------------------------------

fn init_window(
    event_loop: &ActiveEventLoop,
    app: AppHandle,
    proxy: EventLoopProxy<MonitorCommand>,
    bg_tx: Sender<BgLayerResult>,
    viewport: ViewportSpec,
    audio_settings: AudioEngineSettings,
) -> Result<WindowState> {
    let mut window_attrs = Window::default_attributes()
        .with_title(DEFAULT_TITLE)
        .with_decorations(false)
        .with_resizable(false)
        .with_visible(false)
        .with_inner_size(PhysicalSize::new(viewport.width, viewport.height))
        .with_position(PhysicalPosition::new(viewport.x, viewport.y));

    // Платформо-зависимое встраивание child-окна.
    //
    // На X11: `with_embed_parent_window(xid)` делает XReparentWindow — окно перестаёт
    // быть toplevel, клипается и двигается с родителем.
    // `with_parent_window` на X11 НЕ делает reparent; нужен именно embed.
    #[cfg(target_os = "linux")]
    {
        use raw_window_handle::RawWindowHandle;
        use winit::platform::x11::WindowAttributesExtX11;
        match viewport.parent.0 {
            RawWindowHandle::Xlib(h) => {
                log::info!("[monitor] parent: Xlib XID={:#x}", h.window);
                window_attrs = window_attrs
                    .with_embed_parent_window(h.window as u32)
                    .with_override_redirect(true);
            }
            RawWindowHandle::Xcb(h) => {
                log::info!("[monitor] parent: Xcb XID={:#x}", h.window.get());
                window_attrs = window_attrs
                    .with_embed_parent_window(h.window.get())
                    .with_override_redirect(true);
            }
            RawWindowHandle::Wayland(_) => {
                anyhow::bail!(
                    "monitor: parent handle is Wayland — GDK_BACKEND=x11 не подхватилось"
                );
            }
            other => anyhow::bail!("monitor: unexpected parent handle: {:?}", other),
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        // SAFETY: The parent handle belongs to the main Tauri window, which outlives the monitor.
        window_attrs = unsafe { window_attrs.with_parent_window(Some(viewport.parent.0)) };
    }

    let window = Arc::new(
        event_loop
            .create_window(window_attrs)
            .context("create_window failed")?,
    );

    let size = window.inner_size();
    let mut compositor = Compositor::new();
    let surface = pollster::block_on(compositor.create_window_surface(
        window.clone(),
        size.width.max(1),
        size.height.max(1),
    ))?;

    if viewport.visible {
        window.set_visible(true);
    }

    let offscreen_dev_id = Some(surface.dev_id);
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
        window,
        compositor,
        surface,
        clock: Box::new(PlaybackClock::new()),
        layers: LayerRuntimeManager::new(app.clone(), bg_tx, proxy, hw_settings),
        audio,
        audio_layers: Vec::new(),
        audio_tracks: Vec::new(),
        audio_master_gain: 1.0,
        last_emit_pts: -1.0,
        last_viewport: viewport,
        mode: MonitorMode::Embedded,
        frame_channel: None,
        canvas_size: (viewport.width.max(1), viewport.height.max(1)),
        offscreen_dev_id,
    })
}
