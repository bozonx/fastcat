//! Main compositor object. One per application (lives inside the monitor thread,
//! because wgpu device, surface, and vello renderer prefer to stay together).
//!
//! Compositor is responsible for:
//!   1) owning the `vello::RenderContext` and per-device-id `Renderer` cache;
//!   2) creating window surfaces;
//!   3) rendering `scene::Scene` into a surface / pixels.
//!
//! Entry points:
//!   - `render_scene_to_surface` / `render_scene_to_pixels` — high-level, accept a domain `Scene`.
//!   - `render_to_surface` / `render_to_pixels` — low-level, accept a ready `vello::Scene`.
//!
//! Conversion `scene::Scene → vello::Scene` happens internally via `scene.to_vello(w, h)`.

use std::collections::HashMap;
use std::num::NonZeroUsize;
use std::sync::Arc;
use std::time::Instant;

use anyhow::{anyhow, Context, Result};
use vello::peniko::{Color, ImageData};
use vello::util::{RenderContext, RenderSurface};
use vello::{AaConfig, AaSupport, RenderParams, Renderer, RendererOptions, Scene as VelloScene};
use winit::window::Window;

use super::effects::{EffectPipeline, EffectSource, EffectSpec};
use super::gpu_utils::{create_readback_target, create_rgba8_texture, image_pixels_rgba8};
use super::readback::*;
use super::render_telemetry::{RenderPrepareTiming, RenderStageTiming, RenderTelemetry};
use super::scene::{
    BlendMode, Layer, LayerKind, RasterGpuSource, RasterSource, Scene, Transform, TransitionEdge,
    TransitionSource,
};
use super::text_engine::{render_text_layer_with_gpu_shadow, text_layer_needs_gpu_shadow};
use super::transitions::TransitionPipeline;

mod device_context;
mod materializer;

use device_context::{DeviceContext, OffscreenTarget};

/// The wgpu device + queue pair. They are always passed together through the
/// materialization passes, so bundling them keeps those signatures readable.
#[derive(Clone, Copy)]
pub(crate) struct GpuCtx<'a> {
    pub device: &'a wgpu::Device,
    pub queue: &'a wgpu::Queue,
}

pub struct Compositor {
    devices: DeviceContext,
    effect_pipelines: HashMap<usize, EffectPipeline>,
    transition_pipelines: HashMap<usize, TransitionPipeline>,
    /// Reusable scratch buffer for image registration, avoiding per-frame allocations.
    scratch_images: Vec<ImageData>,
    render_telemetry: RenderTelemetry,
}

impl Compositor {
    pub fn new() -> Self {
        Self {
            devices: DeviceContext::new(),
            effect_pipelines: HashMap::new(),
            transition_pipelines: HashMap::new(),
            scratch_images: Vec::with_capacity(16),
            render_telemetry: RenderTelemetry::new(),
        }
    }

    pub async fn create_window_surface(
        &mut self,
        window: Arc<Window>,
        width: u32,
        height: u32,
    ) -> Result<RenderSurface<'static>> {
        let surface = self
            .devices
            .render_cx
            .create_surface(
                window,
                width.max(1),
                height.max(1),
                wgpu::PresentMode::AutoVsync,
            )
            .await
            .map_err(|e| anyhow!("vello create_surface failed: {e:?}"))?;
        self.ensure_renderer(surface.dev_id)?;
        Ok(surface)
    }

    pub fn resize_surface(
        &mut self,
        surface: &mut RenderSurface<'static>,
        width: u32,
        height: u32,
    ) {
        self.devices
            .render_cx
            .resize_surface(surface, width.max(1), height.max(1));
    }

    /// Renders a ready `vello::Scene` to the window. Internally: render_to_texture → blit to swapchain.
    pub fn render_to_surface(
        &mut self,
        surface: &mut RenderSurface<'static>,
        scene: &VelloScene,
        base_color: Color,
        aa: AaConfig,
    ) -> Result<()> {
        let width = surface.config.width;
        let height = surface.config.height;
        let device_handle = &self.devices.render_cx.devices[surface.dev_id];

        let surface_texture = match surface.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(t)
            | wgpu::CurrentSurfaceTexture::Suboptimal(t) => t,
            wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost => {
                self.devices
                    .render_cx
                    .resize_surface(surface, width, height);
                return Ok(());
            }
            other => {
                log::warn!("[compositor] surface acquire: {other:?}");
                return Ok(());
            }
        };

        let renderer = self
            .devices
            .renderers
            .get_mut(&surface.dev_id)
            .ok_or_else(|| anyhow!("no renderer for device {}", surface.dev_id))?;

        renderer
            .render_to_texture(
                &device_handle.device,
                &device_handle.queue,
                scene,
                &surface.target_view,
                &RenderParams {
                    base_color,
                    width,
                    height,
                    antialiasing_method: aa,
                },
            )
            .map_err(|e| anyhow!("vello render: {e:?}"))?;

        let mut encoder =
            device_handle
                .device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("compositor-blit"),
                });
        let surface_view = surface_texture
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        surface.blitter.copy(
            &device_handle.device,
            &mut encoder,
            &surface.target_view,
            &surface_view,
        );
        device_handle.queue.submit([encoder.finish()]);
        surface_texture.present();

        Ok(())
    }

    /// High-level: composes a domain `Scene` into vello and renders to the window.
    /// `scene.background` is used as the base color.
    pub fn render_scene_to_surface(
        &mut self,
        scene: &super::scene::Scene,
        surface: &mut RenderSurface<'static>,
        viewport_w: u32,
        viewport_h: u32,
    ) -> Result<()> {
        let total_started = Instant::now();
        let dev_id = surface.dev_id;
        let mut images = std::mem::take(&mut self.scratch_images);
        let (vello, prepare_timing) =
            self.prepare_vello_scene(dev_id, scene, viewport_w, viewport_h, &mut images)?;
        let aa = self.aa_config_for(dev_id, scene.effect_quality);
        let render_started = Instant::now();
        let result = self.render_to_surface(surface, &vello, scene.background, aa);
        let render_ms = elapsed_ms(render_started);
        self.unregister_images(dev_id, &mut images);
        self.scratch_images = images;
        self.render_telemetry.record(
            "surface",
            RenderStageTiming {
                materialize_ms: prepare_timing.materialize_ms,
                build_vello_ms: prepare_timing.build_vello_ms,
                render_ms,
                total_ms: elapsed_ms(total_started),
            },
        );
        result
    }

    /// High-level: composes a domain `Scene` into vello and reads pixels into `Vec<u8>` (RGBA, `w×h×4`).
    pub fn render_scene_to_pixels(
        &mut self,
        dev_id: usize,
        scene: &super::scene::Scene,
        viewport_w: u32,
        viewport_h: u32,
    ) -> Result<Vec<u8>> {
        let total_started = Instant::now();
        let mut images = std::mem::take(&mut self.scratch_images);
        let (vello, prepare_timing) =
            self.prepare_vello_scene(dev_id, scene, viewport_w, viewport_h, &mut images)?;
        let aa = self.aa_config_for(dev_id, scene.effect_quality);
        let render_started = Instant::now();
        let result =
            self.render_to_pixels(dev_id, &vello, viewport_w, viewport_h, scene.background, aa);
        let render_ms = elapsed_ms(render_started);
        self.unregister_images(dev_id, &mut images);
        self.scratch_images = images;
        self.render_telemetry.record(
            "pixels",
            RenderStageTiming {
                materialize_ms: prepare_timing.materialize_ms,
                build_vello_ms: prepare_timing.build_vello_ms,
                render_ms,
                total_ms: elapsed_ms(total_started),
            },
        );
        result
    }

    fn prepare_vello_scene(
        &mut self,
        dev_id: usize,
        scene: &super::scene::Scene,
        viewport_w: u32,
        viewport_h: u32,
        registered_images: &mut Vec<ImageData>,
    ) -> Result<(VelloScene, RenderPrepareTiming)> {
        materializer::prepare_vello_scene(
            self,
            dev_id,
            scene,
            viewport_w,
            viewport_h,
            registered_images,
        )
    }

    fn build_vello_scene_from_materialized(
        &mut self,
        dev_id: usize,
        scene: &super::scene::Scene,
        viewport_w: u32,
        viewport_h: u32,
        registered_images: &mut Vec<ImageData>,
    ) -> Result<VelloScene> {
        Ok(
            scene.to_vello(viewport_w, viewport_h, |source| match source {
                RasterGpuSource::Texture(texture) => self
                    .register_texture_for_vello(dev_id, texture, registered_images)
                    .ok(),
            }),
        )
    }

    fn materialize_transitions_and_effects(
        &mut self,
        dev_id: usize,
        scene: &super::scene::Scene,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
    ) -> Result<super::scene::Scene> {
        let mut layers = scene.layers.clone();

        self.apply_transitions(dev_id, scene, device, queue, &mut layers)?;
        self.materialize_text_shadow_blurs(dev_id, scene, device, queue, &mut layers)?;

        // Apply effects to the remaining layers (adjustment layers handled separately).
        let mut final_layers = Vec::with_capacity(layers.len());
        for layer in layers {
            if matches!(layer.kind, LayerKind::Adjustment) || layer.effects.is_empty() {
                final_layers.push(layer);
                continue;
            }
            final_layers
                .push(self.materialize_layer_effects(dev_id, scene, &layer, device, queue)?);
        }

        Ok(scene.with_layers(final_layers))
    }

    /// Renders the transition's *source* side (the other clip / background / transparency)
    /// into an `EffectSource`. `None` means the named source layer no longer exists, so the
    /// caller skips this transition.
    fn resolve_transition_source(
        &mut self,
        dev_id: usize,
        scene: &super::scene::Scene,
        source_kind: &TransitionSource,
        layers: &[super::scene::Layer],
        i: usize,
        ctx: GpuCtx<'_>,
    ) -> Result<Option<EffectSource>> {
        let GpuCtx { device, queue } = ctx;
        let source = match source_kind {
            TransitionSource::Layer(id) => {
                let Some(layer) = layers.iter().find(|layer| &layer.id == id).cloned() else {
                    return Ok(None);
                };
                self.transition_layer_source(dev_id, scene, &layer, device, queue)?
            }
            TransitionSource::Background => {
                let lower_layers = layers[..i].to_vec();
                let background_scene = scene.isolated(lower_layers);
                let background_scene = self.materialize_transitions_and_effects(
                    dev_id,
                    &background_scene,
                    device,
                    queue,
                )?;
                let background_scene =
                    self.materialize_video_tracks(dev_id, &background_scene, device, queue)?;
                let background_scene =
                    self.materialize_adjustment_clips(dev_id, &background_scene, device, queue)?;
                let background_scene =
                    self.materialize_video_tracks(dev_id, &background_scene, device, queue)?;
                let texture = self.render_domain_scene_to_owned_texture(
                    dev_id,
                    &background_scene,
                    scene.width,
                    scene.height,
                    Color::TRANSPARENT,
                )?;
                EffectSource::from_texture(texture)
            }
            TransitionSource::Transparent => {
                let transparent_scene = scene.isolated(Vec::new());
                let texture = self.render_domain_scene_to_owned_texture(
                    dev_id,
                    &transparent_scene,
                    scene.width,
                    scene.height,
                    Color::TRANSPARENT,
                )?;
                EffectSource::from_texture(texture)
            }
        };
        Ok(Some(source))
    }

    /// Phase 1: resolve each layer's transition through the transition pipeline into a
    /// flat raster layer, then drop the source layers it consumed.
    fn apply_transitions(
        &mut self,
        dev_id: usize,
        scene: &super::scene::Scene,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        layers: &mut Vec<super::scene::Layer>,
    ) -> Result<()> {
        let mut to_remove = std::collections::HashSet::new();

        for i in 0..layers.len() {
            if let Some(trans_info) = layers[i].transition.clone() {
                let source_kind = trans_info.source.clone();
                if matches!(&source_kind, TransitionSource::Layer(id) if id == &layers[i].id) {
                    continue;
                }

                let Some(source) = self.resolve_transition_source(
                    dev_id,
                    scene,
                    &source_kind,
                    layers,
                    i,
                    GpuCtx { device, queue },
                )?
                else {
                    continue;
                };

                let current =
                    self.transition_layer_source(dev_id, scene, &layers[i], device, queue)?;
                let (from_source, to_source) = match trans_info.edge {
                    TransitionEdge::In => (&source, &current),
                    TransitionEdge::Out => (&current, &source),
                };

                let cache = self.devices.pipeline_caches.get(&dev_id);
                let pipeline = self
                    .transition_pipelines
                    .entry(dev_id)
                    .or_insert_with(|| TransitionPipeline::new(device, cache));

                match pipeline.apply_transition(
                    device,
                    queue,
                    crate::compositor::transitions::TransitionRequest {
                        from_source,
                        to_source,
                        spec: &trans_info.spec,
                        progress: trans_info.progress,
                        speed: trans_info.speed_multiplier,
                    },
                ) {
                    Ok(processed) => {
                        layers[i].kind = LayerKind::Raster {
                            natural_size: (processed.width(), processed.height()),
                            source: RasterSource::GpuTexture(std::sync::Arc::new(
                                crate::media::SharedTexture::new_shared(std::sync::Arc::new(
                                    processed,
                                )),
                            )),
                            padding: None,
                        };
                        layers[i].transform = Transform::identity();
                        layers[i].opacity = 1.0;
                        layers[i].transition = None;
                        layers[i].effects.clear();

                        match source_kind {
                            TransitionSource::Layer(id) => {
                                to_remove.insert(id);
                            }
                            TransitionSource::Background => {
                                to_remove.extend(layers[..i].iter().map(|layer| layer.id.clone()));
                            }
                            TransitionSource::Transparent => {}
                        }
                    }
                    Err(e) => {
                        log::warn!("[compositor] transition failed: {e:?}");
                    }
                }
            }
        }

        layers.retain(|l| !to_remove.contains(&l.id));
        Ok(())
    }

    /// Phase 2: rasterize one layer and apply its effect chain (handling blur-fill, which
    /// reframes to the full project frame, as a special last step). Returns the flattened
    /// raster layer.
    fn materialize_layer_effects(
        &mut self,
        dev_id: usize,
        scene: &super::scene::Scene,
        layer: &super::scene::Layer,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
    ) -> Result<super::scene::Layer> {
        let is_vector = matches!(layer.kind, LayerKind::Shape(_) | LayerKind::Text(_));
        let render_scale = if is_vector {
            Self::vector_effect_render_scale(layer)
        } else {
            (1.0, 1.0)
        };

        let source = if is_vector {
            let texture = self.render_layer_to_texture(dev_id, scene, layer, render_scale)?;
            EffectSource::from_texture(texture)
        } else {
            self.layer_to_effect_source(dev_id, scene, layer)?
        };

        // Blur-fill reframes the layer to fill the whole project frame, so it
        // produces a *frame-sized* texture and the transform is reset to map
        // it 1:1 onto the frame (overriding the clip's letterbox fit). Any
        // other effects in the chain are applied first at source resolution,
        // then blur-fill last.
        if let Some(bf_idx) = layer
            .effects
            .iter()
            .position(|e| matches!(e, EffectSpec::BlurFill { .. }))
        {
            if let EffectSpec::BlurFill {
                fg_scale,
                bg_scale,
                blur,
                bg_dim,
                bg_saturation,
                tint_color,
                tint_strength,
                fg_offset_y,
            } = &layer.effects[bf_idx]
            {
                let others: Vec<EffectSpec> = layer
                    .effects
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| *i != bf_idx)
                    .map(|(_, e)| e.clone())
                    .collect();
                let base = if others.is_empty() {
                    source
                } else {
                    let (processed, _) = self.apply_effects_to_texture(
                        dev_id,
                        GpuCtx { device, queue },
                        &source,
                        &others,
                        false,
                        scene.effect_quality,
                    )?;
                    EffectSource::Gpu(processed)
                };
                let framed = self.apply_blur_fill_to_texture(
                    dev_id,
                    device,
                    queue,
                    &base,
                    &super::effects::BlurFillParams {
                        frame_w: scene.width,
                        frame_h: scene.height,
                        fg_scale: *fg_scale,
                        bg_scale: *bg_scale,
                        blur: *blur,
                        bg_dim: *bg_dim,
                        bg_saturation: *bg_saturation,
                        tint_color: *tint_color,
                        tint_strength: *tint_strength,
                        fg_offset_y: *fg_offset_y,
                        quality: scene.effect_quality,
                    },
                )?;
                let mut next = layer.clone();
                next.transform =
                    Transform::center_fit((scene.width, scene.height), (scene.width, scene.height));
                next.kind = LayerKind::Raster {
                    natural_size: (scene.width, scene.height),
                    source: RasterSource::GpuTexture(framed),
                    padding: None,
                };
                next.effects.clear();
                return Ok(next);
            }
        }

        let (processed, padding) = self.apply_effects_to_texture(
            dev_id,
            GpuCtx { device, queue },
            &source,
            &layer.effects,
            true,
            scene.effect_quality,
        )?;
        let mut next = layer.clone();
        next.kind = LayerKind::Raster {
            natural_size: (processed.width(), processed.height()),
            source: RasterSource::GpuTexture(processed),
            padding: if padding > 0 {
                Some((padding, padding))
            } else {
                None
            },
        };
        if is_vector {
            next.transform.scale_x /= render_scale.0;
            next.transform.scale_y /= render_scale.1;
        }
        next.effects.clear();
        Ok(next)
    }

    /// Materializes adjustment clips by rendering lower layers into a texture,
    /// applying the adjustment's effects, and replacing the lower layers with
    /// a single raster layer. Processes adjustments bottom-to-top (by z-order).
    fn materialize_adjustment_clips(
        &mut self,
        dev_id: usize,
        scene: &super::scene::Scene,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
    ) -> Result<super::scene::Scene> {
        if !scene
            .layers
            .iter()
            .any(|l| matches!(l.kind, LayerKind::Adjustment))
        {
            return Ok(scene.clone());
        }

        let mut result_layers: Vec<Layer> = Vec::new();
        let mut lower_layers: Vec<Layer> = Vec::new();

        for layer in &scene.layers {
            match &layer.kind {
                LayerKind::Adjustment => {
                    if lower_layers.is_empty() {
                        continue;
                    }
                    let temp_scene = scene.isolated(lower_layers.clone());
                    // Keep the original background for adjustment clip rendering.
                    let temp_scene = Scene {
                        background: scene.background,
                        ..temp_scene
                    };
                    let texture = self.render_domain_scene_to_owned_texture(
                        dev_id,
                        &temp_scene,
                        scene.width,
                        scene.height,
                        scene.background,
                    )?;
                    let (processed, _) = self.apply_effects_to_texture(
                        dev_id,
                        GpuCtx { device, queue },
                        &EffectSource::from_texture(texture),
                        &layer.effects,
                        false,
                        scene.effect_quality,
                    )?;
                    result_layers.push(Layer {
                        id: layer.id.clone(),
                        kind: LayerKind::Raster {
                            source: RasterSource::GpuTexture(processed),
                            natural_size: (scene.width, scene.height),
                            padding: None,
                        },
                        transform: Transform::identity(),
                        opacity: 1.0,
                        blend: layer.blend,
                        mask: None,
                        effects: Vec::new(),
                        transition: None,
                    });
                    lower_layers.clear();
                }
                _ => lower_layers.push(layer.clone()),
            }
        }

        result_layers.extend(lower_layers);

        Ok(scene.with_layers(result_layers))
    }

    fn materialize_video_tracks(
        &mut self,
        dev_id: usize,
        scene: &super::scene::Scene,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
    ) -> Result<super::scene::Scene> {
        let mut layers = scene.layers.clone();
        let mut tracks = scene.video_tracks.clone();
        tracks.sort_by_key(|track| track.z);

        for track in tracks {
            let needs_group = track.opacity < 1.0
                || !matches!(track.blend, BlendMode::Normal)
                || !track.effects.is_empty();
            if !needs_group {
                continue;
            }

            let member_ids: std::collections::HashSet<&str> =
                track.layer_ids.iter().map(String::as_str).collect();
            let member_positions: Vec<usize> = layers
                .iter()
                .enumerate()
                .filter_map(|(index, layer)| {
                    member_ids.contains(layer.id.as_str()).then_some(index)
                })
                .collect();
            let Some(insert_at) = member_positions.first().copied() else {
                continue;
            };
            let member_layers: Vec<Layer> = member_positions
                .iter()
                .filter_map(|index| layers.get(*index).cloned())
                .collect();
            if member_layers.is_empty() {
                continue;
            }
            if member_layers
                .iter()
                .any(|layer| matches!(layer.kind, LayerKind::Adjustment))
            {
                continue;
            }

            let isolated = scene.isolated(member_layers);
            let texture = self.render_domain_scene_to_owned_texture(
                dev_id,
                &isolated,
                scene.width,
                scene.height,
                Color::TRANSPARENT,
            )?;
            let source = EffectSource::from_texture(texture);
            let output = if track.effects.is_empty() {
                match source {
                    EffectSource::Gpu(texture) => texture,
                    EffectSource::Cpu(_) => {
                        return Err(anyhow!("track source must be GPU-backed"));
                    }
                }
            } else {
                self.apply_effects_to_texture(
                    dev_id,
                    GpuCtx { device, queue },
                    &source,
                    &track.effects,
                    false,
                    scene.effect_quality,
                )?
                .0
            };

            layers.retain(|layer| !member_ids.contains(layer.id.as_str()));
            layers.insert(
                insert_at.min(layers.len()),
                Layer {
                    id: format!("__track:{}", track.id),
                    kind: LayerKind::Raster {
                        source: RasterSource::GpuTexture(output),
                        natural_size: (scene.width, scene.height),
                        padding: None,
                    },
                    transform: Transform::identity(),
                    opacity: track.opacity,
                    blend: track.blend,
                    mask: None,
                    effects: Vec::new(),
                    transition: None,
                },
            );
        }

        Ok(Scene {
            layers,
            video_tracks: Vec::new(),
            ..scene.with_layers(Vec::new())
        })
    }

    /// Returns the layer's pixel source with its own effects already applied.
    /// If there are no effects, returns the raw source without an extra pass.
    fn layer_source_with_effects(
        &mut self,
        dev_id: usize,
        scene: &super::scene::Scene,
        layer: &Layer,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
    ) -> Result<EffectSource> {
        let base = if text_layer_needs_gpu_shadow(layer) {
            let texture =
                render_text_layer_with_gpu_shadow(self, dev_id, scene, layer, device, queue)?;
            EffectSource::from_texture(texture)
        } else {
            self.layer_to_effect_source(dev_id, scene, layer)?
        };
        if layer.effects.is_empty() {
            return Ok(base);
        }
        let (processed, _) = self.apply_effects_to_texture(
            dev_id,
            GpuCtx { device, queue },
            &base,
            &layer.effects,
            false,
            scene.effect_quality,
        )?;
        Ok(EffectSource::Gpu(processed))
    }

    fn transition_layer_source(
        &mut self,
        dev_id: usize,
        scene: &super::scene::Scene,
        layer: &Layer,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
    ) -> Result<EffectSource> {
        let source = self.layer_source_with_effects(dev_id, scene, layer, device, queue)?;
        let (source, natural_size) = match source {
            EffectSource::Cpu(image) => {
                let size = (image.width, image.height);
                (RasterSource::Image(image), size)
            }
            EffectSource::Gpu(texture) => {
                let size = (texture.width(), texture.height());
                (RasterSource::GpuTexture(texture), size)
            }
        };
        let isolated = scene.isolated(vec![Layer {
            id: layer.id.clone(),
            kind: LayerKind::Raster {
                source,
                natural_size,
                padding: None,
            },
            transform: layer.transform,
            opacity: layer.opacity,
            blend: BlendMode::Normal,
            mask: layer.mask.clone(),
            effects: Vec::new(),
            transition: None,
        }]);
        let texture = self.render_domain_scene_to_owned_texture(
            dev_id,
            &isolated,
            scene.width,
            scene.height,
            Color::TRANSPARENT,
        )?;
        Ok(EffectSource::from_texture(texture))
    }

    fn materialize_text_shadow_blurs(
        &mut self,
        dev_id: usize,
        scene: &super::scene::Scene,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        layers: &mut [Layer],
    ) -> Result<()> {
        for layer in layers {
            if !text_layer_needs_gpu_shadow(layer) {
                continue;
            }

            let render_scale = Self::vector_effect_render_scale(layer);
            match render_text_layer_with_gpu_shadow(self, dev_id, scene, layer, device, queue) {
                Ok(texture) => {
                    layer.kind = LayerKind::Raster {
                        natural_size: (texture.width(), texture.height()),
                        source: RasterSource::GpuTexture(Arc::new(
                            crate::media::SharedTexture::new_shared(Arc::new(texture)),
                        )),
                        padding: None,
                    };
                    layer.transform.scale_x /= render_scale.0;
                    layer.transform.scale_y /= render_scale.1;
                }
                Err(error) => {
                    log::warn!("[compositor] gpu text shadow skipped: {error:?}");
                }
            }
        }
        Ok(())
    }

    fn layer_to_effect_source(
        &mut self,
        dev_id: usize,
        scene: &super::scene::Scene,
        layer: &Layer,
    ) -> Result<EffectSource> {
        match &layer.kind {
            LayerKind::Raster { source, .. } => match source {
                RasterSource::Image(image) => Ok(EffectSource::Cpu(image.clone())),
                RasterSource::GpuTexture(texture) => Ok(EffectSource::Gpu(texture.clone())),
            },
            LayerKind::Shape(_) | LayerKind::Text(_) => {
                // 1:1 — transition path; supersampling for effects is done in step 2.
                let texture = self.render_layer_to_texture(dev_id, scene, layer, (1.0, 1.0))?;
                Ok(EffectSource::from_texture(texture))
            }
            LayerKind::Adjustment => Err(anyhow!(
                "layer_to_effect_source called on adjustment layer {}",
                layer.id
            )),
        }
    }

    /// Rasterizes a vector layer (Shape/Text) into an isolated texture for applying
    /// GPU effects. `scale` sets supersampling: at `(kx,ky) > 1` the layer is drawn
    /// at `natural × k` pixels so that subsequent compositing with upscaling does
    /// not produce aliasing/blur (the vector stays sharp). The caller must divide
    /// the layer's scale by `k`, otherwise the result will be scaled twice.
    pub(crate) fn render_layer_to_texture(
        &mut self,
        dev_id: usize,
        scene: &super::scene::Scene,
        layer: &Layer,
        scale: (f64, f64),
    ) -> Result<wgpu::Texture> {
        let natural = layer.kind.natural_size();
        let (kx, ky) = scale;
        let width = ((natural.0 as f64 * kx).round() as u32).max(1);
        let height = ((natural.1 as f64 * ky).round() as u32).max(1);
        let isolated = super::scene::Scene {
            width,
            height,
            time: scene.time,
            background: Color::TRANSPARENT,
            layers: vec![Layer {
                id: layer.id.clone(),
                kind: layer.kind.clone(),
                // Draw the layer scaled by k inside the texture (no shift/rotation).
                transform: Transform {
                    scale_x: kx,
                    scale_y: ky,
                    ..Transform::identity()
                },
                opacity: 1.0,
                blend: BlendMode::Normal,
                mask: None,
                effects: Vec::new(),
                transition: None,
            }],
            video_tracks: Vec::new(),
            master_effects: Vec::new(),
            effect_quality: scene.effect_quality,
        };
        let vello = isolated.to_vello(width, height, |_| None);
        let aa = self.aa_config_for(dev_id, scene.effect_quality);
        self.render_to_owned_texture(dev_id, &vello, width, height, Color::TRANSPARENT, aa)
    }

    /// Supersampling factor for rasterizing a vector layer for effects:
    /// takes the absolute scale of the layer (how much it is enlarged on the scene),
    /// clamps to `[1; 8]` and limits the final texture size (8192 px per side).
    pub(crate) fn vector_effect_render_scale(layer: &Layer) -> (f64, f64) {
        const MAX_K: f64 = 8.0;
        const MAX_DIM: f64 = 8192.0;
        let (nw, nh) = layer.kind.natural_size();
        let kx = layer.transform.scale_x.abs().clamp(1.0, MAX_K);
        let ky = layer.transform.scale_y.abs().clamp(1.0, MAX_K);
        let kx = kx.min(MAX_DIM / (nw.max(1) as f64)).max(1.0);
        let ky = ky.min(MAX_DIM / (nh.max(1) as f64)).max(1.0);
        (kx, ky)
    }

    /// Reframe a layer source into a frame-sized blur-fill texture (industry
    /// "blur fill"): the source fills the whole frame as a cover-scaled, blurred
    /// background with a contain-fit sharp copy on top. Falls back to the raw
    /// source on GPU failure.
    fn apply_blur_fill_to_texture(
        &mut self,
        dev_id: usize,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        source: &EffectSource,
        params: &super::effects::BlurFillParams,
    ) -> Result<Arc<crate::media::SharedTexture>> {
        let cache = self.devices.pipeline_caches.get(&dev_id);
        let pipeline = self
            .effect_pipelines
            .entry(dev_id)
            .or_insert_with(|| EffectPipeline::new(device, cache));
        match pipeline.apply_blur_fill(device, queue, source, params) {
            Ok(texture) => Ok(texture),
            Err(error) => {
                log::warn!("[compositor] blur-fill skipped: {error:?}");
                let tex = match source {
                    EffectSource::Cpu(img) => Arc::new(crate::media::SharedTexture::new_shared(
                        Arc::new(image_to_texture(device, queue, img)?),
                    )),
                    EffectSource::Gpu(tex) => tex.clone(),
                };
                Ok(tex)
            }
        }
    }

    pub(crate) fn apply_effects_to_texture(
        &mut self,
        dev_id: usize,
        ctx: GpuCtx<'_>,
        source: &EffectSource,
        effects: &[EffectSpec],
        enable_padding: bool,
        quality: crate::compositor::effects::EffectQuality,
    ) -> Result<(Arc<crate::media::SharedTexture>, u32)> {
        let GpuCtx { device, queue } = ctx;
        let cache = self.devices.pipeline_caches.get(&dev_id);
        let pipeline = self
            .effect_pipelines
            .entry(dev_id)
            .or_insert_with(|| EffectPipeline::new(device, cache));
        match pipeline.apply_effects(device, queue, source, effects, enable_padding, quality) {
            Ok((texture, padding)) => Ok((texture, padding)),
            Err(error) => {
                log::warn!("[compositor] layer effects skipped: {error:?}");
                // Fallback: return the source as-is. GPU texture is a cheap handle clone.
                let tex = match source {
                    EffectSource::Cpu(img) => Arc::new(crate::media::SharedTexture::new_shared(
                        Arc::new(image_to_texture(device, queue, img)?),
                    )),
                    EffectSource::Gpu(tex) => tex.clone(),
                };
                Ok((tex, 0))
            }
        }
    }

    fn register_texture_for_vello(
        &mut self,
        dev_id: usize,
        texture: &wgpu::Texture,
        registered_images: &mut Vec<ImageData>,
    ) -> Result<ImageData> {
        // `wgpu::Texture` is a refcounted handle (Arc internally), and `register_texture`
        // merely adds an override to the renderer and copies pixels into its atlas at the
        // start of a frame. So we pass a cheap handle clone instead of a full GPU copy every frame.
        // The source always has COPY_SRC (video frames from decode_thread, outputs of
        // effect/transition pipelines) — the `register_texture` requirement is satisfied.
        let renderer = self
            .devices
            .renderers
            .get_mut(&dev_id)
            .ok_or_else(|| anyhow!("no renderer for device {}", dev_id))?;
        let image = renderer.register_texture(texture.clone());
        registered_images.push(image.clone());
        Ok(image)
    }

    fn unregister_images(&mut self, dev_id: usize, images: &mut Vec<ImageData>) {
        let Some(renderer) = self.devices.renderers.get_mut(&dev_id) else {
            images.clear();
            return;
        };
        for image in images.drain(..) {
            renderer.unregister_texture(image);
        }
    }

    /// Whether a compatible wgpu adapter/device can be created on this machine.
    ///
    /// Used by integration tests to skip GPU-dependent cases gracefully on
    /// headless CI that lacks a hardware or software (e.g. lavapipe) Vulkan
    /// backend. Creates and discards a throwaway device, so call it sparingly.
    pub fn is_gpu_available() -> bool {
        let mut render_cx = RenderContext::new();
        pollster::block_on(render_cx.device(None)).is_some()
    }

    /// Returns the first existing `dev_id` or initializes a new one (needed for offscreen
    /// rendering when there is no surface). We share the device between surface and offscreen —
    /// Vello supports this.
    pub fn ensure_offscreen_device(&mut self) -> Result<usize> {
        if let Some(dev_id) = self.devices.renderers.keys().copied().next() {
            return Ok(dev_id);
        }
        // Create a device via RenderContext without a surface (adapter is chosen automatically).
        let dev_id = pollster::block_on(self.devices.render_cx.device(None))
            .ok_or_else(|| anyhow!("vello device: no compatible adapter"))?;
        self.ensure_renderer(dev_id)?;
        Ok(dev_id)
    }

    pub fn device(&self, dev_id: usize) -> Option<wgpu::Device> {
        self.devices
            .render_cx
            .devices
            .get(dev_id)
            .map(|dh| dh.device.clone())
    }

    pub fn queue(&self, dev_id: usize) -> Option<wgpu::Queue> {
        self.devices
            .render_cx
            .devices
            .get(dev_id)
            .map(|dh| dh.queue.clone())
    }

    /// Renders a scene to an Rgba8 texture and reads it back into `Vec<u8>` (RGBA, length = w*h*4).
    /// `(width, height)` must be multiples of 256 / 64 — this is a `copy_texture_to_buffer`
    /// requirement handled by aligning `bytes_per_row`; we do not require alignment from the caller.
    pub fn render_to_pixels(
        &mut self,
        dev_id: usize,
        scene: &VelloScene,
        width: u32,
        height: u32,
        base_color: Color,
        aa: AaConfig,
    ) -> Result<Vec<u8>> {
        let device_handle = &self.devices.render_cx.devices[dev_id];
        let device = &device_handle.device;
        let queue = &device_handle.queue;

        // (Re)create the offscreen target only when the size changes. Keyed by dev_id
        // so multiple devices do not evict each other.
        let need_rebuild = match self.devices.offscreen.get(&dev_id) {
            Some(t) => t.width != width || t.height != height,
            None => true,
        };
        if need_rebuild {
            let (texture, view, buffer, aligned_row_bytes) =
                create_readback_target(device, "monitor", width, height);
            self.devices.offscreen.insert(
                dev_id,
                OffscreenTarget {
                    width,
                    height,
                    texture,
                    view,
                    buffer,
                    aligned_row_bytes,
                },
            );
        }
        let target = self
            .devices
            .offscreen
            .get(&dev_id)
            .ok_or_else(|| anyhow!("offscreen target missing for device {dev_id}"))?;

        let renderer = self
            .devices
            .renderers
            .get_mut(&dev_id)
            .ok_or_else(|| anyhow!("no renderer for device {}", dev_id))?;
        renderer
            .render_to_texture(
                device,
                queue,
                scene,
                &target.view,
                &RenderParams {
                    base_color,
                    width,
                    height,
                    antialiasing_method: aa,
                },
            )
            .map_err(|e| anyhow!("vello render: {e:?}"))?;

        let row_bytes = width as usize * 4;
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("readback"),
        });
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &target.texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &target.buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(target.aligned_row_bytes as u32),
                    rows_per_image: Some(height),
                },
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );
        queue.submit([encoder.finish()]);

        let slice = target.buffer.slice(..);
        let (tx, rx) = std::sync::mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |r| {
            let _ = tx.send(r);
        });
        device.poll(wgpu::PollType::wait_indefinitely()).ok();
        rx.recv()
            .map_err(|_| anyhow!("buffer map disconnected"))?
            .map_err(|e| anyhow!("buffer map: {e:?}"))?;

        let mapped = slice.get_mapped_range();
        let mut out = Vec::with_capacity(row_bytes * height as usize);
        for row in 0..height as usize {
            let start = row * target.aligned_row_bytes;
            out.extend_from_slice(&mapped[start..start + row_bytes]);
        }
        drop(mapped);
        target.buffer.unmap();
        Ok(out)
    }

    fn render_to_owned_texture(
        &mut self,
        dev_id: usize,
        scene: &VelloScene,
        width: u32,
        height: u32,
        base_color: Color,
        aa: AaConfig,
    ) -> Result<wgpu::Texture> {
        let device_handle = &self.devices.render_cx.devices[dev_id];
        let device = &device_handle.device;
        let queue = &device_handle.queue;
        let texture = create_rgba8_texture(
            device,
            "compositor-owned-vello-layer",
            width,
            height,
            wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::TEXTURE_BINDING,
        );
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let renderer = self
            .devices
            .renderers
            .get_mut(&dev_id)
            .ok_or_else(|| anyhow!("no renderer for device {}", dev_id))?;
        renderer
            .render_to_texture(
                device,
                queue,
                scene,
                &view,
                &RenderParams {
                    base_color,
                    width,
                    height,
                    antialiasing_method: aa,
                },
            )
            .map_err(|e| anyhow!("vello render: {e:?}"))?;
        Ok(texture)
    }

    pub(crate) fn render_domain_scene_to_owned_texture(
        &mut self,
        dev_id: usize,
        scene: &super::scene::Scene,
        width: u32,
        height: u32,
        base_color: Color,
    ) -> Result<wgpu::Texture> {
        let mut registered_images = Vec::new();
        let vello = self.build_vello_scene_from_materialized(
            dev_id,
            scene,
            width,
            height,
            &mut registered_images,
        )?;
        let aa = self.aa_config_for(dev_id, scene.effect_quality);
        let result = self.render_to_owned_texture(dev_id, &vello, width, height, base_color, aa);
        self.unregister_images(dev_id, &mut registered_images);
        result
    }

    fn ensure_renderer(&mut self, dev_id: usize) -> Result<()> {
        if self.devices.renderers.contains_key(&dev_id) {
            return Ok(());
        }
        let device_handle = &self.devices.render_cx.devices[dev_id];

        // Get or create a PipelineCache for this device
        let pipeline_cache = self
            .devices
            .pipeline_caches
            .entry(dev_id)
            .or_insert_with(|| {
                // SAFETY: create_pipeline_cache is safe when data is None and fallback is true.
                unsafe {
                    device_handle
                        .device
                        .create_pipeline_cache(&wgpu::PipelineCacheDescriptor {
                            label: Some("vello-pipeline-cache"),
                            data: None,
                            fallback: true,
                        })
                }
            })
            .clone();

        // Prefer the full AA set (Area + MSAA8 + MSAA16) so we can pick crisp MSAA for
        // still frames / export and cheap Area for realtime playback (see aa_config_for).
        // Compiling MSAA pipelines is heavier and unsupported on some drivers, so fall back
        // to Area-only on failure and remember that this device can't do MSAA.
        let device = &device_handle.device;
        let make_renderer = |support: AaSupport| {
            Renderer::new(
                device,
                RendererOptions {
                    use_cpu: false,
                    antialiasing_support: support,
                    num_init_threads: NonZeroUsize::new(1),
                    pipeline_cache: Some(pipeline_cache.clone()),
                },
            )
        };
        let (renderer, msaa_supported) = match make_renderer(AaSupport::all()) {
            Ok(renderer) => (renderer, true),
            Err(e) => {
                log::warn!(
                    "[compositor] MSAA renderer unavailable on device {dev_id} ({e:?}); \
                     falling back to Area-only antialiasing"
                );
                let renderer = make_renderer(AaSupport::area_only())
                    .map_err(|e| anyhow!("vello renderer: {e:?}"))
                    .context("Compositor::ensure_renderer")?;
                (renderer, false)
            }
        };
        self.devices.renderers.insert(dev_id, renderer);
        self.devices.msaa_supported.insert(dev_id, msaa_supported);
        Ok(())
    }

    /// Antialiasing mode for a render pass on `dev_id`: crisp MSAA where quality matters
    /// (Ultra = export & settled still frames → MSAA16; High → MSAA8) and cheap analytic
    /// Area AA for realtime playback (Low/Medium). Never drops below Area — un-antialiased
    /// vector edges look broken and Area is essentially free. Falls back to Area when the
    /// device has no MSAA pipelines.
    fn aa_config_for(
        &self,
        dev_id: usize,
        quality: crate::compositor::effects::EffectQuality,
    ) -> AaConfig {
        use crate::compositor::effects::EffectQuality;
        let msaa = self
            .devices
            .msaa_supported
            .get(&dev_id)
            .copied()
            .unwrap_or(false);
        if !msaa {
            return AaConfig::Area;
        }
        match quality {
            EffectQuality::Ultra => AaConfig::Msaa16,
            EffectQuality::High => AaConfig::Msaa8,
            EffectQuality::Low | EffectQuality::Medium => AaConfig::Area,
        }
    }
}

fn image_to_texture(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    image: &ImageData,
) -> Result<wgpu::Texture> {
    let texture = create_rgba8_texture(
        device,
        "compositor-owned-image-texture",
        image.width.max(1),
        image.height.max(1),
        wgpu::TextureUsages::COPY_SRC
            | wgpu::TextureUsages::COPY_DST
            | wgpu::TextureUsages::TEXTURE_BINDING,
    );
    let pixels = image_pixels_rgba8(image)?;
    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture: &texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        &pixels,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(image.width.max(1) * 4),
            rows_per_image: Some(image.height.max(1)),
        },
        wgpu::Extent3d {
            width: image.width.max(1),
            height: image.height.max(1),
            depth_or_array_layers: 1,
        },
    );
    Ok(texture)
}

impl Compositor {
    /// Create a pipelined readback session for the given device and size.
    pub fn begin_pipelined_readback(
        &mut self,
        dev_id: usize,
        width: u32,
        height: u32,
        depth: usize,
    ) -> Result<PipelinedReadback> {
        let device_handle = &self.devices.render_cx.devices[dev_id];
        Ok(PipelinedReadback::new(
            &device_handle.device,
            dev_id,
            width,
            height,
            depth,
        ))
    }

    /// Renders a scene and returns pixels from the oldest ready frame,
    /// or `None` if the GPU has not caught up yet.
    pub fn render_to_pixels_pipelined(
        &mut self,
        session: &mut PipelinedReadback,
        scene: &VelloScene,
        base_color: Color,
        aa: AaConfig,
    ) -> Result<Option<Vec<u8>>> {
        let slot_idx = session.next_slot % session.slots.len();
        session.next_slot += 1;

        // If the slot is occupied — drain it first (blocking, rare case).
        if !matches!(session.slots[slot_idx].state, SlotState::Idle) {
            self.drain_slot(session, slot_idx)?;
        }

        let device_handle = &self.devices.render_cx.devices[session.dev_id];
        let device = &device_handle.device;
        let queue = &device_handle.queue;
        let slot = &mut session.slots[slot_idx];

        let renderer = self
            .devices
            .renderers
            .get_mut(&session.dev_id)
            .ok_or_else(|| anyhow!("no renderer for device {}", session.dev_id))?;
        renderer
            .render_to_texture(
                device,
                queue,
                scene,
                &slot.view,
                &RenderParams {
                    base_color,
                    width: session.width,
                    height: session.height,
                    antialiasing_method: aa,
                },
            )
            .map_err(|e| anyhow!("vello render: {e:?}"))?;

        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("pipelined-readback"),
        });
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &slot.texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &slot.buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(slot.aligned_row_bytes as u32),
                    rows_per_image: Some(session.height),
                },
            },
            wgpu::Extent3d {
                width: session.width,
                height: session.height,
                depth_or_array_layers: 1,
            },
        );
        queue.submit([encoder.finish()]);

        let slice = slot.buffer.slice(..);
        let (tx, rx) = std::sync::mpsc::channel();
        let frame = session.frame_seq;
        slice.map_async(wgpu::MapMode::Read, move |r| {
            let _ = tx.send(r);
        });
        slot.state = SlotState::InFlight { frame, map_rx: rx };
        session.frame_seq += 1;

        // Non-blocking poll — forces wgpu to invoke ready callbacks.
        device.poll(wgpu::PollType::Poll).ok();

        // Collect everything that is already mapped.
        collect_ready_slots(session)?;

        Ok(session.pop_next_ready())
    }

    /// High-level pipelined equivalent of `render_scene_to_pixels`.
    pub fn render_scene_to_pixels_pipelined(
        &mut self,
        session: &mut PipelinedReadback,
        scene: &super::scene::Scene,
    ) -> Result<Option<Vec<u8>>> {
        let total_started = Instant::now();
        let dev_id = session.dev_id;
        // Use the same scene-preparation path as the live monitor so adjustment
        // clips and master effects are materialized identically; otherwise their
        // effects (e.g. blur on an adjustment layer) render in the monitor but get
        // silently dropped from the export.
        let mut registered_images = Vec::new();
        let (vello, prepare_timing) = self.prepare_vello_scene(
            dev_id,
            scene,
            session.width,
            session.height,
            &mut registered_images,
        )?;
        let aa = self.aa_config_for(dev_id, scene.effect_quality);
        let render_started = Instant::now();
        let result = self.render_to_pixels_pipelined(session, &vello, scene.background, aa);
        let render_ms = elapsed_ms(render_started);
        self.unregister_images(dev_id, &mut registered_images);
        self.render_telemetry.record(
            "pixels-pipelined",
            RenderStageTiming {
                materialize_ms: prepare_timing.materialize_ms,
                build_vello_ms: prepare_timing.build_vello_ms,
                render_ms,
                total_ms: elapsed_ms(total_started),
            },
        );
        result
    }

    /// Wait for a specific slot and copy its data into `pending`.
    pub(crate) fn drain_slot(
        &mut self,
        session: &mut PipelinedReadback,
        slot_idx: usize,
    ) -> Result<()> {
        let device_handle = &self.devices.render_cx.devices[session.dev_id];
        let device = &device_handle.device;
        let slot = &mut session.slots[slot_idx];

        match std::mem::replace(&mut slot.state, SlotState::Idle) {
            SlotState::Idle => Ok(()),
            SlotState::InFlight { frame, map_rx } => {
                device.poll(wgpu::PollType::wait_indefinitely()).ok();
                map_rx
                    .recv()
                    .map_err(|_| anyhow!("buffer map disconnected"))?
                    .map_err(|e| anyhow!("buffer map: {e:?}"))?;
                let guard = UnmapGuard::new(&slot.buffer);
                let mapped = slot.buffer.slice(..).get_mapped_range();
                let mut out = Vec::with_capacity(session.row_bytes * session.height as usize);
                for row in 0..session.height as usize {
                    let start = row * slot.aligned_row_bytes;
                    out.extend_from_slice(&mapped[start..start + session.row_bytes]);
                }
                drop(mapped);
                slot.buffer.unmap();
                guard.disarm();
                session.push_pending(frame, out);
                Ok(())
            }
        }
    }
}

fn elapsed_ms(started: Instant) -> f64 {
    started.elapsed().as_secs_f64() * 1000.0
}

impl Default for Compositor {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compositor::scene::{BlendMode, Layer, LayerKind, RasterSource, Transform};

    fn raster_layer(natural: (u32, u32), transform: Transform) -> Layer {
        Layer {
            id: "test".into(),
            kind: LayerKind::Raster {
                source: RasterSource::Image(vello::peniko::ImageData {
                    data: vello::peniko::Blob::new(std::sync::Arc::new(vec![
                        0u8;
                        (natural.0 as usize)
                            * (natural.1
                                as usize)
                            * 4
                    ])),
                    format: vello::peniko::ImageFormat::Rgba8,
                    alpha_type: vello::peniko::ImageAlphaType::Alpha,
                    width: natural.0,
                    height: natural.1,
                }),
                natural_size: natural,
                padding: None,
            },
            transform,
            opacity: 1.0,
            blend: BlendMode::Normal,
            mask: None,
            effects: Vec::new(),
            transition: None,
        }
    }

    #[test]
    fn vector_effect_render_scale_identity_returns_one() {
        let layer = raster_layer((100, 200), Transform::identity());
        let (kx, ky) = Compositor::vector_effect_render_scale(&layer);
        assert!((kx - 1.0).abs() < 1e-9);
        assert!((ky - 1.0).abs() < 1e-9);
    }

    #[test]
    fn vector_effect_render_scale_uses_absolute_scale_clamped_to_max_k() {
        let mut t = Transform::identity();
        t.scale_x = 4.0;
        t.scale_y = 2.0;
        let layer = raster_layer((100, 100), t);
        let (kx, ky) = Compositor::vector_effect_render_scale(&layer);
        assert!((kx - 4.0).abs() < 1e-9);
        assert!((ky - 2.0).abs() < 1e-9);
    }

    #[test]
    fn vector_effect_render_scale_clamps_to_max_k() {
        let mut t = Transform::identity();
        t.scale_x = 20.0;
        t.scale_y = 20.0;
        let layer = raster_layer((100, 100), t);
        let (kx, ky) = Compositor::vector_effect_render_scale(&layer);
        assert!((kx - 8.0).abs() < 1e-9);
        assert!((ky - 8.0).abs() < 1e-9);
    }

    #[test]
    fn vector_effect_render_scale_negative_scale_uses_absolute_value() {
        let mut t = Transform::identity();
        t.scale_x = -3.0;
        t.scale_y = -2.0;
        let layer = raster_layer((100, 100), t);
        let (kx, ky) = Compositor::vector_effect_render_scale(&layer);
        assert!((kx - 3.0).abs() < 1e-9);
        assert!((ky - 2.0).abs() < 1e-9);
    }

    #[test]
    fn vector_effect_render_scale_clamps_to_max_dim_8192() {
        // natural 4096×4096 with scale 4.0 → 16384 > 8192, so k should be clamped to 8192/4096 = 2.0
        let mut t = Transform::identity();
        t.scale_x = 4.0;
        t.scale_y = 4.0;
        let layer = raster_layer((4096, 4096), t);
        let (kx, ky) = Compositor::vector_effect_render_scale(&layer);
        assert!((kx - 2.0).abs() < 1e-9);
        assert!((ky - 2.0).abs() < 1e-9);
    }

    #[test]
    fn vector_effect_render_scale_subscale_clamped_to_minimum_one() {
        // scale < 1.0 should be clamped up to 1.0 (no downscaling)
        let mut t = Transform::identity();
        t.scale_x = 0.5;
        t.scale_y = 0.25;
        let layer = raster_layer((100, 100), t);
        let (kx, ky) = Compositor::vector_effect_render_scale(&layer);
        assert!((kx - 1.0).abs() < 1e-9);
        assert!((ky - 1.0).abs() < 1e-9);
    }

    #[test]
    fn vector_effect_render_scale_zero_natural_size_clamped_to_one() {
        let layer = raster_layer((0, 0), Transform::identity());
        let (kx, ky) = Compositor::vector_effect_render_scale(&layer);
        assert!(kx.is_finite() && kx >= 1.0);
        assert!(ky.is_finite() && ky >= 1.0);
    }
}
