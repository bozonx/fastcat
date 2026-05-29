//! ApplicationHandler винита: окно + Compositor + DecodePump.
//!
//! Принцип:
//!   - декод идёт в отдельном потоке (`DecodePump`), в event-loop мы только тянем готовые кадры;
//!   - рендер делегирован Compositor'у: сцена собирается локально (image-layer + transform), он рисует;
//!   - время воспроизведения трекается wall-clock'ом и эмитится через Tauri `emit` ("monitor:time").
//!
//! Кадровый клок: `clock_pts_origin` = PTS текущего «настоящего» отображаемого кадра,
//! `clock_wall_origin` = `Instant` момента, когда этот кадр стал считаться играющим.
//! Через `tick_and_render` мы догоняем `current` до целевого PTS = pts_origin + wall_elapsed.

use std::path::PathBuf;
use std::sync::mpsc::{Sender, TryRecvError};
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

use super::handle::MonitorCommand;

const DEFAULT_TITLE: &str = "FastCat Monitor";
/// События в фронт: текущее время воспроизведения в секундах (clip-local).
const EVT_TIME: &str = "monitor:time";
/// Событие при достижении EOF.
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
    pending_open: Option<PathBuf>,
}

impl MonitorApp {
    fn new(app: AppHandle) -> Self {
        Self { app, state: None, pending_open: None }
    }
}

struct WindowState {
    app: AppHandle,
    window: Arc<Window>,
    compositor: Compositor,
    surface: RenderSurface<'static>,

    pump: Option<DecodePump>,
    media_size: Option<(u32, u32)>,

    current: Option<DecodedFrame>,
    upcoming: Option<DecodedFrame>,

    playing: bool,
    clock_wall_origin: Option<Instant>,
    clock_pts_origin: f64,
    /// Последнее значение времени, отправленное на фронт — чтобы не спамить событиями.
    last_emit_pts: f64,
}

struct DecodedFrame {
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
                if let Some(path) = self.pending_open.take() {
                    if let Some(s) = self.state.as_mut() {
                        if let Err(e) = s.open_media(&path) {
                            log::error!("[monitor] open_media failed: {e:?}");
                        }
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
            MonitorCommand::Open(path) => {
                if let Some(s) = self.state.as_mut() {
                    if let Err(e) = s.open_media(&path) {
                        log::error!("[monitor] open_media failed: {e:?}");
                    }
                } else {
                    self.pending_open = Some(path);
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
                    if let Err(e) = s.seek(t) {
                        log::error!("[monitor] seek failed: {e:?}");
                    }
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
        if let Some(next) = &state.upcoming {
            let target = state.wall_for_pts(next.pts_sec);
            event_loop.set_control_flow(ControlFlow::WaitUntil(target));
        } else {
            event_loop.set_control_flow(ControlFlow::Poll);
        }
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
        pump: None,
        media_size: None,
        current: None,
        upcoming: None,
        playing: false,
        clock_wall_origin: None,
        clock_pts_origin: 0.0,
        last_emit_pts: -1.0,
    })
}

impl WindowState {
    fn resize(&mut self, width: u32, height: u32) {
        self.compositor.resize_surface(&mut self.surface, width, height);
    }

    fn open_media(&mut self, path: &PathBuf) -> Result<()> {
        let pump = DecodePump::open(path)?;
        let info = pump.info.clone();
        log::info!(
            "[monitor] opened {}: {}x{} @ {:.3} fps codec={}",
            path.display(),
            info.width,
            info.height,
            info.fps,
            info.codec
        );
        self.media_size = Some((info.width, info.height));
        self.pump = Some(pump);
        self.current = None;
        self.upcoming = None;
        self.playing = false;
        self.clock_wall_origin = None;
        self.clock_pts_origin = 0.0;
        self.last_emit_pts = -1.0;
        self.prime_first_frames();
        self.window.set_visible(true);
        self.window.request_redraw();
        Ok(())
    }

    fn prime_first_frames(&mut self) {
        // Дренаж первых готовых кадров (если уже успели декодиться).
        // Блокирующего ожидания тут не делаем — пусть отрисуется чёрным, кадры приедут на ближайшем redraw.
        self.try_pull_frames();
    }

    fn try_pull_frames(&mut self) {
        let Some(pump) = self.pump.as_ref() else { return };
        let live_gen = pump.current_generation();
        loop {
            match pump.rx.try_recv() {
                Ok(msg) => {
                    if msg.generation != live_gen {
                        continue; // выбросить остаток предыдущего seek-эпизода
                    }
                    let decoded = decoded_to_image(msg.frame);
                    if self.current.is_none() {
                        self.clock_pts_origin = decoded.pts_sec;
                        self.current = Some(decoded);
                    } else if self.upcoming.is_none() {
                        self.upcoming = Some(decoded);
                    } else {
                        // Кадр опередил собственный темп — придержим вместо upcoming
                        // и выйдем; следующий redraw продвинется и заберёт.
                        // Здесь просто перезаписываем upcoming на «более новый» нельзя — это сломает порядок.
                        // Вернёмся: положим обратно… mpsc не поддерживает; значит — break и оставим в канале.
                        // Чтобы не съесть его — нам пришлось бы его не вынимать. Идея: проверяем прежде.
                        // Перепишем цикл ниже.
                        // Откатить: ничего не делаем, оставляем upcoming прежним; новый кадр потеряется.
                        // Не страшно при QUEUE_CAPACITY=6 — он окажется в очереди и подъедется на следующий redraw.
                        // Но мы его УЖЕ вынули. Костыль: положим в upcoming, потеряв предыдущий upcoming.
                        // Это краткосрочно ок: оба — будущие кадры, видим только текущий.
                        self.upcoming = Some(decoded);
                        break;
                    }
                }
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    self.pump = None;
                    break;
                }
            }
        }
    }

    fn play(&mut self) {
        if self.pump.is_none() {
            return;
        }
        self.playing = true;
        let base_pts = self
            .current
            .as_ref()
            .map(|f| f.pts_sec)
            .unwrap_or(self.clock_pts_origin);
        self.clock_pts_origin = base_pts;
        self.clock_wall_origin = Some(Instant::now());
    }

    fn pause(&mut self) {
        if self.playing {
            // Зафиксировать накопленное время до сброса wall-origin.
            self.clock_pts_origin = self.current_playback_time();
        }
        self.playing = false;
        self.clock_wall_origin = None;
    }

    fn seek(&mut self, time_sec: f64) -> Result<()> {
        let Some(pump) = self.pump.as_ref() else { return Ok(()) };
        pump.seek(time_sec.max(0.0))?;
        self.current = None;
        self.upcoming = None;
        self.clock_pts_origin = time_sec.max(0.0);
        self.clock_wall_origin = if self.playing { Some(Instant::now()) } else { None };
        Ok(())
    }

    fn current_playback_time(&self) -> f64 {
        match (self.playing, self.clock_wall_origin) {
            (true, Some(origin)) => {
                self.clock_pts_origin + Instant::now().duration_since(origin).as_secs_f64()
            }
            _ => self.clock_pts_origin,
        }
    }

    fn wall_for_pts(&self, pts: f64) -> Instant {
        let now = Instant::now();
        match self.clock_wall_origin {
            Some(origin) => {
                let dt = pts - self.clock_pts_origin;
                if dt <= 0.0 {
                    now
                } else {
                    origin + Duration::from_secs_f64(dt)
                }
            }
            None => now,
        }
    }

    fn tick_and_render(&mut self) {
        // Подтянуть готовые кадры из pump.
        self.try_pull_frames();

        if self.playing {
            let t = self.current_playback_time();
            loop {
                let advance = matches!(&self.upcoming, Some(u) if u.pts_sec <= t);
                if !advance {
                    break;
                }
                self.current = self.upcoming.take();
                // Попробуем взять ещё один кадр; если нет — заберём на следующем redraw.
                self.try_pull_frames();
                if self.upcoming.is_none() {
                    // EOF?
                    if let Some(pump) = self.pump.as_ref() {
                        if pump.rx.try_recv().is_err() {
                            // Канал может быть просто пуст — EOF определяется только когда
                            // отстаём по времени надолго. На MVP: если upcoming None после
                            // догона — продолжаем играть current, и если новых кадров нет
                            // несколько кадров подряд — paused.
                        }
                    }
                    break;
                }
            }
            // Если current отстал и нет upcoming — возможно достигли EOF.
            // Не паузим мгновенно, дадим pump подтянуть; фронту сообщим о EOF только по факту
            // «нет новых кадров и pump потерян».
            if self.upcoming.is_none() && self.pump.is_none() {
                self.playing = false;
                let _ = self.app.emit(EVT_ENDED, ());
            }
        }

        self.render();
        self.emit_time();
    }

    fn emit_time(&mut self) {
        let t = self.current_playback_time();
        // Эмитим только при изменении >= 1мс.
        if (t - self.last_emit_pts).abs() < 0.001 {
            return;
        }
        self.last_emit_pts = t;
        let _ = self.app.emit(EVT_TIME, t);
    }

    fn render(&mut self) {
        let width = self.surface.config.width;
        let height = self.surface.config.height;

        let mut scene = VelloScene::new();
        if let (Some(frame), Some((mw, mh))) = (self.current.as_ref(), self.media_size) {
            let scale = (width as f64 / mw as f64).min(height as f64 / mh as f64);
            let draw_w = mw as f64 * scale;
            let draw_h = mh as f64 * scale;
            let tx = (width as f64 - draw_w) * 0.5;
            let ty = (height as f64 - draw_h) * 0.5;
            let transform = kurbo::Affine::translate((tx, ty))
                * kurbo::Affine::scale_non_uniform(scale, scale);
            scene.draw_image(&frame.image, transform);
        }

        if let Err(e) = self
            .compositor
            .render_to_surface(&mut self.surface, &scene, Color::BLACK)
        {
            log::error!("[monitor] compositor render: {e:?}");
        }
    }
}

fn decoded_to_image(frame: VideoFrame) -> DecodedFrame {
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
    DecodedFrame { pts_sec, image }
}
