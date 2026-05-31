//! Нативный монитор: отдельное winit-окно с wgpu surface, рендер через Vello.
//!
//! Раскладка:
//! - `app`      — winit ApplicationHandler (`MonitorApp`) + `WindowState` (coordinator).
//! - `clock`    — `PlaybackClock`: арифметика timeline-времени без знания о GPU/UI.
//! - `frame_cache` — `VideoFrameCache` + sampler: кеш декодированных кадров на слой.
//! - `runtime`  — `LayerRuntimeManager`: lifecycle декодеров, diff сцен, compositor-снимок.
//! - `handle`   — `MonitorHandle`: тонкий proxy к потоку монитора.
//! - `scene`    — IPC-DTO от фронта: `MonitorScene`, `SceneLayer`, `SceneLayerTransform`.

mod app;
mod clock;
mod frame_cache;
mod handle;
pub mod runtime;
pub mod scene;

pub use handle::{MonitorCommand, MonitorHandle, MonitorMode, SendableRawHandle};
pub use scene::{LayerKind, MonitorScene, SceneLayer};
