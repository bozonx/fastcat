//! Доменная модель кадра, который надо отрендерить.
//!
//! Сцена — это плоский список слоёв снизу-вверх + опциональный transition между двумя сценами.
//! Доменная модель НЕ зависит от vello/wgpu — её сериализуют с фронта (JSON) и собирают здесь.

use serde::{Deserialize, Serialize};

use super::effects::EffectSpec;
use super::layers::LayerKind;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Scene {
    pub width: u32,
    pub height: u32,
    /// Время кадра в timeline, секунды. Эффекты с временной зависимостью используют это.
    pub time: f64,
    pub layers: Vec<Layer>,
    /// Цвет фона (RGBA8).
    pub background: [u8; 4],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Layer {
    pub id: String,
    pub kind: LayerKind,
    pub transform: Transform,
    pub opacity: f32,
    pub blend: BlendMode,
    /// Маска: путь (SVG d=) в локальных координатах слоя. None = без маски.
    pub mask: Option<Mask>,
    pub effects: Vec<EffectSpec>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Transform {
    pub x: f32,
    pub y: f32,
    pub scale_x: f32,
    pub scale_y: f32,
    pub rotation_deg: f32,
    pub anchor_x: f32,
    pub anchor_y: f32,
}

impl Default for Transform {
    fn default() -> Self {
        Self { x: 0.0, y: 0.0, scale_x: 1.0, scale_y: 1.0, rotation_deg: 0.0, anchor_x: 0.5, anchor_y: 0.5 }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BlendMode {
    Normal,
    Multiply,
    Screen,
    Overlay,
    Darken,
    Lighten,
    ColorDodge,
    ColorBurn,
    HardLight,
    SoftLight,
    Difference,
    Exclusion,
    Hue,
    Saturation,
    Color,
    Luminosity,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mask {
    /// SVG path d-string.
    pub path: String,
    pub inverted: bool,
}
