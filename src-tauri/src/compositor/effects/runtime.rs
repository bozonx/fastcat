//! Применение списка эффектов к текстуре слоя через wgpu render passes.
//!
//! TODO: после того как Compositor будет выдавать наружу wgpu device/queue
//! (или примет builder-функцию), вернуть сюда параметр устройства.

use super::EffectSpec;

pub struct EffectPipeline;

impl EffectPipeline {
    pub fn apply(
        _device: &wgpu::Device,
        _input: &wgpu::Texture,
        _effects: &[EffectSpec],
    ) -> wgpu::Texture {
        // TODO:
        // - кэшировать pipeline per эффект (один WGSL модуль на EffectSpec::type)
        // - ping-pong две вспомогательные текстуры
        // - вернуть финальную
        unimplemented!()
    }
}
