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
use crate::audio::plugins::AudioEffectSpec;
use crate::compositor::{Compositor, PipelinedReadback};

use super::clock::{Clock, PlaybackClock};
use super::handle::{MonitorCommand, MonitorMode, ScrubTarget};
use super::layer_runtime::{emit_layer_failed, BgLayerResult};
use super::runtime::LayerRuntimeManager;
use super::scene::{MonitorScene, SceneAudioLayer, SceneAudioTrack};
use tauri::ipc::{Channel, InvokeResponseBody};

const DEFAULT_TITLE: &str = "FastCat Monitor";
const EVT_TIME: &str = "monitor:time";
const EVT_ENDED: &str = "monitor:ended";

/// Hard cap on warm-up waiting. If the decoder didn't make it (a very heavy source,
/// an open error, a slow disk/network) we start as-is so Play never hangs. Real scenes
/// pass the check earlier: each video layer's readiness threshold is computed
/// dynamically in `active_videos_ready` via `expected_preroll_duration()`, accounting
/// for the per-layer frame memory limit.
const PREBUFFER_TIMEOUT: Duration = Duration::from_millis(3000);
/// Polling cadence while warming up before playback. Video readiness is normally
/// driven by `VideoFrameReady`/`BgReady` events, but audio-only scenes (or audio
/// finishing its prime after video) emit no such event, so we also wake on this
/// interval to re-check both gates and start promptly instead of at the timeout.
const PREBUFFER_POLL_INTERVAL: Duration = Duration::from_millis(10);
/// A seek arriving while a play-prebuffer / micro-prime is already in flight and
/// targeting within this of where we are already priming is treated as a frontend
/// echo. During a prime the clock is frozen at the prime target and emits no
/// `monitor:time`; the frontend keeps extrapolating a smooth playhead and echoing
/// it back as explicit seeks. Restarting the prime on each echo wipes the ring
/// every time, so the prebuffer never completes and the transport jams (native
/// paused while the UI still shows "playing"). The echoes target the frozen
/// position exactly (diff ≈ 0), so a small tolerance catches them while leaving
/// genuine scrubs to re-target the prime.
const SEEK_PRIME_REDUNDANT_SEC: f64 = 0.05;

/// Requested position/size of the offscreen/native monitor window in physical pixels.
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
    scrub_target: ScrubTarget,
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
    let mut app_handler = MonitorApp::new(app, proxy, bg_tx, bg_rx, audio_settings, scrub_target);
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
        // The monitor runs the winit event loop on a separate thread (see
        // MonitorHandle::spawn), not the main one. winit's Wayland backend doesn't
        // initialize in this context and `build()` fails with "EventLoop::build failed" —
        // and since WAYLAND_DISPLAY is set, winit picks Wayland and does NOT fall back to
        // X11 on its own. Force X11: on a Wayland session that's XWayland, which comes up
        // reliably from a thread. The GTK/Tauri shell stays on native Wayland (we don't
        // touch GDK_BACKEND) — the monitor is offscreen (Canvas) by default, and the
        // standalone XWayland window is indistinguishable from native to the user.
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
    /// A scene that arrived before the first SetViewport.
    pending_scene: Option<MonitorScene>,
    /// The latest viewport. If there's no window yet, we create it from this in resumed/SetViewport.
    pending_viewport: Option<ViewportSpec>,
    /// Canvas-mode commands can arrive before the first SetViewport, when WindowState
    /// doesn't exist yet. We stash them so the initial canvas subscription isn't lost.
    pending_mode: MonitorMode,
    pending_frame_channel: Option<Channel<InvokeResponseBody>>,
    pending_canvas_size: Option<(u32, u32)>,
    /// True after the first `resumed` call — before that, create_window fails.
    resumed: bool,
    audio_settings: AudioEngineSettings,
    next_redraw_at: Option<Instant>,
    /// Latest-wins scrub-target slot. The writer (`MonitorHandle::send` on each `Seek`)
    /// overwrites it with the latest position; the `Seek` handler in the event loop
    /// read-and-clears it. winit delivers user events one per wake-up, so they can't be
    /// collapsed via a batch in `about_to_wait` — but while the loop synchronously
    /// renders one frame, fresher positions get written to the slot, and stale `Seek`
    /// events find it empty and become no-ops. So when scrubbing across a transition zone
    /// (two decoders + a shader) only the last position is rendered, not each in turn (the
    /// source of the "lag").
    scrub_target: ScrubTarget,
}

impl MonitorApp {
    fn new(
        app: AppHandle,
        proxy: EventLoopProxy<MonitorCommand>,
        bg_tx: Sender<BgLayerResult>,
        bg_rx: Receiver<BgLayerResult>,
        audio_settings: AudioEngineSettings,
        scrub_target: ScrubTarget,
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
            scrub_target,
        }
    }

    /// Polls decoder warm-up. If playback has just started, arms the pacing grid and
    /// redraws. Called from the sources that drive warm-up: decoded frames, decoder
    /// open, and the timeout.
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

    // ---- `user_event` command handlers (split out to keep the dispatch small) ----

    /// `MonitorCommand::Play`.
    fn handle_play(&mut self) {
        if let Some(s) = self.state.as_mut() {
            s.play();
            // If the start is instant (no video to warm up) we arm the pacing grid
            // here. Otherwise prewarm is driven by VideoFrameReady / timeout (see
            // drive_prebuffer), and about_to_wait sleeps until the warm-up deadline.
            if s.clock.is_playing() {
                self.next_redraw_at = Some(Instant::now());
            }
            s.render_current_frame();
        }
    }

    /// `MonitorCommand::Seek`.
    fn handle_seek(&mut self, ev_time: f64, ev_explicit: bool) {
        // Read-and-clear slot: collapse a burst of scrub-seeks down to the latest
        // position. A fresh `Seek` always finds a non-empty slot (the writer
        // overwrites it BEFORE sending the event); a stale one finds it empty,
        // because the previous event already took the latest target → no-op. So in
        // the transition zone (expensive synchronous render) only the last position
        // is drawn, not every one in turn. The event payload is a fallback in case
        // of desync (in theory the slot is never empty before the event is handled,
        // but it's cheaper to be safe than to drop a seek).
        let target = match self.scrub_target.lock() {
            // None → this `Seek` is stale (the latest target was already taken by a
            // previous event) → do nothing.
            Ok(mut slot) => slot.take(),
            // Poisoned mutex — extremely unlikely; don't lose the seek.
            Err(_) => Some((ev_time, ev_explicit)),
        };
        let Some((time_sec, explicit)) = target else {
            return;
        };
        if let Some(s) = self.state.as_mut() {
            s.seek(time_sec, explicit);
            // While playing (or warming up a micro-prime after an explicit
            // seek) the tick/prebuffer paths own rendering — just refresh the
            // current frame. While paused, `WindowState::seek` repositions any
            // EXISTING runtimes but never creates one, so a scrub into a clip
            // whose decoder was never opened (or was evicted) would show black
            // until Play. Route paused seeks through `refresh_paused_display`,
            // which guarantees `ensure_runtime_for` spawns the decoder at the
            // playhead and shows the frame as soon as it decodes.
            if s.clock.is_playing() || s.pending_play_deadline.is_some() {
                s.render_current_frame();
            } else {
                s.refresh_paused_display();
            }
        }
    }

    /// `MonitorCommand::BgReady`: drain background-load results, then advance the
    /// prebuffer (a decoder may have just opened during warm-up) or refresh display.
    fn handle_bg_ready(&mut self) {
        while let Ok(result) = self.bg_rx.try_recv() {
            if let Some(s) = self.state.as_mut() {
                s.layers.apply_bg_result(result);
            }
        }
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

    /// `MonitorCommand::VideoFrameReady`.
    fn handle_video_frame_ready(&mut self) {
        // Pre-start warm-up: every decoded frame is a chance to check whether we
        // have accumulated enough ahead of the playhead to start.
        if self.is_prebuffering() {
            self.drive_prebuffer();
        } else if let Some(s) = self.state.as_mut() {
            // While playing, frames are picked up on the next timer-paced tick (see
            // about_to_wait/new_events) — an extra redraw here would only spin the
            // loop. It is only needed while paused/scrubbing, to show a frame that
            // has just caught up.
            if !s.clock.is_playing() {
                s.refresh_paused_display();
            }
        }
    }

    /// `MonitorCommand::OpenNativeWindow`.
    fn handle_open_native_window(&mut self, event_loop: &ActiveEventLoop) {
        log::info!("[monitor] open native window requested");
        if self.pending_viewport.is_none() {
            self.pending_viewport = Some(default_native_window_viewport());
        }
        if self.state.is_none() {
            self.try_create_state();
        }
        if let Some(s) = self.state.as_mut() {
            if let Err(error) = s.open_native_window(event_loop) {
                log::error!("[monitor] open native window failed: {error:?}");
            }
            s.render_current_frame();
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
        // We draw a playback frame strictly when the WaitUntil deadline set in
        // about_to_wait expires — that is the preview_fps pacing.
        //
        // MONITOR PACING INVARIANT (history: the monitor dropped to ~10fps on 4K/XWayland,
        // see memory monitor-playback-seek-thrash). Three linked rules, not to be broken
        // separately:
        //   1) render HERE, directly, not via `request_redraw` (which under XWayland adds
        //      ~65ms of RedrawRequested delivery latency);
        //   2) advance the next-frame deadline ONLY here, after rendering;
        //   3) `about_to_wait` does NOT recompute the deadline, only re-arms the saved one —
        //      otherwise spurious wake-ups (WaitCancelled) shift the grid and halve the fps.
        if matches!(cause, StartCause::ResumeTimeReached { .. }) {
            // Pre-start warm-up timeout: the deadline expired — start playback even if
            // the decoder didn't decode frames ahead (the anti-hang fallback).
            if self.is_prebuffering() {
                self.drive_prebuffer();
            }
            let is_playing = self
                .state
                .as_ref()
                .map(|s| s.clock.is_playing())
                .unwrap_or(false);
            if is_playing {
                // Render DIRECTLY on the pacing timer. The `request_redraw` →
                // `RedrawRequested` path under X11/XWayland adds ~65ms of delivery latency
                // (measured), capping the monitor at ~10fps. The timer already paces (see
                // about_to_wait), so no busy-loop arises.
                let frame_duration = self
                    .state
                    .as_ref()
                    .map(|s| Duration::from_secs_f64(1.0 / s.layers.preview_fps.max(1.0)))
                    .unwrap_or_else(|| Duration::from_millis(33));
                if let Some(s) = self.state.as_mut() {
                    s.tick_and_render();
                }
                // Advance the next-frame deadline ONLY after a real render. Otherwise
                // spurious wake-ups (WaitCancelled from frontend IPC arriving right at the
                // deadline) made `about_to_wait` jump the grid by +1 frame and drop every
                // other frame (halved fps). about_to_wait now only re-arms it.
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
            MonitorCommand::Play => self.handle_play(),
            MonitorCommand::Pause => {
                if let Some(s) = self.state.as_mut() {
                    s.pause();
                    // Render the exact stop frame synchronously: while playing, the
                    // canvas stream runs through a pipelined readback (1 frame of
                    // latency), so the last shown frame is 1 behind the pause point.
                    // This synchronous render (the !is_playing path) lands exactly on
                    // the playhead frame.
                    s.render_current_frame();
                }
                self.next_redraw_at = None;
            }
            MonitorCommand::Seek { time_sec, explicit } => self.handle_seek(time_sec, explicit),
            MonitorCommand::SetSpeed(speed) => {
                if let Some(s) = self.state.as_mut() {
                    let playing = s.clock.is_playing();
                    s.set_speed(speed);
                    // Reverse / speed changes must tick the clock immediately — re-arm
                    // the deadline, otherwise a previously stopped timer never updates
                    // the frame.
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
            MonitorCommand::SetOutputGain(gain) => {
                if let Some(s) = self.state.as_mut() {
                    s.set_output_gain(gain);
                }
            }
            MonitorCommand::SetMasterGain(gain) => {
                if let Some(s) = self.state.as_mut() {
                    s.set_master_gain(gain);
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
            MonitorCommand::BgReady => self.handle_bg_ready(),
            MonitorCommand::VideoFrameReady => self.handle_video_frame_ready(),
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
            MonitorCommand::OpenNativeWindow => self.handle_open_native_window(event_loop),
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
            MonitorCommand::UnsetFrameChannel => {
                if let Some(s) = self.state.as_mut() {
                    s.frame_channel = None;
                    s.canvas_readback = None;
                }
                self.pending_frame_channel = None;
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
                // Pre-start warm-up: periodically poll video AND audio readiness (see
                // PREBUFFER_POLL_INTERVAL) — audio-only scenes don't send VideoFrameReady,
                // otherwise the start would wait for the full timeout. No later than the
                // warm-up deadline itself.
                Some(deadline) => {
                    let poll_at = (Instant::now() + PREBUFFER_POLL_INTERVAL).min(deadline);
                    event_loop.set_control_flow(ControlFlow::WaitUntil(poll_at));
                }
                None => event_loop.set_control_flow(ControlFlow::Wait),
            }
            return;
        }
        // PACING INVARIANT (paired with new_events, see there): the deadline advances ONLY
        // after a render (in new_events). Here we only (re-)arm the already-saved deadline —
        // recomputing it on every wake-up would let spurious events (WaitCancelled) shift
        // the grid and halve the fps. The render happens in new_events(ResumeTimeReached),
        // not here, otherwise a redraw would dispatch immediately (busy-loop, 100% GPU).
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

/// Sends an RGBA frame to the frontend over the canvas channel: an 8-byte header
/// (`u32 LE width`, `u32 LE height`) + tightly-packed RGBA8 pixels.
fn send_canvas_frame(
    channel: &Channel<InvokeResponseBody>,
    width: u32,
    height: u32,
    pixels: Vec<u8>,
) -> bool {
    let mut payload = Vec::with_capacity(8 + pixels.len());
    payload.extend_from_slice(&width.to_le_bytes());
    payload.extend_from_slice(&height.to_le_bytes());
    payload.extend_from_slice(&pixels);
    if let Err(e) = channel.send(InvokeResponseBody::Raw(payload)) {
        log::warn!("[monitor] frame channel send: {e:?}");
        return false;
    }
    true
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
    audio_output_gain: f64,
    audio_master_effects: Vec<AudioEffectSpec>,
    /// Last applied audio settings, kept so the output-stall watchdog can rebuild
    /// the engine with the same backend/buffer config the user selected.
    audio_settings: AudioEngineSettings,

    last_emit_pts: f64,
    /// Last RMS/peak (dB) pushed to the UI meter; suppresses duplicate emits so a
    /// steady level (e.g. repeated silence) doesn't spam IPC every frame.
    last_emit_levels: (f64, f64),
    last_emit_tracks: std::collections::HashMap<String, (f64, f64)>,
    /// Throttle for `audio.prune_distant_layers`: pruning locks the shared audio
    /// state (contends with the producer), so we run it at most ~1×/sec, not per frame.
    last_audio_prune: Instant,
    last_viewport: ViewportSpec,
    mode: MonitorMode,
    /// Channel for streaming RGBA frames to the frontend (Canvas mode only).
    frame_channel: Option<Channel<InvokeResponseBody>>,
    /// Render target size in canvas mode (physical pixels).
    canvas_size: (u32, u32),
    /// wgpu dev_id for the offscreen render; taken from the existing surface.
    offscreen_dev_id: usize,
    /// Pipelined (async-map) readback for the canvas stream during playback.
    /// Removes the blocking `device.poll(wait_indefinitely)` from the event loop at the
    /// cost of one frame of latency. NOT used while paused/scrubbing (there a guaranteed
    /// frame is needed synchronously), and reset to `None`, freeing the GPU buffers.
    canvas_readback: Option<PipelinedReadback>,
    /// Decoder warm-up deadline before the clock starts. `Some` — Play was requested but
    /// playback hasn't begun yet (waiting for frames ahead of the playhead or a timeout).
    /// `None` — either playing or paused.
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
        self.audio_master_effects
            .clone_from(&scene.audio_master_effects);

        if let Some(audio) = self.audio.as_ref() {
            audio.set_scene(
                &scene.audio_layers,
                &scene.audio_tracks,
                master_gain,
                &scene.audio_master_effects,
            );
        }
        self.layers.apply_scene(scene);
        // While paused, immediately spawn/position the active video layers' decoders at
        // the playhead, otherwise they wouldn't be created until the first Play (decoders
        // spawn only here and in tick): the monitor would be black on load and the first
        // Play would start into nothing. During playback tick brings up runtimes itself —
        // no repeat warm-up needed.
        if !self.clock.is_playing() {
            self.refresh_paused_display();
        } else {
            self.render_current_frame();
        }
    }

    fn recreate_audio(&mut self, settings: AudioEngineSettings) {
        self.audio_settings = settings.clone();
        // A micro-prime already in flight (pending_play_deadline) means the transport
        // is logically playing even though the master clock is momentarily frozen.
        let playing = self.clock.is_playing() || self.pending_play_deadline.is_some();
        let pts = self.clock.current_pts();
        self.audio = match NativeAudioEngine::new(&settings) {
            Ok(audio) => {
                audio.set_scene(
                    &self.audio_layers,
                    &self.audio_tracks,
                    self.audio_master_gain,
                    &self.audio_master_effects,
                );
                audio.set_output_gain(self.audio_output_gain);
                if !playing {
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

        // Re-establishing audio mid-playback must NOT just `play()` from `pts`: the
        // master clock keeps free-running while the new producer spends ~START_PREBUFFER
        // (~400ms) filling its ring, so the engine would arm its output that far BEHIND
        // the clock, and the next `sync_to_audio_pts` would yank the video backward by
        // the gap (a visible jump on device-loss recovery / a live settings change).
        // Instead restart through the same warmup path as an explicit seek: freeze the
        // clock, prime audio (and re-arm the video decoders) at `pts`, and let
        // `begin_playback` release both together so their origins line up.
        if playing && self.audio.is_some() {
            let t = pts.max(0.0);
            if let Some(audio) = self.audio.as_ref() {
                audio.start_priming(t);
            }
            self.clock.pause();
            self.layers.set_playing(true);
            self.layers.resync_active_videos(t);
            self.layers.set_frame_events_enabled(true);
            self.pending_play_deadline = Some(Instant::now() + PREBUFFER_TIMEOUT);
        }
    }

    /// Rebuilds the audio engine if its output device stream died (sink unplugged,
    /// default device switched, backend disconnect). When that happens the producer
    /// keeps mixing into a ring no callback drains, so audio would stay silent for
    /// the rest of the session without a manual settings change. Cheap to poll: it
    /// only samples a couple of atomics unless an actual stall is detected.
    fn check_audio_health(&mut self) {
        if self
            .audio
            .as_ref()
            .is_some_and(NativeAudioEngine::output_stalled)
        {
            log::error!("[audio] output stream stalled (device lost?); rebuilding audio engine");
            let settings = self.audio_settings.clone();
            self.recreate_audio(settings);
        }
    }

    fn update_hw_settings(&mut self, settings: crate::FfmpegHwSettings) {
        let t = self.clock.current_pts();
        let playing = self.clock.is_playing();
        if self.layers.update_hw_settings(settings) {
            if playing {
                // During playback the next `tick` recreates the decoders (it calls
                // `ensure_runtime_for`); here we only reposition.
                self.layers.seek(t, playing);
            } else {
                // While paused `tick` doesn't run, and `layers.seek` does NOT create
                // runtimes — after dropping the video decoders (an hwaccel change resets
                // them) the scene would be left with no decoders and the monitor black
                // until the next Play/scrub. Go through refresh_paused_display: it reliably
                // spawns decoders at the playhead.
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
                        // Create the window hidden: show it only after the first render
                        // into the surface (below). Otherwise the WM maps the window before
                        // the first frame reaches the swapchain, and it flashes black for
                        // 1–2 frames at the start.
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
        // Draw the first frame into the surface BEFORE showing the window — then it
        // appears already with a picture, without a black flash.
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

    /// While paused: pulls frames that caught up to the playhead into `current` and
    /// redraws. Without this, a frame decoded after a seek/decoder-open would stay in the
    /// cache unshown and the monitor black until the first Play.
    fn refresh_paused_display(&mut self) {
        let t = self.clock.current_pts();
        let dev_id = self.offscreen_dev_id;
        let device = self.compositor.device(dev_id);
        let queue = self.compositor.queue(dev_id);
        self.layers.refresh_display(t, device, queue);
        self.render(t);
    }

    /// Requests playback. For scenes with video it first warms decoders up to the
    /// playhead (prebuffer), and the clock/audio start later in `begin_playback`, once
    /// frames are decoded ahead — otherwise 4K freezes at start while the GOP decodes.
    /// For scenes with no active video (audio/images only) the start is instant.
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
        // Bring up the decoders: tell them to play and reposition to the playhead so the
        // forward stream is correct after a cache scrub. The clock is still stopped here.
        self.layers.set_playing(true);
        self.layers.resync_active_videos(t);
        // During pre-start warm-up VideoFrameReady is needed (it drives poll_prebuffer);
        // begin_playback disables it once frames flow on the pacing timer.
        self.layers.set_frame_events_enabled(true);

        // Warm audio in parallel with video: the producer fills the ring to a full
        // prefetch, but output is held silent (hold_output) until `begin_playback`. So the
        // first Play after a cold load starts with a full buffer rather than an immediate
        // underrun (crackle + sped-up sound).
        if has_audio {
            if let Some(audio) = self.audio.as_ref() {
                audio.start_priming(t.max(0.0));
            }
        }

        // Nothing to warm (no active video and no audio) — start immediately.
        if !self.layers.has_active_video(t) && !has_audio {
            self.begin_playback();
            return;
        }
        self.pending_play_deadline = Some(Instant::now() + PREBUFFER_TIMEOUT);
    }

    /// The actual playback start: starts the master clock and audio from the current
    /// playhead. The decoders are already playing and positioned (see `play`).
    fn begin_playback(&mut self) {
        let pts = self.clock.current_pts();
        log::info!("[monitor] begin_playback at pts={pts:.3}s");
        self.pending_play_deadline = None;
        // Frames are now pulled on the pacing timer — disable idle VideoFrameReady.
        self.layers.set_frame_events_enabled(false);
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

    /// Polls warm-up. Returns `true` if playback has just started (the clock began) —
    /// the caller must arm the pacing grid and redraw. Starts when frames ahead of the
    /// playhead are ready, or on the timeout.
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
            // Still warming. The playhead stop frame is already on screen: the synchronous
            // path drew it on entering Play/Seek (render_current_frame), and during warm-up
            // `current` doesn't change (poll only pulls frames into the cache, without
            // moving the displayed frame). So do NOT redraw here — otherwise every poll
            // (every ~10ms + on each VideoFrameReady) would do a full composite with a
            // blocking GPU readback of the same frame, taking resources from the decoder
            // exactly during warm-up (especially painful on 4K).
            false
        }
    }

    /// Global transport speed. Re-anchors the master clock and audio engine to the
    /// current position so the switch is seamless. Reverse (<0) and non-1× audio are
    /// handled further down the chain (clock/producer).
    fn set_speed(&mut self, speed: f64) {
        self.clock.set_speed(speed);
        // The clock is the authoritative timeline position and stays correct even
        // across reverse spans (where audio is silent), so anchor audio to it.
        let anchor = self.clock.current_pts().max(0.0);
        self.layers.set_playback_speed(speed);
        if let Some(audio) = self.audio.as_ref() {
            audio.set_speed(speed, anchor);
        }
    }

    fn set_output_gain(&mut self, gain: f64) {
        self.audio_output_gain = if gain.is_finite() {
            gain.clamp(0.0, 10.0)
        } else {
            1.0
        };
        if let Some(audio) = self.audio.as_ref() {
            audio.set_output_gain(self.audio_output_gain);
        }
    }

    fn set_master_gain(&mut self, gain: f64) {
        self.audio_master_gain = crate::audio::mix::sanitize_master_gain(gain);
        if let Some(audio) = self.audio.as_ref() {
            audio.set_master_gain(self.audio_master_gain);
        }
    }

    fn pause(&mut self) {
        // Warm-up interrupted by a pause request — cancel the deferred start.
        self.pending_play_deadline = None;
        // On reverse / non-audible speed, audio is silent and the master clock is the
        // PlaybackClock itself, so we freeze its position. On normal forward audio the
        // source of truth is the audio ring, so we pull to the audible position.
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
        // While paused VideoFrameReady is needed again: it pulls a frame that caught up to
        // the playhead into the display (refresh_paused_display).
        self.layers.set_frame_events_enabled(true);
        // The output callback drops to silence on pause, but `emit_audio_levels`
        // only runs while ticking, so the UI meter would otherwise freeze at its
        // last pre-pause value. Push one zeroed update so it falls to the floor, and
        // record it as the new baseline so the next tick's dedup compares against the
        // floor (not the stale loud value, which would force a redundant re-emit).
        self.last_emit_levels = (
            super::audio_telemetry::LEVEL_FLOOR_DB,
            super::audio_telemetry::LEVEL_FLOOR_DB,
        );
        self.last_emit_tracks.clear();
        if let Some(audio) = self.audio.as_ref() {
            audio.clear_track_levels();
        }
        super::audio_telemetry::emit_audio_levels_floor(&self.app);
    }

    fn seek(&mut self, timeline_sec: f64, explicit: bool) {
        let t = timeline_sec.max(0.0);
        let had_pending = self.pending_play_deadline.is_some();

        // Redundant-echo guard (see SEEK_PRIME_REDUNDANT_SEC). While a prebuffer /
        // micro-prime is in flight the clock is frozen at the prime target; a seek to
        // ~that position is a frontend echo and must be a no-op. Restarting the prime
        // on each echo wipes the ring and it never completes → transport jam.
        if had_pending && (t - self.clock.current_pts()).abs() < SEEK_PRIME_REDUNDANT_SEC {
            return;
        }

        // Does the transport intend to keep playing? This must NOT be read from
        // `clock.is_playing()` alone: a micro-prime in flight has paused the clock
        // (had_pending), yet the transport is still logically playing. Conflating the
        // two was the jam — the next seek dropped to a paused state while the frontend
        // still thought it was playing, and no further `monitor:time` ever arrived.
        let transport_playing = self.clock.is_playing() || had_pending;

        // Seek during warmup cancels the deferred start: the position changed, so we
        // re-establish the prime at the new spot below (if still playing).
        if had_pending {
            self.pending_play_deadline = None;
            self.layers.set_playing(false);
        }

        log::trace!(
            "[monitor] seek to {t:.3}s, explicit={explicit}, transport_playing={transport_playing}"
        );
        self.clock.seek(t);
        if let Some(audio) = self.audio.as_ref() {
            audio.seek(t, transport_playing, explicit);
        }
        self.layers.seek(t, transport_playing);

        if !transport_playing {
            // Do NOT start priming on a paused seek. The frontend sends explicit
            // seeks for every user scrub, and priming sets `playing=true`, which
            // blocks the forward-scrub audio preview (`scrub_preview` returns
            // early when `playing`). `play()` starts priming anyway when the user
            // actually hits Play, so there is no loss.
        }

        // After a real user seek during playback the audio ring was flushed and the
        // callback stopped. If we let the clock keep running, video races ahead while
        // the producer refills the ring. When the callback restarts (after only
        // START_PREBUFFER_CHUNKS chunks) the ring can underrun under decoder-seek load
        // → crackle + sped-up resync. So we do a micro-prime: freeze the video clock,
        // refill the ring, and restart both together once audio is fully primed. A
        // genuine drag re-targets the prime on each move; the echo guard above keeps
        // the stationary echoes from restarting it.
        if transport_playing && explicit {
            if let Some(audio) = self.audio.as_ref() {
                if !audio.is_empty() {
                    log::info!("[monitor] micro-priming audio after explicit seek to {t:.3}s");
                    self.clock.pause();
                    audio.start_priming(t);
                    self.layers.set_playing(true);
                    self.layers.resync_active_videos(t);
                    // The clock is frozen during the micro-prime — VideoFrameReady drives
                    // warm-up again (begin_playback disables it at the actual start).
                    self.layers.set_frame_events_enabled(true);
                    self.pending_play_deadline = Some(Instant::now() + PREBUFFER_TIMEOUT);
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Main tick
    // -----------------------------------------------------------------------

    fn tick_and_render(&mut self) {
        // Recover from a dead output device before reading the audio clock, so a
        // rebuilt engine is the one driving this frame's sync.
        self.check_audio_health();
        // TIME-SOURCE INVARIANT: to pick a frame we use the SMOOTHED `clock.current_pts()`,
        // NOT the raw `audio_pts`. `current_pts` (the audible position) jitters by an
        // audio-chunk amount (~50ms) because it subtracts the instantaneous ring fill —
        // used directly, frames jump backward. `PlaybackClock` runs on the wall-clock and
        // pulls to audio only on significant drift (see `sync_to_audio_pts`), so `t` is
        // monotonic and smooth.
        if let Some(audio_pts) = self.audio.as_ref().and_then(NativeAudioEngine::current_pts) {
            self.clock.sync_to_audio_pts(audio_pts);
        }
        let t = self.clock.current_pts();

        // Reverse reached the start of the timeline — stop at zero.
        if self.clock.is_playing() && self.clock.speed() < 0.0 && t <= 0.0 {
            self.clock.seek(0.0);
            self.pause();
            let _ = self.app.emit(EVT_ENDED, ());
            self.emit_time(0.0);
            self.render(0.0);
            return;
        }

        // Detect the end of the scene during playback (forward only).
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
                // covers() is a half-open interval [start; end): at t == scene_end no layer
                // is active and the scene would be empty (a black frame). Render 1 ms before
                // the end to hold the clip's last frame.
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
        self.emit_audio_levels();

        // Bound long-playback memory: drop audio decoders/windows for clips the
        // playhead has left behind. Throttled (~1×/sec) to limit lock contention
        // with the producer.
        if self.last_audio_prune.elapsed() >= Duration::from_secs(1) {
            if let Some(audio) = self.audio.as_ref() {
                audio.prune_distant_layers(t);
            }
            self.last_audio_prune = Instant::now();
        }
    }

    fn emit_time(&mut self, t: f64) {
        // Suppress duplicates: on pause / repeated redraws don't send the same PTS twice.
        if (t - self.last_emit_pts).abs() < 1e-6 {
            return;
        }
        self.last_emit_pts = t;
        let _ = self.app.emit(EVT_TIME, t);
    }

    fn emit_audio_levels(&mut self) {
        let Some(audio) = self.audio.as_ref() else {
            return;
        };
        super::audio_telemetry::emit_audio_levels(
            &self.app,
            audio,
            &mut self.last_emit_levels,
            &mut self.last_emit_tracks,
        );
    }

    // -----------------------------------------------------------------------
    // Render
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
                    // Playback: a continuous stream of frames — use pipelined async
                    // readback so the event loop is NOT blocked on `device.poll` (otherwise
                    // IPC/audio/decoder events wait for the whole readback; painful at high
                    // preview_fps and on heavy scenes). The cost is 1 frame of latency.
                    let need_new = match &self.canvas_readback {
                        Some(s) => !s.matches(dev_id, width, height),
                        None => true,
                    };
                    if need_new {
                        match self
                            .compositor
                            .begin_pipelined_readback(dev_id, width, height, 2)
                        {
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
                            // The oldest ready frame (the previous one) — hand it to the frontend.
                            Ok(Some(pixels)) => {
                                if !send_canvas_frame(&channel, width, height, pixels) {
                                    self.frame_channel = None;
                                    self.canvas_readback = None;
                                }
                            }
                            // The GPU hasn't caught up yet (the first frame after start) — skip,
                            // the last synchronous freeze-frame stays on screen.
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
                    // Pause/scrub/single frame: a GUARANTEED frame is needed right now
                    // (there may be no next render), so do a synchronous readback. Release
                    // the pipelined session — its GPU buffers aren't needed while paused.
                    self.canvas_readback = None;
                    match self
                        .compositor
                        .render_scene_to_pixels(dev_id, &scene, width, height)
                    {
                        Ok(pixels) => {
                            if !send_canvas_frame(&channel, width, height, pixels) {
                                self.frame_channel = None;
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
}

// ---------------------------------------------------------------------------
// Window initialization
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
        .state::<parking_lot::RwLock<crate::FfmpegHwSettings>>()
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
        audio_output_gain: 1.0,
        audio_master_effects: Vec::new(),
        audio_settings,
        last_emit_pts: -1.0,
        last_emit_levels: (f64::NAN, f64::NAN),
        last_emit_tracks: std::collections::HashMap::new(),
        last_audio_prune: Instant::now(),
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
