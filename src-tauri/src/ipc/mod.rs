//! Tauri-команды, экспортируемые на фронт.
//!
//! Сейчас единственная группа — `monitor_cmd` (управление нативным монитором).
//! Off-screen рендер (для экспорта/thumbnail воркера) будет добавлен поверх
//! существующей timeline-модели (`MonitorScene`) отдельной командой
//! `monitor_render_at(timeline_sec, w, h)`, а не через параллельный per-frame DTO.

pub mod fonts_cmd;
pub mod fs_scope_cmd;
pub mod media_cmd;
pub mod monitor_cmd;
