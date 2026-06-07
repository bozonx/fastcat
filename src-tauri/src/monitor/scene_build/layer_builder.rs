//! Сборка доменной `compositor::scene::Scene` из IPC-DTO `MonitorScene`.
//!
//! Растровые kind'ы (`Video | Image | Svg`) этот модуль НЕ резолвит — он строит
//! только «виртуальные» слои (`Background | Shape | Text`) и финализирует любой
//! `CompLayerKind` в `Layer` (transform + opacity + blend).

use parley::fontique::FontWeight;
use parley::style::LineHeight;
use parley::StyleProperty;
use vello::peniko::Color;

use crate::compositor::scene::{
    Layer, LayerKind as CompLayerKind, ShapeGeometry, ShapeLayer, TextLayer, Transform,
    TransitionInfo,
};
use crate::media::ffmpeg_utils::is_quarter_turn;

use super::ipc_parsers::*;
use super::transform::{
    local_crop_from_display_transform, oriented_fit_scale, source_orientation_deg,
    text_anchor_offset,
};
use super::transition::{apply_transition_curve, compute_transition_opacity};
use crate::monitor::scene::{LayerKind, SceneLayer};

/// Visible extent of a Gaussian blur as a multiple of the CSS-like blur radius.
/// blur radius → σ ≈ blur/2, and the perceptible tail reaches ~3σ = 1.5·blur.
const SHADOW_BLUR_EXTENT_FACTOR: f32 = 1.5;

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
            // Stroke width is authored in the 1920x1080 design space, so scale it to
            // the scene resolution (uniform, matching the shape body which is a fixed
            // fraction of the frame). Mirrors the web `ShapeRenderer`/`LayoutApplier`.
            let render_scale = (scene_w as f64 / 1920.0).min(scene_h as f64 / 1080.0);
            let stroke_width = sl.stroke_width.unwrap_or(0.0).max(0.0) * render_scale;
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

pub fn build_text_layer(sl: &SceneLayer, scene_size: (u32, u32)) -> TextLayer {
    let style = sl.style.clone().unwrap_or(serde_json::Value::Null);
    let font_size = number(&style, "fontSize", 64.0).clamp(1.0, 1000.0) as f32;
    // Text style values (fontSize, padding, letterSpacing, shadows, border,
    // explicit width/height) are authored in the 1920x1080 design space, the same
    // convention as transforms (`TRANSFORM_DESIGN_BASE`) and the web compositor
    // (`text-layout.ts`). Scale them to the actual scene resolution so a 64px font
    // renders as 128px at 4K instead of staying tiny. Must match the front-end
    // `buildNativeTextTransform` render-scale so glyph size and position agree.
    let render_scale = (scene_size.0 as f64 / 1920.0).min(scene_size.1 as f64 / 1080.0);

    // Core parameters
    let text = sl.text.clone().unwrap_or_default();
    let font_family_raw = string_value(&style, "fontFamily", "sans-serif");
    let (primary_font, generic_fallback) =
        crate::compositor::text::resolve_font_family(&font_family_raw);
    let font_weight_val = font_weight(&style);
    let line_height_val = number(&style, "lineHeight", 1.2).clamp(0.1, 10.0) as f32;
    let letter_spacing =
        (number(&style, "letterSpacing", 0.0).clamp(-1000.0, 1000.0) * render_scale) as f32;

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
    let mut content_width_px =
        explicit_width_px.map(|w| (w - padding_left - padding_right).max(1.0));
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
        // Letter-spacing is shaped natively by parley so it is reflected in line
        // metrics AND wrapping. Must match the draw pass in `scene::draw_text`.
        builder.push_default(StyleProperty::LetterSpacing(letter_spacing));
        builder.push_default(StyleProperty::FontFamily(resolved_font_family));
        let mut layout = builder.build(&text);

        layout.break_all_lines(content_width_px);

        let mut max_line_w = 0.0f32;
        for line in layout.lines() {
            // `advance` already includes letter-spacing applied above.
            let line_w = line.metrics().advance;
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

    // Shadows bounding box adjustment.
    // The blur radius maps to a Gaussian with σ ≈ blur/2; its visible tail reaches
    // ~3σ = 1.5·blur. We reserve that much room in the layer's natural size so the
    // blurred shadow is not clipped when the layer is composited inside a clip group
    // (opacity < 1 / non-normal blend / crop all push a natural-bounds clip).
    let bg_shadow_extent = bg_shadow_blur * SHADOW_BLUR_EXTENT_FACTOR + bg_shadow_spread;
    let text_shadow_extent = text_shadow_blur * SHADOW_BLUR_EXTENT_FACTOR + text_shadow_spread;
    let shadow_left = (bg_shadow_extent - bg_shadow_offset_x)
        .max(text_shadow_extent - text_shadow_offset_x)
        .max(0.0);
    let shadow_right = (bg_shadow_extent + bg_shadow_offset_x)
        .max(text_shadow_extent + text_shadow_offset_x)
        .max(0.0);
    let shadow_top = (bg_shadow_extent - bg_shadow_offset_y)
        .max(text_shadow_extent - text_shadow_offset_y)
        .max(0.0);
    let shadow_bottom = (bg_shadow_extent + bg_shadow_offset_y)
        .max(text_shadow_extent + text_shadow_offset_y)
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
        shadow_right,
        shadow_bottom,
        frame_width: frame_width_px,
        frame_height: frame_height_px,
        text_block_height: text_block_height_px,

        natural_size: (natural_width, natural_height),
    }
}

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
            // Text anchoring is finalized here, where the parley-measured natural
            // size is authoritative (the front-end cannot reproduce glyph shaping).
            let (anchor_dx, anchor_dy) =
                text_anchor_offset(&kind, media_size, t.anchor_x, t.anchor_y);
            let mut transform = Transform::from(t);
            transform.x += anchor_dx;
            transform.y += anchor_dy;
            transform.scale_x *= fit;
            transform.scale_y *= fit;
            transform.rotation_deg += source_rotation;
            transform.crop_top = crop.top;
            transform.crop_bottom = crop.bottom;
            transform.crop_left = crop.left;
            transform.crop_right = crop.right;
            transform
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
                // For text the "no explicit transform" default is center of the
                // scene with the anchor baked in (same convention as shapes).
                let (anchor_dx, anchor_dy) = text_anchor_offset(&kind, media_size, 0.5, 0.5);
                Transform {
                    x: scene_size.0 as f64 / 2.0 + anchor_dx,
                    y: scene_size.1 as f64 / 2.0 + anchor_dy,
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

    // Все шейдерные переходы (включая dissolve → crossfade-spec) рендерятся через
    // `transition_in` входящего клипа: он композитится поверх `from_layer`, чьи пиксели
    // блендятся в шейдере. Для смежных клипов `transition_out` исходящего клипа
    // наследуется следующим клипом через `getEffectiveTransitionIn` на фронте, поэтому
    // переходы между соседними клипами РАБОТАЮТ как настоящий кроссфейд.
    // Условие появления прохода — наличие `from_layer_id` + `spec`. Dissolve без
    // from-слоя (первый клип на таймлайне) проявляется из фона через альфу в
    // `compute_transition_opacity`. Standalone `transition_out` (в пустоту/background)
    // в Rust поддержан только для dissolve — тоже через альфу.
    let mut transition = None;
    if let Some(t_in) = &sl.transition_in {
        let in_dur = t_in.duration_sec;
        if in_dur > 0.0 && local_t < in_dur && local_t >= 0.0 {
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

    Layer {
        id: sl.id.clone(),
        kind,
        transform,
        opacity,
        blend: sl.blend_mode,
        mask: None,
        effects: sl.effects.clone(),
        transition,
    }
}
