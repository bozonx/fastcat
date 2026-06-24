//! Thin handle to the monitor thread. Held in `VideoEngine` and shared across Tauri commands.

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

/// Monitor output mode.
/// - `Embedded` — the native monitor window as a separate platform window.
/// - `Canvas` — offscreen render, streaming RGBA frames to an HTML `<canvas>` via a Tauri Channel.
///   Lets SVG/HTML overlays (transform handles, grid, timecode) sit on top of the image.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[derive(Default)]
pub enum MonitorMode {
    #[default]
    Embedded,
    Canvas,
}

/// Latest-wins scrub-target slot, shared between `MonitorHandle` (writer) and the
/// event loop (reader). Each `Seek` command overwrites it before sending the event;
/// the handler read-and-clears it in the loop, collapsing a burst of scrub-seeks into
/// the last position (see `MonitorApp::scrub_target`).
pub type ScrubTarget = Arc<Mutex<Option<(f64, bool)>>>;

pub enum MonitorCommand {
    /// Full scene replacement — the frontend sends the current timeline snapshot.
    SetScene(MonitorScene),
    Play,
    Pause,
    /// Seek by timeline time (seconds). `explicit` means an explicit user scrub
    /// (playhead click/drag) that must NEVER be swallowed by the echo-seek guard.
    /// `false` means a programmatic / possibly-echo seek (the safety path).
    Seek {
        time_sec: f64,
        explicit: bool,
    },
    /// Global transport speed (timeline-time multiplier).
    /// >0 — forward (1.0 normal), <0 — reverse (audio is muted).
    SetSpeed(f64),
    /// Audio preview while scrubbing forward: a one-shot snippet
    /// `[from_sec, from_sec + duration_sec)`, played only when normal playback is not
    /// running and without moving the transport.
    ScrubPreview {
        from_sec: f64,
        duration_sec: f64,
    },
    /// Stop the current scrub preview (the drag has ended).
    StopScrubPreview,
    Close,
    /// Update the native audio engine settings.
    SetAudioSettings(crate::audio::engine::AudioEngineSettings),
    /// Post-mix monitor output gain/mute. Applies only to live monitor output.
    SetOutputGain(f64),
    /// Timeline master gain. Updates the live mixer without replacing the scene.
    SetMasterGain(f64),
    /// Update FFmpeg/hwaccel settings for new video decoders.
    SetHwSettings(crate::FfmpegHwSettings),
    /// A background thread finished loading a layer — the event loop must drain bg_rx.
    BgReady,
    /// A video frame was decoded.
    VideoFrameReady,
    /// Position/size of the offscreen/native monitor window in physical pixels.
    /// The first call with a non-empty rect creates the window; later ones move/resize it.
    SetViewport {
        x: i32,
        y: i32,
        width: u32,
        height: u32,
        visible: bool,
    },
    /// Show the standalone native monitor window.
    OpenNativeWindow,
    /// Switch the output mode (see `MonitorMode`).
    SetMode(MonitorMode),
    /// Register the channel for streaming RGBA frames in canvas mode.
    /// Each frame: an 8-byte header (`u32 LE width`, `u32 LE height`) + RGBA8 pixels.
    SetFrameChannel(Channel<InvokeResponseBody>),
    /// Reset the RGBA-frame stream channel (e.g. when the canvas element unmounts).
    UnsetFrameChannel,
    /// Render target size in canvas mode (physical pixels). May differ from `SetViewport`.
    SetCanvasSize {
        width: u32,
        height: u32,
    },
}

pub struct MonitorHandle {
    proxy: EventLoopProxy<MonitorCommand>,
    _thread: Option<JoinHandle<()>>,
    /// Set to false when the event loop has exited. Faster than a Ping round-trip.
    alive: Arc<AtomicBool>,
    /// Latest-wins scrub target (see `ScrubTarget`). Written in `send` before each
    /// `Seek`, read by the event loop.
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
        // Record the latest scrub target BEFORE sending the event: while the event loop
        // synchronously renders one frame, newer `Seek`s overwrite the slot, and stale
        // events find it empty and collapse into a no-op (see `ScrubTarget`).
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
