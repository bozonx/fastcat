//! GPU text rendering: text shadows, glyph masks, and background composition.
//!
//! These helpers used to live inside `Compositor`; they are split out because
//! text rendering (Parley glyph layout, shadow blur, background+frame
//! composition) is a separate domain from the generic render pipeline.

use std::sync::Arc;

use anyhow::{anyhow, Result};
use vello::peniko::Color;

use super::effects::{EffectSpec, EffectSource};
use super::scene::{
    BlendMode, Layer, LayerKind, RasterSource, Scene, TextLayer, TextRenderMode, Transform,
};
use super::{Compositor, GpuCtx};

/// Whether a text layer needs a GPU-rendered shadow pass.
pub(crate) fn text_layer_needs_gpu_shadow(layer: &Layer) -> bool {
    let LayerKind::Text(spec) = &layer.kind else {
        return false;
    };
    spec.text_shadow_enabled
        && spec.text_shadow_blur > 0.0
        && spec.text_shadow_color.to_rgba8().a > 0
}

/// Renders a text layer with a GPU-blurred shadow sandwiched between its
/// background/frame and glyphs, matching the CSS-like layering.
pub(crate) fn render_text_layer_with_gpu_shadow(
    compositor: &mut Compositor,
    dev_id: usize,
    scene: &Scene,
    layer: &Layer,
    device: &wgpu::Device,
    queue: &wgpu::Queue,
) -> Result<wgpu::Texture> {
    let LayerKind::Text(spec) = &layer.kind else {
        return Err(anyhow!("gpu text shadow requested for non-text layer"));
    };
    let render_scale = Compositor::vector_effect_render_scale(layer);

    // The text shadow must sit BETWEEN the background and the glyphs (as in CSS /
    // the old CPU path), otherwise an opaque background plate fully covers it. So we
    // composite three layers: bg+border (bottom) → blurred shadow → main text (top).
    let mut bg_spec = spec.clone();
    bg_spec.render_mode = TextRenderMode::BackgroundOnly;
    let background = render_text_spec_to_texture(
        compositor,
        dev_id,
        scene.time,
        layer.id.as_str(),
        bg_spec,
        render_scale,
    )?;

    let mut shadow_spec = spec.clone();
    shadow_spec.render_mode = TextRenderMode::TextShadowMask;
    shadow_spec.text_shadow_blur = 0.0;
    let shadow_mask = render_text_spec_to_texture(
        compositor,
        dev_id,
        scene.time,
        layer.id.as_str(),
        shadow_spec,
        render_scale,
    )?;
    let blur_scale = ((render_scale.0 + render_scale.1) * 0.5) as f32;
    let (blurred_shadow, _) = compositor.apply_effects_to_texture(
        dev_id,
        GpuCtx { device, queue },
        &EffectSource::Gpu(Arc::new(crate::media::SharedTexture::new_shared(Arc::new(
            shadow_mask,
        )))),
        &[EffectSpec::GaussianBlurPixels {
            radius: spec.text_shadow_blur * blur_scale,
            mix: 1.0,
        }],
        false,
        scene.effect_quality,
    )?;

    let mut text_spec = spec.clone();
    text_spec.render_mode = TextRenderMode::TextOnly;
    let text = render_text_spec_to_texture(
        compositor,
        dev_id,
        scene.time,
        layer.id.as_str(),
        text_spec,
        render_scale,
    )?;

    let width = text.width();
    let height = text.height();
    let composite = Scene {
        width,
        height,
        time: scene.time,
        background: Color::TRANSPARENT,
        layers: vec![
            gpu_texture_layer(
                format!("{}:gpu-text-bg", layer.id),
                Arc::new(crate::media::SharedTexture::new_shared(Arc::new(background))),
                (width, height),
            ),
            gpu_texture_layer(
                format!("{}:gpu-text-shadow", layer.id),
                blurred_shadow,
                (width, height),
            ),
            gpu_texture_layer(
                format!("{}:gpu-text-glyphs", layer.id),
                Arc::new(crate::media::SharedTexture::new_shared(Arc::new(text))),
                (width, height),
            ),
        ],
        video_tracks: Vec::new(),
        master_effects: Vec::new(),
        effect_quality: scene.effect_quality,
    };
    compositor.render_domain_scene_to_owned_texture(
        dev_id,
        &composite,
        width,
        height,
        Color::TRANSPARENT,
    )
}

/// Renders a single text layer spec into an isolated texture at the given scale.
pub(crate) fn render_text_spec_to_texture(
    compositor: &mut Compositor,
    dev_id: usize,
    time: f64,
    layer_id: &str,
    spec: TextLayer,
    scale: (f64, f64),
) -> Result<wgpu::Texture> {
    let layer = Layer {
        id: layer_id.to_string(),
        kind: LayerKind::Text(spec),
        transform: Transform::identity(),
        opacity: 1.0,
        blend: BlendMode::Normal,
        mask: None,
        effects: Vec::new(),
        transition: None,
    };
    let scene = Scene {
        width: layer.kind.natural_size().0,
        height: layer.kind.natural_size().1,
        time,
        background: Color::TRANSPARENT,
        layers: Vec::new(),
        video_tracks: Vec::new(),
        master_effects: Vec::new(),
        effect_quality: crate::compositor::effects::EffectQuality::Ultra,
    };
    compositor.render_layer_to_texture(dev_id, &scene, &layer, scale)
}

/// Builds a simple raster layer wrapping a GPU texture.
pub(crate) fn gpu_texture_layer(
    id: String,
    texture: Arc<crate::media::SharedTexture>,
    natural_size: (u32, u32),
) -> Layer {
    Layer {
        id,
        kind: LayerKind::Raster {
            source: RasterSource::GpuTexture(texture),
            natural_size,
            padding: None,
        },
        transform: Transform::identity(),
        opacity: 1.0,
        blend: BlendMode::Normal,
        mask: None,
        effects: Vec::new(),
        transition: None,
    }
}
