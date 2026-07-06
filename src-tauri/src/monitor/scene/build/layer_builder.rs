//! Building the domain `compositor::scene::Scene` from the `MonitorScene` IPC DTO.
//!
//! This module does NOT resolve raster kinds (`Video | Image | Svg`) — it builds
//! only the "virtual" layers (`Background | Shape | Text`) and finalizes any
//! `CompLayerKind` into a `Layer` (transform + opacity + blend).

use parley::fontique::FontWeight;
use parley::style::LineHeight;
use parley::StyleProperty;
use vello::peniko::Color;

use crate::compositor::scene::{
    Layer, LayerKind as CompLayerKind, ShapeGeometry, ShapeLayer, TextLayer, TextRenderMode,
    Transform, TransitionEdge, TransitionInfo, TransitionSource,
};
use crate::media::ffmpeg::utils::is_quarter_turn;

use super::ipc_parsers::*;
use super::transform::{
    is_transform_snap_safe, local_crop_from_display_transform, oriented_fit_scale,
    source_orientation_deg, text_anchor_offset,
};
use super::transition::{apply_transition_curve, compute_transition_opacity};
use crate::monitor::scene::{LayerKind, SceneLayer};

/// Visible extent of a Gaussian blur as a multiple of the CSS-like blur radius.
/// blur radius → σ ≈ blur/2, and the perceptible tail reaches ~3σ = 1.5·blur.
/// Must match the web compositor's `SHADOW_BLUR_EXTENT_FACTOR` in
/// `src/utils/video-editor/text-layout.ts` so both reserve identical headroom.
const SHADOW_BLUR_EXTENT_FACTOR: f32 = 1.5;

/// Builds a "virtual" (decode-free) `CompLayerKind` for `Background | Shape | Text`
/// layers. For raster kinds it returns `None` — those are resolved by the caller
/// (from the cache or by synchronous decode).
pub fn build_virtual_kind(sl: &SceneLayer, scene_size: (u32, u32)) -> Option<CompLayerKind> {
    let (scene_w, scene_h) = scene_size;
    match sl.kind {
        LayerKind::Video | LayerKind::Image | LayerKind::Svg | LayerKind::Adjustment => None,
        LayerKind::Background => {
            let base = scene_w.min(scene_h).max(1) as f64;
            Some(CompLayerKind::Shape(ShapeLayer {
                geometry: ShapeGeometry::Rectangle {
                    width: scene_w.max(1) as f64 / base,
                    height: scene_h.max(1) as f64 / base,
                    corner_radius: 0.0,
                },
                fill: parse_color(sl.background_color.as_deref().unwrap_or("#000000"), 1.0),
                stroke: Color::TRANSPARENT,
                stroke_width: 0.0,
                natural_size: (scene_w, scene_h),
            }))
        }
        LayerKind::Shape => {
            // Stroke width is authored in the 1920x1080 design space, so scale it to
            // the scene resolution (uniform, matching the shape body which is a fixed
            // fraction of the frame). Mirrors the web `ShapeRenderer`/`LayoutApplier`.
            let render_scale = (scene_w as f64 / 1920.0).min(scene_h as f64 / 1080.0);
            let is_snap_active =
                sl.snap_to_pixel_grid && is_transform_snap_safe(sl.transform.as_ref());
            let mut stroke_width = sl.stroke_width.unwrap_or(0.0).max(0.0) * render_scale;
            if is_snap_active {
                stroke_width = stroke_width.round();
            }
            let size = if is_snap_active {
                (scene_w.min(scene_h) as f64 * 0.8 + stroke_width * 2.0)
                    .round()
                    .max(1.0) as u32
            } else {
                (scene_w.min(scene_h) as f64 * 0.8 + stroke_width * 2.0)
                    .ceil()
                    .max(1.0) as u32
            };
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

    // Mirror web `normalizeTextPadding`: each side is clamped to [0, 10000].
    // Without this the native path accepted negative / unbounded padding (the
    // object form used `unwrap_or(0.0)` with no `max`), diverging from web layout.
    let clamp_pad = |v: f64| v.clamp(0.0, 10_000.0);

    Padding {
        top: clamp_pad(top),
        right: clamp_pad(right),
        bottom: clamp_pad(bottom),
        left: clamp_pad(left),
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

    // Computed early: every downstream measurement that contributes to the
    // frame/border/background box position (padding, border outset, shadow
    // reservation, frame size) must be rounded to whole scene pixels so their
    // sums land on integer coordinates too — rounding only the outer
    // `natural_width`/`natural_height` (below) is not enough, because
    // `scene::draw_text` derives `frame_x`/`frame_y`/the border and background
    // rects directly from these unrounded fields, reintroducing sub-pixel
    // edges even when the layer's final position is snapped.
    let is_snap_active = sl.snap_to_pixel_grid && is_transform_snap_safe(sl.transform.as_ref());
    let snap_round = |v: f32| if is_snap_active { v.round() } else { v };

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
    let padding_top = snap_round((padding.top * render_scale) as f32);
    let padding_right = snap_round((padding.right * render_scale) as f32);
    let padding_bottom = snap_round((padding.bottom * render_scale) as f32);
    let padding_left = snap_round((padding.left * render_scale) as f32);

    // Explicit sizing
    let explicit_width_px = number_opt(&style, "width").map(|w| (w * render_scale).max(1.0) as f32);
    let explicit_height_px =
        number_opt(&style, "height").map(|h| (h * render_scale).max(1.0) as f32);

    // Border
    let border_enabled = bool_value(&style, "borderEnabled", false);
    let border_width = if border_enabled {
        snap_round((number(&style, "borderWidth", 0.0).max(0.0) * render_scale) as f32)
    } else {
        0.0
    };
    // Creative gap between the background box and the border (design space → device).
    let border_offset = if border_enabled {
        snap_round((number(&style, "borderOffset", 0.0).max(0.0) * render_scale) as f32)
    } else {
        0.0
    };
    let border_color = parse_color(
        string_value(&style, "borderColor", "#ffffff").as_str(),
        number(&style, "borderAlpha", 1.0).clamp(0.0, 1.0),
    );

    // Background.
    // Mirrors web `normalizeTextClipStyle`: an explicit boolean `backgroundEnabled`
    // is ALWAYS authoritative (incl. `false` = disabled). Only when it is absent do
    // we enable based on a non-empty `backgroundColor`. This used to be `||`, which
    // meant a saved color prevented disabling the background.
    let background_enabled = match style.get("backgroundEnabled").and_then(|v| v.as_bool()) {
        Some(explicit) => explicit,
        None => style
            .get("backgroundColor")
            .and_then(|v| v.as_str())
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false),
    };
    let background_color = parse_color(
        string_value(&style, "backgroundColor", "#000000").as_str(),
        number(&style, "backgroundAlpha", 1.0).clamp(0.0, 1.0),
    );
    let background_radius = number(&style, "backgroundRadius", 0.0).max(0.0) * render_scale;

    // A shadow's blur/spread/offset values are authored in the 1920x1080 design
    // space and only contribute when the shadow is enabled; this folds the
    // "enabled ? value * render_scale : 0" pattern shared by every shadow field.
    let scaled_when = |enabled: bool, key: &str, clamp_non_negative: bool| -> f32 {
        if !enabled {
            return 0.0;
        }
        let raw = number(&style, key, 0.0);
        let raw = if clamp_non_negative {
            raw.max(0.0)
        } else {
            raw
        };
        (raw * render_scale) as f32
    };

    // Background Shadow
    let bg_shadow_enabled = bool_value(&style, "backgroundShadowEnabled", false);
    let bg_shadow_blur = scaled_when(bg_shadow_enabled, "backgroundShadowBlur", true);
    let bg_shadow_spread = scaled_when(bg_shadow_enabled, "backgroundShadowSpread", true);
    let bg_shadow_offset_x = scaled_when(bg_shadow_enabled, "backgroundShadowOffsetX", false);
    let bg_shadow_offset_y = scaled_when(bg_shadow_enabled, "backgroundShadowOffsetY", false);
    let bg_shadow_color = parse_color(
        string_value(&style, "backgroundShadowColor", "#000000").as_str(),
        number(&style, "backgroundShadowAlpha", 1.0).clamp(0.0, 1.0),
    );

    // Text Shadow
    let text_shadow_enabled = bool_value(&style, "textShadowEnabled", false);
    let text_shadow_blur = scaled_when(text_shadow_enabled, "textShadowBlur", true);
    let text_shadow_spread = scaled_when(text_shadow_enabled, "textShadowSpread", true);
    let text_shadow_offset_x = scaled_when(text_shadow_enabled, "textShadowOffsetX", false);
    let text_shadow_offset_y = scaled_when(text_shadow_enabled, "textShadowOffsetY", false);
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
    let frame_width_px = snap_round(frame_content_width_px + padding_left + padding_right);
    let auto_frame_height_px = text_block_height_px + padding_top + padding_bottom;
    let frame_height_px = snap_round(
        explicit_height_px
            .map(|height| height.max(auto_frame_height_px))
            .unwrap_or(auto_frame_height_px)
            .max(1.0),
    );

    // Shadows bounding box adjustment.
    // The blur radius maps to a Gaussian with σ ≈ blur/2; its visible tail reaches
    // ~3σ = 1.5·blur. We reserve that much room in the layer's natural size so the
    // blurred shadow is not clipped when the layer is composited inside a clip group
    // (opacity < 1 / non-normal blend / crop all push a natural-bounds clip). Rounded
    // (only the reservation, not the shadow's own blur/spread/offset) so it doesn't
    // reintroduce the sub-pixel `frame_x`/`frame_y` offset this whole block exists
    // to eliminate — the shadow itself stays blurred regardless of a <1px shift.
    let bg_shadow_extent = bg_shadow_blur * SHADOW_BLUR_EXTENT_FACTOR + bg_shadow_spread;
    let text_shadow_extent = text_shadow_blur * SHADOW_BLUR_EXTENT_FACTOR + text_shadow_spread;
    let shadow_left = snap_round(
        (bg_shadow_extent - bg_shadow_offset_x)
            .max(text_shadow_extent - text_shadow_offset_x)
            .max(0.0),
    );
    let shadow_right = snap_round(
        (bg_shadow_extent + bg_shadow_offset_x)
            .max(text_shadow_extent + text_shadow_offset_x)
            .max(0.0),
    );
    let shadow_top = snap_round(
        (bg_shadow_extent - bg_shadow_offset_y)
            .max(text_shadow_extent - text_shadow_offset_y)
            .max(0.0),
    );
    let shadow_bottom = snap_round(
        (bg_shadow_extent + bg_shadow_offset_y)
            .max(text_shadow_extent + text_shadow_offset_y)
            .max(0.0),
    );

    // Border reaches `border_width + border_offset` outward from the frame on each side.
    let border_outset = border_width + border_offset;
    let background_width = frame_width_px + border_outset * 2.0 + shadow_left + shadow_right;
    let background_height = frame_height_px + border_outset * 2.0 + shadow_top + shadow_bottom;

    let (natural_width, natural_height) = if is_snap_active {
        (
            background_width.round() as u32,
            background_height.round() as u32,
        )
    } else {
        (
            background_width.ceil() as u32,
            background_height.ceil() as u32,
        )
    };

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
        border_offset,

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
        render_mode: TextRenderMode::Full,
        snap_text_origin: is_snap_active,
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

/// Finalizes a `CompLayerKind` into a `Layer`: transform (explicit or center-fit),
/// opacity and blend mode from the IPC layer.
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

    // Keyframe animation (v1: transform + opacity). Sampled at the layer's
    // source-relative time; the resulting overrides fully replace the static
    // transform/opacity for this frame (the web overlay does the same).
    let local_t = time_sec - sl.timeline_start_sec;
    let animation_t_us = super::animation::resolve_layer_animation_time_us(sl, time_sec);
    let anim = super::animation::resolve_animation_override(sl, animation_t_us, scene_size);
    let effective_transform = anim.transform.as_ref().or(sl.transform.as_ref());

    let transform = match effective_transform {
        Some(t) => {
            let fit = if is_raster_layer {
                oriented_fit_scale(media_size, scene_size, source_rotation)
            } else {
                1.0
            };
            let crop = local_crop_from_display_transform(t, source_rotation, is_raster_layer);
            // Text anchoring is finalized here, where the parley-measured natural
            // size is authoritative (the front-end cannot reproduce glyph shaping).
            let oriented_size = if is_raster_layer && is_quarter_turn(source_rotation) {
                (media_size.1, media_size.0)
            } else {
                media_size
            };
            let (anchor_dx, anchor_dy) =
                text_anchor_offset(&kind, oriented_size, t.anchor_x, t.anchor_y);
            let mut transform = Transform::from(t);
            transform.x += anchor_dx;
            transform.y += anchor_dy;
            transform.scale_x *= fit;
            transform.scale_y *= fit;
            transform.source_rotation = source_rotation;
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
                    source_rotation,
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
                    source_rotation,
                    anchor_x: 0.5,
                    anchor_y: 0.5,
                    ..Default::default()
                }
            }
        }
    };

    let mut transform = transform;
    if matches!(sl.kind, LayerKind::Text | LayerKind::Shape)
        && sl.snap_to_pixel_grid
        && is_transform_snap_safe(effective_transform)
    {
        // Round the layer's LOCAL-space ORIGIN (where local (0,0) lands in scene
        // pixels), NOT the anchor position. `to_affine` maps local (0,0) to
        // `transform.x - anchor_x * natural_width` (no rotation/scale in the
        // snap-safe case). With an odd natural width and a centered (0.5) anchor,
        // `anchor_x * natural_width` is a half-integer, so rounding `transform.x`
        // directly leaves that origin on a half-pixel — every local-integer
        // coordinate (the snapped background/border rect corners and the rounded
        // text origin) then rasterizes half a device pixel off-grid, which is the
        // residual soft border/text edge seen in stop-frame snapshots and export.
        // Rounding the origin lands all of them on whole device pixels whenever the
        // scene renders 1:1 (export + monitor snapshot; `fit_into` is identity).
        let nw = media_size.0 as f64;
        let nh = media_size.1 as f64;
        let origin_x = transform.x - transform.anchor_x * nw;
        let origin_y = transform.y - transform.anchor_y * nh;
        transform.x += origin_x.round() - origin_x;
        transform.y += origin_y.round() - origin_y;
    }

    // A keyframed opacity replaces the static value as the pre-transition base;
    // transition fades still multiply on top (mirrors the web path).
    let base_opacity = anim
        .opacity
        .unwrap_or_else(|| sl.opacity.clamp(0.0, 1.0) as f32);
    let opacity = compute_transition_opacity(sl, local_t, base_opacity);

    // A transition source can be an adjacent layer, the lower-layer composite,
    // or a transparent texture. OUT transitions reverse the shader inputs.
    let mut transition = None;
    let clip_dur = sl.timeline_end_sec - sl.timeline_start_sec;
    let in_dur = sl
        .transition_in
        .as_ref()
        .map(|value| value.duration_sec.clamp(0.0, clip_dur))
        .unwrap_or(0.0);
    let out_dur = sl
        .transition_out
        .as_ref()
        .map(|value| value.duration_sec.clamp(0.0, clip_dur))
        .unwrap_or(0.0);
    let out_start = (clip_dur - out_dur).max(0.0);
    let in_active = in_dur > 0.0 && local_t >= 0.0 && local_t < in_dur;
    let out_active = out_dur > 0.0 && local_t >= out_start && local_t < clip_dur;
    let use_in = in_active && (!out_active || in_dur - local_t <= local_t - out_start);
    let selected = if use_in {
        sl.transition_in
            .as_ref()
            .map(|value| (value, in_dur, TransitionEdge::In))
    } else if out_active {
        sl.transition_out
            .as_ref()
            .map(|value| (value, out_dur, TransitionEdge::Out))
    } else {
        None
    };

    if let Some((selected, duration, edge)) = selected {
        if let Some(spec) = &selected.spec {
            let source = match selected.mode.as_deref() {
                Some("background") => Some(TransitionSource::Background),
                Some("transparent") => Some(TransitionSource::Transparent),
                Some("adjacent") | None => selected
                    .from_layer_id
                    .as_ref()
                    .map(|id| TransitionSource::Layer(id.clone())),
                Some(_) => None,
            };

            if let Some(source) = source {
                let raw_progress = match edge {
                    TransitionEdge::In => local_t / duration,
                    TransitionEdge::Out => (local_t - out_start) / duration,
                }
                .clamp(0.0, 1.0);
                let curve = selected.curve.as_deref().unwrap_or("linear");
                let progress = apply_transition_curve(raw_progress, curve) as f32;
                let delta = 0.01;
                let p_lo = apply_transition_curve((raw_progress - delta).max(0.0), curve);
                let p_hi = apply_transition_curve((raw_progress + delta).min(1.0), curve);
                let speed_multiplier = (((p_hi - p_lo) / (2.0 * delta)).max(0.0)) as f32;
                transition = Some(TransitionInfo {
                    spec: spec.clone(),
                    progress,
                    speed_multiplier,
                    source,
                    edge,
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
        // Baked effect-param animation overrides the static specs per frame.
        effects: super::animation::resolve_baked_effect_specs(sl, animation_t_us)
            .unwrap_or_else(|| sl.effects.clone()),
        transition,
    }
}
