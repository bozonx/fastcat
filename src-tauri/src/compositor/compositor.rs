//! Главный объект композитора. Один на приложение (живёт внутри monitor-потока,
//! т.к. wgpu device, surface, vello renderer хотят жить рядом).
//!
//! Compositor отвечает за:
//!   1) владение `vello::RenderContext` и кешем `Renderer` по device-id;
//!   2) создание оконных surface'ов;
//!   3) рендер `scene::Scene` в surface / пиксели.
//!
//! Точки входа:
//!   - `render_scene_to_surface` / `render_scene_to_pixels` — high-level, принимают доменную `Scene`.
//!   - `render_to_surface` / `render_to_pixels` — low-level, принимают готовую `vello::Scene`.
//!
//! Конвертация `scene::Scene → vello::Scene` происходит внутри через `scene.to_vello(w, h)`.

use std::collections::HashMap;
use std::num::NonZeroUsize;
use std::sync::Arc;

use anyhow::{Context, Result, anyhow};
use vello::peniko::{Color, ImageData};
use vello::util::{RenderContext, RenderSurface};
use vello::{AaConfig, AaSupport, RenderParams, Renderer, RendererOptions, Scene as VelloScene};
use winit::window::Window;

use super::effects::{EffectPipeline, EffectSource, EffectSpec};
use super::scene::{BlendMode, Layer, LayerKind, RasterGpuSource, RasterSource, Transform};
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
        texture_cache: &super::texture_cache::TextureCache,
    ) -> Result<()> {
        let dev_id = surface.dev_id;
        let device_handle = &self.render_cx.devices[dev_id];
        let device = device_handle.device.clone();
        let queue = device_handle.queue.clone();
        let effective_scene = self.materialize_transitions_and_effects(
            dev_id,
            scene,
            texture_cache,
            &device,
            &queue,
        )?;
        let mut registered_images = Vec::new();
        let vello = self.build_vello_scene_from_materialized(
            dev_id,
            &effective_scene,
            viewport_w,
            viewport_h,
            texture_cache,
            &mut registered_images,
        )?;
        let result = self.render_to_surface(surface, &vello, scene.background);
        self.unregister_images(dev_id, registered_images);
        result
    }

    /// High-level: составляет доменную `Scene` в vello и читает пиксели в `Vec<u8>` (RGBA, `w×h×4`).
    pub fn render_scene_to_pixels(
        &mut self,
        dev_id: usize,
        scene: &super::scene::Scene,
        viewport_w: u32,
        viewport_h: u32,
        texture_cache: &super::texture_cache::TextureCache,
    ) -> Result<Vec<u8>> {
        let device_handle = &self.render_cx.devices[dev_id];
        let device = device_handle.device.clone();
        let queue = device_handle.queue.clone();
        let effective_scene = self.materialize_transitions_and_effects(
            dev_id,
            scene,
            texture_cache,
            &device,
            &queue,
        )?;
        let mut registered_images = Vec::new();
        let vello = self.build_vello_scene_from_materialized(
            dev_id,
            &effective_scene,
            viewport_w,
            viewport_h,
            texture_cache,
            &mut registered_images,
        )?;
        let result =
            self.render_to_pixels(dev_id, &vello, viewport_w, viewport_h, scene.background);
        self.unregister_images(dev_id, registered_images);
        result
    }

    fn build_vello_scene_from_materialized(
        &mut self,
        dev_id: usize,
        scene: &super::scene::Scene,
        viewport_w: u32,
        viewport_h: u32,
        texture_cache: &super::texture_cache::TextureCache,
        registered_images: &mut Vec<ImageData>,
    ) -> Result<VelloScene> {
        Ok(
            scene.to_vello(viewport_w, viewport_h, |source| match source {
                RasterGpuSource::Cache(key) => {
                    let texture = texture_cache.get(key)?;
                    self.register_texture_for_vello(dev_id, &texture, registered_images)
                        .ok()
                }
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
        texture_cache: &super::texture_cache::TextureCache,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
    ) -> Result<super::scene::Scene> {
        let mut layers = scene.layers.clone();

        // 1. Применяем переходы
        let mut to_remove = std::collections::HashSet::new();

        for i in 0..layers.len() {
            if let Some(trans_info) = layers[i].transition.clone() {
                let from_layer_opt = layers
                    .iter()
                    .find(|l| l.id == trans_info.from_layer_id)
                    .cloned();

                if let Some(from_layer) = from_layer_opt {
                    // Эффекты слоёв запекаем ДО перехода: иначе эффекты `from`-клипа
                    // терялись полностью (слой удаляется), а эффекты `to`-клипа
                    // применялись поверх готового перехода, а не к исходному кадру.
                    let from_source = self.layer_source_with_effects(
                        dev_id,
                        scene,
                        &from_layer,
                        texture_cache,
                        device,
                        queue,
                    )?;

                    let to_source = self.layer_source_with_effects(
                        dev_id,
                        scene,
                        &layers[i],
                        texture_cache,
                        device,
                        queue,
                    )?;

                    let pipeline = self
                        .transition_pipelines
                        .entry(dev_id)
                        .or_insert_with(|| TransitionPipeline::new(device));

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
                                source: RasterSource::GpuTexture(std::sync::Arc::new(processed)),
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

        // 2. Применяем эффекты к оставшимся слоям
        let mut final_layers = Vec::with_capacity(layers.len());
        for layer in layers {
            if layer.effects.is_empty() {
                final_layers.push(layer);
                continue;
            }

            let source = self.layer_to_effect_source(dev_id, scene, &layer, texture_cache)?;
            let processed =
                self.apply_effects_to_texture(dev_id, device, queue, &source, &layer.effects)?;
            let mut next = layer.clone();
            next.kind = LayerKind::Raster {
                natural_size: (processed.width(), processed.height()),
                source: RasterSource::GpuTexture(std::sync::Arc::new(processed)),
            };
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
        texture_cache: &super::texture_cache::TextureCache,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
    ) -> Result<EffectSource> {
        let base = self.layer_to_effect_source(dev_id, scene, layer, texture_cache)?;
        if layer.effects.is_empty() {
            return Ok(base);
        }
        let processed = self.apply_effects_to_texture(dev_id, device, queue, &base, &layer.effects)?;
        Ok(EffectSource::Gpu(Arc::new(processed)))
    }

    fn layer_to_effect_source(
        &mut self,
        dev_id: usize,
        scene: &super::scene::Scene,
        layer: &Layer,
        texture_cache: &super::texture_cache::TextureCache,
    ) -> Result<EffectSource> {
        match &layer.kind {
            LayerKind::Raster { source, .. } => match source {
                RasterSource::Image(image) => Ok(EffectSource::Cpu(image.clone())),
                RasterSource::GpuHandle(key) => {
                    let texture = texture_cache
                        .get(*key)
                        .ok_or_else(|| anyhow!("missing GPU texture for effect layer"))?;
                    Ok(EffectSource::Gpu(texture))
                }
                RasterSource::GpuTexture(texture) => Ok(EffectSource::Gpu(texture.clone())),
            },
            LayerKind::Shape(_) | LayerKind::Text(_) => {
                let texture = self.render_layer_to_texture(dev_id, scene, layer)?;
                Ok(EffectSource::Gpu(Arc::new(texture)))
            }
        }
    }

    fn render_layer_to_texture(
        &mut self,
        dev_id: usize,
        scene: &super::scene::Scene,
        layer: &Layer,
    ) -> Result<wgpu::Texture> {
        let natural = layer.kind.natural_size();
        let width = natural.0.max(1);
        let height = natural.1.max(1);
        let isolated = super::scene::Scene {
            width,
            height,
            time: scene.time,
            background: Color::TRANSPARENT,
            layers: vec![Layer {
                id: layer.id.clone(),
                kind: layer.kind.clone(),
                transform: Transform::identity(),
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

    fn apply_effects_to_texture(
        &mut self,
        dev_id: usize,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        source: &EffectSource,
        effects: &[EffectSpec],
    ) -> Result<wgpu::Texture> {
        let pipeline = self
            .effect_pipelines
            .entry(dev_id)
            .or_insert_with(|| EffectPipeline::new(device));
        match pipeline.apply_effects(device, queue, source, effects) {
            Ok(texture) => Ok(texture),
            Err(error) => {
                log::warn!("[compositor] layer effects skipped: {error:?}");
                // Fallback: отдать исходник как есть. GPU-текстура — дешёвый клон хэндла.
                match source {
                    EffectSource::Cpu(img) => image_to_texture(device, queue, img),
                    EffectSource::Gpu(tex) => Ok((**tex).clone()),
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

    fn unregister_images(&mut self, dev_id: usize, images: Vec<ImageData>) {
        let Some(renderer) = self.renderers.get_mut(&dev_id) else {
            return;
        };
        for image in images {
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
        let target = self.offscreen.get(&dev_id)
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

    fn ensure_renderer(&mut self, dev_id: usize) -> Result<()> {
        if self.renderers.contains_key(&dev_id) {
            return Ok(());
        }
        let device_handle = &self.render_cx.devices[dev_id];
        
        // Получаем или создаем PipelineCache для этого устройства
        let pipeline_cache = self.pipeline_caches.entry(dev_id).or_insert_with(|| {
            unsafe {
                device_handle.device.create_pipeline_cache(&wgpu::PipelineCacheDescriptor {
                    label: Some("vello-pipeline-cache"),
                    data: None,
                    fallback: true,
                })
            }
        }).clone();

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

fn image_pixels_rgba8(image: &ImageData) -> Result<Vec<u8>> {
    let expected = image
        .format
        .size_in_bytes(image.width, image.height)
        .ok_or_else(|| anyhow!("image byte size overflow"))?;
    let data = image.data.data();
    if data.len() < expected {
        return Err(anyhow!(
            "image data is too small: {} bytes for {}x{}",
            data.len(),
            image.width,
            image.height
        ));
    }
    match image.format {
        vello::peniko::ImageFormat::Rgba8 => Ok(data[..expected].to_vec()),
        vello::peniko::ImageFormat::Bgra8 => {
            let mut rgba = data[..expected].to_vec();
            for px in rgba.chunks_exact_mut(4) {
                px.swap(0, 2);
            }
            Ok(rgba)
        }
        _ => Err(anyhow!(
            "unsupported image format for compositor texture upload"
        )),
    }
}

impl Default for Compositor {
    fn default() -> Self {
        Self::new()
    }
}
