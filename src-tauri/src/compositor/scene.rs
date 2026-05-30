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

use kurbo::{Affine, Rect};
use vello::peniko::{Color, Fill, ImageData, Mix};
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
}

impl LayerKind {
    pub fn natural_size(&self) -> (u32, u32) {
        match self {
            LayerKind::Raster { natural_size, .. } => *natural_size,
        }
    }
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
    pub fn to_vello(self) -> Mix {
        match self {
            BlendMode::Normal => Mix::Normal,
            BlendMode::Multiply => Mix::Multiply,
            BlendMode::Screen => Mix::Screen,
            BlendMode::Overlay => Mix::Overlay,
            BlendMode::Darken => Mix::Darken,
            BlendMode::Lighten => Mix::Lighten,
            BlendMode::ColorDodge => Mix::ColorDodge,
            BlendMode::ColorBurn => Mix::ColorBurn,
            BlendMode::HardLight => Mix::HardLight,
            BlendMode::SoftLight => Mix::SoftLight,
            BlendMode::Difference => Mix::Difference,
            BlendMode::Exclusion => Mix::Exclusion,
            BlendMode::Hue => Mix::Hue,
            BlendMode::Saturation => Mix::Saturation,
            BlendMode::Color => Mix::Color,
            BlendMode::Luminosity => Mix::Luminosity,
        }
    }
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
        assert_eq!(BlendMode::Normal.to_vello(), Mix::Normal);
        assert_eq!(BlendMode::Multiply.to_vello(), Mix::Multiply);
        assert_eq!(BlendMode::Screen.to_vello(), Mix::Screen);
        assert_eq!(BlendMode::Luminosity.to_vello(), Mix::Luminosity);
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
            layers: vec![raster_layer((50, 50), Transform::center_fit((50, 50), (100, 100)), 0.0)],
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
            BlendMode::Normal, BlendMode::Multiply, BlendMode::Screen,
            BlendMode::Overlay, BlendMode::Darken, BlendMode::Lighten,
            BlendMode::ColorDodge, BlendMode::ColorBurn, BlendMode::HardLight,
            BlendMode::SoftLight, BlendMode::Difference, BlendMode::Exclusion,
            BlendMode::Hue, BlendMode::Saturation, BlendMode::Color,
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
