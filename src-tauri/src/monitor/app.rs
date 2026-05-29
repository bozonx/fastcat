//! ApplicationHandler винита: окно + Compositor + мульти-слойная сцена.
//!
//! Модель:
//!   - сцена = список `SceneLayer` (video|image) с z-order, opacity, диапазонами на таймлайне;
//!   - на каждый видеослой держим свой `DecodePump` (открываем лениво при первом покрытии);
//!   - на каждый image-слой — раз декодим в `ImageData` и держим в кеше;
//!   - мастер-клок = timeline-time (секунды), wall-clock based; в фронт эмитим именно его.
//!
//! Кадровый клок: `clock_pts_origin` = timeline-PTS, который должен «играть» в момент
//! `clock_wall_origin`. В `tick_and_render` мы для каждого видеослоя выбираем готовый кадр,
//! чей `pts_sec` (clip-local) не превышает целевого `source_pts_at(timeline_pts)`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc::{Sender, TryRecvError};
use std::sync::Arc;
use std::time::Instant;

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
/// Событие в фронт: текущий timeline-time (секунды).
const EVT_TIME: &str = "monitor:time";
/// Событие при достижении конца последнего покрытого слоя (опционально).
const EVT_ENDED: &str = "monitor:ended";

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
    if proxy_tx.send(Ok(proxy)).is_err() {
        return;
    }

    let mut app_handler = MonitorApp::new(app);
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

struct MonitorApp {
    app: AppHandle,
    state: Option<WindowState>,
    pending_scene: Option<MonitorScene>,
}

impl MonitorApp {
    fn new(app: AppHandle) -> Self {
        Self { app, state: None, pending_scene: None }
    }
}

struct WindowState {
    app: AppHandle,
    window: Arc<Window>,
    compositor: Compositor,
    surface: RenderSurface<'static>,

    /// Сцена «как заказал фронт». Источник истины для diff'а рантаймов.
    scene: Vec<SceneLayer>,
    /// `id -> runtime` (видеопампы, декодированные картинки).
    runtimes: HashMap<String, LayerRuntime>,

    playing: bool,
    /// timeline-PTS, который играет в `clock_wall_origin`.
    clock_pts_origin: f64,
    clock_wall_origin: Option<Instant>,
    /// Последнее значение времени, отправленное на фронт.
    last_emit_pts: f64,
    /// Композитный размер сцены (бер ём из MonitorScene.width/height).
    scene_size: (u32, u32),
}

enum LayerRuntime {
    Video(VideoLayerRt),
    Image(ImageLayerRt),
    /// Слой задан, но открытие пока не удалось / отложено.
    Pending,
}

struct VideoLayerRt {
    pump: DecodePump,
    media_size: (u32, u32),
    current: Option<DecodedVideoFrame>,
    upcoming: Option<DecodedVideoFrame>,
    /// Последний clip-local seek, чтобы не дёргать ffmpeg каждый кадр без нужды.
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

impl ApplicationHandler<MonitorCommand> for MonitorApp {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.state.is_some() {
            return;
        }
        match init_window(event_loop, self.app.clone()) {
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
            MonitorCommand::Ping => {
                // живой — ничего не делаем
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
        // Простая модель: пока играем — Poll. На больших сценах можно оптимизировать,
        // считая ближайший целевой wall-time по min(upcoming.pts_sec) по всем видеослоям.
        event_loop.set_control_flow(ControlFlow::Poll);
        state.window.request_redraw();
    }
}

fn init_window(event_loop: &ActiveEventLoop, app: AppHandle) -> Result<WindowState> {
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
        scene: Vec::new(),
        runtimes: HashMap::new(),
        playing: false,
        clock_pts_origin: 0.0,
        clock_wall_origin: None,
        last_emit_pts: -1.0,
        scene_size: (0, 0),
    })
}

impl WindowState {
    fn resize(&mut self, width: u32, height: u32) {
        self.compositor.resize_surface(&mut self.surface, width, height);
    }

    fn apply_scene(&mut self, scene: MonitorScene) {
        let new_ids: std::collections::HashSet<String> =
            scene.layers.iter().map(|l| l.id.clone()).collect();
        // Дропаем рантаймы исчезнувших слоёв (закроет ffmpeg subprocess).
        self.runtimes.retain(|id, _| new_ids.contains(id));
        self.scene_size = (scene.width, scene.height);
        self.scene = scene.layers;
        if !self.scene.is_empty() {
            self.window.set_visible(true);
        }
        // Ленивая инициализация рантаймов происходит в tick_and_render
        // (видим только то, что покрывает текущий timeline-PTS).
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
        // Дропаем фреймы видеослоёв — следующая прокачка возьмёт свежие после seek'а.
        // Здесь же сразу отправляем seek в pump'ы покрывающих слоёв.
        let scene = self.scene.clone();
        for layer in &scene {
            if !layer.covers(t) {
                continue;
            }
            if layer.kind != LayerKind::Video {
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

    fn ensure_runtime_for(&mut self, layer: &SceneLayer) {
        if self.runtimes.contains_key(&layer.id) {
            return;
        }
        match layer.kind {
            LayerKind::Video => {
                let path = PathBuf::from(&layer.path);
                match DecodePump::open(&path) {
                    Ok(pump) => {
                        let info = pump.info.clone();
                        log::info!(
                            "[monitor] opened video layer {} {}: {}x{} @ {:.3}fps codec={}",
                            layer.id,
                            path.display(),
                            info.width,
                            info.height,
                            info.fps,
                            info.codec
                        );
                        let media_size = (info.width, info.height);
                        let mut rt = VideoLayerRt {
                            pump,
                            media_size,
                            current: None,
                            upcoming: None,
                            last_seek_clip_local: None,
                        };
                        // Сразу же seek'аемся в clip-local от текущего timeline-PTS,
                        // чтобы при play не упереться в начало источника.
                        let clip_local = layer.source_pts_at(self.current_timeline_pts());
                        if clip_local > 0.0 {
                            if let Err(e) = rt.pump.seek(clip_local) {
                                log::error!("[monitor] initial seek {}: {e:?}", layer.id);
                            }
                            rt.last_seek_clip_local = Some(clip_local);
                        }
                        self.runtimes
                            .insert(layer.id.clone(), LayerRuntime::Video(rt));
                    }
                    Err(e) => {
                        log::error!("[monitor] open pump {}: {e:?}", layer.id);
                        self.runtimes.insert(layer.id.clone(), LayerRuntime::Pending);
                    }
                }
            }
            LayerKind::Image => {
                let path = PathBuf::from(&layer.path);
                match decode_image(&path) {
                    Ok(img) => {
                        log::info!(
                            "[monitor] decoded image layer {} {}: {}x{}",
                            layer.id,
                            path.display(),
                            img.width,
                            img.height
                        );
                        let rt = ImageLayerRt {
                            image: img.image,
                            size: (img.width, img.height),
                        };
                        self.runtimes
                            .insert(layer.id.clone(), LayerRuntime::Image(rt));
                    }
                    Err(e) => {
                        log::error!("[monitor] decode image {}: {e:?}", layer.id);
                        self.runtimes.insert(layer.id.clone(), LayerRuntime::Pending);
                    }
                }
            }
        }
    }

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
                        // Слишком быстрый pump — затрём upcoming.
                        rt.upcoming = Some(decoded);
                        break;
                    }
                }
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => break,
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

    fn tick_and_render(&mut self) {
        let t = self.current_timeline_pts();
        // Ensure runtimes for currently-visible layers.
        let scene = self.scene.clone();
        for layer in &scene {
            if layer.covers(t) {
                self.ensure_runtime_for(layer);
            }
        }
        // Прокачать кадры и подровнять «current» под целевой PTS.
        for layer in &scene {
            if !layer.covers(t) {
                continue;
            }
            if layer.kind != LayerKind::Video {
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

    fn render(&mut self, t: f64) {
        let width = self.surface.config.width;
        let height = self.surface.config.height;

        // Bounding box композитной сцены — приоритет: явный scene_size, иначе максимум по слоям.
        let (scene_w, scene_h) = if self.scene_size.0 > 0 && self.scene_size.1 > 0 {
            (self.scene_size.0, self.scene_size.1)
        } else {
            self.compute_scene_bbox()
        };

        let mut scene_obj = VelloScene::new();
        if scene_w > 0 && scene_h > 0 {
            // Letterbox: фит композитной сцены в окно.
            let scale = (width as f64 / scene_w as f64).min(height as f64 / scene_h as f64);
            let draw_w = scene_w as f64 * scale;
            let draw_h = scene_h as f64 * scale;
            let tx = (width as f64 - draw_w) * 0.5;
            let ty = (height as f64 - draw_h) * 0.5;
            let outer = kurbo::Affine::translate((tx, ty))
                * kurbo::Affine::scale_non_uniform(scale, scale);

            // z-order: меньший z — внизу.
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
                    LayerRuntime::Pending => continue,
                };
                // Фит каждого слоя в композитный bbox (сохраняем aspect).
                let layer_scale = (scene_w as f64 / mw as f64).min(scene_h as f64 / mh as f64);
                let dw = mw as f64 * layer_scale;
                let dh = mh as f64 * layer_scale;
                let lx = (scene_w as f64 - dw) * 0.5;
                let ly = (scene_h as f64 - dh) * 0.5;
                let inner = kurbo::Affine::translate((lx, ly))
                    * kurbo::Affine::scale_non_uniform(layer_scale, layer_scale);
                let xform = outer * inner;

                // Прозрачность: оборачиваем рисование в push_layer с alpha. Это уважает
                // straight alpha канала изображения И per-clip opacity.
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

        // Чёрный фон (за letterbox-полями и под прозрачными слоями).
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
                LayerRuntime::Pending => continue,
            };
            w = w.max(mw);
            h = h.max(mh);
        }
        if w == 0 || h == 0 {
            (1920, 1080)
        } else {
            (w, h)
        }
    }
}

fn decoded_to_image(frame: VideoFrame) -> DecodedVideoFrame {
    let VideoFrame { width, height, pixels, pts_sec } = frame;
    let blob = Blob::new(Arc::new(pixels));
    let image = ImageData {
        data: blob,
        format: ImageFormat::Rgba8,
        // ffmpeg -pix_fmt rgba отдаёт straight (unpremultiplied) RGBA.
        alpha_type: ImageAlphaType::Alpha,
        width,
        height,
    };
    DecodedVideoFrame { pts_sec, image }
}

// Подавление неиспользуемого варианта при отсутствии EOF-логики (будущая фича).
#[allow(dead_code)]
const _EVT_ENDED: &str = EVT_ENDED;
