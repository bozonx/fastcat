//! Media pipeline: декод видео/аудио/картинок на стороне Rust.
//!
//! Pipeline (целевой):
//!   file -> demux -> packet -> [video decoder | audio decoder]
//!     video -> hw/sw frame -> upload to wgpu Texture -> texture_id -> compositor::Scene
//!     audio -> PCM -> отправляется в существующий веб audio-движок (звук пока не трогаем)
//!
//! Реализация декодера будет выбрана отдельно — см. doc/tauri-compositor.md
//! (выбор между ffmpeg-next и gstreamer-rs). Скорее всего ffmpeg-next + VAAPI/NVDEC/VideoToolbox.

pub mod decode;
pub mod frame_cache;
