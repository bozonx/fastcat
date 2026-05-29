//! Типы слоёв сцены.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum LayerKind {
    /// Видео-кадр: ссылается на ресурс, заранее загруженный в GPU-кэш текстур (см. media/).
    VideoFrame {
        /// id текстуры в кэше — заполняет media-pipeline когда кадр готов.
        texture_id: u64,
        natural_width: u32,
        natural_height: u32,
    },
    /// Растровое изображение из файла. Грузится через `image` crate.
    Image {
        /// Абсолютный путь или ключ в кэше.
        source: String,
    },
    /// Векторный шейп — прямоугольник, эллипс, polygon, или произвольный path.
    Shape(ShapeSpec),
    /// SVG-документ (через usvg -> vello_svg).
    Svg {
        source: String,
    },
    /// Текстовый слой (parley layout + vello draw).
    Text(TextSpec),
    /// Группа: рендерится в offscreen, потом композится — нужно для blend/opacity на группе.
    Group {
        children: Vec<super::scene::Layer>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShapeSpec {
    pub geometry: ShapeGeometry,
    pub fill: Option<Paint>,
    pub stroke: Option<Stroke>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ShapeGeometry {
    Rect { width: f32, height: f32, radius: f32 },
    Ellipse { rx: f32, ry: f32 },
    Path { d: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Paint {
    Solid { rgba: [u8; 4] },
    LinearGradient { from: [f32; 2], to: [f32; 2], stops: Vec<GradientStop> },
    RadialGradient { center: [f32; 2], radius: f32, stops: Vec<GradientStop> },
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
pub enum TextAlign { Left, Center, Right, Justify }
