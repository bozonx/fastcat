//! GPU-resident texture cache — задел под HW-decoded видеокадры и group-offscreen-кеш.
//!
//! Сейчас весь рендер идёт через CPU-blob (`peniko::ImageData`). Vello внутренне
//! кеширует GPU-аплоад по identity `peniko::Blob`, поэтому повторный клон одной
//! и той же `ImageData` (статичная картинка) не перезаливается.
//!
//! Этот модуль активируется когда появятся:
//!   - HW-decode видео (VAAPI / VideoToolbox / D3D11) — декодер пишет в
//!     `wgpu::Texture`, минуя CPU readback;
//!   - `LayerKind::Group` — offscreen-композит детей кешируется между кадрами
//!     до изменения дочерних слоёв.
//!
//! План активации:
//!   1. Реализовать `TextureCache::{insert, get, remove}` поверх `wgpu::Device`.
//!   2. Добавить вариант `RasterSource::GpuHandle(TextureKey)` в [`super::scene::RasterSource`].
//!   3. Расширить `Scene::to_vello`: для GPU-handle либо readback в `ImageData`,
//!      либо custom WGSL-pass до vello-композита.

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
        let key = self.next_key.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
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
