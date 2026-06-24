//! Tauri commands exported to the frontend.
//!
//! Currently the only group is `monitor_cmd` (native monitor control).
//! Off-screen rendering (for the export/thumbnail worker) will be added on top of
//! the existing timeline model (`MonitorScene`) as a separate command
//! `monitor_render_at(timeline_sec, w, h)`, not via a parallel per-frame DTO.

pub mod fonts_cmd;
pub mod fs_scope_cmd;
pub mod media_cmd;
pub mod monitor_cmd;
