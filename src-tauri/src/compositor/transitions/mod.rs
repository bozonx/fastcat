//! Переходы между двумя сценами (например A→B на стыке клипов).
//! Каждый transition — wgpu shader pass над двумя текстурами (from, to) + прогресс 0..1.
//!
//! Сейчас runtime отсутствует. Подключение: добавить
//! `Compositor::render_transition(from: &Scene, to: &Scene, spec, progress, ...)`
//! поверх существующих `render_scene_to_*`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum TransitionSpec {
    Crossfade,
    Wipe {
        angle_deg: f32,
        softness: f32,
    },
    Slide {
        direction: SlideDirection,
    },
    Dissolve {
        seed: u32,
    },
    CircleReveal {
        center: [f32; 2],
        softness: f32,
    },
    /// Произвольный WGSL.
    CustomWgsl {
        source: String,
        params: serde_json::Value,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SlideDirection {
    Left,
    Right,
    Up,
    Down,
}
