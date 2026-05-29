//! Переходы между двумя сценами (например A→B на стыке клипов).
//! Каждый transition — wgpu shader pass над двумя текстурами (from, to) + прогресс 0..1.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum TransitionSpec {
    Crossfade,
    Wipe { angle_deg: f32, softness: f32 },
    Slide { direction: SlideDirection },
    Dissolve { seed: u32 },
    CircleReveal { center: [f32; 2], softness: f32 },
    /// Произвольный WGSL.
    CustomWgsl { source: String, params: serde_json::Value },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SlideDirection { Left, Right, Up, Down }

pub struct TransitionPipeline;

impl TransitionPipeline {
    pub fn apply(
        _from: &wgpu::Texture,
        _to: &wgpu::Texture,
        _spec: &TransitionSpec,
        _progress: f32,
    ) -> wgpu::Texture {
        unimplemented!()
    }
}
