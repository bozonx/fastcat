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
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use vello::peniko::{Color, ImageData};
use vello::util::{RenderContext, RenderSurface};
use vello::{AaConfig, AaSupport, RenderParams, Renderer, RendererOptions, Scene as VelloScene};
use winit::window::Window;

use super::effects::{EffectPipeline, EffectSource, EffectSpec};
use super::gpu_utils::image_pixels_rgba8;
use super::readback::*;
use super::scene::{
    BlendMode, Layer, LayerKind, RasterGpuSource, RasterSource, TextLayer, TextRenderMode,
    Transform,
};
use super::transitions::TransitionPipeline;

/// Закешированный таргет offscreen-рендера. Пересоздаётся только при изменении размера.
/// Без кеша мы аллоцировали бы 8-16 МБ wgpu Buffer + текстуру на каждый кадр (60 FPS = 480-960 МБ/с
/// allocations), что давало взрывной рост памяти и нагрузку на CPU.
struct OffscreenTarget {
    width: u32,
    height: u32,
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    buffer: wgpu::Buffer,
    aligned_row_bytes: usize,
}

#[derive(Clone, Copy, Default)]
struct RenderStageTiming {
    materialize_ms: f64,
    build_vello_ms: f64,
    render_ms: f64,
    total_ms: f64,
}

#[derive(Default)]
struct RenderPrepareTiming {
    materialize_ms: f64,
    build_vello_ms: f64,
}

struct RenderTelemetry {
    enabled: bool,
    records: u64,
    frames: u64,
    warmup_frames: u64,
    last_log: Instant,
    materialize_sum_ms: f64,
    build_vello_sum_ms: f64,
    render_sum_ms: f64,
    total_sum_ms: f64,
}

impl RenderTelemetry {
    const INITIAL_WARMUP_CUTOFF_MS: f64 = 250.0;

    fn new() -> Self {
        Self::with_enabled(std::env::var("FASTCAT_RENDER_TIMING").is_ok_and(|value| value != "0"))
    }

    fn with_enabled(enabled: bool) -> Self {
        Self {
            enabled,
            records: 0,
            frames: 0,
            warmup_frames: 0,
            last_log: Instant::now(),
            materialize_sum_ms: 0.0,
            build_vello_sum_ms: 0.0,
            render_sum_ms: 0.0,
            total_sum_ms: 0.0,
        }
    }

    fn record(&mut self, target: &'static str, timing: RenderStageTiming) {
        if !self.enabled {
            return;
        }
        self.records += 1;

        if self.frames == 0 && timing.total_ms >= Self::INITIAL_WARMUP_CUTOFF_MS {
            self.warmup_frames += 1;
            log::info!(
                "[compositor-timing] {target}: warmup total={:.2}ms materialize={:.2}ms build_vello={:.2}ms render={:.2}ms; excluded from avg",
                timing.total_ms,
                timing.materialize_ms,
                timing.build_vello_ms,
                timing.render_ms,
            );
            self.last_log = Instant::now();
            return;
        }

        self.frames += 1;
        self.materialize_sum_ms += timing.materialize_ms;
        self.build_vello_sum_ms += timing.build_vello_ms;
        self.render_sum_ms += timing.render_ms;
        self.total_sum_ms += timing.total_ms;

        let should_log_periodic = self.frames.is_multiple_of(120);
        let should_log_slow =
            timing.total_ms >= 50.0 && self.last_log.elapsed() >= Duration::from_secs(1);
        if !should_log_periodic && !should_log_slow {
            return;
        }

        let frames = self.frames as f64;
        log::info!(
            "[compositor-timing] {target}: last total={:.2}ms materialize={:.2}ms build_vello={:.2}ms render={:.2}ms; avg total={:.2}ms materialize={:.2}ms build_vello={:.2}ms render={:.2}ms over {} frames",
            timing.total_ms,
            timing.materialize_ms,
            timing.build_vello_ms,
            timing.render_ms,
            self.total_sum_ms / frames,
            self.materialize_sum_ms / frames,
            self.build_vello_sum_ms / frames,
            self.render_sum_ms / frames,
            self.frames,
        );
        self.last_log = Instant::now();
    }
}

pub struct Compositor {
    render_cx: RenderContext,
    renderers: HashMap<usize, Renderer>,
    effect_pipelines: HashMap<usize, EffectPipeline>,
    transition_pipelines: HashMap<usize, TransitionPipeline>,
    /// Offscreen target — отдельный на каждый wgpu device. Текстура и readback-buffer
    /// привязаны к конкретному `wgpu::Device`; шарить один `Option` между device'ами
    /// приводило бы к молотьбе rebuild'ов при чередовании (preview ↔ export-device).
    offscreen: HashMap<usize, OffscreenTarget>,
    /// Кэш скомпилированных GPU пайплайнов (шейдеров) для каждого wgpu-устройства.
    pipeline_caches: HashMap<usize, wgpu::PipelineCache>,
    /// Reusable scratch buffer for image registration, avoiding per-frame allocations.
    scratch_images: Vec<ImageData>,
    render_telemetry: RenderTelemetry,
}

impl Compositor {
    pub fn new() -> Self {
        Self {
            render_cx: RenderContext::new(),
            renderers: HashMap::new(),
            effect_pipelines: HashMap::new(),
            transition_pipelines: HashMap::new(),
            offscreen: HashMap::new(),
            pipeline_caches: HashMap::new(),
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
        self.render_cx
            .resize_surface(surface, width.max(1), height.max(1));
    }

    /// Рендерит готовую `vello::Scene` в окно. Внутри: render_to_texture → blit на свопчейн.
    pub fn render_to_surface(
        &mut self,
        surface: &mut RenderSurface<'static>,
        scene: &VelloScene,
        base_color: Color,
    ) -> Result<()> {
        let width = surface.config.width;
        let height = surface.config.height;
        let device_handle = &self.render_cx.devices[surface.dev_id];

        let surface_texture = match surface.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(t)
            | wgpu::CurrentSurfaceTexture::Suboptimal(t) => t,
            wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost => {
                self.render_cx.resize_surface(surface, width, height);
                return Ok(());
            }
            other => {
                log::warn!("[compositor] surface acquire: {other:?}");
                return Ok(());
            }
        };

        let renderer = self
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
                    antialiasing_method: AaConfig::Area,
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

    /// High-level: составляет доменную `Scene` в vello и рендерит в окно.
    /// `scene.background` используется как базовый цвет.
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
        let render_started = Instant::now();
        let result = self.render_to_surface(surface, &vello, scene.background);
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

    /// High-level: составляет доменную `Scene` в vello и читает пиксели в `Vec<u8>` (RGBA, `w×h×4`).
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
        let render_started = Instant::now();
        let result =
            self.render_to_pixels(dev_id, &vello, viewport_w, viewport_h, scene.background);
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
        let device_handle = &self.render_cx.devices[dev_id];
        let device = device_handle.device.clone();
        let queue = device_handle.queue.clone();
        let materialize_started = Instant::now();
        let effective_scene =
            self.materialize_transitions_and_effects(dev_id, scene, &device, &queue)?;
        let materialize_ms = elapsed_ms(materialize_started);
        let build_started = Instant::now();
        let vello = self.build_vello_scene_from_materialized(
            dev_id,
            &effective_scene,
            viewport_w,
            viewport_h,
            registered_images,
        )?;
        let build_vello_ms = elapsed_ms(build_started);
        Ok((
            vello,
            RenderPrepareTiming {
                materialize_ms,
                build_vello_ms,
            },
        ))
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

        // 1. Применяем переходы
        let mut to_remove = std::collections::HashSet::new();

        for i in 0..layers.len() {
            if let Some(trans_info) = layers[i].transition.clone() {
                // A layer referencing itself as the from-layer would produce
                // a zero-area transition and then be erroneously removed.
                if trans_info.from_layer_id == layers[i].id {
                    continue;
                }
                let from_layer_opt = layers
                    .iter()
                    .find(|l| l.id == trans_info.from_layer_id)
                    .cloned();

                if let Some(from_layer) = from_layer_opt {
                    // Эффекты слоёв запекаем ДО перехода: иначе эффекты `from`-клипа
                    // терялись полностью (слой удаляется), а эффекты `to`-клипа
                    // применялись поверх готового перехода, а не к исходному кадру.
                    let from_source =
                        self.layer_source_with_effects(dev_id, scene, &from_layer, device, queue)?;

                    let to_source =
                        self.layer_source_with_effects(dev_id, scene, &layers[i], device, queue)?;

                    let cache = self.pipeline_caches.get(&dev_id);
                    let pipeline = self
                        .transition_pipelines
                        .entry(dev_id)
                        .or_insert_with(|| TransitionPipeline::new(device, cache));

                    match pipeline.apply_transition(
                        device,
                        queue,
                        &from_source,
                        &to_source,
                        &trans_info.spec,
                        trans_info.progress,
                    ) {
                        Ok(processed) => {
                            layers[i].kind = LayerKind::Raster {
                                natural_size: (processed.width(), processed.height()),
                                source: RasterSource::GpuTexture(std::sync::Arc::new(
                                    crate::media::SharedTexture::new_shared(std::sync::Arc::new(
                                        processed,
                                    )),
                                )),
                            };
                            layers[i].transition = None;
                            // Эффекты уже запечены в переход — не применять повторно в шаге 2.
                            layers[i].effects.clear();

                            to_remove.insert(from_layer.id.clone());
                        }
                        Err(e) => {
                            log::warn!("[compositor] transition failed: {e:?}");
                        }
                    }
                }
            }
        }

        layers.retain(|l| !to_remove.contains(&l.id));
        self.materialize_text_shadow_blurs(dev_id, scene, device, queue, &mut layers)?;

        // 2. Применяем эффекты к оставшимся слоям
        let mut final_layers = Vec::with_capacity(layers.len());
        for layer in layers {
            if layer.effects.is_empty() {
                final_layers.push(layer);
                continue;
            }

            // Векторные слои (Shape/Text) растеризуем под эффект в ЭКРАННОМ разрешении
            // (natural × scale), иначе крупная фигура/текст рендерилась бы в natural_size
            // и увеличивалась при композите → лесенка/мыло. Затем компенсируем scale слоя,
            // чтобы итоговый размер не удвоился. Растровые слои уже пиксельные — без k.
            let is_vector = matches!(layer.kind, LayerKind::Shape(_) | LayerKind::Text(_));
            let render_scale = if is_vector {
                Self::vector_effect_render_scale(&layer)
            } else {
                (1.0, 1.0)
            };

            let source = if is_vector {
                let texture = self.render_layer_to_texture(dev_id, scene, &layer, render_scale)?;
                EffectSource::Gpu(Arc::new(crate::media::SharedTexture::new_shared(Arc::new(
                    texture,
                ))))
            } else {
                self.layer_to_effect_source(dev_id, scene, &layer)?
            };
            let processed =
                self.apply_effects_to_texture(dev_id, device, queue, &source, &layer.effects)?;
            let mut next = layer.clone();
            next.kind = LayerKind::Raster {
                natural_size: (processed.width(), processed.height()),
                source: RasterSource::GpuTexture(processed),
            };
            if is_vector {
                next.transform.scale_x /= render_scale.0;
                next.transform.scale_y /= render_scale.1;
            }
            next.effects.clear();
            final_layers.push(next);
        }

        Ok(super::scene::Scene {
            width: scene.width,
            height: scene.height,
            time: scene.time,
            background: scene.background,
            layers: final_layers,
        })
    }

    /// Источник пикселей слоя с УЖЕ применёнными собственными эффектами слоя.
    /// Если эффектов нет — возвращает сырой источник без лишнего прохода.
    fn layer_source_with_effects(
        &mut self,
        dev_id: usize,
        scene: &super::scene::Scene,
        layer: &Layer,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
    ) -> Result<EffectSource> {
        let base = if Self::text_layer_needs_gpu_shadow(layer) {
            let texture =
                self.render_text_layer_with_gpu_shadow(dev_id, scene, layer, device, queue)?;
            EffectSource::Gpu(Arc::new(crate::media::SharedTexture::new_shared(Arc::new(
                texture,
            ))))
        } else {
            self.layer_to_effect_source(dev_id, scene, layer)?
        };
        if layer.effects.is_empty() {
            return Ok(base);
        }
        let processed =
            self.apply_effects_to_texture(dev_id, device, queue, &base, &layer.effects)?;
        Ok(EffectSource::Gpu(processed))
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
            if !Self::text_layer_needs_gpu_shadow(layer) {
                continue;
            }

            let render_scale = Self::vector_effect_render_scale(layer);
            match self.render_text_layer_with_gpu_shadow(dev_id, scene, layer, device, queue) {
                Ok(texture) => {
                    layer.kind = LayerKind::Raster {
                        natural_size: (texture.width(), texture.height()),
                        source: RasterSource::GpuTexture(Arc::new(
                            crate::media::SharedTexture::new_shared(Arc::new(texture)),
                        )),
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

    fn text_layer_needs_gpu_shadow(layer: &Layer) -> bool {
        let LayerKind::Text(spec) = &layer.kind else {
            return false;
        };
        spec.text_shadow_enabled
            && spec.text_shadow_blur > 0.0
            && spec.text_shadow_color.to_rgba8().a > 0
    }

    fn render_text_layer_with_gpu_shadow(
        &mut self,
        dev_id: usize,
        scene: &super::scene::Scene,
        layer: &Layer,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
    ) -> Result<wgpu::Texture> {
        let LayerKind::Text(spec) = &layer.kind else {
            return Err(anyhow!("gpu text shadow requested for non-text layer"));
        };
        let render_scale = Self::vector_effect_render_scale(layer);

        // Тень текста должна лежать МЕЖДУ фоном и глифами (как в CSS / старом CPU-пути),
        // иначе непрозрачный фон-подложка полностью её перекрывает. Поэтому композитим
        // три слоя: фон+рамка (низ) → размытая тень → основной текст (верх).
        let mut bg_spec = spec.clone();
        bg_spec.render_mode = TextRenderMode::BackgroundOnly;
        let background = self.render_text_spec_to_texture(
            dev_id,
            scene.time,
            layer.id.as_str(),
            bg_spec,
            render_scale,
        )?;

        let mut shadow_spec = spec.clone();
        shadow_spec.render_mode = TextRenderMode::TextShadowMask;
        shadow_spec.text_shadow_blur = 0.0;
        let shadow_mask = self.render_text_spec_to_texture(
            dev_id,
            scene.time,
            layer.id.as_str(),
            shadow_spec,
            render_scale,
        )?;
        let blur_scale = ((render_scale.0 + render_scale.1) * 0.5) as f32;
        let blurred_shadow = self.apply_effects_to_texture(
            dev_id,
            device,
            queue,
            &EffectSource::Gpu(Arc::new(crate::media::SharedTexture::new_shared(Arc::new(
                shadow_mask,
            )))),
            &[EffectSpec::GaussianBlurPixels {
                radius: spec.text_shadow_blur * blur_scale,
            }],
        )?;

        let mut text_spec = spec.clone();
        text_spec.render_mode = TextRenderMode::TextOnly;
        let text = self.render_text_spec_to_texture(
            dev_id,
            scene.time,
            layer.id.as_str(),
            text_spec,
            render_scale,
        )?;

        let width = text.width();
        let height = text.height();
        let composite = super::scene::Scene {
            width,
            height,
            time: scene.time,
            background: Color::TRANSPARENT,
            layers: vec![
                Self::gpu_texture_layer(
                    format!("{}:gpu-text-bg", layer.id),
                    Arc::new(crate::media::SharedTexture::new_shared(Arc::new(
                        background,
                    ))),
                    (width, height),
                ),
                Self::gpu_texture_layer(
                    format!("{}:gpu-text-shadow", layer.id),
                    blurred_shadow,
                    (width, height),
                ),
                Self::gpu_texture_layer(
                    format!("{}:gpu-text-glyphs", layer.id),
                    Arc::new(crate::media::SharedTexture::new_shared(Arc::new(text))),
                    (width, height),
                ),
            ],
        };
        self.render_domain_scene_to_owned_texture(
            dev_id,
            &composite,
            width,
            height,
            Color::TRANSPARENT,
        )
    }

    fn render_text_spec_to_texture(
        &mut self,
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
        let scene = super::scene::Scene {
            width: layer.kind.natural_size().0,
            height: layer.kind.natural_size().1,
            time,
            background: Color::TRANSPARENT,
            layers: Vec::new(),
        };
        self.render_layer_to_texture(dev_id, &scene, &layer, scale)
    }

    fn gpu_texture_layer(
        id: String,
        texture: Arc<crate::media::SharedTexture>,
        natural_size: (u32, u32),
    ) -> Layer {
        Layer {
            id,
            kind: LayerKind::Raster {
                source: RasterSource::GpuTexture(texture),
                natural_size,
            },
            transform: Transform::identity(),
            opacity: 1.0,
            blend: BlendMode::Normal,
            mask: None,
            effects: Vec::new(),
            transition: None,
        }
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
                // 1:1 — путь переходов; сверхдискретизация под эффекты делается в шаге 2.
                let texture = self.render_layer_to_texture(dev_id, scene, layer, (1.0, 1.0))?;
                Ok(EffectSource::Gpu(Arc::new(
                    crate::media::SharedTexture::new_shared(Arc::new(texture)),
                )))
            }
        }
    }

    /// Растеризует векторный слой (Shape/Text) в изолированную текстуру для применения
    /// GPU-эффектов. `scale` задаёт сверхдискретизацию: при `(kx,ky) > 1` слой рисуется
    /// в `natural × k` пикселей, чтобы при последующем композите с увеличением не было
    /// алиасинга/мыла (вектор остаётся резким). Вызывающий обязан поделить scale слоя
    /// на `k`, иначе результат увеличится дважды.
    fn render_layer_to_texture(
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
                // Рисуем слой увеличенным в k раз внутри текстуры (без сдвига/поворота).
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
        };
        let vello = isolated.to_vello(width, height, |_| None);
        self.render_to_owned_texture(dev_id, &vello, width, height, Color::TRANSPARENT)
    }

    /// Степень сверхдискретизации для растеризации векторного слоя под эффект:
    /// берём абсолютный scale слоя (на сколько он увеличивается на сцене), кламп в
    /// `[1; 8]` и ограничиваем итоговый размер текстуры (8192 px на сторону).
    fn vector_effect_render_scale(layer: &Layer) -> (f64, f64) {
        const MAX_K: f64 = 8.0;
        const MAX_DIM: f64 = 8192.0;
        let (nw, nh) = layer.kind.natural_size();
        let kx = layer.transform.scale_x.abs().clamp(1.0, MAX_K);
        let ky = layer.transform.scale_y.abs().clamp(1.0, MAX_K);
        let kx = kx.min(MAX_DIM / (nw.max(1) as f64)).max(1.0);
        let ky = ky.min(MAX_DIM / (nh.max(1) as f64)).max(1.0);
        (kx, ky)
    }

    fn apply_effects_to_texture(
        &mut self,
        dev_id: usize,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        source: &EffectSource,
        effects: &[EffectSpec],
    ) -> Result<Arc<crate::media::SharedTexture>> {
        let cache = self.pipeline_caches.get(&dev_id);
        let pipeline = self
            .effect_pipelines
            .entry(dev_id)
            .or_insert_with(|| EffectPipeline::new(device, cache));
        match pipeline.apply_effects(device, queue, source, effects) {
            Ok(texture) => Ok(texture),
            Err(error) => {
                log::warn!("[compositor] layer effects skipped: {error:?}");
                // Fallback: отдать исходник как есть. GPU-текстура — дешёвый клон хэндла.
                match source {
                    EffectSource::Cpu(img) => {
                        Ok(Arc::new(crate::media::SharedTexture::new_shared(Arc::new(
                            image_to_texture(device, queue, img)?,
                        ))))
                    }
                    EffectSource::Gpu(tex) => Ok(tex.clone()),
                }
            }
        }
    }

    fn register_texture_for_vello(
        &mut self,
        dev_id: usize,
        texture: &wgpu::Texture,
        registered_images: &mut Vec<ImageData>,
    ) -> Result<ImageData> {
        // `wgpu::Texture` — это refcounted-хэндл (Arc внутри), а `register_texture`
        // лишь добавляет override в renderer и копирует пиксели в свой атлас в начале
        // кадра. Поэтому отдаём дешёвый клон хэндла вместо полной GPU-копии каждый кадр.
        // Источник всегда имеет COPY_SRC (видеокадры из decode_thread, выходы
        // effect/transition-пайплайнов) — требование `register_texture` соблюдено.
        let renderer = self
            .renderers
            .get_mut(&dev_id)
            .ok_or_else(|| anyhow!("no renderer for device {}", dev_id))?;
        let image = renderer.register_texture(texture.clone());
        registered_images.push(image.clone());
        Ok(image)
    }

    fn unregister_images(&mut self, dev_id: usize, images: &mut Vec<ImageData>) {
        let Some(renderer) = self.renderers.get_mut(&dev_id) else {
            images.clear();
            return;
        };
        for image in images.drain(..) {
            renderer.unregister_texture(image);
        }
    }

    /// Возвращает первое существующее `dev_id` или инициализирует новое (нужно для offscreen-рендера,
    /// когда нет surface). Здесь мы шарим device между surface и offscreen — у Vello это OK.
    pub fn ensure_offscreen_device(&mut self) -> Result<usize> {
        if let Some(dev_id) = self.renderers.keys().copied().next() {
            return Ok(dev_id);
        }
        // Создаём device через RenderContext без surface (адаптер выберется автоматически).
        let dev_id = pollster::block_on(self.render_cx.device(None))
            .ok_or_else(|| anyhow!("vello device: no compatible adapter"))?;
        self.ensure_renderer(dev_id)?;
        Ok(dev_id)
    }

    pub fn device(&self, dev_id: usize) -> Option<wgpu::Device> {
        self.render_cx
            .devices
            .get(dev_id)
            .map(|dh| dh.device.clone())
    }

    pub fn queue(&self, dev_id: usize) -> Option<wgpu::Queue> {
        self.render_cx
            .devices
            .get(dev_id)
            .map(|dh| dh.queue.clone())
    }

    /// Рендерит сцену в Rgba8 texture и читает её обратно в `Vec<u8>` (RGBA, length = w*h*4).
    /// `(width, height)` должны быть кратны 256 / 64 — это требование `copy_texture_to_buffer`
    /// учитываем выравниванием `bytes_per_row`; здесь не требуем кратности от вызывающего.
    pub fn render_to_pixels(
        &mut self,
        dev_id: usize,
        scene: &VelloScene,
        width: u32,
        height: u32,
        base_color: Color,
    ) -> Result<Vec<u8>> {
        let device_handle = &self.render_cx.devices[dev_id];
        let device = &device_handle.device;
        let queue = &device_handle.queue;

        // (Пере)создаём offscreen target только при изменении размера. Ключ — dev_id,
        // чтобы при работе с несколькими device'ами они не вытесняли друг друга.
        let need_rebuild = match self.offscreen.get(&dev_id) {
            Some(t) => t.width != width || t.height != height,
            None => true,
        };
        if need_rebuild {
            let row_bytes = width as usize * 4;
            let aligned_row_bytes = (row_bytes + 255) & !255;
            let buffer_size = (aligned_row_bytes * height as usize) as u64;
            let texture = device.create_texture(&wgpu::TextureDescriptor {
                label: Some("monitor-offscreen"),
                size: wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_SRC,
                view_formats: &[],
            });
            let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
            let buffer = device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("monitor-readback"),
                size: buffer_size,
                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                mapped_at_creation: false,
            });
            self.offscreen.insert(
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
            .offscreen
            .get(&dev_id)
            .ok_or_else(|| anyhow!("offscreen target missing for device {dev_id}"))?;

        let renderer = self
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
                    antialiasing_method: AaConfig::Area,
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
    ) -> Result<wgpu::Texture> {
        let device_handle = &self.render_cx.devices[dev_id];
        let device = &device_handle.device;
        let queue = &device_handle.queue;
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("compositor-owned-vello-layer"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let renderer = self
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
                    antialiasing_method: AaConfig::Area,
                },
            )
            .map_err(|e| anyhow!("vello render: {e:?}"))?;
        Ok(texture)
    }

    fn render_domain_scene_to_owned_texture(
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
        let result = self.render_to_owned_texture(dev_id, &vello, width, height, base_color);
        self.unregister_images(dev_id, &mut registered_images);
        result
    }

    fn ensure_renderer(&mut self, dev_id: usize) -> Result<()> {
        if self.renderers.contains_key(&dev_id) {
            return Ok(());
        }
        let device_handle = &self.render_cx.devices[dev_id];

        // Получаем или создаем PipelineCache для этого устройства
        let pipeline_cache = self
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

        let renderer = Renderer::new(
            &device_handle.device,
            RendererOptions {
                use_cpu: false,
                antialiasing_support: AaSupport::area_only(),
                num_init_threads: NonZeroUsize::new(1),
                pipeline_cache: Some(pipeline_cache),
            },
        )
        .map_err(|e| anyhow!("vello renderer: {e:?}"))
        .context("Compositor::ensure_renderer")?;
        self.renderers.insert(dev_id, renderer);
        Ok(())
    }
}

fn image_to_texture(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    image: &ImageData,
) -> Result<wgpu::Texture> {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("compositor-owned-image-texture"),
        size: wgpu::Extent3d {
            width: image.width.max(1),
            height: image.height.max(1),
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::COPY_SRC
            | wgpu::TextureUsages::COPY_DST
            | wgpu::TextureUsages::TEXTURE_BINDING,
        view_formats: &[],
    });
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
    /// Создать pipelined readback-сессию для заданного device и размера.
    pub fn begin_pipelined_readback(
        &mut self,
        dev_id: usize,
        width: u32,
        height: u32,
        depth: usize,
    ) -> Result<PipelinedReadback> {
        let device_handle = &self.render_cx.devices[dev_id];
        Ok(PipelinedReadback::new(
            &device_handle.device,
            dev_id,
            width,
            height,
            depth,
        ))
    }

    /// Рендерит сцену и возвращает пиксели самого старого готового кадра,
    /// либо `None`, если GPU ещё не догнал.
    pub fn render_to_pixels_pipelined(
        &mut self,
        session: &mut PipelinedReadback,
        scene: &VelloScene,
        base_color: Color,
    ) -> Result<Option<Vec<u8>>> {
        let slot_idx = session.next_slot % session.slots.len();
        session.next_slot += 1;

        // Если слот занят — сначала забираем его (блокирующе, редкий случай).
        if !matches!(session.slots[slot_idx].state, SlotState::Idle) {
            self.drain_slot(session, slot_idx)?;
        }

        let device_handle = &self.render_cx.devices[session.dev_id];
        let device = &device_handle.device;
        let queue = &device_handle.queue;
        let slot = &mut session.slots[slot_idx];

        let renderer = self
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
                    antialiasing_method: AaConfig::Area,
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

        // Неблокирующий poll — заставляет wgpu вызвать уже готовые callbacks.
        device.poll(wgpu::PollType::Poll).ok();

        // Собираем всё, что уже mapped.
        collect_ready_slots(session)?;

        // Возвращаем самый старый готовый кадр.
        if let Some((_, pixels)) = session.pending.pop_first() {
            session.emitted += 1;
            Ok(Some(pixels))
        } else {
            Ok(None)
        }
    }

    /// High-level pipelined аналог `render_scene_to_pixels`.
    pub fn render_scene_to_pixels_pipelined(
        &mut self,
        session: &mut PipelinedReadback,
        scene: &super::scene::Scene,
    ) -> Result<Option<Vec<u8>>> {
        let total_started = Instant::now();
        let dev_id = session.dev_id;
        let device_handle = &self.render_cx.devices[dev_id];
        let device = device_handle.device.clone();
        let queue = device_handle.queue.clone();
        let materialize_started = Instant::now();
        let effective_scene =
            self.materialize_transitions_and_effects(dev_id, scene, &device, &queue)?;
        let materialize_ms = elapsed_ms(materialize_started);
        let mut registered_images = Vec::new();
        let build_started = Instant::now();
        let vello = self.build_vello_scene_from_materialized(
            dev_id,
            &effective_scene,
            session.width,
            session.height,
            &mut registered_images,
        )?;
        let build_vello_ms = elapsed_ms(build_started);
        let render_started = Instant::now();
        let result = self.render_to_pixels_pipelined(session, &vello, scene.background);
        let render_ms = elapsed_ms(render_started);
        self.unregister_images(dev_id, &mut registered_images);
        self.render_telemetry.record(
            "pixels-pipelined",
            RenderStageTiming {
                materialize_ms,
                build_vello_ms,
                render_ms,
                total_ms: elapsed_ms(total_started),
            },
        );
        result
    }

    /// Дождаться конкретного слота и скопировать данные в `pending`.
    pub(crate) fn drain_slot(
        &mut self,
        session: &mut PipelinedReadback,
        slot_idx: usize,
    ) -> Result<()> {
        let device_handle = &self.render_cx.devices[session.dev_id];
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

    #[test]
    fn render_telemetry_disabled_ignores_records() {
        let mut telemetry = RenderTelemetry::with_enabled(false);

        telemetry.record(
            "surface",
            RenderStageTiming {
                materialize_ms: 1.0,
                build_vello_ms: 2.0,
                render_ms: 3.0,
                total_ms: 6.0,
            },
        );

        assert_eq!(telemetry.records, 0);
        assert_eq!(telemetry.frames, 0);
        assert_eq!(telemetry.total_sum_ms, 0.0);
    }

    #[test]
    fn render_telemetry_enabled_accumulates_stage_totals() {
        let mut telemetry = RenderTelemetry::with_enabled(true);

        telemetry.record(
            "surface",
            RenderStageTiming {
                materialize_ms: 1.0,
                build_vello_ms: 2.0,
                render_ms: 3.0,
                total_ms: 6.0,
            },
        );
        telemetry.record(
            "pixels",
            RenderStageTiming {
                materialize_ms: 4.0,
                build_vello_ms: 5.0,
                render_ms: 6.0,
                total_ms: 15.0,
            },
        );

        assert_eq!(telemetry.records, 2);
        assert_eq!(telemetry.frames, 2);
        assert_eq!(telemetry.warmup_frames, 0);
        assert_eq!(telemetry.materialize_sum_ms, 5.0);
        assert_eq!(telemetry.build_vello_sum_ms, 7.0);
        assert_eq!(telemetry.render_sum_ms, 9.0);
        assert_eq!(telemetry.total_sum_ms, 21.0);
    }

    #[test]
    fn render_telemetry_excludes_initial_slow_warmup_from_averages() {
        let mut telemetry = RenderTelemetry::with_enabled(true);

        telemetry.record(
            "surface",
            RenderStageTiming {
                materialize_ms: 0.1,
                build_vello_ms: 0.1,
                render_ms: 999.8,
                total_ms: 1000.0,
            },
        );
        telemetry.record(
            "surface",
            RenderStageTiming {
                materialize_ms: 1.0,
                build_vello_ms: 2.0,
                render_ms: 3.0,
                total_ms: 6.0,
            },
        );

        assert_eq!(telemetry.records, 2);
        assert_eq!(telemetry.frames, 1);
        assert_eq!(telemetry.warmup_frames, 1);
        assert_eq!(telemetry.materialize_sum_ms, 1.0);
        assert_eq!(telemetry.build_vello_sum_ms, 2.0);
        assert_eq!(telemetry.render_sum_ms, 3.0);
        assert_eq!(telemetry.total_sum_ms, 6.0);
    }
}
