//! Tauri-команды, экспортируемые на фронт. Все команды композитора — здесь.
//! Принципы:
//!   - принимаем сериализованный Scene (JSON) — единый формат с фронта.
//!   - крупные данные (frame buffers) НЕ через invoke; для монитора — через Tauri event/IPC
//!     или через регистрируемый custom URI scheme. См. doc/tauri-compositor.md (вопрос про monitor).

pub mod compositor_cmd;
