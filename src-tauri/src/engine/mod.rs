//! Видео-движок: владелец Compositor + media pipeline + frame cache.
//! Singleton: создаётся при старте Tauri и шарится между командами через `tauri::State`.

use anyhow::Result;
use parking_lot::Mutex;

use crate::compositor::Compositor;
use crate::media::frame_cache::FrameCache;

pub struct VideoEngine {
    pub compositor: Mutex<Compositor>,
    pub frame_cache: FrameCache,
}

impl VideoEngine {
    pub async fn new() -> Result<Self> {
        let compositor = Compositor::new().await?;
        Ok(Self { compositor: Mutex::new(compositor), frame_cache: FrameCache::new() })
    }
}
