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

use anyhow::{anyhow, Context, Result};
use vello::peniko::{Color, ImageData};
use vello::util::{RenderContext, RenderSurface};
use vello::{AaConfig, AaSupport, RenderParams, Renderer, RendererOptions, Scene as VelloScene};
use winit::window::Window;

use super::effects::{EffectPipeline, EffectSpec};
use super::scene::{BlendMode, Layer, LayerKind, RasterSource, Transform};

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
    /// Offscreen target — отдельный на каждый wgpu device. Текстура и readback-buffer
    /// привязаны к конкретному `wgpu::Device`; шарить один `Option` между device'ами
    /// приводило бы к молотьбе rebuild'ов при чередовании (preview ↔ export-device).
    offscreen: HashMap<usize, OffscreenTarget>,
}

impl Compositor {
    pub fn new() -> Self {
        Self {
            render_cx: RenderContext::new(),
            renderers: HashMap::new(),
            effect_pipelines: HashMap::new(),
            offscreen: HashMap::new(),
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
        let vello = self.build_vello_scene_with_effects(
            dev_id,
            scene,
            viewport_w,
            viewport_h,
            texture_cache,
        )?;
        self.render_to_surface(surface, &vello, scene.background)
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
        let vello = self.build_vello_scene_with_effects(
            dev_id,
            scene,
            viewport_w,
            viewport_h,
            texture_cache,
        )?;
        self.render_to_pixels(dev_id, &vello, viewport_w, viewport_h, scene.background)
    }

    fn build_vello_scene_with_effects(
        &mut self,
        dev_id: usize,
        scene: &super::scene::Scene,
        viewport_w: u32,
        viewport_h: u32,
        texture_cache: &super::texture_cache::TextureCache,
    ) -> Result<VelloScene> {
        let device_handle = &self.render_cx.devices[dev_id];
        let device = device_handle.device.clone();
        let queue = device_handle.queue.clone();
        let effective_scene =
            self.materialize_effect_layers(dev_id, scene, texture_cache, &device, &queue)?;

        Ok(effective_scene.to_vello(viewport_w, viewport_h, |key| {
            if let Some(texture) = texture_cache.get(key) {
                read_texture_to_image(&device, &queue, &texture).ok()
            } else {
                None
            }
        }))
    }

    fn materialize_effect_layers(
        &mut self,
        dev_id: usize,
        scene: &super::scene::Scene,
        texture_cache: &super::texture_cache::TextureCache,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
    ) -> Result<super::scene::Scene> {
        if !scene.layers.iter().any(|layer| !layer.effects.is_empty()) {
            return Ok(scene.clone());
        }

        let mut layers = Vec::with_capacity(scene.layers.len());
        for layer in &scene.layers {
            if layer.effects.is_empty() {
                layers.push(layer.clone());
                continue;
            }

            let source = self.layer_to_effect_source_image(
                dev_id,
                scene,
                layer,
                texture_cache,
                device,
                queue,
            )?;
            let processed =
                self.apply_effects_to_image(dev_id, device, queue, &source, &layer.effects);
            let mut next = layer.clone();
            next.kind = LayerKind::Raster {
                natural_size: (processed.width, processed.height),
                source: RasterSource::Image(processed),
            };
            next.effects.clear();
            layers.push(next);
        }

        Ok(super::scene::Scene {
            width: scene.width,
            height: scene.height,
            time: scene.time,
            background: scene.background,
            layers,
        })
    }

    fn layer_to_effect_source_image(
        &mut self,
        dev_id: usize,
        scene: &super::scene::Scene,
        layer: &Layer,
        texture_cache: &super::texture_cache::TextureCache,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
    ) -> Result<ImageData> {
        match &layer.kind {
            LayerKind::Raster { source, .. } => match source {
                RasterSource::Image(image) => Ok(image.clone()),
                RasterSource::GpuHandle(key) => {
                    let texture = texture_cache
                        .get(*key)
                        .ok_or_else(|| anyhow!("missing GPU texture for effect layer"))?;
                    read_texture_to_image(device, queue, &texture)
                }
            },
            LayerKind::Shape(_) | LayerKind::Text(_) => {
                self.render_layer_to_image(dev_id, scene, layer, texture_cache, device, queue)
            }
        }
    }

    fn render_layer_to_image(
        &mut self,
        dev_id: usize,
        scene: &super::scene::Scene,
        layer: &Layer,
        texture_cache: &super::texture_cache::TextureCache,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
    ) -> Result<ImageData> {
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
            }],
        };
        let vello = isolated.to_vello(width, height, |key| {
            if let Some(texture) = texture_cache.get(key) {
                read_texture_to_image(device, queue, &texture).ok()
            } else {
                None
            }
        });
        let pixels = self.render_to_pixels(dev_id, &vello, width, height, Color::TRANSPARENT)?;
        Ok(ImageData {
            data: vello::peniko::Blob::new(std::sync::Arc::new(pixels)),
            format: vello::peniko::ImageFormat::Rgba8,
            alpha_type: vello::peniko::ImageAlphaType::Alpha,
            width,
            height,
        })
    }

    fn apply_effects_to_image(
        &mut self,
        dev_id: usize,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        image: &ImageData,
        effects: &[EffectSpec],
    ) -> ImageData {
        let pipeline = self
            .effect_pipelines
            .entry(dev_id)
            .or_insert_with(|| EffectPipeline::new(device));
        apply_effects_or_original(pipeline, device, queue, image, effects)
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
        let target = self.offscreen.get(&dev_id).unwrap();

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

    fn ensure_renderer(&mut self, dev_id: usize) -> Result<()> {
        if self.renderers.contains_key(&dev_id) {
            return Ok(());
        }
        let device_handle = &self.render_cx.devices[dev_id];
        let renderer = Renderer::new(
            &device_handle.device,
            RendererOptions {
                use_cpu: false,
                antialiasing_support: AaSupport::area_only(),
                num_init_threads: NonZeroUsize::new(1),
                pipeline_cache: None,
            },
        )
        .map_err(|e| anyhow!("vello renderer: {e:?}"))
        .context("Compositor::ensure_renderer")?;
        self.renderers.insert(dev_id, renderer);
        Ok(())
    }
}

pub fn read_texture_to_image(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    texture: &wgpu::Texture,
) -> Result<vello::peniko::ImageData> {
    let width = texture.width();
    let height = texture.height();
    let row_bytes = width as usize * 4;
    let aligned_row_bytes = (row_bytes + 255) & !255;
    let buffer_size = (aligned_row_bytes * height as usize) as u64;

    let buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("texture-cache-readback"),
        size: buffer_size,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });

    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
        label: Some("texture-cache-readback-encoder"),
    });

    encoder.copy_texture_to_buffer(
        wgpu::TexelCopyTextureInfo {
            texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        wgpu::TexelCopyBufferInfo {
            buffer: &buffer,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(aligned_row_bytes as u32),
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

    let slice = buffer.slice(..);
    let (tx, rx) = std::sync::mpsc::channel();
    slice.map_async(wgpu::MapMode::Read, move |r| {
        let _ = tx.send(r);
    });
    device.poll(wgpu::PollType::wait_indefinitely()).ok();
    rx.recv()
        .map_err(|_| anyhow!("buffer map disconnected"))?
        .map_err(|e| anyhow!("buffer map: {e:?}"))?;

    let mapped = slice.get_mapped_range();
    let mut pixels = Vec::with_capacity(row_bytes * height as usize);
    for row in 0..height as usize {
        let start = row * aligned_row_bytes;
        pixels.extend_from_slice(&mapped[start..start + row_bytes]);
    }
    drop(mapped);
    buffer.unmap();

    let blob = vello::peniko::Blob::new(std::sync::Arc::new(pixels));
    Ok(vello::peniko::ImageData {
        data: blob,
        format: vello::peniko::ImageFormat::Rgba8,
        alpha_type: vello::peniko::ImageAlphaType::Alpha,
        width,
        height,
    })
}

fn apply_effects_or_original(
    pipeline: &EffectPipeline,
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    image: &ImageData,
    effects: &[EffectSpec],
) -> ImageData {
    match pipeline.apply_to_image(device, queue, image, effects) {
        Ok(image) => image,
        Err(error) => {
            log::warn!("[compositor] layer effects skipped: {error:?}");
            image.clone()
        }
    }
}

impl Default for Compositor {
    fn default() -> Self {
        Self::new()
    }
}
