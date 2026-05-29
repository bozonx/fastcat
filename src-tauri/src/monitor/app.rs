//! ApplicationHandler винита: создание окна, wgpu surface + Vello render,
//! приём кадров декодера и тик воспроизведения.
//!
//! Поток рендера: Vello пишет в intermediate Rgba8Unorm-текстуру (storage),
//! затем `TextureBlitter` копирует её в surface (любой формат). Это
//! рекомендованный паттерн из `vello::util` — поддерживает любые swapchain-форматы.

use std::num::NonZeroUsize;
use std::path::PathBuf;
use std::sync::mpsc::Sender;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use vello::peniko::{Blob, ImageAlphaType, ImageData, ImageFormat};
use vello::util::{RenderContext, RenderSurface};
use vello::{AaConfig, AaSupport, RenderParams, Renderer, RendererOptions, Scene};
use winit::application::ApplicationHandler;
use winit::event::WindowEvent;
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop, EventLoopProxy};
use winit::window::{Window, WindowId};

use crate::media::decode::{FfmpegDecoder, VideoDecoder, VideoFrame};

use super::handle::MonitorCommand;

const DEFAULT_TITLE: &str = "FastCat Monitor";

pub fn run_event_loop(proxy_tx: Sender<Result<EventLoopProxy<MonitorCommand>, String>>) {
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

    let mut app = MonitorApp::default();
    event_loop.set_control_flow(ControlFlow::Wait);
    if let Err(e) = event_loop.run_app(&mut app) {
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

#[derive(Default)]
struct MonitorApp {
    state: Option<WindowState>,
    pending_open: Option<PathBuf>,
}

struct WindowState {
    window: Arc<Window>,
    render_cx: RenderContext,
    surface: RenderSurface<'static>,
    renderer: Renderer,

    decoder: Option<Box<dyn VideoDecoder>>,
    media_size: Option<(u32, u32)>,

    current: Option<DecodedFrame>,
    upcoming: Option<DecodedFrame>,

    playing: bool,
    clock_wall_origin: Option<Instant>,
    clock_pts_origin: f64,
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
        match init_window(event_loop) {
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

fn init_window(event_loop: &ActiveEventLoop) -> Result<WindowState> {
    let window_attrs = Window::default_attributes()
        .with_title(DEFAULT_TITLE)
        .with_inner_size(winit::dpi::LogicalSize::new(960.0, 540.0));
    let window = Arc::new(
        event_loop
            .create_window(window_attrs)
            .context("create_window failed")?,
    );

    let size = window.inner_size();
    let mut render_cx = RenderContext::new();
    // Vello создаёт surface от Window; нужен `'static` lifetime — оборачиваем Arc.
    let surface = pollster::block_on(render_cx.create_surface(
        window.clone(),
        size.width.max(1),
        size.height.max(1),
        wgpu::PresentMode::AutoVsync,
    ))
    .map_err(|e| anyhow::anyhow!("vello create_surface: {e:?}"))?;

    let device_handle = &render_cx.devices[surface.dev_id];
    let renderer = Renderer::new(
        &device_handle.device,
        RendererOptions {
            use_cpu: false,
            antialiasing_support: AaSupport::area_only(),
            num_init_threads: NonZeroUsize::new(1),
            pipeline_cache: None,
        },
    )
    .map_err(|e| anyhow::anyhow!("vello renderer: {e:?}"))?;

    Ok(WindowState {
        window,
        render_cx,
        surface,
        renderer,
        decoder: None,
        media_size: None,
        current: None,
        upcoming: None,
        playing: false,
        clock_wall_origin: None,
        clock_pts_origin: 0.0,
    })
}

impl WindowState {
    fn resize(&mut self, width: u32, height: u32) {
        self.render_cx
            .resize_surface(&mut self.surface, width, height);
    }

    fn open_media(&mut self, path: &PathBuf) -> Result<()> {
        let decoder = FfmpegDecoder::open(path)?;
        let info = decoder.info().clone();
        log::info!(
            "[monitor] opened {}: {}x{} @ {:.3} fps codec={}",
            path.display(),
            info.width,
            info.height,
            info.fps,
            info.codec
        );
        self.media_size = Some((info.width, info.height));
        self.decoder = Some(Box::new(decoder));
        self.current = None;
        self.upcoming = None;
        self.playing = false;
        self.clock_wall_origin = None;
        self.clock_pts_origin = 0.0;
        self.prime_first_frame()?;
        self.window.set_visible(true);
        self.window.request_redraw();
        Ok(())
    }

    fn prime_first_frame(&mut self) -> Result<()> {
        if let Some(dec) = self.decoder.as_mut() {
            if let Some(frame) = dec.next_frame()? {
                let pts = frame.pts_sec;
                self.current = Some(decoded_to_image(frame));
                self.clock_pts_origin = pts;
            }
            if let Some(frame) = dec.next_frame()? {
                self.upcoming = Some(decoded_to_image(frame));
            }
        }
        Ok(())
    }

    fn play(&mut self) {
        if self.decoder.is_none() {
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
        self.playing = false;
        self.clock_wall_origin = None;
    }

    fn seek(&mut self, time_sec: f64) -> Result<()> {
        if let Some(dec) = self.decoder.as_mut() {
            dec.seek(time_sec)?;
            self.current = None;
            self.upcoming = None;
            self.clock_pts_origin = time_sec;
            self.clock_wall_origin = if self.playing { Some(Instant::now()) } else { None };
            while let Some(frame) = dec.next_frame()? {
                if frame.pts_sec + 1.0 / 240.0 >= time_sec {
                    let pts = frame.pts_sec;
                    self.current = Some(decoded_to_image(frame));
                    self.clock_pts_origin = pts;
                    break;
                }
            }
            if let Some(frame) = dec.next_frame()? {
                self.upcoming = Some(decoded_to_image(frame));
            }
        }
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
        if self.playing {
            let t = self.current_playback_time();
            loop {
                let advance = matches!(&self.upcoming, Some(u) if u.pts_sec <= t);
                if !advance {
                    break;
                }
                self.current = self.upcoming.take();
                if let Some(dec) = self.decoder.as_mut() {
                    match dec.next_frame() {
                        Ok(Some(frame)) => self.upcoming = Some(decoded_to_image(frame)),
                        Ok(None) => {
                            self.playing = false;
                            break;
                        }
                        Err(e) => {
                            log::error!("[monitor] decode error: {e:?}");
                            self.playing = false;
                            break;
                        }
                    }
                }
            }
        }
        self.render();
    }

    fn render(&mut self) {
        let width = self.surface.config.width;
        let height = self.surface.config.height;

        let mut scene = Scene::new();
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

        let device_handle = &self.render_cx.devices[self.surface.dev_id];

        let surface_texture = match self.surface.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(t) | wgpu::CurrentSurfaceTexture::Suboptimal(t) => t,
            wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost => {
                self.render_cx
                    .resize_surface(&mut self.surface, width, height);
                return;
            }
            other => {
                log::warn!("[monitor] surface acquire: {other:?}");
                return;
            }
        };

        let render_params = RenderParams {
            base_color: vello::peniko::Color::BLACK,
            width,
            height,
            antialiasing_method: AaConfig::Area,
        };

        if let Err(e) = self.renderer.render_to_texture(
            &device_handle.device,
            &device_handle.queue,
            &scene,
            &self.surface.target_view,
            &render_params,
        ) {
            log::error!("[monitor] vello render: {e:?}");
            return;
        }

        // Блитим intermediate Rgba8Unorm в surface формат.
        let mut encoder = device_handle
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("monitor-blit"),
            });
        let surface_view = surface_texture
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        self.surface
            .blitter
            .copy(&device_handle.device, &mut encoder, &self.surface.target_view, &surface_view);
        device_handle.queue.submit([encoder.finish()]);
        surface_texture.present();
    }
}

fn decoded_to_image(frame: VideoFrame) -> DecodedFrame {
    let VideoFrame {
        width,
        height,
        pixels,
        pts_sec,
    } = frame;
    let blob = Blob::new(Arc::new(pixels));
    let image = ImageData {
        data: blob,
        format: ImageFormat::Rgba8,
        alpha_type: ImageAlphaType::Alpha,
        width,
        height,
    };
    DecodedFrame { pts_sec, image }
}
