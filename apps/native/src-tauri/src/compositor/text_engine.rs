//! GPU text rendering: text shadows, glyph masks, and background composition.
//!
//! These helpers used to live inside `Compositor`; they are split out because
//! text rendering (Parley glyph layout, shadow blur, background+frame
//! composition) is a separate domain from the generic render pipeline.

use std::sync::Arc;

use anyhow::{anyhow, Result};
use vello::peniko::Color;

use super::effects::{EffectSource, EffectSpec};
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
                Arc::new(crate::media::SharedTexture::new_shared(Arc::new(
                    background,
                ))),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compositor::scene::{
        BlendMode, Layer, LayerKind, TextAlign, TextLayer, TextRenderMode, TextVerticalAlign,
        Transform,
    };

    fn base_text_layer() -> TextLayer {
        TextLayer {
            text: "Hello".into(),
            font_family: "Inter".into(),
            font_size: 32.0,
            font_weight: 400.0,
            color: vello::peniko::Color::WHITE,
            align: TextAlign::Left,
            vertical_align: TextVerticalAlign::Top,
            line_height: 1.2,
            letter_spacing: 0.0,
            max_width: None,
            explicit_height: None,
            background_enabled: false,
            background_color: vello::peniko::Color::TRANSPARENT,
            background_radius: 0.0,
            bg_shadow_enabled: false,
            bg_shadow_color: vello::peniko::Color::TRANSPARENT,
            bg_shadow_blur: 0.0,
            bg_shadow_spread: 0.0,
            bg_shadow_offset_x: 0.0,
            bg_shadow_offset_y: 0.0,
            border_enabled: false,
            border_color: vello::peniko::Color::TRANSPARENT,
            border_width: 0.0,
            border_offset: 0.0,
            text_shadow_enabled: false,
            text_shadow_color: vello::peniko::Color::TRANSPARENT,
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
            snap_text_origin: false,
        }
    }

    fn text_layer(spec: TextLayer) -> Layer {
        Layer {
            id: "text".into(),
            kind: LayerKind::Text(spec),
            transform: Transform::identity(),
            opacity: 1.0,
            blend: BlendMode::Normal,
            mask: None,
            effects: Vec::new(),
            transition: None,
        }
    }

    #[test]
    fn needs_gpu_shadow_false_for_non_text_layer() {
        use crate::compositor::scene::RasterSource;
        let layer = Layer {
            id: "raster".into(),
            kind: LayerKind::Raster {
                source: RasterSource::Image(vello::peniko::ImageData {
                    data: vello::peniko::Blob::new(std::sync::Arc::new(vec![0u8; 4])),
                    format: vello::peniko::ImageFormat::Rgba8,
                    alpha_type: vello::peniko::ImageAlphaType::Alpha,
                    width: 1,
                    height: 1,
                }),
                natural_size: (1, 1),
                padding: None,
            },
            transform: Transform::identity(),
            opacity: 1.0,
            blend: BlendMode::Normal,
            mask: None,
            effects: Vec::new(),
            transition: None,
        };
        assert!(!text_layer_needs_gpu_shadow(&layer));
    }

    #[test]
    fn needs_gpu_shadow_false_when_shadow_disabled() {
        let mut spec = base_text_layer();
        spec.text_shadow_enabled = false;
        assert!(!text_layer_needs_gpu_shadow(&text_layer(spec)));
    }

    #[test]
    fn needs_gpu_shadow_false_when_shadow_blur_zero() {
        let mut spec = base_text_layer();
        spec.text_shadow_enabled = true;
        spec.text_shadow_blur = 0.0;
        spec.text_shadow_color = vello::peniko::Color::BLACK;
        assert!(!text_layer_needs_gpu_shadow(&text_layer(spec)));
    }

    #[test]
    fn needs_gpu_shadow_false_when_shadow_alpha_zero() {
        let mut spec = base_text_layer();
        spec.text_shadow_enabled = true;
        spec.text_shadow_blur = 10.0;
        // TRANSPARENT has alpha = 0
        spec.text_shadow_color = vello::peniko::Color::TRANSPARENT;
        assert!(!text_layer_needs_gpu_shadow(&text_layer(spec)));
    }

    #[test]
    fn needs_gpu_shadow_true_when_enabled_blur_and_opaque() {
        let mut spec = base_text_layer();
        spec.text_shadow_enabled = true;
        spec.text_shadow_blur = 8.0;
        spec.text_shadow_color = vello::peniko::Color::BLACK;
        assert!(text_layer_needs_gpu_shadow(&text_layer(spec)));
    }
}
