//! Media pipeline: декод видео на стороне Rust.
//!
//! Сейчас: один процесс ffmpeg на открытый клип, frame queue читается из отдельного потока.
//! Аудио в Tauri-сборке намеренно отключено — звук обеспечивает веб-AudioEngine (web-сборка).

use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::Mutex;

pub type GpuTexturePool = Arc<Mutex<HashMap<(u32, u32), Vec<wgpu::Texture>>>>;
pub use decode::SharedTexture;

pub mod audio_extract;
pub mod decode;
pub mod ffmpeg;
pub mod hwaccel;
pub mod image_decode;
pub mod processing;
pub mod tasks;
pub mod temp;
pub mod timeline_export;
pub mod timeline_render;
pub mod types;
