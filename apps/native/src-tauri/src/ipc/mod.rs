//! Tauri commands exported to the frontend.
//!
//! Command groups: `monitor_cmd` (native monitor control), `media_cmd` (media
//! processing, probing, export), `fonts_cmd` (system font enumeration),
//! `fs_scope_cmd` (filesystem scope management).

pub mod fonts_cmd;
pub mod fs_scope_cmd;
pub mod media_cmd;
pub mod monitor_cmd;
pub mod plugin_cmd;
