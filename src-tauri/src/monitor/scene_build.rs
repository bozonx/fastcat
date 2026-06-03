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

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::SystemTime;

use anyhow::Result;
use vello::peniko::{Blob, Color, ImageAlphaType, ImageData, ImageFormat};

use crate::compositor::scene::{
    BlendMode, Layer, LayerKind as CompLayerKind, ShapeGeometry, ShapeLayer, TextAlign,
    TextBackground, TextLayer, TextVerticalAlign, Transform,
};

use super::scene::{LayerKind, SceneLayer, SceneLayerTransform};

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
pub fn finalize_layer(
    sl: &SceneLayer,
    kind: CompLayerKind,
    scene_size: (u32, u32),
    time_sec: f64,
) -> Layer {
    let media_size = kind.natural_size();
    let source_rotation = source_orientation_deg(sl);
    let is_raster_layer = matches!(
        sl.kind,
        LayerKind::Video | LayerKind::Image | LayerKind::Svg
    );
    let transform = match &sl.transform {
        Some(t) => {
            let fit = if is_raster_layer {
                oriented_fit_scale(media_size, scene_size, source_rotation)
            } else {
                1.0
            };
            let crop = local_crop_from_display_transform(t, source_rotation, is_raster_layer);
            Transform {
                x: t.x,
                y: t.y,
                scale_x: t.scale_x * fit,
                scale_y: t.scale_y * fit,
                rotation_deg: t.rotation_deg + source_rotation,
                anchor_x: t.anchor_x,
                anchor_y: t.anchor_y,
                crop_top: crop.top,
                crop_bottom: crop.bottom,
                crop_left: crop.left,
                crop_right: crop.right,
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
    let base_opacity = sl.opacity.clamp(0.0, 1.0) as f32;
    let local_t = time_sec - sl.timeline_start_sec;
    let opacity = compute_transition_opacity(sl, local_t, base_opacity);

    Layer {
        id: sl.id.clone(),
        kind,
        transform,
        opacity,
        blend: parse_blend_mode(&sl.blend_mode),
        mask: None,
        effects: sl.effects.clone(),
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct LocalCrop {
    top: f64,
    bottom: f64,
    left: f64,
    right: f64,
}

fn local_crop_from_display_transform(
    transform: &SceneLayerTransform,
    source_rotation: f64,
    is_raster_layer: bool,
) -> LocalCrop {
    let crop = LocalCrop {
        top: transform.crop_top,
        bottom: transform.crop_bottom,
        left: transform.crop_left,
        right: transform.crop_right,
    };
    if !is_raster_layer {
        return crop;
    }

    match normalized_right_angle(source_rotation) {
        90 => LocalCrop {
            top: crop.right,
            right: crop.bottom,
            bottom: crop.left,
            left: crop.top,
        },
        180 => LocalCrop {
            top: crop.bottom,
            right: crop.left,
            bottom: crop.top,
            left: crop.right,
        },
        270 => LocalCrop {
            top: crop.left,
            right: crop.top,
            bottom: crop.right,
            left: crop.bottom,
        },
        _ => crop,
    }
}

pub fn compute_transition_opacity(sl: &SceneLayer, local_t: f64, base_opacity: f32) -> f32 {
    let clip_dur = sl.timeline_end_sec - sl.timeline_start_sec;
    if clip_dur <= 0.0 {
        return 0.0;
    }

    let in_dur = sl
        .transition_in
        .as_ref()
        .map(|t| t.duration_sec)
        .unwrap_or(0.0);
    let out_dur = sl
        .transition_out
        .as_ref()
        .map(|t| t.duration_sec)
        .unwrap_or(0.0);
    let out_start = clip_dur - out_dur;

    let in_active = in_dur > 0.0 && local_t < in_dur;
    let out_active = out_dur > 0.0 && local_t >= out_start;

    let mut apply_in = in_active;
    let mut apply_out = out_active;

    if in_active && out_active {
        let dist_to_in_end = in_dur - local_t;
        let dist_to_out_start = local_t - out_start;
        if dist_to_in_end <= dist_to_out_start {
            apply_out = false;
        } else {
            apply_in = false;
        }
    }

    let mut opacity = base_opacity;

    if apply_in {
        if let Some(t_in) = &sl.transition_in {
            if t_in.transition_type == "dissolve" {
                let raw_progress = (local_t / in_dur).clamp(0.0, 1.0);
                let curve = t_in.curve.as_deref().unwrap_or("linear");
                let progress = apply_transition_curve(raw_progress, curve);
                opacity = opacity * progress as f32;
            }
        }
    } else if apply_out {
        if let Some(t_out) = &sl.transition_out {
            if t_out.transition_type == "dissolve" {
                let raw_progress = ((local_t - out_start) / out_dur).clamp(0.0, 1.0);
                let curve = t_out.curve.as_deref().unwrap_or("linear");
                let progress = apply_transition_curve(raw_progress, curve);
                opacity = opacity * (1.0 - progress) as f32;
            }
        }
    }

    opacity.clamp(0.0, 1.0)
}

fn solve_cubic_bezier(t: f64, x1: f64, y1: f64, x2: f64, y2: f64) -> f64 {
    if t <= 0.0 {
        return 0.0;
    }
    if t >= 1.0 {
        return 1.0;
    }
    if (x1 - y1).abs() < 1e-9 && (x2 - y2).abs() < 1e-9 {
        return t;
    }

    let mut guess = t;
    for _ in 0..5 {
        let cx = 3.0 * x1;
        let bx = 3.0 * (x2 - x1) - cx;
        let ax = 1.0 - cx - bx;
        let current_x = ((ax * guess + bx) * guess + cx) * guess;
        let current_slope = (3.0 * ax * guess + 2.0 * bx) * guess + cx;
        if current_slope.abs() < 1e-9 {
            break;
        }
        guess -= (current_x - t) / current_slope;
    }

    guess = guess.clamp(0.0, 1.0);

    let cy = 3.0 * y1;
    let by = 3.0 * (y2 - y1) - cy;
    let ay = 1.0 - cy - by;
    ((ay * guess + by) * guess + cy) * guess
}

fn apply_transition_curve(progress: f64, curve: &str) -> f64 {
    let t = progress.clamp(0.0, 1.0);
    match curve {
        "linear" => t,
        "ease-in" => {
            let bulge = 0.8;
            let offset = 1.0;
            let x1 = offset * bulge;
            let x2 = 1.0 - (1.0 - offset) * bulge;
            solve_cubic_bezier(t, x1, 0.0, x2, 1.0)
        }
        "ease-out" => {
            let bulge = 0.8;
            let offset = 0.0;
            let x1 = offset * bulge;
            let x2 = 1.0 - (1.0 - offset) * bulge;
            solve_cubic_bezier(t, x1, 0.0, x2, 1.0)
        }
        "smooth" => {
            let bulge = 0.8;
            let offset = 0.5;
            let x1 = offset * bulge;
            let x2 = 1.0 - (1.0 - offset) * bulge;
            solve_cubic_bezier(t, x1, 0.0, x2, 1.0)
        }
        _ => t,
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

fn normalized_right_angle(rotation_deg: f64) -> i32 {
    let normalized = ((rotation_deg.round() as i32 % 360) + 360) % 360;
    match normalized {
        90 | 180 | 270 => normalized,
        _ => 0,
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
    matches!(normalized_right_angle(rotation_deg), 90 | 270)
}

// ---------------------------------------------------------------------------
// Декод растровых ресурсов
// ---------------------------------------------------------------------------

static GLOBAL_FONT_DB: OnceLock<Arc<resvg::usvg::fontdb::Database>> = OnceLock::new();

fn get_font_db() -> Arc<resvg::usvg::fontdb::Database> {
    GLOBAL_FONT_DB
        .get_or_init(|| {
            log::info!("[svg] scanning system fonts once for the global database...");
            let mut db = resvg::usvg::fontdb::Database::new();
            db.load_system_fonts();
            Arc::new(db)
        })
        .clone()
}

struct SvgCacheEntry {
    modified: SystemTime,
    image: ImageData,
    size: (u32, u32),
}

static SVG_CACHE: OnceLock<Mutex<HashMap<(PathBuf, u32), SvgCacheEntry>>> = OnceLock::new();

/// Растеризует SVG в `ImageData`, целясь в `target_long_edge` пикселей по длинной
/// стороне (= разрешение, в котором слой будет показан: монитор для preview,
/// export-кадр для экспорта). Раньше растеризация шла всегда в натуральном размере
/// SVG, из-за чего мелкие иконки на весь экран были мыными, а большие SVG в
/// маленьком preview зря жгли память.
pub fn rasterize_svg(path: &Path, target_long_edge: u32) -> Result<(ImageData, (u32, u32))> {
    let path_buf = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let modified = fs::metadata(&path_buf)
        .and_then(|m| m.modified())
        .unwrap_or_else(|_| SystemTime::now());

    let cache_lock = SVG_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(cache) = cache_lock.lock() {
        if let Some(entry) = cache.get(&(path_buf.clone(), target_long_edge)) {
            if entry.modified == modified {
                return Ok((entry.image.clone(), entry.size));
            }
        }
    }

    let options = resvg::usvg::Options {
        resources_dir: path_buf.parent().map(|p| p.to_path_buf()),
        fontdb: get_font_db(),
        ..resvg::usvg::Options::default()
    };

    let bytes = fs::read(&path_buf)?;
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

    let image = ImageData {
        data: Blob::new(Arc::new(data)),
        format: ImageFormat::Rgba8,
        alpha_type: ImageAlphaType::AlphaPremultiplied,
        width,
        height,
    };
    let size = (width, height);

    if let Ok(mut cache) = cache_lock.lock() {
        cache.insert(
            (path_buf, target_long_edge),
            SvgCacheEntry {
                modified,
                image: image.clone(),
                size,
            },
        );
    }

    Ok((image, size))
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
    use serde_json::json;

    fn test_shape_kind() -> CompLayerKind {
        CompLayerKind::Shape(ShapeLayer {
            geometry: ShapeGeometry::Rectangle {
                width: 1.0,
                height: 1.0,
                corner_radius: 0.0,
            },
            fill: Color::WHITE,
            stroke: Color::TRANSPARENT,
            stroke_width: 0.0,
            natural_size: (1920, 1080),
        })
    }

    fn layer_with_crop(kind: &str, source_orientation: &str) -> SceneLayer {
        serde_json::from_value(json!({
            "id": "crop-test",
            "kind": kind,
            "timeline_start_sec": 0.0,
            "timeline_end_sec": 1.0,
            "source_start_sec": 0.0,
            "source_orientation": source_orientation,
            "z": 1,
            "opacity": 1.0,
            "transform": {
                "x": 960.0,
                "y": 540.0,
                "crop_top": 10.0,
                "crop_bottom": 20.0,
                "crop_left": 30.0,
                "crop_right": 40.0
            }
        }))
        .unwrap()
    }

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

    #[test]
    fn finalize_layer_remaps_raster_crop_for_90_degree_source_orientation() {
        let layer = layer_with_crop("video", "90");
        let output = finalize_layer(&layer, test_shape_kind(), (1920, 1080), 0.0);

        assert_eq!(output.transform.crop_top, 40.0);
        assert_eq!(output.transform.crop_right, 20.0);
        assert_eq!(output.transform.crop_bottom, 30.0);
        assert_eq!(output.transform.crop_left, 10.0);
    }

    #[test]
    fn finalize_layer_remaps_raster_crop_for_270_degree_source_orientation() {
        let layer = layer_with_crop("video", "270");
        let output = finalize_layer(&layer, test_shape_kind(), (1920, 1080), 0.0);

        assert_eq!(output.transform.crop_top, 30.0);
        assert_eq!(output.transform.crop_right, 10.0);
        assert_eq!(output.transform.crop_bottom, 40.0);
        assert_eq!(output.transform.crop_left, 20.0);
    }

    #[test]
    fn finalize_layer_remaps_raster_crop_for_180_degree_source_orientation() {
        let layer = layer_with_crop("video", "180");
        let output = finalize_layer(&layer, test_shape_kind(), (1920, 1080), 0.0);

        assert_eq!(output.transform.crop_top, 20.0);
        assert_eq!(output.transform.crop_right, 30.0);
        assert_eq!(output.transform.crop_bottom, 10.0);
        assert_eq!(output.transform.crop_left, 40.0);
    }

    #[test]
    fn finalize_layer_keeps_non_raster_crop_in_local_space() {
        let layer = layer_with_crop("shape", "90");
        let output = finalize_layer(&layer, test_shape_kind(), (1920, 1080), 0.0);

        assert_eq!(output.transform.crop_top, 10.0);
        assert_eq!(output.transform.crop_right, 40.0);
        assert_eq!(output.transform.crop_bottom, 20.0);
        assert_eq!(output.transform.crop_left, 30.0);
    }

    #[test]
    fn test_compute_transition_opacity() {
        let build_layer = |json_val: serde_json::Value| -> SceneLayer {
            serde_json::from_value(json_val).unwrap()
        };

        // 1. No transitions
        let layer_no_trans = build_layer(json!({
            "id": "1",
            "kind": "video",
            "timeline_start_sec": 10.0,
            "timeline_end_sec": 20.0,
            "source_start_sec": 0.0,
            "z": 1,
            "opacity": 0.8
        }));

        assert_eq!(compute_transition_opacity(&layer_no_trans, 0.0, 0.8), 0.8);
        assert_eq!(compute_transition_opacity(&layer_no_trans, 5.0, 0.8), 0.8);
        assert_eq!(compute_transition_opacity(&layer_no_trans, 10.0, 0.8), 0.8);

        // 2. Transition In (duration = 2.0 sec, linear, dissolve)
        let layer_trans_in = build_layer(json!({
            "id": "2",
            "kind": "video",
            "timeline_start_sec": 10.0,
            "timeline_end_sec": 20.0,
            "source_start_sec": 0.0,
            "z": 1,
            "opacity": 0.8,
            "transition_in": {
                "type": "dissolve",
                "duration_sec": 2.0,
                "curve": "linear"
            }
        }));

        assert_eq!(compute_transition_opacity(&layer_trans_in, 0.0, 0.8), 0.0);
        assert!((compute_transition_opacity(&layer_trans_in, 1.0, 0.8) - 0.4).abs() < 1e-5);
        assert_eq!(compute_transition_opacity(&layer_trans_in, 2.0, 0.8), 0.8);
        assert_eq!(compute_transition_opacity(&layer_trans_in, 5.0, 0.8), 0.8);

        // 3. Transition Out (duration = 2.0 sec, linear, dissolve)
        let layer_trans_out = build_layer(json!({
            "id": "3",
            "kind": "video",
            "timeline_start_sec": 10.0,
            "timeline_end_sec": 20.0,
            "source_start_sec": 0.0,
            "z": 1,
            "opacity": 0.8,
            "transition_out": {
                "type": "dissolve",
                "duration_sec": 2.0,
                "curve": "linear"
            }
        }));

        assert_eq!(compute_transition_opacity(&layer_trans_out, 5.0, 0.8), 0.8);
        assert_eq!(compute_transition_opacity(&layer_trans_out, 8.0, 0.8), 0.8);
        assert!((compute_transition_opacity(&layer_trans_out, 9.0, 0.8) - 0.4).abs() < 1e-5);
        assert_eq!(compute_transition_opacity(&layer_trans_out, 10.0, 0.8), 0.0);

        // 4. Overlapping Transitions (transition_in 6.0 sec, transition_out 6.0 sec, duration 10.0 sec)
        let layer_overlap = build_layer(json!({
            "id": "4",
            "kind": "video",
            "timeline_start_sec": 10.0,
            "timeline_end_sec": 20.0,
            "source_start_sec": 0.0,
            "z": 1,
            "opacity": 1.0,
            "transition_in": {
                "type": "dissolve",
                "duration_sec": 6.0,
                "curve": "linear"
            },
            "transition_out": {
                "type": "dissolve",
                "duration_sec": 6.0,
                "curve": "linear"
            }
        }));

        let op_in = compute_transition_opacity(&layer_overlap, 2.0, 1.0);
        assert!((op_in - 2.0 / 6.0).abs() < 1e-5);

        let op_out = compute_transition_opacity(&layer_overlap, 8.0, 1.0);
        assert!((op_out - 2.0 / 6.0).abs() < 1e-5);

        // 5. Bezier Curves (smooth)
        let layer_bezier = build_layer(json!({
            "id": "5",
            "kind": "video",
            "timeline_start_sec": 10.0,
            "timeline_end_sec": 20.0,
            "source_start_sec": 0.0,
            "z": 1,
            "opacity": 1.0,
            "transition_in": {
                "type": "dissolve",
                "duration_sec": 2.0,
                "curve": "smooth"
            }
        }));
        let op_smooth = compute_transition_opacity(&layer_bezier, 1.0, 1.0);
        assert!((op_smooth - 0.5).abs() < 1e-5);
    }

    #[test]
    fn test_rasterize_svg_caching() {
        use std::io::Write;
        let path = std::env::temp_dir().join("test_fastcat_svg.svg");
        let svg_content = r#"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>"#;
        let mut file = std::fs::File::create(&path).unwrap();
        file.write_all(svg_content.as_bytes()).unwrap();
        file.sync_all().unwrap();

        // First rasterization
        let (img1, size1) = rasterize_svg(&path, 100).unwrap();
        assert_eq!(size1, (100, 100));

        // Second rasterization (should hit cache)
        let (img2, size2) = rasterize_svg(&path, 100).unwrap();
        assert_eq!(size2, (100, 100));

        // Verify pixel data equality
        assert_eq!(img1.data.as_ref(), img2.data.as_ref());

        // Cleanup
        let _ = std::fs::remove_file(&path);
    }
}
