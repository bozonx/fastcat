//! Команды композитора, вызываемые с фронта через invoke().

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::compositor::scene::Scene;
use crate::engine::VideoEngine;

#[derive(Debug, Serialize)]
pub struct RenderFrameResult {
    pub width: u32,
    pub height: u32,
    /// Сейчас — base64 PNG/JPEG для простого тоста монитора (медленно, заменим).
    /// План: переход на shared memory / SharedArrayBuffer или прямой surface (см. doc).
    pub png_base64: Option<String>,
}

#[tauri::command]
pub async fn compositor_render_frame(
    _scene: Scene,
    _engine: State<'_, VideoEngine>,
) -> Result<RenderFrameResult, String> {
    // TODO: engine.compositor.lock().render_to_buffer(&scene, w, h)
    Err("not implemented".into())
}

#[derive(Debug, Deserialize)]
pub struct OpenMediaParams {
    pub path: String,
}

#[derive(Debug, Serialize)]
pub struct OpenMediaResult {
    pub clip_id: String,
    pub width: u32,
    pub height: u32,
    pub duration_sec: f64,
    pub fps: f64,
    pub codec: String,
    pub has_audio: bool,
}

#[tauri::command]
pub async fn media_open(
    _params: OpenMediaParams,
    _engine: State<'_, VideoEngine>,
) -> Result<OpenMediaResult, String> {
    Err("not implemented".into())
}
