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

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// Стабильный идентификатор GPU-resident текстуры в [`TextureCache`].
/// Получается через `TextureCache::insert`, освобождается через `remove`.
#[derive(Debug, Clone, Copy, Eq, PartialEq, Hash)]
pub struct TextureKey(pub(crate) u64);

/// Кеш wgpu-текстур, привязанный к одному `wgpu::Device`.
pub struct TextureCache {
    next_key: AtomicU64,
    textures: HashMap<u64, Arc<wgpu::Texture>>,
    order: VecDeque<u64>,
    max_size: usize,
}

impl TextureCache {
    pub fn new() -> Self {
        Self {
            next_key: AtomicU64::new(1),
            textures: HashMap::new(),
            order: VecDeque::new(),
            max_size: 64,
        }
    }

    pub fn insert(&mut self, texture: wgpu::Texture) -> TextureKey {
        let key = self.next_key.fetch_add(1, Ordering::Relaxed);
        self.textures.insert(key, Arc::new(texture));
        self.order.push_back(key);
        while self.textures.len() > self.max_size {
            if let Some(oldest) = self.order.pop_front() {
                self.textures.remove(&oldest);
            }
        }
        TextureKey(key)
    }

    pub fn get(&self, key: TextureKey) -> Option<Arc<wgpu::Texture>> {
        self.textures.get(&key.0).cloned()
    }

    /// Дёшево проверяет, жива ли текстура под этим ключом (без клонирования Arc).
    /// Используется сборкой сцены, чтобы решить GPU-handle vs CPU-fallback.
    pub fn contains(&self, key: TextureKey) -> bool {
        self.textures.contains_key(&key.0)
    }

    pub fn remove(&mut self, key: TextureKey) -> Option<Arc<wgpu::Texture>> {
        let removed = self.textures.remove(&key.0);
        if removed.is_some() {
            self.order.retain(|k| *k != key.0);
        }
        removed
    }
}

impl Default for TextureCache {
    fn default() -> Self {
        Self::new()
    }
}
