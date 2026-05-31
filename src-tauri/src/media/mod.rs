//! Media pipeline: декод видео на стороне Rust.
//!
//! Сейчас: один процесс ffmpeg на открытый клип, frame queue читается из отдельного потока.
//! Аудио в Tauri-сборке намеренно отключено — звук обеспечивает веб-AudioEngine (web-сборка).

pub mod decode;
pub mod decode_gate;
pub mod decode_thread;
pub mod image_decode;
