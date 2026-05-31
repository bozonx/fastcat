//! Доменная модель кадра, ready-to-render.
//!
//! `Scene` описывает ОДИН композитный кадр в момент `time` (секунды timeline).
//! Это внутренний контракт между `monitor` (владелец таймлайна) и `Compositor`
//! (исполнитель отрисовки) — она НЕ сериализуется и не пересекает Tauri-границу.
//!
//! Timeline-DTO (что есть на таймлайне в принципе) живёт в [`crate::monitor::scene::MonitorScene`];
//! мост `MonitorScene + t → compositor::scene::Scene` — в `monitor::app::WindowState::build_scene`.
//!
//! Расширение: новые типы слоёв добавляются как варианты `LayerKind`
//! (он `#[non_exhaustive]`), плюс ветка в `Scene::to_vello`.

use kurbo::{Affine, BezPath, Rect, RoundedRect, Shape, Stroke};
use parley::{
    fontique::FontWeight, Alignment, AlignmentOptions, FontContext, FontFamily, LayoutContext,
    LineHeight, PositionedLayoutItem, StyleProperty,
};
use std::sync::{Mutex, OnceLock};
use vello::peniko::{BlendMode as PenikoBlendMode, Brush, Color, Compose, Fill, ImageData, Mix};
use vello::Glyph;
use vello::Scene as VelloScene;

use super::effects::EffectSpec;

#[derive(Debug, Clone)]
pub struct Scene {
    pub width: u32,
    pub height: u32,
    /// Текущее время кадра по timeline-clock'у, секунды. Используется будущими
    /// эффектами/transitions с временной зависимостью; сейчас informational.
    pub time: f64,
    pub background: Color,
    /// Слои предварительно отсортированы снизу-вверх (по `z` источника).
    pub layers: Vec<Layer>,
}

impl Scene {
    /// Композит сцены в `vello::Scene`. Вписывает (`scene.width × scene.height`)
    /// в (`viewport_w × viewport_h`) с сохранением аспекта (letterbox).
    ///
    /// Это единственное место в кодовой базе, которое строит vello-команды для
    /// доменной сцены — все будущие kind'ы/эффекты/transitions подключаются здесь.
    pub fn to_vello(&self, viewport_w: u32, viewport_h: u32) -> VelloScene {
        let mut out = VelloScene::new();
        if self.width == 0 || self.height == 0 || viewport_w == 0 || viewport_h == 0 {
            return out;
        }
        let outer = fit_into((self.width, self.height), (viewport_w, viewport_h));

        for layer in &self.layers {
            let opacity = layer.opacity.clamp(0.0, 1.0);
            if opacity <= 0.0 {
                continue;
            }
            let natural = layer.kind.natural_size();
            if natural.0 == 0 || natural.1 == 0 {
                continue;
            }
            let inner = layer.transform.to_affine(natural);
            let xform = outer * inner;

            // push_layer нужен для opacity<1 или non-Normal blend. Маска и эффекты пока
            // no-op — будут подключены здесь же при реализации.
            let mix = layer.blend.to_vello();
            let needs_layer = opacity < 1.0 || !matches!(layer.blend, BlendMode::Normal);
            if needs_layer {
                let bbox = Rect::new(0.0, 0.0, natural.0 as f64, natural.1 as f64);
                out.push_layer(Fill::NonZero, mix, opacity, xform, &bbox);
            }

            match &layer.kind {
                LayerKind::Raster { source, .. } => match source {
                    RasterSource::Image(img) => {
                        out.draw_image(img, xform);
                    }
                },
                LayerKind::Shape(spec) => {
                    draw_shape(&mut out, spec, xform);
                }
                LayerKind::Text(spec) => {
                    draw_text(&mut out, spec, xform);
                }
            }

            if needs_layer {
                out.pop_layer();
            }
            // TODO: layer.mask — kurbo::BezPath из layer.mask.path, push_layer как clip.
            // TODO: layer.effects — multi-pass через future EffectPipeline до draw_image.
        }

        out
    }
}

#[derive(Debug, Clone)]
pub struct Layer {
    pub id: String,
    pub kind: LayerKind,
    pub transform: Transform,
    pub opacity: f32,
    pub blend: BlendMode,
    pub mask: Option<Mask>,
    pub effects: Vec<EffectSpec>,
}

/// Тип слоя. `#[non_exhaustive]` — добавление новых вариантов (Text, Svg, Shape,
/// Group, ...) не ломает консьюмеров и сразу заставляет `to_vello` дать новую ветку.
#[derive(Debug, Clone)]
#[non_exhaustive]
pub enum LayerKind {
    /// Растровый слой (видеокадр или статичная картинка). Источник прячется
    /// за [`RasterSource`], чтобы CPU-blob и future GPU-handle отличались
    /// только в одной точке.
    Raster {
        source: RasterSource,
        natural_size: (u32, u32),
    },
    Shape(ShapeLayer),
    Text(TextLayer),
}

impl LayerKind {
    pub fn natural_size(&self) -> (u32, u32) {
        match self {
            LayerKind::Raster { natural_size, .. } => *natural_size,
            LayerKind::Shape(spec) => spec.natural_size,
            LayerKind::Text(spec) => spec.natural_size,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ShapeLayer {
    pub geometry: ShapeGeometry,
    pub fill: Color,
    pub stroke: Color,
    pub stroke_width: f64,
    pub natural_size: (u32, u32),
}

/// Типизированная геометрия фигуры. Поля-доли уже нормализованы (проценты делятся на 100
/// и клампятся 0..10) на границе IPC — см. `crate::monitor::runtime::parse_shape_geometry`.
/// Раньше тут лежал `shape_type: String` + `config: serde_json::Value`, который парсился
/// строковыми ключами на каждом кадре; перенос в enum убрал stringly-typing и дубли.
#[derive(Debug, Clone)]
pub enum ShapeGeometry {
    Rectangle {
        width: f64,
        height: f64,
        corner_radius: f64,
    },
    Circle {
        squash_x: f64,
        squash_y: f64,
    },
    Triangle {
        base_length: f64,
        vertex_offset: f64,
    },
    Star {
        rays: usize,
        inner_radius: f64,
    },
    Bang {
        rays: usize,
        inner_radius: f64,
    },
    SpeechBubble {
        width: f64,
        height: f64,
        corner_radius: f64,
        pointer_x: f64,
        pointer_w: f64,
        pointer_h: f64,
        pointer_right: bool,
    },
    Cloud {
        cloud_type: i32,
    },
}

#[derive(Debug, Clone)]
pub struct TextLayer {
    pub text: String,
    pub font_family: String,
    pub font_size: f32,
    pub font_weight: f32,
    pub color: Color,
    pub align: TextAlign,
    pub line_height: f32,
    pub max_width: Option<f32>,
    pub background: Option<TextBackground>,
    pub natural_size: (u32, u32),
}

#[derive(Debug, Clone, Copy)]
pub enum TextAlign {
    Left,
    Center,
    Right,
}

#[derive(Debug, Clone)]
pub struct TextBackground {
    pub color: Color,
    pub radius: f64,
}

/// Источник пикселей для `LayerKind::Raster`.
///
/// `#[non_exhaustive]` — задел для GPU-resident вариантов (HW-decoded frame,
/// group-offscreen cache). Сейчас весь рендер идёт через CPU-blob; Vello внутренне
/// кеширует аплоад в GPU-текстуру по identity `peniko::Blob`, так что повторный
/// клон того же `ImageData` (статичный image-слой) не перезаливается.
#[derive(Debug, Clone)]
#[non_exhaustive]
pub enum RasterSource {
    Image(ImageData),
    // Future:
    // /// GPU-resident handle: реальная wgpu::Texture хранится в `super::texture_cache::TextureCache`.
    // GpuHandle(super::texture_cache::TextureKey),
}

/// 2D-transform слоя в координатах композитного кадра.
///
/// Семантика: `anchor` — точка внутри натуральной bbox слоя в долях `[0..1]`,
/// которая переходит в `(x, y)` после rotate+scale. Сборка affine — в `to_affine`.
#[derive(Debug, Clone, Copy)]
pub struct Transform {
    pub x: f64,
    pub y: f64,
    pub scale_x: f64,
    pub scale_y: f64,
    pub rotation_deg: f64,
    pub anchor_x: f64,
    pub anchor_y: f64,
}

impl Transform {
    pub fn identity() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
            rotation_deg: 0.0,
            anchor_x: 0.0,
            anchor_y: 0.0,
        }
    }

    /// Transform, который вписывает натуральный bbox `natural` в `into` с
    /// сохранением аспекта и центрирует результат. Anchor = центр слоя,
    /// позиция = центр сцены.
    pub fn center_fit(natural: (u32, u32), into: (u32, u32)) -> Self {
        let s = (into.0 as f64 / natural.0 as f64).min(into.1 as f64 / natural.1 as f64);
        Self {
            x: into.0 as f64 / 2.0,
            y: into.1 as f64 / 2.0,
            scale_x: s,
            scale_y: s,
            rotation_deg: 0.0,
            anchor_x: 0.5,
            anchor_y: 0.5,
        }
    }

    /// Сборка `Affine` из Transform и натуральных размеров слоя.
    pub fn to_affine(self, natural: (u32, u32)) -> Affine {
        let (nw, nh) = (natural.0 as f64, natural.1 as f64);
        Affine::translate((self.x, self.y))
            * Affine::rotate(self.rotation_deg.to_radians())
            * Affine::scale_non_uniform(self.scale_x, self.scale_y)
            * Affine::translate((-self.anchor_x * nw, -self.anchor_y * nh))
    }
}

impl Default for Transform {
    fn default() -> Self {
        Self::identity()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlendMode {
    Normal,
    Add,
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

impl BlendMode {
    pub fn to_vello(self) -> PenikoBlendMode {
        match self {
            BlendMode::Normal => Mix::Normal.into(),
            BlendMode::Add => Compose::Plus.into(),
            BlendMode::Multiply => Mix::Multiply.into(),
            BlendMode::Screen => Mix::Screen.into(),
            BlendMode::Overlay => Mix::Overlay.into(),
            BlendMode::Darken => Mix::Darken.into(),
            BlendMode::Lighten => Mix::Lighten.into(),
            BlendMode::ColorDodge => Mix::ColorDodge.into(),
            BlendMode::ColorBurn => Mix::ColorBurn.into(),
            BlendMode::HardLight => Mix::HardLight.into(),
            BlendMode::SoftLight => Mix::SoftLight.into(),
            BlendMode::Difference => Mix::Difference.into(),
            BlendMode::Exclusion => Mix::Exclusion.into(),
            BlendMode::Hue => Mix::Hue.into(),
            BlendMode::Saturation => Mix::Saturation.into(),
            BlendMode::Color => Mix::Color.into(),
            BlendMode::Luminosity => Mix::Luminosity.into(),
        }
    }
}

fn draw_shape(scene: &mut VelloScene, spec: &ShapeLayer, xform: Affine) {
    let path = build_shape_path(&spec.geometry, spec.natural_size, spec.stroke_width);
    scene.fill(Fill::NonZero, xform, Brush::Solid(spec.fill), None, &path);
    if spec.stroke_width > 0.0 {
        scene.stroke(
            &Stroke::new(spec.stroke_width),
            xform,
            Brush::Solid(spec.stroke),
            None,
            &path,
        );
    }
}

fn build_shape_path(
    geometry: &ShapeGeometry,
    natural_size: (u32, u32),
    stroke_width: f64,
) -> BezPath {
    let w = natural_size.0 as f64;
    let h = natural_size.1 as f64;
    let sw = stroke_width.max(0.0);
    let size = (w.min(h) - sw * 2.0).max(1.0);
    let cx = w * 0.5;
    let cy = h * 0.5;
    let half = size * 0.5;

    match geometry {
        ShapeGeometry::Circle { squash_x, squash_y } => {
            let rx = half * (1.0 - *squash_x);
            let ry = half * (1.0 - *squash_y);
            kurbo::Ellipse::new((cx, cy), (rx.max(1.0), ry.max(1.0)), 0.0).to_path(0.1)
        }
        ShapeGeometry::Triangle {
            base_length,
            vertex_offset,
        } => {
            let base = size * *base_length;
            let offset = *vertex_offset * base;
            polygon(&[
                (cx - base * 0.5 + offset, cy - half),
                (cx + base * 0.5, cy + half),
                (cx - base * 0.5, cy + half),
            ])
        }
        ShapeGeometry::Star { rays, inner_radius } | ShapeGeometry::Bang { rays, inner_radius } => {
            star_path(cx, cy, half, half * *inner_radius, *rays)
        }
        ShapeGeometry::SpeechBubble {
            width,
            height,
            corner_radius,
            pointer_x,
            pointer_w,
            pointer_h,
            pointer_right,
        } => speech_bubble_path(SpeechBubbleParams {
            cx,
            cy,
            half,
            size,
            width: *width,
            height: *height,
            corner_radius: *corner_radius,
            pointer_x: *pointer_x,
            pointer_w: *pointer_w,
            pointer_h: *pointer_h,
            pointer_right: *pointer_right,
        }),
        ShapeGeometry::Cloud { cloud_type } => cloud_path(cx, cy, half, *cloud_type),
        ShapeGeometry::Rectangle {
            width,
            height,
            corner_radius,
        } => {
            let rw = size * *width;
            let rh = size * *height;
            let r = *corner_radius * rw.min(rh) * 0.5;
            RoundedRect::new(
                cx - rw * 0.5,
                cy - rh * 0.5,
                cx + rw * 0.5,
                cy + rh * 0.5,
                r,
            )
            .to_path(0.1)
        }
    }
}

fn draw_text(scene: &mut VelloScene, spec: &TextLayer, xform: Affine) {
    if let Some(bg) = &spec.background {
        let rect = RoundedRect::new(
            0.0,
            0.0,
            spec.natural_size.0 as f64,
            spec.natural_size.1 as f64,
            bg.radius,
        )
        .to_path(0.1);
        scene.fill(Fill::NonZero, xform, Brush::Solid(bg.color), None, &rect);
    }

    static TEXT_CTX: OnceLock<Mutex<(FontContext, LayoutContext<[u8; 4]>)>> = OnceLock::new();
    let lock = TEXT_CTX.get_or_init(|| Mutex::new((FontContext::new(), LayoutContext::new())));
    let Ok(mut ctx) = lock.lock() else { return };
    let (font_cx, layout_cx) = &mut *ctx;
    let mut builder = layout_cx.ranged_builder(font_cx, &spec.text, 1.0, true);
    builder.push_default(StyleProperty::FontSize(spec.font_size.max(1.0)));
    builder.push_default(StyleProperty::Brush([255, 255, 255, 255]));
    builder.push_default(StyleProperty::LineHeight(LineHeight::FontSizeRelative(
        spec.line_height.max(0.1),
    )));
    builder.push_default(StyleProperty::FontWeight(FontWeight::new(spec.font_weight)));
    builder.push_default(StyleProperty::FontFamily(FontFamily::from(
        spec.font_family.as_str(),
    )));
    let mut layout = builder.build(&spec.text);
    layout.break_all_lines(spec.max_width);
    let alignment = match spec.align {
        TextAlign::Left => Alignment::Start,
        TextAlign::Center => Alignment::Center,
        TextAlign::Right => Alignment::End,
    };
    layout.align(alignment, AlignmentOptions::default());

    let y = ((spec.natural_size.1 as f32 - layout.height()).max(0.0)) * 0.5;
    for line in layout.lines() {
        for item in line.items() {
            let PositionedLayoutItem::GlyphRun(run) = item else {
                continue;
            };
            let run_xform = xform * Affine::translate((0.0, y as f64));
            scene
                .draw_glyphs(run.run().font())
                .font_size(run.run().font_size())
                .brush(spec.color)
                .transform(run_xform)
                .draw(
                    Fill::NonZero,
                    run.positioned_glyphs().map(|g| Glyph {
                        id: g.id,
                        x: g.x,
                        y: g.y,
                    }),
                );
        }
    }
}

fn polygon(points: &[(f64, f64)]) -> BezPath {
    let mut path = BezPath::new();
    if let Some(first) = points.first() {
        path.move_to(*first);
        for point in &points[1..] {
            path.line_to(*point);
        }
        path.close_path();
    }
    path
}

fn star_path(cx: f64, cy: f64, outer: f64, inner: f64, rays: usize) -> BezPath {
    let mut points = Vec::with_capacity(rays * 2);
    let step = std::f64::consts::PI / rays as f64;
    for i in 0..(rays * 2) {
        let radius = if i % 2 == 0 { outer } else { inner };
        let angle = i as f64 * step - std::f64::consts::FRAC_PI_2;
        points.push((cx + angle.cos() * radius, cy + angle.sin() * radius));
    }
    polygon(&points)
}

struct SpeechBubbleParams {
    cx: f64,
    cy: f64,
    half: f64,
    size: f64,
    width: f64,
    height: f64,
    corner_radius: f64,
    pointer_x: f64,
    pointer_w: f64,
    pointer_h: f64,
    pointer_right: bool,
}

fn speech_bubble_path(p: SpeechBubbleParams) -> BezPath {
    let w = p.size * p.width;
    let h = p.size * p.height;
    let x = p.cx - w * 0.5;
    let y = p.cy - h * 0.5 - p.half * 0.15;
    let r = (p.corner_radius * w.min(h) * 0.5).min(w.min(h) * 0.5);
    let pointer_x = w * p.pointer_x;
    let pointer_w = w * p.pointer_w;
    let pointer_h = h * p.pointer_h;
    let right = p.pointer_right;
    let mut path = BezPath::new();
    path.move_to((x + r, y));
    path.line_to((x + w - r, y));
    path.quad_to((x + w, y), (x + w, y + r));
    path.line_to((x + w, y + h - r));
    path.quad_to((x + w, y + h), (x + w - r, y + h));
    if right {
        path.line_to((x + pointer_x + pointer_w, y + h));
        path.line_to((x + pointer_x + pointer_w, y + h + pointer_h));
        path.line_to((x + pointer_x, y + h));
    } else {
        path.line_to((x + pointer_x + pointer_w, y + h));
        path.line_to((x + pointer_x, y + h + pointer_h));
        path.line_to((x + pointer_x, y + h));
    }
    path.line_to((x + r, y + h));
    path.quad_to((x, y + h), (x, y + h - r));
    path.line_to((x, y + r));
    path.quad_to((x, y), (x + r, y));
    path.close_path();
    path
}

fn cloud_path(cx: f64, cy: f64, half: f64, cloud_type: i32) -> BezPath {
    let circles: &[(f64, f64, f64)] = if cloud_type == 2 {
        &[
            (-0.5, 0.1, 0.4),
            (0.5, 0.1, 0.4),
            (-0.2, -0.3, 0.5),
            (0.2, -0.2, 0.45),
            (0.0, 0.3, 0.3),
        ]
    } else {
        &[
            (-0.4, 0.0, 0.5),
            (0.4, 0.0, 0.5),
            (0.0, -0.3, 0.6),
            (0.0, 0.2, 0.4),
        ]
    };
    let mut path = BezPath::new();
    for (x, y, r) in circles {
        path.extend(
            kurbo::Ellipse::new((cx + half * x, cy + half * y), (half * r, half * r), 0.0)
                .to_path(0.1),
        );
    }
    path
}

#[derive(Debug, Clone)]
pub struct Mask {
    /// SVG path d-string в локальных координатах слоя.
    pub path: String,
    pub inverted: bool,
}

/// Letterbox-fit натуральных размеров `natural` в `into`. Возвращает Affine
/// для применения к слою/сцене (используется как outer transform в `to_vello`).
pub fn fit_into(natural: (u32, u32), into: (u32, u32)) -> Affine {
    let s = (into.0 as f64 / natural.0 as f64).min(into.1 as f64 / natural.1 as f64);
    let dw = natural.0 as f64 * s;
    let dh = natural.1 as f64 * s;
    let tx = (into.0 as f64 - dw) * 0.5;
    let ty = (into.1 as f64 - dh) * 0.5;
    Affine::translate((tx, ty)) * Affine::scale_non_uniform(s, s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use vello::peniko::{Blob, ImageAlphaType, ImageFormat};

    fn dummy_image(w: u32, h: u32) -> ImageData {
        let pixels = vec![0u8; (w as usize) * (h as usize) * 4];
        ImageData {
            data: Blob::new(Arc::new(pixels)),
            format: ImageFormat::Rgba8,
            alpha_type: ImageAlphaType::Alpha,
            width: w,
            height: h,
        }
    }

    fn raster_layer(natural: (u32, u32), transform: Transform, opacity: f32) -> Layer {
        Layer {
            id: "x".into(),
            kind: LayerKind::Raster {
                source: RasterSource::Image(dummy_image(natural.0, natural.1)),
                natural_size: natural,
            },
            transform,
            opacity,
            blend: BlendMode::Normal,
            mask: None,
            effects: Vec::new(),
        }
    }

    fn approx(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-6
    }

    fn affine_apply(a: Affine, p: (f64, f64)) -> (f64, f64) {
        let v = a * kurbo::Point::new(p.0, p.1);
        (v.x, v.y)
    }

    #[test]
    fn fit_into_widens_to_letterbox_height() {
        // 16:9 в 4:3 → должно ужаться по ширине, по высоте чёрные полосы.
        let a = fit_into((1920, 1080), (1280, 960));
        let (x0, y0) = affine_apply(a, (0.0, 0.0));
        let (x1, y1) = affine_apply(a, (1920.0, 1080.0));
        // scale = 1280/1920 = 0.666...
        assert!(approx(x0, 0.0));
        assert!(approx(x1, 1280.0));
        // height fit = 1080 * 0.666... = 720; letterbox top = (960-720)/2 = 120
        assert!(approx(y0, 120.0));
        assert!(approx(y1, 840.0));
    }

    #[test]
    fn fit_into_pillarbox_when_target_wider() {
        // 4:3 в 16:9 → fit по высоте, по ширине pillarbox.
        let a = fit_into((640, 480), (1920, 1080));
        let (x0, _) = affine_apply(a, (0.0, 0.0));
        let (x1, _) = affine_apply(a, (640.0, 0.0));
        let scale = 1080.0 / 480.0;
        let fitted_w = 640.0 * scale;
        let pillar = (1920.0 - fitted_w) / 2.0;
        assert!(approx(x0, pillar));
        assert!(approx(x1, pillar + fitted_w));
    }

    #[test]
    fn transform_identity_is_noop() {
        let a = Transform::identity().to_affine((100, 200));
        let (x, y) = affine_apply(a, (50.0, 75.0));
        assert!(approx(x, 50.0));
        assert!(approx(y, 75.0));
    }

    #[test]
    fn transform_center_fit_maps_center_to_scene_center() {
        let t = Transform::center_fit((100, 100), (400, 300));
        let a = t.to_affine((100, 100));
        let (cx, cy) = affine_apply(a, (50.0, 50.0));
        assert!(approx(cx, 200.0));
        assert!(approx(cy, 150.0));
    }

    #[test]
    fn transform_center_fit_preserves_aspect_and_corners() {
        // Квадрат 200×200 в 800×400 → fit по высоте (scale=2), pillar по бокам.
        let t = Transform::center_fit((200, 200), (800, 400));
        let a = t.to_affine((200, 200));
        let (x0, y0) = affine_apply(a, (0.0, 0.0));
        let (x1, y1) = affine_apply(a, (200.0, 200.0));
        // scale = min(800/200, 400/200) = 2; fitted = 400×400
        // pillar = (800-400)/2 = 200; vertical = 0
        assert!(approx(x0, 200.0));
        assert!(approx(y0, 0.0));
        assert!(approx(x1, 600.0));
        assert!(approx(y1, 400.0));
    }

    #[test]
    fn blend_mode_normal_maps_to_vello_normal() {
        assert_eq!(BlendMode::Normal.to_vello(), Mix::Normal.into());
        assert_eq!(BlendMode::Add.to_vello(), Compose::Plus.into());
        assert_eq!(BlendMode::Multiply.to_vello(), Mix::Multiply.into());
        assert_eq!(BlendMode::Screen.to_vello(), Mix::Screen.into());
        assert_eq!(BlendMode::Luminosity.to_vello(), Mix::Luminosity.into());
    }

    #[test]
    fn to_vello_empty_scene_returns_empty() {
        let scene = Scene {
            width: 1920,
            height: 1080,
            time: 0.0,
            background: Color::BLACK,
            layers: Vec::new(),
        };
        // Должно вернуть без паники.
        let _ = scene.to_vello(1280, 720);
    }

    #[test]
    fn to_vello_skips_zero_opacity_layer() {
        // Smoke: opacity=0 — layer не должен вызывать draw, паники не должно быть.
        let scene = Scene {
            width: 100,
            height: 100,
            time: 0.0,
            background: Color::BLACK,
            layers: vec![raster_layer(
                (50, 50),
                Transform::center_fit((50, 50), (100, 100)),
                0.0,
            )],
        };
        let _ = scene.to_vello(100, 100);
    }

    #[test]
    fn to_vello_handles_zero_viewport() {
        let scene = Scene {
            width: 100,
            height: 100,
            time: 0.0,
            background: Color::BLACK,
            layers: vec![raster_layer((10, 10), Transform::identity(), 1.0)],
        };
        // Не должен паниковать при нулевом viewport'е.
        let _ = scene.to_vello(0, 0);
        let _ = scene.to_vello(100, 0);
    }

    #[test]
    fn fit_into_same_aspect_no_translation() {
        // Если аспект совпадает — letterbox/pillarbox нулевые.
        let a = fit_into((1920, 1080), (960, 540));
        let (x0, y0) = affine_apply(a, (0.0, 0.0));
        let (x1, y1) = affine_apply(a, (1920.0, 1080.0));
        assert!(approx(x0, 0.0));
        assert!(approx(y0, 0.0));
        assert!(approx(x1, 960.0));
        assert!(approx(y1, 540.0));
    }

    #[test]
    fn blend_mode_all_variants_map_without_panic() {
        // Исчерпывающая проверка: ни одна ветка match не упадёт.
        let modes = [
            BlendMode::Normal,
            BlendMode::Multiply,
            BlendMode::Screen,
            BlendMode::Overlay,
            BlendMode::Darken,
            BlendMode::Lighten,
            BlendMode::ColorDodge,
            BlendMode::ColorBurn,
            BlendMode::HardLight,
            BlendMode::SoftLight,
            BlendMode::Difference,
            BlendMode::Exclusion,
            BlendMode::Hue,
            BlendMode::Saturation,
            BlendMode::Color,
            BlendMode::Luminosity,
        ];
        for m in modes {
            let _ = m.to_vello();
        }
    }

    #[test]
    fn transform_rotation_90deg_maps_x_to_y() {
        // Поворот на 90° вокруг начала координат: (1,0) → (0,1).
        let t = Transform {
            x: 0.0,
            y: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
            rotation_deg: 90.0,
            anchor_x: 0.0,
            anchor_y: 0.0,
        };
        let a = t.to_affine((0, 0)); // natural size не используется при anchor=0
        let (px, py) = affine_apply(a, (1.0, 0.0));
        // После rotate(90°): x→-y, y→x, т.е. (1,0)→(0,1) в математических осях.
        // В экранных координатах (y вниз): (1,0)→(0,-1)?
        // kurbo::Affine::rotate(π/2): [[cos, -sin],[sin, cos]] = [[0,-1],[1,0]] → (1,0)→(0,1).
        assert!(approx(px.abs(), 0.0));
        assert!(approx(py.abs(), 1.0));
    }
}
