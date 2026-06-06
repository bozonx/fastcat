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
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::SystemTime;

use anyhow::Result;
use vello::peniko::{Blob, Color, ImageAlphaType, ImageData, ImageFormat};

use crate::compositor::scene::{
    BlendMode, Layer, LayerKind as CompLayerKind, ShapeGeometry, ShapeLayer, TextAlign, TextLayer,
    TextVerticalAlign, Transform, TransitionInfo,
};
use parley::fontique::FontWeight;
use parley::style::LineHeight;
use parley::{PositionedLayoutItem, StyleProperty};

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

struct Padding {
    top: f64,
    right: f64,
    bottom: f64,
    left: f64,
}

fn parse_padding(style: &serde_json::Value) -> Padding {
    let padding_linked = bool_value(style, "paddingLinked", true);
    let padding_val = style.get("padding");

    let mut top = 60.0;
    let mut right = 60.0;
    let mut bottom = 60.0;
    let mut left = 60.0;

    if let Some(val) = padding_val {
        if let Some(num) = val.as_f64() {
            top = num;
            right = num;
            bottom = num;
            left = num;
        } else if let Some(obj) = val.as_object() {
            let x = obj.get("x").and_then(|v| v.as_f64());
            let y = obj.get("y").and_then(|v| v.as_f64());
            let t = obj.get("top").and_then(|v| v.as_f64());
            let r = obj.get("right").and_then(|v| v.as_f64());
            let b = obj.get("bottom").and_then(|v| v.as_f64());
            let l = obj.get("left").and_then(|v| v.as_f64());

            if t.is_some() || r.is_some() || b.is_some() || l.is_some() {
                top = t.unwrap_or(0.0);
                right = r.unwrap_or(0.0);
                bottom = b.unwrap_or(0.0);
                left = l.unwrap_or(0.0);
            } else if x.is_some() || y.is_some() {
                let xv = x.unwrap_or(0.0);
                let yv = y.unwrap_or(0.0);
                top = yv;
                right = xv;
                bottom = yv;
                left = xv;
            }
        }
    }

    if padding_linked {
        top = left;
        right = left;
        bottom = left;
    }

    Padding {
        top,
        right,
        bottom,
        left,
    }
}

fn build_text_layer(sl: &SceneLayer, scene_size: (u32, u32)) -> TextLayer {
    let scene_w = scene_size.0;
    let scene_h = scene_size.1;
    let style = sl.style.clone().unwrap_or(serde_json::Value::Null);
    let font_size = number(&style, "fontSize", 64.0).clamp(1.0, 1000.0) as f32;
    let render_scale = (scene_w as f64 / 1920.0).min(scene_h as f64 / 1080.0);

    // Core parameters
    let text = sl.text.clone().unwrap_or_default();
    let font_family_raw = string_value(&style, "fontFamily", "sans-serif");
    let (primary_font, generic_fallback) =
        crate::compositor::text::resolve_font_family(&font_family_raw);
    let font_weight_val = font_weight(&style);
    let line_height_val = number(&style, "lineHeight", 1.2).clamp(0.1, 10.0) as f32;
    let letter_spacing = (number(&style, "letterSpacing", 0.0) * render_scale) as f32;

    let font_size_px = (font_size as f64 * render_scale).max(1.0) as f32;

    let color_alpha = number(&style, "colorAlpha", 1.0).clamp(0.0, 1.0);
    let color = parse_color(
        string_value(&style, "color", "#ffffff").as_str(),
        color_alpha,
    );

    let align = text_align(&style);
    let vertical_align = text_vertical_align(&style);

    // Padding
    let padding = parse_padding(&style);
    let padding_top = (padding.top * render_scale) as f32;
    let padding_right = (padding.right * render_scale) as f32;
    let padding_bottom = (padding.bottom * render_scale) as f32;
    let padding_left = (padding.left * render_scale) as f32;

    // Explicit sizing
    let explicit_width_px = number_opt(&style, "width").map(|w| (w * render_scale).max(1.0) as f32);
    let explicit_height_px =
        number_opt(&style, "height").map(|h| (h * render_scale).max(1.0) as f32);

    // Border
    let border_enabled = bool_value(&style, "borderEnabled", false);
    let border_width = if border_enabled {
        (number(&style, "borderWidth", 0.0).max(0.0) * render_scale) as f32
    } else {
        0.0
    };
    let border_color = parse_color(
        string_value(&style, "borderColor", "#ffffff").as_str(),
        number(&style, "borderAlpha", 1.0).clamp(0.0, 1.0),
    );

    // Background
    let background_enabled = bool_value(&style, "backgroundEnabled", false)
        || style
            .get("backgroundColor")
            .and_then(|v| v.as_str())
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false);
    let background_color = parse_color(
        string_value(&style, "backgroundColor", "#000000").as_str(),
        number(&style, "backgroundAlpha", 1.0).clamp(0.0, 1.0),
    );
    let background_radius = number(&style, "backgroundRadius", 0.0).max(0.0) * render_scale;

    // Background Shadow
    let bg_shadow_enabled = bool_value(&style, "backgroundShadowEnabled", false);
    let bg_shadow_blur = if bg_shadow_enabled {
        (number(&style, "backgroundShadowBlur", 0.0).max(0.0) * render_scale) as f32
    } else {
        0.0
    };
    let bg_shadow_spread = if bg_shadow_enabled {
        (number(&style, "backgroundShadowSpread", 0.0).max(0.0) * render_scale) as f32
    } else {
        0.0
    };
    let bg_shadow_offset_x = if bg_shadow_enabled {
        (number(&style, "backgroundShadowOffsetX", 0.0) * render_scale) as f32
    } else {
        0.0
    };
    let bg_shadow_offset_y = if bg_shadow_enabled {
        (number(&style, "backgroundShadowOffsetY", 0.0) * render_scale) as f32
    } else {
        0.0
    };
    let bg_shadow_color = parse_color(
        string_value(&style, "backgroundShadowColor", "#000000").as_str(),
        number(&style, "backgroundShadowAlpha", 1.0).clamp(0.0, 1.0),
    );

    // Text Shadow
    let text_shadow_enabled = bool_value(&style, "textShadowEnabled", false);
    let text_shadow_blur = if text_shadow_enabled {
        (number(&style, "textShadowBlur", 0.0).max(0.0) * render_scale) as f32
    } else {
        0.0
    };
    let text_shadow_spread = if text_shadow_enabled {
        (number(&style, "textShadowSpread", 0.0).max(0.0) * render_scale) as f32
    } else {
        0.0
    };
    let text_shadow_offset_x = if text_shadow_enabled {
        (number(&style, "textShadowOffsetX", 0.0) * render_scale) as f32
    } else {
        0.0
    };
    let text_shadow_offset_y = if text_shadow_enabled {
        (number(&style, "textShadowOffsetY", 0.0) * render_scale) as f32
    } else {
        0.0
    };
    let text_shadow_color = parse_color(
        string_value(&style, "textShadowColor", "#000000").as_str(),
        number(&style, "textShadowAlpha", 1.0).clamp(0.0, 1.0),
    );

    // Determine text wrapping constraint
    let mut content_width_px = explicit_width_px.map(|w| (w - padding_left - padding_right).max(1.0));
    if let Some(ref mut cw) = content_width_px {
        if padding_left + padding_right > explicit_width_px.unwrap_or(0.0) {
            log::warn!(
                "[scene_build] padding ({:.1}+{:.1}) exceeds explicit width ({:.1}), clamping content width to 1.0",
                padding_left, padding_right, explicit_width_px.unwrap_or(0.0)
            );
            *cw = 1.0;
        }
    }

    // Layout parley to compute actual size
    let text_block_width_px;
    let text_block_height_px;

    let lock = crate::compositor::text::get_text_context();
    if let Ok(mut ctx) = lock.lock() {
        let (font_cx, layout_cx) = &mut *ctx;
        let resolved_font_family =
            crate::compositor::text::build_font_family(font_cx, &primary_font, generic_fallback);
        let mut builder = layout_cx.ranged_builder(font_cx, &text, 1.0, true);
        builder.push_default(StyleProperty::FontSize(font_size_px));
        builder.push_default(StyleProperty::LineHeight(LineHeight::FontSizeRelative(
            line_height_val,
        )));
        builder.push_default(StyleProperty::FontWeight(FontWeight::new(font_weight_val)));
        builder.push_default(StyleProperty::FontFamily(resolved_font_family));
        let mut layout = builder.build(&text);

        layout.break_all_lines(content_width_px);

        let mut max_line_w = 0.0f32;
        for line in layout.lines() {
            let mut glyph_count = 0;
            for item in line.items() {
                if let PositionedLayoutItem::GlyphRun(run) = item {
                    glyph_count += run.positioned_glyphs().count();
                }
            }
            let line_w =
                line.metrics().advance + (glyph_count.saturating_sub(1) as f32) * letter_spacing;
            if line_w > max_line_w {
                max_line_w = line_w;
            }
        }
        text_block_width_px = max_line_w;
        text_block_height_px = layout.height();
    } else {
        log::warn!("[scene_build] failed to acquire text context lock, using estimated text size");
        let approx_chars = text.chars().count().max(1) as f32;
        text_block_width_px = approx_chars * font_size_px * 0.5;
        text_block_height_px = font_size_px * line_height_val;
    }

    // Frame size
    let frame_content_width_px = content_width_px.unwrap_or(text_block_width_px);
    let frame_width_px = frame_content_width_px + padding_left + padding_right;
    let auto_frame_height_px = text_block_height_px + padding_top + padding_bottom;
    let frame_height_px = explicit_height_px.unwrap_or(auto_frame_height_px).max(1.0);

    // Shadows bounding box adjustment
    let shadow_left = (bg_shadow_blur + bg_shadow_spread - bg_shadow_offset_x)
        .max(text_shadow_blur + text_shadow_spread - text_shadow_offset_x)
        .max(0.0);
    let shadow_right = (bg_shadow_blur + bg_shadow_spread + bg_shadow_offset_x)
        .max(text_shadow_blur + text_shadow_spread + text_shadow_offset_x)
        .max(0.0);
    let shadow_top = (bg_shadow_blur + bg_shadow_spread - bg_shadow_offset_y)
        .max(text_shadow_blur + text_shadow_spread - text_shadow_offset_y)
        .max(0.0);
    let shadow_bottom = (bg_shadow_blur + bg_shadow_spread + bg_shadow_offset_y)
        .max(text_shadow_blur + text_shadow_spread + text_shadow_offset_y)
        .max(0.0);

    let background_width = frame_width_px + border_width * 2.0 + shadow_left + shadow_right;
    let background_height = frame_height_px + border_width * 2.0 + shadow_top + shadow_bottom;

    let natural_width = background_width.ceil() as u32;
    let natural_height = background_height.ceil() as u32;

    TextLayer {
        text,
        font_family: primary_font,
        font_size: font_size_px,
        font_weight: font_weight_val,
        color,
        align,
        vertical_align,
        line_height: line_height_val,
        letter_spacing,
        max_width: explicit_width_px,
        explicit_height: explicit_height_px,

        background_enabled,
        background_color,
        background_radius,

        bg_shadow_enabled,
        bg_shadow_color,
        bg_shadow_blur,
        bg_shadow_spread,
        bg_shadow_offset_x,
        bg_shadow_offset_y,

        border_enabled,
        border_color,
        border_width,

        text_shadow_enabled,
        text_shadow_color,
        text_shadow_blur,
        text_shadow_spread,
        text_shadow_offset_x,
        text_shadow_offset_y,

        padding_top,
        padding_right,
        padding_bottom,
        padding_left,

        shadow_left,
        shadow_top,
        frame_width: frame_width_px,
        frame_height: frame_height_px,
        text_block_height: text_block_height_px,

        natural_size: (natural_width, natural_height),
    }
}

/// Финализирует `CompLayerKind` в `Layer`: transform (явный или center-fit),
/// opacity и blend-mode из IPC-слоя.
/// Returns a copy of `layer` with `source_orientation` resolved from the decoder's
/// detected rotation when the layer left it as auto/unset. An explicit orientation
/// from the front-end always wins. Shared by the preview runtime and export render
/// paths so both apply rotation identically.
pub fn layer_with_auto_source_rotation(layer: &SceneLayer, source_rotation: i32) -> SceneLayer {
    if source_rotation.rem_euclid(360) == 0 {
        return layer.clone();
    }
    match layer.source_orientation.as_deref() {
        None | Some("auto") => {
            let mut layer = layer.clone();
            layer.source_orientation = Some(source_rotation.rem_euclid(360).to_string());
            layer
        }
        Some(_) => layer.clone(),
    }
}

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
            if is_raster_layer {
                let fit_media_size = if is_quarter_turn(source_rotation) {
                    (media_size.1, media_size.0)
                } else {
                    media_size
                };
                Transform {
                    rotation_deg: source_rotation,
                    ..Transform::center_fit(fit_media_size, scene_size)
                }
            } else {
                Transform {
                    x: scene_size.0 as f64 / 2.0,
                    y: scene_size.1 as f64 / 2.0,
                    scale_x: 1.0,
                    scale_y: 1.0,
                    rotation_deg: source_rotation,
                    anchor_x: 0.5,
                    anchor_y: 0.5,
                    ..Default::default()
                }
            }
        }
    };
    let base_opacity = sl.opacity.clamp(0.0, 1.0) as f32;
    let local_t = time_sec - sl.timeline_start_sec;
    let opacity = compute_transition_opacity(sl, local_t, base_opacity);

    // Шейдерные переходы (wipe/slide/circle/…) рендерятся через `transition_in`
    // входящего клипа (он композитится поверх `from_layer`).
    // Для смежных клипов `transition_out` исходящего клипа автоматически
    // наследуется следующим клипом через `getEffectiveTransitionIn` на фронте,
    // поэтому non-dissolve переходы между соседними клипами РАБОТАЮТ.
    // Standalone `transition_out` (wipe в пустоту / background / transparent)
    // намеренно не даёт отдельного шейдерного прохода — это отдельная фича.
    // Для `transition_out` в Rust поддержан только dissolve (через альфу в
    // `compute_transition_opacity`).
    let mut transition = None;
    if let Some(t_in) = &sl.transition_in {
        let in_dur = t_in.duration_sec;
        if in_dur > 0.0 && local_t < in_dur && local_t >= 0.0 {
            if t_in.transition_type != "dissolve" {
                if let (Some(from_id), Some(spec)) = (&t_in.from_layer_id, &t_in.spec) {
                    let progress = (local_t / in_dur).clamp(0.0, 1.0);
                    let curve = t_in.curve.as_deref().unwrap_or("linear");
                    let progress_curved = apply_transition_curve(progress, curve) as f32;
                    transition = Some(TransitionInfo {
                        spec: spec.clone(),
                        progress: progress_curved,
                        from_layer_id: from_id.clone(),
                    });
                }
            }
        }
    }

    Layer {
        id: sl.id.clone(),
        kind,
        transform,
        opacity,
        blend: parse_blend_mode(&sl.blend_mode),
        mask: None,
        effects: sl.effects.clone(),
        transition,
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
        .map(|t| t.duration_sec.clamp(0.0, clip_dur))
        .unwrap_or(0.0);
    let out_dur = sl
        .transition_out
        .as_ref()
        .map(|t| t.duration_sec.clamp(0.0, clip_dur))
        .unwrap_or(0.0);
    let out_start = (clip_dur - out_dur).max(0.0);

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

/// Уникальные имена семейств шрифтов, установленных в системе, отсортированные
/// по алфавиту. Берётся из той же глобальной базы, что и растеризация SVG, поэтому
/// список ровно соответствует тому, чем реально умеет рисовать нативный рендер.
pub fn system_font_families() -> Vec<String> {
    let db = get_font_db();
    let mut families: Vec<String> = db
        .faces()
        .filter_map(|face| face.families.first().map(|(name, _)| name.clone()))
        .collect();
    families.sort_unstable_by_key(|name| name.to_lowercase());
    families.dedup();
    families
}

struct SvgCacheEntry {
    modified: SystemTime,
    image: ImageData,
    size: (u32, u32),
}

static SVG_CACHE: OnceLock<Mutex<lru::LruCache<(PathBuf, u32), SvgCacheEntry>>> = OnceLock::new();

/// Растеризует SVG в `ImageData`, целясь в `target_long_edge` пикселей по длинной
/// стороне (= разрешение, в котором слой будет показан: монитор для preview,
/// export-кадр для экспорта). Раньше растеризация шла всегда в натуральном размере
/// SVG, из-за чего мелкие иконки на весь экран были мыными, а большие SVG в
/// маленьком preview зря жгли память.
pub fn rasterize_svg(path: &Path, target_long_edge: u32) -> Result<(ImageData, (u32, u32))> {
    let path_buf = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let maybe_modified = fs::metadata(&path_buf).and_then(|m| m.modified()).ok();

    let cache_lock = SVG_CACHE.get_or_init(|| {
        Mutex::new(lru::LruCache::new(
            std::num::NonZeroUsize::new(128).unwrap(),
        ))
    });
    if let (Some(modified), Ok(mut cache)) = (maybe_modified, cache_lock.lock()) {
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

    if let (Some(modified), Ok(mut cache)) = (maybe_modified, cache_lock.lock()) {
        cache.push(
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
    let trimmed = input.trim();
    let lower = trimmed.to_lowercase();

    // Named colors (subset of CSS)
    let named = match lower.as_str() {
        "black" => Some((0, 0, 0)),
        "white" => Some((255, 255, 255)),
        "red" => Some((255, 0, 0)),
        "green" => Some((0, 128, 0)),
        "blue" => Some((0, 0, 255)),
        "yellow" => Some((255, 255, 0)),
        "cyan" => Some((0, 255, 255)),
        "magenta" => Some((255, 0, 255)),
        "silver" => Some((192, 192, 192)),
        "gray" | "grey" => Some((128, 128, 128)),
        "maroon" => Some((128, 0, 0)),
        "olive" => Some((128, 128, 0)),
        "lime" => Some((0, 255, 0)),
        "aqua" => Some((0, 255, 255)),
        "teal" => Some((0, 128, 128)),
        "navy" => Some((0, 0, 128)),
        "fuchsia" => Some((255, 0, 255)),
        "purple" => Some((128, 0, 128)),
        "orange" => Some((255, 165, 0)),
        _ => None,
    };
    if let Some((r, g, b)) = named {
        let a = ((255_u8 as f64) * alpha.clamp(0.0, 1.0)).round() as u8;
        return Color::from_rgba8(r, g, b, a);
    }

    // rgb(r, g, b)
    if let Some(caps) = lower.strip_prefix("rgb(").and_then(|s| s.strip_suffix(")")) {
        let parts: Vec<_> = caps.split(',').map(|s| s.trim().parse::<u8>().ok()).collect();
        if let [Some(r), Some(g), Some(b)] = parts[..] {
            let a = ((255_u8 as f64) * alpha.clamp(0.0, 1.0)).round() as u8;
            return Color::from_rgba8(r, g, b, a);
        }
    }

    // rgba(r, g, b, a)
    if let Some(caps) = lower.strip_prefix("rgba(").and_then(|s| s.strip_suffix(")")) {
        let parts: Vec<_> = caps.split(',').map(|s| s.trim()).collect();
        if parts.len() == 4 {
            if let (Ok(r), Ok(g), Ok(b), Ok(a_in)) = (
                parts[0].parse::<u8>(),
                parts[1].parse::<u8>(),
                parts[2].parse::<u8>(),
                parts[3].parse::<f64>(),
            ) {
                let a = ((255.0 * a_in * alpha).clamp(0.0, 255.0)).round() as u8;
                return Color::from_rgba8(r, g, b, a);
            }
        }
    }

    // Hex
    let hex = trimmed.trim_start_matches('#');
    let parse_pair = |s: &str| u8::from_str_radix(s, 16).ok();
    let (r, g, b, a) = match hex.len() {
        3 | 4 => {
            let mut chars = hex.chars();
            let dbl =
                |c: Option<char>| c.and_then(|c| u8::from_str_radix(&format!("{c}{c}"), 16).ok());
            let (r, g, b) = (dbl(chars.next()), dbl(chars.next()), dbl(chars.next()));
            // 4-значная форма `#rgba` несёт альфу в четвёртом ниббле.
            let a = if hex.len() == 4 {
                dbl(chars.next())
            } else {
                Some(255)
            };
            (r, g, b, a)
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
        _ => (None, None, None, None),
    };
    // Invalid / non-hex strings fall back to transparent so they don't visually pollute.
    let a = ((a.unwrap_or(255) as f64) * alpha.clamp(0.0, 1.0)).round() as u8;
    Color::from_rgba8(r.unwrap_or(0), g.unwrap_or(0), b.unwrap_or(0), a)
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
    fn parses_four_digit_rgba_hex() {
        // #rgba: красный, полупрозрачный (a-ниббл 8 → 0x88).
        let c = parse_color("#f008", 1.0);
        let rgba = c.to_rgba8();
        assert_eq!((rgba.r, rgba.g, rgba.b), (255, 0, 0));
        assert_eq!(rgba.a, 0x88);
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
    fn finalize_layer_builds_shader_transition_info_from_transition_in() {
        let layer: SceneLayer = serde_json::from_value(json!({
            "id": "to",
            "kind": "video",
            "timeline_start_sec": 10.0,
            "timeline_end_sec": 20.0,
            "source_start_sec": 0.0,
            "z": 1,
            "opacity": 1.0,
            "transition_in": {
                "type": "wipe",
                "duration_sec": 2.0,
                "curve": "linear",
                "from_layer_id": "from",
                "spec": {
                    "type": "wipe",
                    "angle_deg": 45.0,
                    "softness": 0.25
                }
            }
        }))
        .unwrap();

        let output = finalize_layer(&layer, test_shape_kind(), (1920, 1080), 11.0);
        let transition = output.transition.expect("transition info");
        assert_eq!(transition.from_layer_id, "from");
        assert!((transition.progress - 0.5).abs() < 1e-6);
        match transition.spec {
            crate::compositor::transitions::TransitionSpec::Wipe {
                angle_deg,
                softness,
            } => {
                assert_eq!(angle_deg, 45.0);
                assert_eq!(softness, 0.25);
            }
            _ => panic!("expected wipe transition"),
        }
    }

    #[test]
    fn finalize_layer_ignores_non_dissolve_transition_out() {
        let layer: SceneLayer = serde_json::from_value(json!({
            "id": "out",
            "kind": "video",
            "timeline_start_sec": 10.0,
            "timeline_end_sec": 20.0,
            "source_start_sec": 0.0,
            "z": 1,
            "opacity": 1.0,
            "transition_out": {
                "type": "wipe",
                "duration_sec": 2.0,
                "curve": "linear",
                "spec": {
                    "type": "wipe",
                    "angle_deg": 45.0,
                    "softness": 0.25
                }
            }
        }))
        .unwrap();

        let output = finalize_layer(&layer, test_shape_kind(), (1920, 1080), 19.0);
        assert!(output.transition.is_none());
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
    fn compute_transition_opacity_non_dissolve_overlap_keeps_base_opacity() {
        let layer: SceneLayer = serde_json::from_value(json!({
            "id": "overlap",
            "kind": "video",
            "timeline_start_sec": 10.0,
            "timeline_end_sec": 20.0,
            "source_start_sec": 0.0,
            "z": 1,
            "opacity": 0.8,
            "transition_in": {
                "type": "wipe",
                "duration_sec": 6.0,
                "curve": "linear"
            },
            "transition_out": {
                "type": "slide",
                "duration_sec": 6.0,
                "curve": "linear"
            }
        }))
        .unwrap();

        // During overlap (t=4..6) opacity must stay at base because neither
        // transition is a dissolve.
        assert_eq!(compute_transition_opacity(&layer, 4.0, 0.8), 0.8);
        assert_eq!(compute_transition_opacity(&layer, 5.0, 0.8), 0.8);
        assert_eq!(compute_transition_opacity(&layer, 6.0, 0.8), 0.8);
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

    #[test]
    fn test_build_text_layer_auto_size_and_metrics() {
        let style = json!({
            "fontSize": 48.0,
            "fontFamily": "Inter",
            "letterSpacing": 2.0,
            "padding": {
                "top": 10.0,
                "right": 20.0,
                "bottom": 15.0,
                "left": 25.0
            },
            "paddingLinked": false,
            "borderEnabled": true,
            "borderWidth": 4.0,
            "borderColor": "#ff0000",
            "backgroundEnabled": true,
            "backgroundColor": "#0000ff",
            "backgroundRadius": 8.0,
            "backgroundShadowEnabled": true,
            "backgroundShadowBlur": 10.0,
            "backgroundShadowSpread": 5.0,
            "backgroundShadowOffsetX": 3.0,
            "backgroundShadowOffsetY": 4.0,
            "textShadowEnabled": true,
            "textShadowBlur": 5.0,
            "textShadowSpread": 2.0,
            "textShadowOffsetX": 1.0,
            "textShadowOffsetY": 2.0,
            "align": "left",
            "verticalAlign": "top"
        });

        let sl = SceneLayer {
            id: "text-layer-1".into(),
            kind: LayerKind::Text,
            path: "".into(),
            timeline_start_sec: 0.0,
            timeline_end_sec: 10.0,
            source_start_sec: 0.0,
            source_range_duration_sec: 10.0,
            speed: 1.0,
            freeze_frame_source_sec: None,
            source_orientation: None,
            z: 1,
            opacity: 1.0,
            blend_mode: "normal".into(),
            background_color: None,
            text: Some("Test".into()),
            style: Some(style),
            shape_type: None,
            fill_color: None,
            stroke_color: None,
            stroke_width: None,
            shape_config: None,
            transform: None,
            transition_in: None,
            transition_out: None,
            effects: Vec::new(),
        };

        let text_layer = build_text_layer(&sl, (1920, 1080));

        assert_eq!(text_layer.text, "Test");
        assert_eq!(text_layer.font_family, "Inter");
        assert_eq!(text_layer.letter_spacing, 2.0);
        assert_eq!(text_layer.padding_top, 10.0);
        assert_eq!(text_layer.padding_left, 25.0);
        assert_eq!(text_layer.border_width, 4.0);
        assert_eq!(text_layer.background_radius, 8.0);

        assert!(text_layer.natural_size.0 > 0);
        assert!(text_layer.natural_size.1 > 0);
        assert!(text_layer.frame_width > 0.0);
        assert!(text_layer.frame_height > 0.0);
        assert!(text_layer.shadow_left > 0.0);
    }

    #[test]
    fn parse_color_named_colors() {
        let red = parse_color("red", 1.0);
        assert_eq!(red.to_rgba8(), vello::peniko::Color::from_rgba8(255, 0, 0, 255).to_rgba8());
        let white = parse_color("White", 0.5);
        assert_eq!(white.to_rgba8().a, 128);
    }

    #[test]
    fn parse_color_rgb_format() {
        let c = parse_color("rgb(10, 20, 30)", 1.0);
        assert_eq!(c.to_rgba8(), vello::peniko::Color::from_rgba8(10, 20, 30, 255).to_rgba8());
    }

    #[test]
    fn parse_color_rgba_format() {
        let c = parse_color("rgba(10, 20, 30, 0.5)", 1.0);
        assert_eq!(c.to_rgba8().a, 128);
        let c2 = parse_color("rgba(10, 20, 30, 0.5)", 0.5);
        assert_eq!(c2.to_rgba8().a, 64);
    }

    #[test]
    fn parse_color_hex_still_works() {
        let c = parse_color("#ff00aa", 1.0);
        assert_eq!(c.to_rgba8(), vello::peniko::Color::from_rgba8(255, 0, 170, 255).to_rgba8());
    }
}
