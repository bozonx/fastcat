//! Native monitor: a separate winit window with a wgpu surface, rendered via Vello.
//!
//! Layout:
//! - `app`      — winit ApplicationHandler (`MonitorApp`) + `WindowState` (coordinator).
//! - `clock`    — `PlaybackClock`: timeline-time arithmetic with no knowledge of GPU/UI.
//! - `frame_cache` — `VideoFrameCache` + sampler: per-layer cache of decoded frames.
//! - `runtime`  — `LayerRuntimeManager`: decoder lifecycle, scene diff, compositor snapshot.
//! - `handle`   — `MonitorHandle`: a thin proxy to the monitor thread.
//! - `scene`    — IPC DTOs from the frontend: `MonitorScene`, `SceneLayer`, `SceneLayerTransform`.

mod app;
mod audio_telemetry;
mod clock;
mod frame_cache;
mod handle;
pub mod layer_runtime;
pub mod runtime;
pub mod scene;

pub use handle::{MonitorCommand, MonitorHandle, MonitorMode};
pub use scene::{LayerKind, MonitorScene, SceneLayer};
