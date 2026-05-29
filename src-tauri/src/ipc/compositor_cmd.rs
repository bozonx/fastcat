//! Команды композитора. Сейчас offscreen-рендер не реализован — Compositor живёт
//! в monitor-потоке (wgpu device/surface/vello renderer привязаны к нему).
//! Для frontend нужен отдельный путь (запрос кадра → ответ через канал), добавим позже.

use serde::{Deserialize, Serialize};

use crate::compositor::scene::Scene;

#[derive(Debug, Serialize)]
pub struct RenderFrameResult {
    pub width: u32,
    pub height: u32,
    pub png_base64: Option<String>,
}

#[tauri::command]
pub async fn compositor_render_frame(_scene: Scene) -> Result<RenderFrameResult, String> {
    Err("offscreen compositor render not implemented yet (Compositor lives in monitor thread)".into())
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
pub async fn media_open(_params: OpenMediaParams) -> Result<OpenMediaResult, String> {
    Err("media_open not implemented".into())
}
