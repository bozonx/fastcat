//! GPU-resident texture cache — задел под HW-decoded видеокадры и group-offscreen-кеш.
//!
//! Vello still describes images as `peniko::ImageData`, but GPU-resident layers
//! are registered through renderer texture overrides, without CPU readback from
//! this cache.
//!
//! Этот модуль активируется когда появятся:
//!   - HW-decode видео (VAAPI / VideoToolbox / D3D11) — декодер пишет в
//!     `wgpu::Texture`, минуя CPU readback;
//!   - `LayerKind::Group` — offscreen-композит детей кешируется между кадрами
//!     до изменения дочерних слоёв.
//!
//! Active path:
//!   1. `TextureCache::{insert, get, remove}` stores wgpu textures by key.
//!   2. `RasterSource::GpuHandle(TextureKey)` carries cached GPU frames.
//!   3. `Scene::to_vello` resolves GPU handles to lightweight `ImageData`
//!      handles backed by Vello texture overrides.

/// Стабильный идентификатор GPU-resident текстуры в [`TextureCache`].
/// Получается через `TextureCache::insert`, освобождается через `remove`.
#[derive(Debug, Clone, Copy, Eq, PartialEq, Hash)]
pub struct TextureKey(pub(crate) u64);

/// Кеш wgpu-текстур, привязанный к одному `wgpu::Device`.
pub struct TextureCache {
    next_key: std::sync::atomic::AtomicU64,
    textures: std::collections::HashMap<u64, std::sync::Arc<wgpu::Texture>>,
}

impl TextureCache {
    pub fn new() -> Self {
        Self {
            next_key: std::sync::atomic::AtomicU64::new(1),
            textures: std::collections::HashMap::new(),
        }
    }

    pub fn insert(&mut self, texture: wgpu::Texture) -> TextureKey {
        let key = self
            .next_key
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        self.textures.insert(key, std::sync::Arc::new(texture));
        TextureKey(key)
    }

    pub fn get(&self, key: TextureKey) -> Option<std::sync::Arc<wgpu::Texture>> {
        self.textures.get(&key.0).cloned()
    }

    pub fn remove(&mut self, key: TextureKey) -> Option<std::sync::Arc<wgpu::Texture>> {
        self.textures.remove(&key.0)
    }
}

impl Default for TextureCache {
    fn default() -> Self {
        Self::new()
    }
}
