//! ApplicationHandler винита: окно + Compositor + мульти-слойная сцена.
//!
//! Модель:
//!   - сцена = список `SceneLayer` (video|image) с z-order, opacity, диапазонами на таймлайне;
//!   - на каждый слой держим рантайм (Loading → Video/Image | Failed);
//!   - открытие декодеров и декод картинок происходит в фоновых потоках (не блокируя event-loop);
//!   - мастер-клок = timeline-time (секунды), wall-clock based; в фронт эмитим именно его.
//!
//! Жизненный цикл слоя:
//!   `apply_scene` → рантайм отсутствует → `ensure_runtime_for` → Loading + фоновый поток
//!   → `BgReady` event → `apply_bg_result` → Video | Image | Failed
//!   `apply_scene` (новая сцена) → Failed удаляется → retry цикл выше.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use tauri::{AppHandle, Emitter};
use vello::peniko::{Blob, Color, ImageAlphaType, ImageData, ImageFormat};
use vello::util::RenderSurface;
use vello::Scene as VelloScene;
use winit::application::ApplicationHandler;
use winit::event::WindowEvent;
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop, EventLoopProxy};
use winit::window::{Window, WindowId};

use crate::compositor::Compositor;
use crate::media::decode::VideoFrame;
use crate::media::decode_thread::DecodePump;
use crate::media::image_decode::decode_image;

use super::handle::MonitorCommand;
use super::scene::{LayerKind, MonitorScene, SceneLayer};

const DEFAULT_TITLE: &str = "FastCat Monitor";
const EVT_TIME: &str = "monitor:time";
const EVT_ENDED: &str = "monitor:ended";
/// Целевой framerate нативного монитора (кадров/сек). Ограничивает Poll — вместо busy-loop.
const TARGET_FPS: f64 = 60.0;

// ---------------------------------------------------------------------------
// Результаты фоновой загрузки слоёв
// ---------------------------------------------------------------------------

pub(super) enum BgLayerResult {
    VideoOk { id: String, pump: DecodePump, media_size: (u32, u32) },
    VideoErr { id: String, error: String },
    ImageOk { id: String, image: ImageData, size: (u32, u32) },
    ImageErr { id: String, error: String },
}

// DecodePump и ImageData содержат только Send-типы; явная разметка нужна, т.к. компилятор
// не может автоматически вывести Send для непрозрачных внешних типов (wgpu Blob).
unsafe impl Send for BgLayerResult {}

// ---------------------------------------------------------------------------
// Event loop
// ---------------------------------------------------------------------------

pub fn run_event_loop(
    app: AppHandle,
    proxy_tx: Sender<Result<EventLoopProxy<MonitorCommand>, String>>,
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
    let mut app_handler = MonitorApp::new(app, proxy, bg_tx, bg_rx);
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
    /// Клон прокси — нужен для передачи в фоновые потоки загрузки.
    proxy: EventLoopProxy<MonitorCommand>,
    /// Отправитель результатов фоновых загрузок.
    bg_tx: Sender<BgLayerResult>,
    /// Получатель результатов фоновых загрузок; дренируется в user_event(BgReady).
    bg_rx: Receiver<BgLayerResult>,
    state: Option<WindowState>,
    pending_scene: Option<MonitorScene>,
}

impl MonitorApp {
    fn new(
        app: AppHandle,
        proxy: EventLoopProxy<MonitorCommand>,
        bg_tx: Sender<BgLayerResult>,
        bg_rx: Receiver<BgLayerResult>,
    ) -> Self {
        Self { app, proxy, bg_tx, bg_rx, state: None, pending_scene: None }
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
    /// Для передачи в фоновые потоки загрузки.
    bg_tx: Sender<BgLayerResult>,
    proxy: EventLoopProxy<MonitorCommand>,

    /// Сцена «как заказал фронт». Источник истины для diff'а рантаймов.
    scene: Vec<SceneLayer>,
    /// id → рантайм (Loading, Video, Image, Failed).
    runtimes: HashMap<String, LayerRuntime>,
    /// Слои, для которых фоновый поток загрузки уже запущен.
    loading_set: HashSet<String>,

    playing: bool,
    clock_pts_origin: f64,
    clock_wall_origin: Option<Instant>,
    last_emit_pts: f64,
    scene_size: (u32, u32),
}

enum LayerRuntime {
    Video(VideoLayerRt),
    Image(ImageLayerRt),
    /// Фоновый поток загрузки запущен — результат ещё не пришёл.
    Loading,
    /// Открытие не удалось. Будет удалён следующим `apply_scene` для retry.
    Failed,
}

struct VideoLayerRt {
    pump: DecodePump,
    media_size: (u32, u32),
    current: Option<DecodedVideoFrame>,
    upcoming: Option<DecodedVideoFrame>,
    last_seek_clip_local: Option<f64>,
}

struct ImageLayerRt {
    image: ImageData,
    size: (u32, u32),
}

struct DecodedVideoFrame {
    pts_sec: f64,
    image: ImageData,
}

// ---------------------------------------------------------------------------
// ApplicationHandler impl
// ---------------------------------------------------------------------------

impl ApplicationHandler<MonitorCommand> for MonitorApp {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.state.is_some() {
            return;
        }
        match init_window(
            event_loop,
            self.app.clone(),
            self.proxy.clone(),
            self.bg_tx.clone(),
        ) {
            Ok(state) => {
                self.state = Some(state);
                if let Some(scene) = self.pending_scene.take() {
                    if let Some(s) = self.state.as_mut() {
                        s.apply_scene(scene);
                    }
                }
            }
            Err(e) => {
                log::error!("[monitor] init failed: {e:?}");
                event_loop.exit();
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
            MonitorCommand::Close => {
                event_loop.exit();
            }
            MonitorCommand::BgReady => {
                // Дренируем все готовые результаты фоновой загрузки.
                while let Ok(result) = self.bg_rx.try_recv() {
                    if let Some(s) = self.state.as_mut() {
                        s.apply_bg_result(result);
                    }
                }
                if let Some(s) = self.state.as_ref() {
                    s.window.request_redraw();
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
        let Some(state) = self.state.as_mut() else {
            return;
        };
        if !state.playing {
            event_loop.set_control_flow(ControlFlow::Wait);
            return;
        }
        // Ограничиваем частоту кадров через WaitUntil вместо busy-loop Poll.
        let frame_duration = Duration::from_secs_f64(1.0 / TARGET_FPS);
        event_loop.set_control_flow(ControlFlow::WaitUntil(Instant::now() + frame_duration));
        state.window.request_redraw();
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
) -> Result<WindowState> {
    let window_attrs = Window::default_attributes()
        .with_title(DEFAULT_TITLE)
        .with_inner_size(winit::dpi::LogicalSize::new(960.0, 540.0));
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

    Ok(WindowState {
        app,
        window,
        compositor,
        surface,
        bg_tx,
        proxy,
        scene: Vec::new(),
        runtimes: HashMap::new(),
        loading_set: HashSet::new(),
        playing: false,
        clock_pts_origin: 0.0,
        clock_wall_origin: None,
        last_emit_pts: -1.0,
        scene_size: (0, 0),
    })
}

// ---------------------------------------------------------------------------
// WindowState impl
// ---------------------------------------------------------------------------

impl WindowState {
    fn resize(&mut self, width: u32, height: u32) {
        self.compositor.resize_surface(&mut self.surface, width, height);
    }

    fn apply_scene(&mut self, scene: MonitorScene) {
        let new_ids: HashSet<String> = scene.layers.iter().map(|l| l.id.clone()).collect();

        // Дропаем рантаймы исчезнувших слоёв (закроет ffmpeg subprocesses).
        self.runtimes.retain(|id, rt| {
            if !new_ids.contains(id) {
                return false;
            }
            // Failed-рантаймы удаляем, чтобы следующий tick сделал retry.
            !matches!(rt, LayerRuntime::Failed)
        });

        // Loading-слои, которых нет в новой сцене — убираем из очереди.
        // Фоновый поток всё равно отработает, но результат выбросим в apply_bg_result.
        self.loading_set.retain(|id| new_ids.contains(id));

        self.scene_size = (scene.width, scene.height);
        self.scene = scene.layers;

        if !self.scene.is_empty() {
            self.window.set_visible(true);
        }
        self.window.request_redraw();
    }

    fn play(&mut self) {
        if self.scene.is_empty() {
            return;
        }
        self.playing = true;
        self.clock_wall_origin = Some(Instant::now());
    }

    fn pause(&mut self) {
        if self.playing {
            self.clock_pts_origin = self.current_timeline_pts();
        }
        self.playing = false;
        self.clock_wall_origin = None;
    }

    fn seek(&mut self, timeline_sec: f64) {
        let t = timeline_sec.max(0.0);
        self.clock_pts_origin = t;
        self.clock_wall_origin = if self.playing { Some(Instant::now()) } else { None };
        let scene = self.scene.clone();
        for layer in &scene {
            if !layer.covers(t) || layer.kind != LayerKind::Video {
                continue;
            }
            let clip_local = layer.source_pts_at(t);
            if let Some(LayerRuntime::Video(v)) = self.runtimes.get_mut(&layer.id) {
                if let Err(e) = v.pump.seek(clip_local) {
                    log::error!("[monitor] seek pump {}: {e:?}", layer.id);
                }
                v.current = None;
                v.upcoming = None;
                v.last_seek_clip_local = Some(clip_local);
            }
        }
    }

    fn current_timeline_pts(&self) -> f64 {
        match (self.playing, self.clock_wall_origin) {
            (true, Some(origin)) => {
                self.clock_pts_origin + Instant::now().duration_since(origin).as_secs_f64()
            }
            _ => self.clock_pts_origin,
        }
    }

    // -----------------------------------------------------------------------
    // Фоновая загрузка слоёв (не блокирует event-loop)
    // -----------------------------------------------------------------------

    fn ensure_runtime_for(&mut self, layer: &SceneLayer) {
        // Рантайм уже есть (Loading, Video, Image) — ничего не делаем.
        if self.runtimes.contains_key(&layer.id) {
            return;
        }

        // Помечаем как Loading сразу, чтобы повторные вызовы в том же тике не дублировали spawn.
        self.runtimes.insert(layer.id.clone(), LayerRuntime::Loading);
        self.loading_set.insert(layer.id.clone());

        let id = layer.id.clone();
        let path = PathBuf::from(&layer.path);
        let bg_tx = self.bg_tx.clone();
        let proxy = self.proxy.clone();

        match layer.kind {
            LayerKind::Video => {
                std::thread::Builder::new()
                    .name(format!("fastcat-load-video:{}", path.display()))
                    .spawn(move || {
                        let result = match DecodePump::open(&path) {
                            Ok(pump) => {
                                let media_size = (pump.info.width, pump.info.height);
                                BgLayerResult::VideoOk { id, pump, media_size }
                            }
                            Err(e) => BgLayerResult::VideoErr { id, error: e.to_string() },
                        };
                        let _ = bg_tx.send(result);
                        let _ = proxy.send_event(MonitorCommand::BgReady);
                    })
                    .ok();
            }
            LayerKind::Image => {
                std::thread::Builder::new()
                    .name(format!("fastcat-load-img:{}", path.display()))
                    .spawn(move || {
                        let result = match decode_image(&path) {
                            Ok(img) => BgLayerResult::ImageOk {
                                id,
                                image: img.image,
                                size: (img.width, img.height),
                            },
                            Err(e) => BgLayerResult::ImageErr { id, error: e.to_string() },
                        };
                        let _ = bg_tx.send(result);
                        let _ = proxy.send_event(MonitorCommand::BgReady);
                    })
                    .ok();
            }
        }
    }

    fn apply_bg_result(&mut self, result: BgLayerResult) {
        match result {
            BgLayerResult::VideoOk { id, pump, media_size } => {
                self.loading_set.remove(&id);
                // Слой мог исчезнуть из сцены за время загрузки — дропаем pump.
                if !self.scene.iter().any(|l| l.id == id) {
                    self.runtimes.remove(&id);
                    return;
                }
                let clip_local = self.scene.iter()
                    .find(|l| l.id == id)
                    .map(|l| l.source_pts_at(self.current_timeline_pts()))
                    .unwrap_or(0.0);
                log::info!(
                    "[monitor] opened video layer {id}: {}x{} @ {:.3}fps codec={}",
                    pump.info.width, pump.info.height, pump.info.fps, pump.info.codec,
                );
                let mut rt = VideoLayerRt {
                    pump,
                    media_size,
                    current: None,
                    upcoming: None,
                    last_seek_clip_local: None,
                };
                if clip_local > 0.0 {
                    if let Err(e) = rt.pump.seek(clip_local) {
                        log::error!("[monitor] initial seek {id}: {e:?}");
                    }
                    rt.last_seek_clip_local = Some(clip_local);
                }
                self.runtimes.insert(id, LayerRuntime::Video(rt));
            }
            BgLayerResult::VideoErr { id, error } => {
                self.loading_set.remove(&id);
                log::error!("[monitor] open pump {id}: {error}");
                self.runtimes.insert(id, LayerRuntime::Failed);
            }
            BgLayerResult::ImageOk { id, image, size } => {
                self.loading_set.remove(&id);
                if !self.scene.iter().any(|l| l.id == id) {
                    self.runtimes.remove(&id);
                    return;
                }
                log::info!("[monitor] decoded image layer {id}: {}x{}", size.0, size.1);
                self.runtimes.insert(id, LayerRuntime::Image(ImageLayerRt { image, size }));
            }
            BgLayerResult::ImageErr { id, error } => {
                self.loading_set.remove(&id);
                log::error!("[monitor] decode image {id}: {error}");
                self.runtimes.insert(id, LayerRuntime::Failed);
            }
        }
    }

    // -----------------------------------------------------------------------
    // Видеокадры
    // -----------------------------------------------------------------------

    fn pull_video_frames(rt: &mut VideoLayerRt) {
        let live_gen = rt.pump.current_generation();
        loop {
            match rt.pump.rx.try_recv() {
                Ok(msg) => {
                    if msg.generation != live_gen {
                        continue;
                    }
                    let decoded = decoded_to_image(msg.frame);
                    if rt.current.is_none() {
                        rt.current = Some(decoded);
                    } else if rt.upcoming.is_none() {
                        rt.upcoming = Some(decoded);
                    } else {
                        rt.upcoming = Some(decoded);
                        break;
                    }
                }
                Err(TryRecvError::Empty) | Err(TryRecvError::Disconnected) => break,
            }
        }
    }

    fn advance_video_to(rt: &mut VideoLayerRt, target_clip_local: f64) {
        loop {
            let advance = matches!(&rt.upcoming, Some(u) if u.pts_sec <= target_clip_local);
            if !advance {
                break;
            }
            rt.current = rt.upcoming.take();
            Self::pull_video_frames(rt);
            if rt.upcoming.is_none() {
                break;
            }
        }
    }

    // -----------------------------------------------------------------------
    // Главный тик
    // -----------------------------------------------------------------------

    fn tick_and_render(&mut self) {
        let t = self.current_timeline_pts();

        // Детектируем конец сцены во время воспроизведения.
        if self.playing && !self.scene.is_empty() {
            let scene_end = self.scene.iter()
                .map(|l| l.timeline_end_sec)
                .fold(0.0_f64, f64::max);
            if scene_end > 0.0 && t >= scene_end {
                self.pause();
                let _ = self.app.emit(EVT_ENDED, ());
                self.emit_time(scene_end);
                self.render(scene_end);
                return;
            }
        }

        // Запускаем фоновую загрузку для активных слоёв.
        let scene = self.scene.clone();
        for layer in &scene {
            if layer.covers(t) {
                self.ensure_runtime_for(layer);
            }
        }

        // Прокачиваем видеокадры.
        for layer in &scene {
            if !layer.covers(t) || layer.kind != LayerKind::Video {
                continue;
            }
            if let Some(LayerRuntime::Video(rt)) = self.runtimes.get_mut(&layer.id) {
                Self::pull_video_frames(rt);
                let target = layer.source_pts_at(t);
                Self::advance_video_to(rt, target);
            }
        }

        self.render(t);
        self.emit_time(t);
    }

    fn emit_time(&mut self, t: f64) {
        if (t - self.last_emit_pts).abs() < 0.001 {
            return;
        }
        self.last_emit_pts = t;
        let _ = self.app.emit(EVT_TIME, t);
    }

    // -----------------------------------------------------------------------
    // Рендер
    // -----------------------------------------------------------------------

    fn render(&mut self, t: f64) {
        let width = self.surface.config.width;
        let height = self.surface.config.height;

        let (scene_w, scene_h) = if self.scene_size.0 > 0 && self.scene_size.1 > 0 {
            (self.scene_size.0, self.scene_size.1)
        } else {
            self.compute_scene_bbox()
        };

        let mut scene_obj = VelloScene::new();
        if scene_w > 0 && scene_h > 0 {
            let scale = (width as f64 / scene_w as f64).min(height as f64 / scene_h as f64);
            let draw_w = scene_w as f64 * scale;
            let draw_h = scene_h as f64 * scale;
            let tx = (width as f64 - draw_w) * 0.5;
            let ty = (height as f64 - draw_h) * 0.5;
            let outer = kurbo::Affine::translate((tx, ty))
                * kurbo::Affine::scale_non_uniform(scale, scale);

            let mut indices: Vec<usize> = (0..self.scene.len())
                .filter(|&i| self.scene[i].covers(t))
                .collect();
            indices.sort_by_key(|&i| self.scene[i].z);

            for i in indices {
                let layer = &self.scene[i];
                let opacity = layer.opacity.clamp(0.0, 1.0);
                if opacity <= 0.0 {
                    continue;
                }
                let Some(rt) = self.runtimes.get(&layer.id) else { continue };
                let (img, (mw, mh)) = match rt {
                    LayerRuntime::Video(v) => match v.current.as_ref() {
                        Some(f) => (&f.image, v.media_size),
                        None => continue,
                    },
                    LayerRuntime::Image(im) => (&im.image, im.size),
                    LayerRuntime::Loading | LayerRuntime::Failed => continue,
                };
                let layer_scale =
                    (scene_w as f64 / mw as f64).min(scene_h as f64 / mh as f64);
                let dw = mw as f64 * layer_scale;
                let dh = mh as f64 * layer_scale;
                let lx = (scene_w as f64 - dw) * 0.5;
                let ly = (scene_h as f64 - dh) * 0.5;
                let inner = kurbo::Affine::translate((lx, ly))
                    * kurbo::Affine::scale_non_uniform(layer_scale, layer_scale);
                let xform = outer * inner;

                if opacity < 1.0 {
                    let bbox = kurbo::Rect::new(0.0, 0.0, mw as f64, mh as f64);
                    scene_obj.push_layer(
                        vello::peniko::Fill::NonZero,
                        vello::peniko::Mix::Normal,
                        opacity as f32,
                        xform,
                        &bbox,
                    );
                    scene_obj.draw_image(img, xform);
                    scene_obj.pop_layer();
                } else {
                    scene_obj.draw_image(img, xform);
                }
            }
        }

        if let Err(e) = self
            .compositor
            .render_to_surface(&mut self.surface, &scene_obj, Color::BLACK)
        {
            log::error!("[monitor] compositor render: {e:?}");
        }
    }

    fn compute_scene_bbox(&self) -> (u32, u32) {
        let mut w = 0u32;
        let mut h = 0u32;
        for layer in &self.scene {
            let Some(rt) = self.runtimes.get(&layer.id) else { continue };
            let (mw, mh) = match rt {
                LayerRuntime::Video(v) => v.media_size,
                LayerRuntime::Image(im) => im.size,
                LayerRuntime::Loading | LayerRuntime::Failed => continue,
            };
            w = w.max(mw);
            h = h.max(mh);
        }
        if w == 0 || h == 0 { (1920, 1080) } else { (w, h) }
    }
}

fn decoded_to_image(frame: VideoFrame) -> DecodedVideoFrame {
    let VideoFrame { width, height, pixels, pts_sec } = frame;
    let blob = Blob::new(Arc::new(pixels));
    let image = ImageData {
        data: blob,
        format: ImageFormat::Rgba8,
        alpha_type: ImageAlphaType::Alpha,
        width,
        height,
    };
    DecodedVideoFrame { pts_sec, image }
}
