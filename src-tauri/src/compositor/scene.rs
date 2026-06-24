//! Domain model of a single ready-to-render frame.
//!
//! `Scene` describes ONE composite frame at the given `time` (timeline seconds).
//! This is an internal contract between `monitor` (timeline owner) and `Compositor`
//! (render executor) — it is NOT serialized and does not cross the Tauri boundary.
//!
//! The timeline DTO lives in [`crate::monitor::scene::MonitorScene`];
//! the bridge `MonitorScene + t → compositor::scene::Scene` is in `monitor::app::WindowState::build_scene`.
//!
//! Extension: new layer kinds are added as variants of `LayerKind`
//! (it is `#[non_exhaustive]`), plus a branch in `Scene::to_vello`.

use super::effects::{EffectQuality, EffectSpec};
use kurbo::{Affine, BezPath, Rect, RoundedRect, Shape, Stroke};
use parley::{fontique::FontWeight, LineHeight, PositionedLayoutItem, StyleProperty};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use vello::peniko::{BlendMode as PenikoBlendMode, Brush, Color, Compose, Fill, ImageData, Mix};
use vello::Glyph;
use vello::Scene as VelloScene;

#[derive(Debug, Clone)]
pub struct Scene {
    pub width: u32,
    pub height: u32,
    /// Current frame time on the timeline clock, in seconds. Intended for future
    /// time-dependent effects / transitions; currently informational.
    pub time: f64,
    pub background: Color,
    /// Layers are pre-sorted bottom-to-top (by source `z`).
    pub layers: Vec<Layer>,
    pub video_tracks: Vec<VideoTrack>,
    /// Video master effects applied to the final composited frame after all layers.
    pub master_effects: Vec<super::effects::EffectSpec>,
    pub effect_quality: EffectQuality,
}

#[derive(Debug, Clone)]
pub struct VideoTrack {
    pub id: String,
    pub z: i32,
    pub layer_ids: Vec<String>,
    pub opacity: f32,
    pub blend: BlendMode,
    pub effects: Vec<EffectSpec>,
}

impl Scene {
    /// Creates an isolated scene with the same dimensions, time, and quality
    /// as `self`, but with a transparent background, empty video tracks, and
    /// empty master effects. Used when rendering a subset of layers to a
    /// texture for effects, transitions, or adjustment clips.
    pub fn isolated(&self, layers: Vec<Layer>) -> Self {
        Scene {
            width: self.width,
            height: self.height,
            time: self.time,
            background: Color::TRANSPARENT,
            layers,
            video_tracks: Vec::new(),
            master_effects: Vec::new(),
            effect_quality: self.effect_quality,
        }
    }

    /// Creates a scene with the same dimensions, time, background, quality,
    /// video tracks, and master effects as `self`, but with replaced layers.
    pub fn with_layers(&self, layers: Vec<Layer>) -> Self {
        Scene {
            width: self.width,
            height: self.height,
            time: self.time,
            background: self.background,
            layers,
            video_tracks: self.video_tracks.clone(),
            master_effects: self.master_effects.clone(),
            effect_quality: self.effect_quality,
        }
    }

    /// Composites the scene into a `vello::Scene`. Fits (`scene.width × scene.height`)
    /// into (`viewport_w × viewport_h`) while preserving aspect ratio (letterbox).
    ///
    /// This is the single place in the codebase that builds vello commands for the
    /// domain scene — all future kinds / effects / transitions are wired in here.
    pub fn to_vello<F>(
        &self,
        viewport_w: u32,
        viewport_h: u32,
        resolve_gpu_texture: F,
    ) -> VelloScene
    where
        F: FnMut(RasterGpuSource<'_>) -> Option<ImageData>,
    {
        self.to_vello_with_image_processor(
            viewport_w,
            viewport_h,
            resolve_gpu_texture,
            |image, _| image.clone(),
        )
    }

    pub fn to_vello_with_image_processor<F, P>(
        &self,
        viewport_w: u32,
        viewport_h: u32,
        mut resolve_gpu_texture: F,
        mut process_image: P,
    ) -> VelloScene
    where
        F: FnMut(RasterGpuSource<'_>) -> Option<ImageData>,
        P: FnMut(&ImageData, &[EffectSpec]) -> ImageData,
    {
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
            let padding = match &layer.kind {
                LayerKind::Raster {
                    padding: Some((px, py)),
                    ..
                } => (*px as f64, *py as f64),
                _ => (0.0, 0.0),
            };
            let inner = layer.transform.to_affine_with_padding(natural, padding);
            let xform = outer * inner;

            // Cropped bbox calculation (crop)
            let nw = natural.0 as f64;
            let nh = natural.1 as f64;
            let mut crop_left = (layer.transform.crop_left.clamp(0.0, 100.0) / 100.0) * nw;
            let mut crop_right = (layer.transform.crop_right.clamp(0.0, 100.0) / 100.0) * nw;
            let mut crop_top = (layer.transform.crop_top.clamp(0.0, 100.0) / 100.0) * nh;
            let mut crop_bottom = (layer.transform.crop_bottom.clamp(0.0, 100.0) / 100.0) * nh;

            // Prevent inverted bbox when opposing crops overlap.
            if crop_left + crop_right > nw {
                let scale = nw / (crop_left + crop_right);
                crop_left *= scale;
                crop_right *= scale;
            }
            if crop_top + crop_bottom > nh {
                let scale = nh / (crop_top + crop_bottom);
                crop_top *= scale;
                crop_bottom *= scale;
            }

            let x_min = crop_left;
            let x_max = (nw - crop_right).max(x_min);
            let y_min = crop_top;
            let y_max = (nh - crop_bottom).max(y_min);
            let crop_bbox = Rect::new(x_min, y_min, x_max, y_max);

            let has_crop =
                crop_left > 0.0 || crop_right > 0.0 || crop_top > 0.0 || crop_bottom > 0.0;

            // Isolation is needed for opacity and non-normal blend. Crop-only should
            // use a clip layer so it does not alter the backdrop seen by later blends.
            let mix = layer.blend.to_vello();
            let needs_composite_layer = opacity < 1.0 || !matches!(layer.blend, BlendMode::Normal);
            let needs_clip_layer = has_crop && !needs_composite_layer;
            if needs_composite_layer {
                out.push_layer(Fill::NonZero, mix, opacity, xform, &crop_bbox);
            } else if needs_clip_layer {
                out.push_clip_layer(Fill::NonZero, xform, &crop_bbox);
            }

            match &layer.kind {
                LayerKind::Raster { source, .. } => match source {
                    RasterSource::Image(img) => {
                        let processed = if layer.effects.is_empty() {
                            img.clone()
                        } else {
                            process_image(img, &layer.effects)
                        };
                        out.draw_image(&processed, xform);
                    }
                    RasterSource::GpuTexture(texture) => {
                        if let Some(img) = resolve_gpu_texture(RasterGpuSource::Texture(texture)) {
                            let processed = if layer.effects.is_empty() {
                                img
                            } else {
                                process_image(&img, &layer.effects)
                            };
                            out.draw_image(&processed, xform);
                        }
                    }
                },
                LayerKind::Shape(spec) => {
                    draw_shape(&mut out, spec, xform);
                }
                LayerKind::Text(spec) => {
                    draw_text(&mut out, spec, xform);
                }
                LayerKind::Adjustment => {}
            }

            if needs_composite_layer || needs_clip_layer {
                out.pop_layer();
            }
            // TODO: layer.mask — kurbo::BezPath from layer.mask.path, push_layer as clip.
            // TODO: shape/text layer effects need offscreen subscene rendering before Vello compose.
        }

        out
    }
}

#[derive(Debug, Clone)]
pub struct TransitionInfo {
    pub spec: super::transitions::TransitionSpec,
    pub progress: f32,
    /// Instantaneous "speed" of the curve (derivative of the curve at the current point,
    /// normalized so that linear == 1.0). Used by motion-blur shaders so the blur
    /// grows/falls with the curve (as in web manifests).
    pub speed_multiplier: f32,
    pub source: TransitionSource,
    pub edge: TransitionEdge,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransitionSource {
    Layer(String),
    Background,
    Transparent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransitionEdge {
    In,
    Out,
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
    pub transition: Option<TransitionInfo>,
}

/// Layer kind. `#[non_exhaustive]` — adding new variants (Text, Svg, Shape,
/// Group, ...) does not break consumers and immediately forces `to_vello` to
/// provide a new branch.
#[derive(Debug, Clone)]
#[non_exhaustive]
pub enum LayerKind {
    /// Raster layer (video frame or static image). The source is hidden behind
    /// [`RasterSource`] so that CPU-blob and future GPU-handle differ only at
    /// one point.
    Raster {
        source: RasterSource,
        natural_size: (u32, u32),
        padding: Option<(u32, u32)>,
    },
    Shape(ShapeLayer),
    Text(TextLayer),
    /// Adjustment layer: applies effects to lower layers. Rendered as raster
    /// after composing lower layers into a texture and applying its effects.
    Adjustment,
}

impl LayerKind {
    pub fn natural_size(&self) -> (u32, u32) {
        match self {
            LayerKind::Raster { natural_size, .. } => *natural_size,
            LayerKind::Shape(spec) => spec.natural_size,
            LayerKind::Text(spec) => spec.natural_size,
            LayerKind::Adjustment => (0, 0),
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

/// Typed shape geometry. Fraction fields are already normalized (percentages divided by 100
/// and clamped to 0..10) at the IPC boundary — see `crate::monitor::runtime::parse_shape_geometry`.
/// Previously this held `shape_type: String` + `config: serde_json::Value`, parsed with string
/// keys on every frame; moving to an enum removed stringly-typing and duplication.
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
    pub vertical_align: TextVerticalAlign,
    pub line_height: f32,
    pub letter_spacing: f32,
    pub max_width: Option<f32>,
    pub explicit_height: Option<f32>,

    // Background
    pub background_enabled: bool,
    pub background_color: Color,
    pub background_radius: f64,

    // Background Shadow
    pub bg_shadow_enabled: bool,
    pub bg_shadow_color: Color,
    pub bg_shadow_blur: f32,
    pub bg_shadow_spread: f32,
    pub bg_shadow_offset_x: f32,
    pub bg_shadow_offset_y: f32,

    // Border
    pub border_enabled: bool,
    pub border_color: Color,
    pub border_width: f32,

    // Text Shadow
    pub text_shadow_enabled: bool,
    pub text_shadow_color: Color,
    pub text_shadow_blur: f32,
    pub text_shadow_spread: f32,
    pub text_shadow_offset_x: f32,
    pub text_shadow_offset_y: f32,

    // Padding
    pub padding_top: f32,
    pub padding_right: f32,
    pub padding_bottom: f32,
    pub padding_left: f32,

    // Offset helper metrics calculated at construction
    pub shadow_left: f32,
    pub shadow_top: f32,
    pub shadow_right: f32,
    pub shadow_bottom: f32,
    pub frame_width: f32,
    pub frame_height: f32,
    pub text_block_height: f32,

    pub natural_size: (u32, u32),
    pub render_mode: TextRenderMode,
}

#[derive(Debug, Clone, Copy)]
pub enum TextRenderMode {
    Full,
    WithoutTextShadow,
    TextShadowMask,
    /// Only background: bg shadow + bg + border (no text or text shadow).
    /// Bottom layer of the text-shadow GPU composite.
    BackgroundOnly,
    /// Only main text glyphs (no bg/border/shadow).
    /// Top layer of the text-shadow GPU composite.
    TextOnly,
}

#[derive(Debug, Clone, Copy)]
pub enum TextAlign {
    Left,
    Center,
    Right,
}

#[derive(Debug, Clone, Copy)]
pub enum TextVerticalAlign {
    Top,
    Middle,
    Bottom,
}

/// Pixel source for `LayerKind::Raster`.
///
/// `#[non_exhaustive]` — reserved for GPU-resident variants (HW-decoded frame,
/// group-offscreen cache). Currently all rendering goes through CPU-blob; Vello
/// internally caches the upload to GPU texture by identity `peniko::Blob`, so
/// re-cloning the same `ImageData` (static image layer) does not re-upload.
#[derive(Debug, Clone)]
#[non_exhaustive]
pub enum RasterSource {
    Image(ImageData),
    /// GPU-resident frame. `Arc` owns the texture for exactly as long as the layer/frame
    /// references it — there is no separate cache with independent eviction, so the
    /// handle never goes "stale" under a live frame (previously a CPU copy was held for this).
    GpuTexture(Arc<crate::media::SharedTexture>),
}

pub enum RasterGpuSource<'a> {
    Texture(&'a crate::media::SharedTexture),
}

/// 2D layer transform in composite frame coordinates.
///
/// Semantics: `anchor` — a point inside the layer's natural bbox in fractions `[0..1]`,
/// which maps to `(x, y)` after rotate+scale. Affine assembly is in `to_affine`.
#[derive(Debug, Clone, Copy)]
pub struct Transform {
    pub x: f64,
    pub y: f64,
    pub scale_x: f64,
    pub scale_y: f64,
    pub rotation_deg: f64,
    pub anchor_x: f64,
    pub anchor_y: f64,
    pub crop_top: f64,
    pub crop_bottom: f64,
    pub crop_left: f64,
    pub crop_right: f64,
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
            crop_top: 0.0,
            crop_bottom: 0.0,
            crop_left: 0.0,
            crop_right: 0.0,
        }
    }

    /// Transform that fits the natural bbox `natural` into `into` while
    /// preserving aspect ratio and centering the result. Anchor = layer center,
    /// position = scene center.
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
            crop_top: 0.0,
            crop_bottom: 0.0,
            crop_left: 0.0,
            crop_right: 0.0,
        }
    }

    /// Builds an `Affine` from the Transform and the layer's natural dimensions.
    pub fn to_affine(self, natural: (u32, u32)) -> Affine {
        self.to_affine_with_padding(natural, (0.0, 0.0))
    }

    pub fn to_affine_with_padding(self, natural: (u32, u32), padding: (f64, f64)) -> Affine {
        let nw = natural.0 as f64 - 2.0 * padding.0;
        let nh = natural.1 as f64 - 2.0 * padding.1;
        Affine::translate((self.x, self.y))
            * Affine::rotate(self.rotation_deg.to_radians())
            * Affine::scale_non_uniform(self.scale_x, self.scale_y)
            * Affine::translate((
                -self.anchor_x * nw - padding.0,
                -self.anchor_y * nh - padding.1,
            ))
    }
}

impl Default for Transform {
    fn default() -> Self {
        Self::identity()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "snake_case")]
#[ts(
    export,
    export_to = "../../src/types/generated/native-monitor/",
    rename_all = "snake_case"
)]
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

/// Per-line metrics precomputed once and shared by the shadow and main-text
/// passes so glyph counts / advances aren't recomputed per pass.
struct LineDrawInfo {
    glyph_count: usize,
    adjusted_width: f32,
}

fn draw_text(scene: &mut VelloScene, spec: &TextLayer, xform: Affine) {
    let frame_x = spec.border_width + spec.shadow_left;
    let frame_y = spec.border_width + spec.shadow_top;

    if matches!(
        spec.render_mode,
        TextRenderMode::Full | TextRenderMode::WithoutTextShadow | TextRenderMode::BackgroundOnly
    ) {
        draw_text_background_shadow(scene, spec, xform, frame_x, frame_y);
        draw_text_background(scene, spec, xform, frame_x, frame_y);
        draw_text_border(scene, spec, xform, frame_x, frame_y);
    }

    // Background drawn — text/shadow not needed in this mode.
    if matches!(spec.render_mode, TextRenderMode::BackgroundOnly) {
        return;
    }

    // 4. Layout Text
    let lock = crate::compositor::text::get_text_context();
    let Ok(mut ctx) = lock.lock() else {
        log::warn!("[scene] failed to acquire text context lock, skipping text render");
        return;
    };
    let (font_cx, layout_cx) = &mut *ctx;

    let (primary, generic) = crate::compositor::text::resolve_font_family(&spec.font_family);
    let resolved_font_family =
        crate::compositor::text::build_font_family(font_cx, &primary, generic);

    let mut builder = layout_cx.ranged_builder(font_cx, &spec.text, 1.0, true);
    builder.push_default(StyleProperty::FontSize(spec.font_size.max(1.0)));
    builder.push_default(StyleProperty::Brush([255, 255, 255, 255]));
    builder.push_default(StyleProperty::LineHeight(LineHeight::FontSizeRelative(
        spec.line_height.max(0.1),
    )));
    builder.push_default(StyleProperty::FontWeight(FontWeight::new(spec.font_weight)));
    // Letter-spacing is shaped natively by parley so it is reflected in glyph
    // positions, line metrics and wrapping. Must match `build_text_layer`.
    builder.push_default(StyleProperty::LetterSpacing(spec.letter_spacing));
    builder.push_default(StyleProperty::FontFamily(resolved_font_family));
    let mut layout = builder.build(&spec.text);

    let content_width_px = spec
        .max_width
        .map(|w| (w - spec.padding_left - spec.padding_right).max(1.0));
    layout.break_all_lines(content_width_px);

    let text_block_top_px = text_block_top(spec, frame_y);
    let lines_info = compute_line_infos(&layout);

    if matches!(
        spec.render_mode,
        TextRenderMode::Full | TextRenderMode::TextShadowMask
    ) {
        draw_text_shadows(
            scene,
            spec,
            xform,
            &layout,
            &lines_info,
            frame_x,
            text_block_top_px,
        );
    }

    if matches!(
        spec.render_mode,
        TextRenderMode::Full | TextRenderMode::WithoutTextShadow | TextRenderMode::TextOnly
    ) {
        draw_main_text(
            scene,
            spec,
            xform,
            &layout,
            &lines_info,
            frame_x,
            text_block_top_px,
        );
    }
}

/// Background shadow — a real Gaussian blur via the native vello primitive
/// (`draw_blurred_rounded_rect`), not 9 offset copies as before.
fn draw_text_background_shadow(
    scene: &mut VelloScene,
    spec: &TextLayer,
    xform: Affine,
    frame_x: f32,
    frame_y: f32,
) {
    // Only draw shadow when background is enabled (like web: `backgroundEnabled &&
    // backgroundShadowEnabled`) — shadow from an invisible background makes no sense.
    if !(spec.background_enabled && spec.bg_shadow_enabled && spec.bg_shadow_color.to_rgba8().a > 0)
    {
        return;
    }
    let shadow_x = frame_x + spec.bg_shadow_offset_x;
    let shadow_y = frame_y + spec.bg_shadow_offset_y;

    let ext = text_background_shadow_outset(spec);
    let rect = Rect::new(
        (shadow_x - ext) as f64,
        (shadow_y - ext) as f64,
        (shadow_x + spec.frame_width + ext) as f64,
        (shadow_y + spec.frame_height + ext) as f64,
    );
    let radius = (spec.background_radius + ext as f64).max(0.0);

    if spec.bg_shadow_blur > 0.0 {
        // CSS-like blur-radius → σ ≈ blur/2. One precise Gaussian primitive,
        // full alpha (no multi-pass spreading).
        let std_dev = (spec.bg_shadow_blur as f64) * 0.5;
        scene.draw_blurred_rounded_rect(xform, rect, spec.bg_shadow_color, radius, std_dev);
    } else {
        let path = RoundedRect::new(rect.x0, rect.y0, rect.x1, rect.y1, radius).to_path(0.1);
        scene.fill(
            Fill::NonZero,
            xform,
            Brush::Solid(spec.bg_shadow_color),
            None,
            &path,
        );
    }
}

fn draw_text_background(
    scene: &mut VelloScene,
    spec: &TextLayer,
    xform: Affine,
    frame_x: f32,
    frame_y: f32,
) {
    if !(spec.background_enabled && spec.background_color.to_rgba8().a > 0) {
        return;
    }
    let rect = RoundedRect::new(
        frame_x as f64,
        frame_y as f64,
        (frame_x + spec.frame_width) as f64,
        (frame_y + spec.frame_height) as f64,
        spec.background_radius,
    )
    .to_path(0.1);
    scene.fill(
        Fill::NonZero,
        xform,
        Brush::Solid(spec.background_color),
        None,
        &rect,
    );
}

fn draw_text_border(
    scene: &mut VelloScene,
    spec: &TextLayer,
    xform: Affine,
    frame_x: f32,
    frame_y: f32,
) {
    if !(spec.border_enabled && spec.border_width > 0.0 && spec.border_color.to_rgba8().a > 0) {
        return;
    }
    let inset = spec.border_width / 2.0;
    let border_rect = RoundedRect::new(
        (frame_x - inset) as f64,
        (frame_y - inset) as f64,
        (frame_x + spec.frame_width + inset) as f64,
        (frame_y + spec.frame_height + inset) as f64,
        (spec.background_radius + inset as f64).max(0.0),
    )
    .to_path(0.1);

    scene.stroke(
        &Stroke::new(spec.border_width as f64),
        xform,
        Brush::Solid(spec.border_color),
        None,
        &border_rect,
    );
}

/// Vertical offset of the text block, honoring `vertical_align` when the layer
/// has an explicit height to align within.
fn text_block_top(spec: &TextLayer, frame_y: f32) -> f32 {
    let content_top_px = frame_y + spec.padding_top;
    if spec.explicit_height.is_none() {
        return content_top_px;
    }
    let content_height_px = (spec.frame_height - spec.padding_top - spec.padding_bottom).max(1.0);
    match spec.vertical_align {
        TextVerticalAlign::Top => content_top_px,
        TextVerticalAlign::Middle => {
            content_top_px + (content_height_px - spec.text_block_height) * 0.5
        }
        TextVerticalAlign::Bottom => content_top_px + content_height_px - spec.text_block_height,
    }
}

fn compute_line_infos(layout: &parley::Layout<[u8; 4]>) -> Vec<LineDrawInfo> {
    layout
        .lines()
        .map(|line| {
            let glyph_count = line
                .items()
                .filter_map(|item| match item {
                    PositionedLayoutItem::GlyphRun(run) => Some(run.positioned_glyphs().count()),
                    _ => None,
                })
                .sum();
            LineDrawInfo {
                glyph_count,
                // `advance` already accounts for letter-spacing (shaped by parley above).
                adjusted_width: line.metrics().advance,
            }
        })
        .collect()
}

/// Horizontal start offset of a line, honoring `align` within the padded frame.
fn line_x_offset(spec: &TextLayer, frame_x: f32, line_width: f32) -> f32 {
    let base = frame_x + spec.padding_left;
    match spec.align {
        TextAlign::Left => base,
        TextAlign::Center => {
            let content = (spec.frame_width - spec.padding_left - spec.padding_right).max(0.0);
            base + (content - line_width) * 0.5
        }
        TextAlign::Right => {
            let content = (spec.frame_width - spec.padding_left - spec.padding_right).max(0.0);
            base + content - line_width
        }
    }
}

/// Draws a single glyph run, optionally with a stroked outline pass (used for
/// shadow spread). Letter-spacing is baked into glyph positions by parley, so
/// glyph offsets are used as-is (bidi / mixed runs / emoji handled natively).
fn draw_glyph_run(
    scene: &mut VelloScene,
    run: &parley::layout::GlyphRun<'_, [u8; 4]>,
    run_xform: Affine,
    brush: Color,
    stroke_spread: f32,
) {
    let glyphs = run
        .positioned_glyphs()
        .map(|g| Glyph {
            id: g.id,
            x: g.x,
            y: g.y,
        })
        .collect::<Vec<_>>();

    if stroke_spread > 0.0 {
        scene
            .draw_glyphs(run.run().font())
            .font_size(run.run().font_size())
            .brush(brush)
            .transform(run_xform)
            .draw(
                &Stroke::new(stroke_spread as f64),
                glyphs.clone().into_iter(),
            );
    }

    scene
        .draw_glyphs(run.run().font())
        .font_size(run.run().font_size())
        .brush(brush)
        .transform(run_xform)
        .draw(Fill::NonZero, glyphs.into_iter());
}

#[allow(clippy::too_many_arguments)]
fn draw_text_shadows(
    scene: &mut VelloScene,
    spec: &TextLayer,
    xform: Affine,
    layout: &parley::Layout<[u8; 4]>,
    lines_info: &[LineDrawInfo],
    frame_x: f32,
    text_block_top_px: f32,
) {
    if !(spec.text_shadow_enabled && spec.text_shadow_color.to_rgba8().a > 0) {
        return;
    }
    let base_color = spec.text_shadow_color.to_rgba8();
    let base_alpha = base_color.a as f32 / 255.0;

    let draw_shadow_pass = |scene: &mut VelloScene, dx: f32, dy: f32, weight: f32| {
        let shadow_color = Color::from_rgba8(
            base_color.r,
            base_color.g,
            base_color.b,
            ((base_alpha * weight) * 255.0).clamp(0.0, 255.0) as u8,
        );

        for (line_idx, line) in layout.lines().enumerate() {
            let info = &lines_info[line_idx];
            if info.glyph_count == 0 {
                continue;
            }
            let x_offset = line_x_offset(spec, frame_x, info.adjusted_width);

            for item in line.items() {
                let PositionedLayoutItem::GlyphRun(run) = item else {
                    continue;
                };
                let run_xform = xform
                    * Affine::translate(((x_offset + dx) as f64, (text_block_top_px + dy) as f64));
                draw_glyph_run(
                    scene,
                    &run,
                    run_xform,
                    shadow_color,
                    spec.text_shadow_spread,
                );
            }
        }
    };

    if matches!(spec.render_mode, TextRenderMode::TextShadowMask) {
        draw_shadow_pass(
            scene,
            spec.text_shadow_offset_x,
            spec.text_shadow_offset_y,
            1.0,
        );
    } else if spec.text_shadow_blur > 0.0 {
        // Glyphs have no native blur in vello, so we approximate a Gaussian
        // with a DISCRETE CONVOLUTION of the silhouette: a grid of taps within ±2σ
        // with weights exp(-(x²+y²)/2σ²), normalized to sum 1. This is a 2D kernel
        // instead of a ring of 8 copies at one radius (which produced "8 ghosts"
        // at large blur).
        for (dx, dy, w) in gaussian_kernel_taps(spec.text_shadow_blur * 0.5) {
            draw_shadow_pass(
                scene,
                spec.text_shadow_offset_x + dx,
                spec.text_shadow_offset_y + dy,
                w,
            );
        }
    } else {
        draw_shadow_pass(
            scene,
            spec.text_shadow_offset_x,
            spec.text_shadow_offset_y,
            1.0,
        );
    }
}

#[allow(clippy::too_many_arguments)]
fn draw_main_text(
    scene: &mut VelloScene,
    spec: &TextLayer,
    xform: Affine,
    layout: &parley::Layout<[u8; 4]>,
    lines_info: &[LineDrawInfo],
    frame_x: f32,
    text_block_top_px: f32,
) {
    for (line_idx, line) in layout.lines().enumerate() {
        let info = &lines_info[line_idx];
        if info.glyph_count == 0 {
            continue;
        }
        let x_offset = line_x_offset(spec, frame_x, info.adjusted_width);

        for item in line.items() {
            let PositionedLayoutItem::GlyphRun(run) = item else {
                continue;
            };
            let run_xform = xform * Affine::translate((x_offset as f64, text_block_top_px as f64));
            draw_glyph_run(scene, &run, run_xform, spec.color, 0.0);
        }
    }
}

fn text_background_shadow_outset(spec: &TextLayer) -> f32 {
    let border_outset = if spec.border_enabled && spec.border_width > 0.0 {
        spec.border_width
    } else {
        0.0
    };

    (border_outset + spec.bg_shadow_spread).max(0.0)
}

/// Discrete 2D Gaussian kernel taps for approximating text shadow blur
/// by redrawing the silhouette with offsets. Returns `(dx, dy, weight)` on a grid
/// within ±2σ; weights are normalized to sum 1, negligible ones (<4%) are dropped for speed.
/// At σ≤0 — a single tap (0,0,1).
fn gaussian_kernel_taps(sigma: f32) -> Vec<(f32, f32, f32)> {
    let sigma = sigma.max(0.0);
    if sigma < 0.5 {
        return vec![(0.0, 0.0, 1.0)];
    }
    // Denser grid for smoother shadows: 7×7 with step 0.75σ covers ±2.25σ.
    // For small sigma (< 1.5) fall back to the lighter 5×5 grid.
    let steps = if sigma < 1.5 { 2 } else { 3 };
    let step = sigma * 0.75;
    let two_sigma_sq = 2.0 * sigma * sigma;
    let mut taps = Vec::new();
    let mut wsum = 0.0f32;
    for iy in -steps..=steps {
        for ix in -steps..=steps {
            let dx = ix as f32 * step;
            let dy = iy as f32 * step;
            let w = (-(dx * dx + dy * dy) / two_sigma_sq).exp();
            if w < 0.005 {
                continue;
            }
            taps.push((dx, dy, w));
            wsum += w;
        }
    }
    if wsum <= 0.0 {
        return vec![(0.0, 0.0, 1.0)];
    }
    for tap in &mut taps {
        tap.2 /= wsum;
    }
    taps
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
    /// SVG path d-string in the layer's local coordinates.
    pub path: String,
    pub inverted: bool,
}

/// Letterbox-fit natural dimensions `natural` into `into`. Returns an Affine
/// to apply to the layer/scene (used as outer transform in `to_vello`).
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
                padding: None,
            },
            transform,
            opacity,
            blend: BlendMode::Normal,
            mask: None,
            effects: Vec::new(),
            transition: None,
        }
    }

    fn text_layer_with_shadow_border(border_width: f32, shadow_spread: f32) -> TextLayer {
        TextLayer {
            text: "Text".into(),
            font_family: "Inter".into(),
            font_size: 64.0,
            font_weight: 700.0,
            color: Color::WHITE,
            align: TextAlign::Center,
            vertical_align: TextVerticalAlign::Middle,
            line_height: 1.2,
            letter_spacing: 0.0,
            max_width: None,
            explicit_height: None,
            background_enabled: true,
            background_color: Color::BLACK,
            background_radius: 0.0,
            bg_shadow_enabled: true,
            bg_shadow_color: Color::BLACK,
            bg_shadow_blur: 0.0,
            bg_shadow_spread: shadow_spread,
            bg_shadow_offset_x: 0.0,
            bg_shadow_offset_y: 0.0,
            border_enabled: border_width > 0.0,
            border_color: Color::WHITE,
            border_width,
            text_shadow_enabled: false,
            text_shadow_color: Color::TRANSPARENT,
            text_shadow_blur: 0.0,
            text_shadow_spread: 0.0,
            text_shadow_offset_x: 0.0,
            text_shadow_offset_y: 0.0,
            padding_top: 0.0,
            padding_right: 0.0,
            padding_bottom: 0.0,
            padding_left: 0.0,
            shadow_left: 0.0,
            shadow_top: 0.0,
            shadow_right: 0.0,
            shadow_bottom: 0.0,
            frame_width: 100.0,
            frame_height: 40.0,
            text_block_height: 40.0,
            natural_size: (100, 40),
            render_mode: TextRenderMode::Full,
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
    fn text_background_shadow_outset_uses_outer_border_edge() {
        let spec = text_layer_with_shadow_border(4.0, 6.0);

        assert_eq!(text_background_shadow_outset(&spec), 10.0);
    }

    #[test]
    fn fit_into_widens_to_letterbox_height() {
        // 16:9 into 4:3 → should shrink width, black bars top/bottom.
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
        // 4:3 into 16:9 → fit by height, pillarbox on sides.
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
        // Square 200×200 into 800×400 → fit by height (scale=2), pillarbox on sides.
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
    fn to_vello_applies_crop_clipping() {
        let mut transform = Transform::identity();
        transform.crop_left = 10.0;
        transform.crop_top = 20.0;
        transform.crop_right = 30.0;
        transform.crop_bottom = 40.0;

        let layer = raster_layer((100, 100), transform, 1.0);
        let scene = Scene {
            master_effects: Vec::new(),
            effect_quality: EffectQuality::Ultra,
            width: 100,
            height: 100,
            time: 0.0,
            background: Color::BLACK,
            layers: vec![layer],
            video_tracks: Vec::new(),
        };

        let vello_scene = scene.to_vello(100, 100, |_| None);
        assert!(!vello_scene.encoding().is_empty());
    }

    #[test]
    fn to_vello_empty_scene_returns_empty() {
        let scene = Scene {
            master_effects: Vec::new(),
            effect_quality: EffectQuality::Ultra,
            width: 1920,
            height: 1080,
            time: 0.0,
            background: Color::BLACK,
            layers: Vec::new(),
            video_tracks: Vec::new(),
        };
        // Should return without panicking.
        let _ = scene.to_vello(1280, 720, |_| None);
    }

    #[test]
    fn to_vello_skips_zero_opacity_layer() {
        // Smoke: opacity=0 — layer should not trigger draw, no panic.
        let scene = Scene {
            master_effects: Vec::new(),
            effect_quality: EffectQuality::Ultra,
            width: 100,
            height: 100,
            time: 0.0,
            background: Color::BLACK,
            layers: vec![raster_layer(
                (50, 50),
                Transform::center_fit((50, 50), (100, 100)),
                0.0,
            )],
            video_tracks: Vec::new(),
        };
        let _ = scene.to_vello(100, 100, |_| None);
    }

    #[test]
    fn to_vello_handles_zero_viewport() {
        let scene = Scene {
            master_effects: Vec::new(),
            effect_quality: EffectQuality::Ultra,
            width: 100,
            height: 100,
            time: 0.0,
            background: Color::BLACK,
            layers: vec![raster_layer((10, 10), Transform::identity(), 1.0)],
            video_tracks: Vec::new(),
        };
        // Should not panic with zero viewport.
        let _ = scene.to_vello(0, 0, |_| None);
        let _ = scene.to_vello(100, 0, |_| None);
    }

    #[test]
    fn to_vello_processes_raster_layer_effects() {
        let mut layer = raster_layer((10, 10), Transform::identity(), 1.0);
        layer.effects = vec![EffectSpec::Brightness { value: 1.2 }];
        let scene = Scene {
            master_effects: Vec::new(),
            effect_quality: EffectQuality::Ultra,
            width: 100,
            height: 100,
            time: 0.0,
            background: Color::BLACK,
            layers: vec![layer],
            video_tracks: Vec::new(),
        };
        let mut calls = 0;

        let _ = scene.to_vello_with_image_processor(
            100,
            100,
            |_| None,
            |image, effects| {
                calls += 1;
                assert_eq!(effects.len(), 1);
                image.clone()
            },
        );

        assert_eq!(calls, 1);
    }

    #[test]
    fn fit_into_same_aspect_no_translation() {
        // If aspect matches — letterbox/pillarbox is zero.
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
        // Exhaustive check: no match branch should panic.
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
    fn gaussian_kernel_taps_normalized_and_centered() {
        // σ≤0 → single central tap with weight 1.
        let z = gaussian_kernel_taps(0.0);
        assert_eq!(z.len(), 1);
        assert_eq!(z[0], (0.0, 0.0, 1.0));

        // Significant σ → multiple taps, weights normalized to sum 1,
        // central tap is heaviest, kernel is symmetric.
        let taps = gaussian_kernel_taps(6.0);
        assert!(taps.len() > 1);
        let wsum: f32 = taps.iter().map(|t| t.2).sum();
        assert!(
            (wsum - 1.0).abs() < 1e-4,
            "weights must sum to 1, got {wsum}"
        );
        let center = taps.iter().find(|t| t.0 == 0.0 && t.1 == 0.0).unwrap();
        assert!(taps.iter().all(|t| t.2 <= center.2 + 1e-6));
        let sum_dx: f32 = taps.iter().map(|t| t.0).sum();
        let sum_dy: f32 = taps.iter().map(|t| t.1).sum();
        assert!(
            sum_dx.abs() < 1e-3 && sum_dy.abs() < 1e-3,
            "kernel must be symmetric"
        );
    }

    #[test]
    fn transform_rotation_90deg_maps_x_to_y() {
        // 90° rotation around origin: (1,0) → (0,1).
        let t = Transform {
            x: 0.0,
            y: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
            rotation_deg: 90.0,
            anchor_x: 0.0,
            anchor_y: 0.0,
            crop_top: 0.0,
            crop_bottom: 0.0,
            crop_left: 0.0,
            crop_right: 0.0,
        };
        let a = t.to_affine((0, 0)); // natural size unused when anchor=0
        let (px, py) = affine_apply(a, (1.0, 0.0));
        // After rotate(90°): x→-y, y→x, i.e. (1,0)→(0,1) in math axes.
        // In screen coordinates (y down): (1,0)→(0,-1)?
        // kurbo::Affine::rotate(π/2): [[cos, -sin],[sin, cos]] = [[0,-1],[1,0]] → (1,0)→(0,1).
        assert!(approx(px.abs(), 0.0));
        assert!(approx(py.abs(), 1.0));
    }
}
