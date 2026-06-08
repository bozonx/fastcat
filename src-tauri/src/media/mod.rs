//! Media pipeline: декод видео на стороне Rust.
//!
//! Сейчас: один процесс ffmpeg на открытый клип, frame queue читается из отдельного потока.
//! Аудио в Tauri-сборке намеренно отключено — звук обеспечивает веб-AudioEngine (web-сборка).

use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::Mutex;

pub type GpuTexturePool = Arc<Mutex<HashMap<(u32, u32), Vec<wgpu::Texture>>>>;

pub mod audio_extract;
pub mod decode;
pub mod decode_gate;
pub mod decode_thread;
pub mod ffmpeg_args;
pub mod ffmpeg_runner;
pub mod ffmpeg_utils;
pub mod hwaccel;
pub mod image_decode;
pub mod processing;
pub mod tasks;
pub mod timeline_export;
pub mod timeline_render;
pub mod types;
