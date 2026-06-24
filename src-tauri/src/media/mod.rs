//! Media pipeline: video decoding on the Rust side.
//!
//! Currently: one ffmpeg process per open clip; the frame queue is read from a separate thread.
//! Audio in the Tauri build is intentionally disabled — sound is provided by the web AudioEngine (web build).

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
