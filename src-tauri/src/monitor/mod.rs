//! Нативный монитор: отдельное окно (winit) с wgpu surface, отрисовка через Vello.
//!
//! Минимальная реализация: окно живёт на собственном потоке (winit event loop),
//! принимает команды play/pause/seek/open через `EventLoopProxy::send_event`.
//! Декодер ffmpeg крутится в том же потоке — для baseline-плеера этого достаточно.

mod app;
mod handle;
pub mod scene;

pub use handle::{MonitorCommand, MonitorHandle, SendableRawHandle};
pub use scene::{LayerKind, MonitorScene, SceneLayer};
