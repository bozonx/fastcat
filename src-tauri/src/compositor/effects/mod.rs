//! Эффекты на слой. Каждый эффект — это wgpu render/compute pass над текстурой слоя
//! ДО того как Vello его композитит в общую сцену.
//!
//! Pipeline: layer_texture -> [effect1] -> [effect2] -> ... -> compose-into-scene.
//!
//! Сейчас runtime отсутствует — `Scene::to_vello` игнорирует `Layer::effects`.
//! Подключение: реализовать `EffectPipeline::apply(device, input_texture, &[EffectSpec]) -> Texture`
//! и вызвать перед `draw_image` в `Scene::to_vello`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum EffectSpec {
    GaussianBlur {
        radius: f32,
    },
    Brightness {
        value: f32,
    },
    Contrast {
        value: f32,
    },
    Saturation {
        value: f32,
    },
    Hue {
        degrees: f32,
    },
    Levels {
        in_black: f32,
        in_white: f32,
        gamma: f32,
        out_black: f32,
        out_white: f32,
    },
    ChromaKey {
        key_rgba: [u8; 4],
        threshold: f32,
        smoothness: f32,
    },
    Sharpen {
        amount: f32,
    },
    Pixelate {
        size: f32,
    },
    Bloom {
        threshold: f32,
        strength: f32,
        radius: f32,
    },
    Vignette {
        strength: f32,
        radius: f32,
        softness: f32,
    },
    Noise {
        amount: f32,
        seed: u32,
    },
    ChromaticAberration {
        amount: f32,
        angle_deg: f32,
    },
    /// Произвольный WGSL — для расширяемости.
    CustomWgsl {
        source: String,
        params: serde_json::Value,
    },
}
