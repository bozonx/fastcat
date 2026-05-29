//! Применение списка эффектов к текстуре слоя через wgpu render passes.

use super::EffectSpec;
use crate::compositor::gpu::GpuContext;

pub struct EffectPipeline;

impl EffectPipeline {
    pub fn apply(
        _gpu: &GpuContext,
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
