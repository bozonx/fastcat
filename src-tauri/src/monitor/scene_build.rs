//! Сборка доменной `compositor::scene::Scene` из IPC-DTO `MonitorScene`.
//!
//! Раньше эта логика была продублирована в `monitor::runtime` (live-preview) и
//! `media::timeline_render` (thumbnail/export) — два почти идентичных набора
//! `parse_*`-хелперов и веток сборки слоёв. Теперь общий код живёт здесь, а
//! вызывающие отличаются только тем, КАК резолвят растровые слои (video/image/svg):
//!   - live: из кеша декодеров (`LayerRuntimeManager`);
//!   - export/thumbnail: синхронным декодом.
//!
//! Растровые kind'ы (`Video | Image | Svg`) этот модуль НЕ резолвит — он строит
//! только «виртуальные» слои (`Background | Shape | Text`) и финализирует любой
//! `CompLayerKind` в `Layer` (transform + opacity + blend).

use std::fs;
use std::path::Path;
use std::sync::Arc;

use anyhow::Result;
use vello::peniko::{Blob, Color, ImageAlphaType, ImageData, ImageFormat};

use crate::compositor::scene::{
    BlendMode, Layer, LayerKind as CompLayerKind, ShapeGeometry, ShapeLayer, TextAlign,
    TextBackground, TextLayer, TextVerticalAlign, Transform,
};

use super::scene::{LayerKind, SceneLayer};

/// Строит «виртуальный» (не требующий декода) `CompLayerKind` для слоёв
/// `Background | Shape | Text`. Для растровых kind'ов возвращает `None` —
/// их резолвит вызывающий (из кеша или синхронным декодом).
pub fn build_virtual_kind(sl: &SceneLayer, scene_size: (u32, u32)) -> Option<CompLayerKind> {
    let (scene_w, scene_h) = scene_size;
    match sl.kind {
        LayerKind::Video | LayerKind::Image | LayerKind::Svg => None,
        LayerKind::Background => Some(CompLayerKind::Shape(ShapeLayer {
            geometry: ShapeGeometry::Rectangle {
                width: 1.0,
                height: 1.0,
                corner_radius: 0.0,
            },
            fill: parse_color(sl.background_color.as_deref().unwrap_or("#000000"), 1.0),
            stroke: Color::TRANSPARENT,
            stroke_width: 0.0,
            natural_size: (scene_w, scene_h),
        })),
        LayerKind::Shape => {
            let stroke_width = sl.stroke_width.unwrap_or(0.0).max(0.0);
            let size = (scene_w.min(scene_h) as f64 * 0.8 + stroke_width * 2.0)
                .ceil()
                .max(1.0) as u32;
            let shape_type = sl.shape_type.clone().unwrap_or_else(|| "square".into());
            let config = sl.shape_config.clone().unwrap_or(serde_json::Value::Null);
            Some(CompLayerKind::Shape(ShapeLayer {
                geometry: parse_shape_geometry(&shape_type, &config),
                fill: parse_color(sl.fill_color.as_deref().unwrap_or("#ffffff"), 1.0),
                stroke: parse_color(sl.stroke_color.as_deref().unwrap_or("#000000"), 1.0),
                stroke_width,
                natural_size: (size, size),
            }))
        }
        LayerKind::Text => Some(CompLayerKind::Text(build_text_layer(sl, scene_size))),
    }
}

fn build_text_layer(sl: &SceneLayer, scene_size: (u32, u32)) -> TextLayer {
    let (scene_w, scene_h) = scene_size;
    let style = sl.style.clone().unwrap_or(serde_json::Value::Null);
    let font_size = number(&style, "fontSize", 64.0).clamp(1.0, 1000.0) as f32;
    let render_scale = scene_h as f64 / 1080.0;
    let width = number_opt(&style, "width")
        .map(|w| (w * render_scale).max(1.0) as u32)
        .unwrap_or_else(|| scene_w.max(1));
    let height = number_opt(&style, "height")
        .map(|h| (h * render_scale).max(1.0) as u32)
        .unwrap_or_else(|| ((font_size as f64 * 1.6 * render_scale).max(1.0)) as u32);
    let color_alpha = number(&style, "colorAlpha", 1.0).clamp(0.0, 1.0);
    let background = if bool_value(&style, "backgroundEnabled", false) {
        Some(TextBackground {
            color: parse_color(
                string_value(&style, "backgroundColor", "#000000").as_str(),
                number(&style, "backgroundAlpha", 1.0).clamp(0.0, 1.0),
            ),
            radius: number(&style, "backgroundRadius", 0.0).max(0.0) * render_scale,
        })
    } else {
        None
    };
    TextLayer {
        text: sl.text.clone().unwrap_or_default(),
        font_family: string_value(&style, "fontFamily", "sans-serif"),
        font_size: (font_size as f64 * render_scale).max(1.0) as f32,
        font_weight: font_weight(&style),
        color: parse_color(
            string_value(&style, "color", "#ffffff").as_str(),
            color_alpha,
        ),
        align: text_align(&style),
        vertical_align: text_vertical_align(&style),
        line_height: number(&style, "lineHeight", 1.2).clamp(0.1, 10.0) as f32,
        max_width: Some(width as f32),
        background,
        natural_size: (width, height),
    }
}

/// Финализирует `CompLayerKind` в `Layer`: transform (явный или center-fit),
/// opacity и blend-mode из IPC-слоя.
pub fn finalize_layer(sl: &SceneLayer, kind: CompLayerKind, scene_size: (u32, u32)) -> Layer {
    let media_size = kind.natural_size();
    let source_rotation = source_orientation_deg(sl);
    let transform = match &sl.transform {
        Some(t) => {
            let fit = if matches!(
                sl.kind,
                LayerKind::Video | LayerKind::Image | LayerKind::Svg
            ) {
                oriented_fit_scale(media_size, scene_size, source_rotation)
            } else {
                1.0
            };
            Transform {
                x: t.x,
                y: t.y,
                scale_x: t.scale_x * fit,
                scale_y: t.scale_y * fit,
                rotation_deg: t.rotation_deg + source_rotation,
                anchor_x: t.anchor_x,
                anchor_y: t.anchor_y,
            }
        }
        None => {
            let fit_media_size = if is_quarter_turn(source_rotation) {
                (media_size.1, media_size.0)
            } else {
                media_size
            };
            Transform {
                rotation_deg: source_rotation,
                ..Transform::center_fit(fit_media_size, scene_size)
            }
        }
    };
    Layer {
        id: sl.id.clone(),
        kind,
        transform,
        opacity: sl.opacity.clamp(0.0, 1.0) as f32,
        blend: parse_blend_mode(&sl.blend_mode),
        mask: None,
        effects: Vec::new(),
    }
}

fn source_orientation_deg(sl: &SceneLayer) -> f64 {
    match sl.source_orientation.as_deref() {
        Some("90") => 90.0,
        Some("180") => 180.0,
        Some("270") => 270.0,
        _ => 0.0,
    }
}

fn oriented_fit_scale(natural: (u32, u32), scene_size: (u32, u32), rotation_deg: f64) -> f64 {
    let fit_natural = if is_quarter_turn(rotation_deg) {
        (natural.1, natural.0)
    } else {
        natural
    };
    let nw = fit_natural.0.max(1) as f64;
    let nh = fit_natural.1.max(1) as f64;
    let sw = scene_size.0.max(1) as f64;
    let sh = scene_size.1.max(1) as f64;
    (sw / nw).min(sh / nh)
}

fn is_quarter_turn(rotation_deg: f64) -> bool {
    let normalized = ((rotation_deg.round() as i32 % 360) + 360) % 360;
    normalized == 90 || normalized == 270
}

// ---------------------------------------------------------------------------
// Декод растровых ресурсов
// ---------------------------------------------------------------------------

/// Растеризует SVG в `ImageData`, целясь в `target_long_edge` пикселей по длинной
/// стороне (= разрешение, в котором слой будет показан: монитор для preview,
/// export-кадр для экспорта). Раньше растеризация шла всегда в натуральном размере
/// SVG, из-за чего мелкие иконки на весь экран были мыльными, а большие SVG в
/// маленьком preview зря жгли память.
pub fn rasterize_svg(path: &Path, target_long_edge: u32) -> Result<(ImageData, (u32, u32))> {
    let mut options = resvg::usvg::Options {
        resources_dir: path.parent().map(|p| p.to_path_buf()),
        ..resvg::usvg::Options::default()
    };
    options.fontdb_mut().load_system_fonts();
    let bytes = fs::read(path)?;
    let tree = resvg::usvg::Tree::from_data(&bytes, &options)?;
    let natural = tree.size().to_int_size();
    let (nw, nh) = (natural.width().max(1), natural.height().max(1));

    // Масштаб так, чтобы длинная сторона == target_long_edge. Кламп, чтобы не
    // улетать в гигантские pixmap'ы при экзотических target'ах.
    let long = nw.max(nh) as f64;
    let target = target_long_edge.max(1) as f64;
    let scale = (target / long).clamp(0.01, 64.0);
    let out_w = ((nw as f64 * scale).round() as u32).max(1);
    let out_h = ((nh as f64 * scale).round() as u32).max(1);

    let mut pixmap = resvg::tiny_skia::Pixmap::new(out_w, out_h)
        .ok_or_else(|| anyhow::anyhow!("cannot create svg pixmap {out_w}x{out_h}"))?;
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::from_scale(scale as f32, scale as f32),
        &mut pixmap.as_mut(),
    );
    let width = pixmap.width();
    let height = pixmap.height();
    let data = pixmap.take();
    Ok((
        ImageData {
            data: Blob::new(Arc::new(data)),
            format: ImageFormat::Rgba8,
            alpha_type: ImageAlphaType::AlphaPremultiplied,
            width,
            height,
        },
        (width, height),
    ))
}

// ---------------------------------------------------------------------------
// Парсинг IPC-полей
// ---------------------------------------------------------------------------

/// Маппинг строкового blend-mode из таймлайна в `compositor::scene::BlendMode`.
/// Поддерживает полный набор CSS/Pixi-режимов (тот же список, что фронтовый
/// `TimelineBlendMode`). Неизвестное значение → `Normal`.
pub fn parse_blend_mode(value: &str) -> BlendMode {
    match value {
        "add" | "plus" | "linear-dodge" => BlendMode::Add,
        "multiply" => BlendMode::Multiply,
        "screen" => BlendMode::Screen,
        "overlay" => BlendMode::Overlay,
        "darken" => BlendMode::Darken,
        "lighten" => BlendMode::Lighten,
        "color-dodge" => BlendMode::ColorDodge,
        "color-burn" => BlendMode::ColorBurn,
        "hard-light" => BlendMode::HardLight,
        "soft-light" => BlendMode::SoftLight,
        "difference" => BlendMode::Difference,
        "exclusion" => BlendMode::Exclusion,
        "hue" => BlendMode::Hue,
        "saturation" => BlendMode::Saturation,
        "color" => BlendMode::Color,
        "luminosity" => BlendMode::Luminosity,
        _ => BlendMode::Normal,
    }
}

pub fn parse_color(input: &str, alpha: f64) -> Color {
    let hex = input.trim().trim_start_matches('#');
    let parse_pair = |s: &str| u8::from_str_radix(s, 16).ok();
    let (r, g, b, a) = match hex.len() {
        3 => {
            let mut chars = hex.chars();
            let dbl =
                |c: Option<char>| c.and_then(|c| u8::from_str_radix(&format!("{c}{c}"), 16).ok());
            (
                dbl(chars.next()),
                dbl(chars.next()),
                dbl(chars.next()),
                Some(255),
            )
        }
        6 | 8 => (
            parse_pair(&hex[0..2]),
            parse_pair(&hex[2..4]),
            parse_pair(&hex[4..6]),
            if hex.len() == 8 {
                parse_pair(&hex[6..8])
            } else {
                Some(255)
            },
        ),
        _ => (Some(255), Some(255), Some(255), Some(255)),
    };
    let a = ((a.unwrap_or(255) as f64) * alpha.clamp(0.0, 1.0)).round() as u8;
    Color::from_rgba8(r.unwrap_or(255), g.unwrap_or(255), b.unwrap_or(255), a)
}

pub fn number(value: &serde_json::Value, key: &str, fallback: f64) -> f64 {
    number_opt(value, key).unwrap_or(fallback)
}

pub fn number_opt(value: &serde_json::Value, key: &str) -> Option<f64> {
    value
        .get(key)
        .and_then(|v| v.as_f64())
        .filter(|v| v.is_finite())
}

/// Доля из процентного поля: `number/100`, clamp 0..10.
fn percent(value: &serde_json::Value, key: &str, fallback: f64) -> f64 {
    (number(value, key, fallback) / 100.0).clamp(0.0, 10.0)
}

pub fn parse_shape_geometry(shape_type: &str, cfg: &serde_json::Value) -> ShapeGeometry {
    match shape_type {
        "circle" => ShapeGeometry::Circle {
            squash_x: percent(cfg, "squashX", 0.0),
            squash_y: percent(cfg, "squashY", 0.0),
        },
        "triangle" => ShapeGeometry::Triangle {
            base_length: percent(cfg, "baseLength", 100.0),
            vertex_offset: percent(cfg, "vertexOffset", 50.0),
        },
        "star" => ShapeGeometry::Star {
            rays: number(cfg, "rays", 5.0).round().max(2.0) as usize,
            inner_radius: percent(cfg, "innerRadius", 40.0),
        },
        "bang" => ShapeGeometry::Bang {
            rays: number(cfg, "rays", 12.0).round().max(2.0) as usize,
            inner_radius: percent(cfg, "innerRadius", 70.0),
        },
        "speech_bubble" => ShapeGeometry::SpeechBubble {
            width: percent(cfg, "width", 100.0),
            height: percent(cfg, "height", 70.0),
            corner_radius: percent(cfg, "cornerRadius", 20.0),
            pointer_x: percent(cfg, "pointerX", 30.0),
            pointer_w: percent(cfg, "pointerAngle", 20.0),
            pointer_h: percent(cfg, "pointerSharpness", 40.0),
            pointer_right: cfg.get("pointerDirection").and_then(|v| v.as_str()) == Some("right"),
        },
        "cloud" => ShapeGeometry::Cloud {
            cloud_type: number(cfg, "cloudType", 1.0).round() as i32,
        },
        _ => ShapeGeometry::Rectangle {
            width: percent(cfg, "width", 100.0),
            height: percent(cfg, "height", 100.0),
            corner_radius: percent(cfg, "cornerRadius", 0.0),
        },
    }
}

pub fn string_value(value: &serde_json::Value, key: &str, fallback: &str) -> String {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .filter(|v| !v.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

pub fn bool_value(value: &serde_json::Value, key: &str, fallback: bool) -> bool {
    value.get(key).and_then(|v| v.as_bool()).unwrap_or(fallback)
}

pub fn font_weight(value: &serde_json::Value) -> f32 {
    match value.get("fontWeight") {
        Some(v) if v.is_number() => v.as_f64().unwrap_or(700.0) as f32,
        Some(v) if v.as_str() == Some("normal") => 400.0,
        Some(v) if v.as_str() == Some("bold") => 700.0,
        Some(v) => v
            .as_str()
            .and_then(|s| s.parse::<f32>().ok())
            .unwrap_or(700.0),
        None => 700.0,
    }
}

pub fn text_align(value: &serde_json::Value) -> TextAlign {
    match value.get("align").and_then(|v| v.as_str()) {
        Some("left") => TextAlign::Left,
        Some("right") => TextAlign::Right,
        _ => TextAlign::Center,
    }
}

pub fn text_vertical_align(value: &serde_json::Value) -> TextVerticalAlign {
    match value.get("verticalAlign").and_then(|v| v.as_str()) {
        Some("top") => TextVerticalAlign::Top,
        Some("bottom") => TextVerticalAlign::Bottom,
        _ => TextVerticalAlign::Middle,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compositor::scene::BlendMode;

    #[test]
    fn maps_full_blend_mode_set() {
        assert_eq!(parse_blend_mode("multiply"), BlendMode::Multiply);
        assert_eq!(parse_blend_mode("overlay"), BlendMode::Overlay);
        assert_eq!(parse_blend_mode("color-dodge"), BlendMode::ColorDodge);
        assert_eq!(parse_blend_mode("hard-light"), BlendMode::HardLight);
        assert_eq!(parse_blend_mode("difference"), BlendMode::Difference);
        assert_eq!(parse_blend_mode("luminosity"), BlendMode::Luminosity);
        assert_eq!(parse_blend_mode("add"), BlendMode::Add);
        assert_eq!(parse_blend_mode("unknown"), BlendMode::Normal);
    }

    #[test]
    fn parses_short_and_long_hex() {
        let c = parse_color("#f00", 1.0);
        assert_eq!(
            (c.to_rgba8().r, c.to_rgba8().g, c.to_rgba8().b),
            (255, 0, 0)
        );
        let c2 = parse_color("00ff00", 0.5);
        assert_eq!(c2.to_rgba8().g, 255);
        assert_eq!(c2.to_rgba8().a, 128);
    }
}
