//! Спецификации будущих типов слоёв.
//!
//! Эти типы — «словарь» для будущих вариантов [`super::scene::LayerKind`]
//! (он `#[non_exhaustive]`). Сейчас не подключены: `LayerKind` поддерживает только
//! `Raster`. Когда появятся Shape/Text/Svg/Group, варианты добавляются сюда
//! как `LayerKind::Shape(ShapeSpec)`, и в `Scene::to_vello` добавляется ветка
//! сборки vello-команд.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShapeSpec {
    pub geometry: ShapeGeometry,
    pub fill: Option<Paint>,
    pub stroke: Option<Stroke>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ShapeGeometry {
    Rect {
        width: f32,
        height: f32,
        radius: f32,
    },
    Ellipse {
        rx: f32,
        ry: f32,
    },
    Path {
        d: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Paint {
    Solid {
        rgba: [u8; 4],
    },
    LinearGradient {
        from: [f32; 2],
        to: [f32; 2],
        stops: Vec<GradientStop>,
    },
    RadialGradient {
        center: [f32; 2],
        radius: f32,
        stops: Vec<GradientStop>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GradientStop {
    pub offset: f32,
    pub rgba: [u8; 4],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stroke {
    pub paint: Paint,
    pub width: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextSpec {
    pub content: String,
    pub font_family: String,
    pub font_size: f32,
    pub color: [u8; 4],
    pub weight: u16,
    pub italic: bool,
    pub align: TextAlign,
    pub line_height: f32,
    pub max_width: Option<f32>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TextAlign {
    Left,
    Center,
    Right,
    Justify,
}
