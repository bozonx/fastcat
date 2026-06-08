//! GPU layer effects for the native compositor.
//!
//! This is intentionally independent from the Pixi/Web renderer. Each effect is
//! a wgpu compute pass over a texture, so the same code path can be used by the
//! native monitor and export.

use anyhow::{anyhow, Result};
use bytemuck::{Pod, Zeroable};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::Arc;
use vello::peniko::ImageData;

use super::gpu_utils::image_pixels_rgba8;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum EffectSpec {
    GaussianBlur {
        radius: f32,
    },
    Brightness {
        value: f32,
    },
    Contrast {
        value: f32,
    },
    Saturation {
        value: f32,
    },
    Hue {
        degrees: f32,
    },
    Levels {
        in_black: f32,
        in_white: f32,
        gamma: f32,
        out_black: f32,
        out_white: f32,
    },
    ChromaKey {
        key_rgba: [u8; 4],
        threshold: f32,
        smoothness: f32,
    },
    Sharpen {
        amount: f32,
    },
    Pixelate {
        size: f32,
    },
    Bloom {
        threshold: f32,
        strength: f32,
        radius: f32,
    },
    Vignette {
        strength: f32,
        radius: f32,
        softness: f32,
    },
    Noise {
        amount: f32,
        seed: u32,
    },
    ChromaticAberration {
        amount: f32,
        angle_deg: f32,
    },
    /// Arbitrary WGSL. Not executed by the built-in pipeline yet; keep the
    /// serialized contract available for future plugin-style effects.
    CustomWgsl {
        source: String,
        params: serde_json::Value,
    },
}

#[repr(C)]
#[derive(Clone, Copy, Default, Pod, Zeroable)]
struct EffectUniform {
    mode: u32,
    width: u32,
    height: u32,
    seed: u32,
    p0: f32,
    p1: f32,
    p2: f32,
    p3: f32,
    p4: f32,
    p5: f32,
    p6: f32,
    p7: f32,
}

#[derive(Clone)]
struct EffectPass {
    uniform: EffectUniform,
    custom_source: Option<String>,
}

pub enum EffectSource {
    Cpu(ImageData),
    Gpu(Arc<wgpu::Texture>),
}

struct CachedResources {
    width: u32,
    height: u32,
    input: Option<wgpu::Texture>,
    // Текстуры держим как канонических владельцев; пассы пишут/читают через *_view.
    // Финальный пасс теперь целится в отдельную owned-текстуру (см. `apply_effects`),
    // поэтому сами `ping`/`pong` напрямую больше не читаются — только их вью.
    #[allow(dead_code)]
    ping: wgpu::Texture,
    ping_view: wgpu::TextureView,
    #[allow(dead_code)]
    pong: wgpu::Texture,
    pong_view: wgpu::TextureView,
}

/// Запись пула owned-выходов эффектов. Текстура отдаётся вызывающему как
/// `Arc`, а пул держит свой клон — когда `strong_count` падает до 1 (остался
/// только пул), кадр-потребитель уже освободил её и текстуру можно переиспользовать.
struct PooledTexture {
    texture: Arc<wgpu::Texture>,
    view: wgpu::TextureView,
    width: u32,
    height: u32,
}

/// Пул owned-текстур для финального выхода эффектов. Раньше на КАЖДЫЙ слой с
/// эффектами на КАЖДЫЙ кадр делался `device.create_texture` (+ view) — постоянное
/// давление на GPU-аллокатор и фрагментация. Пул возвращает свободную текстуру
/// нужного размера (reclaim по `Arc::strong_count == 1`) или создаёт новую.
#[derive(Default)]
struct OwnedTexturePool {
    entries: Vec<PooledTexture>,
}

impl OwnedTexturePool {
    fn acquire(
        &mut self,
        device: &wgpu::Device,
        width: u32,
        height: u32,
    ) -> (Arc<wgpu::Texture>, wgpu::TextureView) {
        // Свободная (никто кроме пула не держит) текстура точного размера — переиспользуем.
        if let Some(entry) = self
            .entries
            .iter()
            .find(|e| e.width == width && e.height == height && Arc::strong_count(&e.texture) == 1)
        {
            return (entry.texture.clone(), entry.view.clone());
        }

        // Промах: выкидываем свободные записи другого размера, чтобы пул не рос
        // монотонно после смены разрешения (preview ↔ export, ресайз окна).
        self.entries.retain(|e| {
            Arc::strong_count(&e.texture) > 1 || (e.width == width && e.height == height)
        });

        let texture = Arc::new(device.create_texture(&wgpu::TextureDescriptor {
            label: Some("native-effect-owned-output"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::STORAGE_BINDING,
            view_formats: &[],
        }));
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        self.entries.push(PooledTexture {
            texture: texture.clone(),
            view: view.clone(),
            width,
            height,
        });
        (texture, view)
    }
}

pub struct EffectPipeline {
    bind_layout: wgpu::BindGroupLayout,
    pipeline: Arc<wgpu::ComputePipeline>,
    resources: Option<CachedResources>,
    pipeline_cache: Option<wgpu::PipelineCache>,
    custom_pipelines: HashMap<u64, Arc<wgpu::ComputePipeline>>,
    /// Один постоянный uniform-буфер на все пассы кадра: пассы адресуются через
    /// dynamic offset (`uniform_stride`), значения пишутся одним `write_buffer`.
    /// Раньше каждый пасс делал `create_buffer_init` — аллокация в горячем цикле.
    uniform_buffer: Option<wgpu::Buffer>,
    uniform_capacity: u64,
    uniform_stride: u64,
    owned_pool: OwnedTexturePool,
}

impl EffectPipeline {
    pub fn new(device: &wgpu::Device, cache: Option<&wgpu::PipelineCache>) -> Self {
        let bind_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("native-effect-bind-layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::StorageTexture {
                        access: wgpu::StorageTextureAccess::WriteOnly,
                        format: wgpu::TextureFormat::Rgba8Unorm,
                        view_dimension: wgpu::TextureViewDimension::D2,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: true,
                        min_binding_size: wgpu::BufferSize::new(
                            std::mem::size_of::<EffectUniform>() as u64,
                        ),
                    },
                    count: None,
                },
                // Secondary input for bloom compose / custom effects.
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
            ],
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("native-effect-wgsl"),
            source: wgpu::ShaderSource::Wgsl(Cow::Borrowed(EFFECT_SHADER)),
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("native-effect-pipeline-layout"),
            bind_group_layouts: &[Some(&bind_layout)],
            immediate_size: 0,
        });
        let pipeline = Arc::new(
            device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some("native-effect-pipeline"),
                layout: Some(&pipeline_layout),
                module: &shader,
                entry_point: Some("main"),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                cache,
            }),
        );
        // Шаг между uniform'ами пассов в общем буфере: размер uniform'а,
        // выровненный до `min_uniform_buffer_offset_alignment` (требование dynamic offset).
        let uniform_size = std::mem::size_of::<EffectUniform>() as u64;
        let align = device.limits().min_uniform_buffer_offset_alignment.max(1) as u64;
        let uniform_stride = uniform_size.div_ceil(align) * align;
        Self {
            bind_layout,
            pipeline,
            resources: None,
            pipeline_cache: cache.cloned(),
            custom_pipelines: HashMap::new(),
            uniform_buffer: None,
            uniform_capacity: 0,
            uniform_stride,
            owned_pool: OwnedTexturePool::default(),
        }
    }

    /// Гарантирует, что постоянный uniform-буфер вмещает `pass_count` пассов.
    /// Растёт по мере надобности; стабильные цепочки эффектов аллокаций не делают.
    fn ensure_uniform_buffer(&mut self, device: &wgpu::Device, pass_count: usize) {
        let needed = self.uniform_stride * pass_count.max(1) as u64;
        if self.uniform_buffer.is_some() && self.uniform_capacity >= needed {
            return;
        }
        self.uniform_buffer = Some(device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("native-effect-uniform-ring"),
            size: needed,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        }));
        self.uniform_capacity = needed;
    }

    fn get_or_create_custom_pipeline(
        &mut self,
        device: &wgpu::Device,
        shader_source: &str,
    ) -> Result<Arc<wgpu::ComputePipeline>> {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        shader_source.hash(&mut hasher);
        let key = hasher.finish();
        if !self.custom_pipelines.contains_key(&key) {
            let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("native-effect-custom-wgsl"),
                source: wgpu::ShaderSource::Wgsl(shader_source.into()),
            });
            let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("native-effect-custom-pipeline-layout"),
                bind_group_layouts: &[Some(&self.bind_layout)],
                immediate_size: 0,
            });
            let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some("native-effect-custom-pipeline"),
                layout: Some(&pipeline_layout),
                module: &shader,
                entry_point: Some("main"),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                cache: self.pipeline_cache.as_ref(),
            });
            self.custom_pipelines.insert(key, Arc::new(pipeline));
        }
        self.custom_pipelines
            .get(&key)
            .cloned()
            .ok_or_else(|| anyhow!("custom effect pipeline missing after insertion"))
    }

    fn ensure_resources(
        &mut self,
        device: &wgpu::Device,
        width: u32,
        height: u32,
        need_input: bool,
    ) {
        let mut recreate = true;
        if let Some(res) = &self.resources {
            if res.width >= width && res.height >= height && (!need_input || res.input.is_some()) {
                recreate = false;
            }
            // Shrink if the cached texture is more than 2x larger than needed
            // to avoid monotonic GPU memory growth after resolution changes.
            if !recreate && (res.width > width * 2 || res.height > height * 2) {
                recreate = true;
            }
        }

        if recreate {
            let new_w = width.max(1);
            let new_h = height.max(1);
            let new_size = wgpu::Extent3d {
                width: new_w,
                height: new_h,
                depth_or_array_layers: 1,
            };

            let usage = wgpu::TextureUsages::COPY_DST
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::STORAGE_BINDING;

            let input = if need_input {
                Some(device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("native-effect-cached-input"),
                    size: new_size,
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                    usage,
                    view_formats: &[],
                }))
            } else {
                None
            };

            let ping = device.create_texture(&wgpu::TextureDescriptor {
                label: Some("native-effect-cached-ping"),
                size: new_size,
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage,
                view_formats: &[],
            });
            let ping_view = ping.create_view(&wgpu::TextureViewDescriptor::default());

            let pong = device.create_texture(&wgpu::TextureDescriptor {
                label: Some("native-effect-cached-pong"),
                size: new_size,
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage,
                view_formats: &[],
            });
            let pong_view = pong.create_view(&wgpu::TextureViewDescriptor::default());

            self.resources = Some(CachedResources {
                width: new_w,
                height: new_h,
                input,
                ping,
                ping_view,
                pong,
                pong_view,
            });
        }
    }

    pub fn apply_effects(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        source: &EffectSource,
        effects: &[EffectSpec],
    ) -> Result<Arc<wgpu::Texture>> {
        let (width, height) = match source {
            EffectSource::Cpu(img) => (img.width, img.height),
            EffectSource::Gpu(tex) => (tex.width(), tex.height()),
        };

        let passes = build_passes(effects, width, height);
        if passes.is_empty() {
            return source_to_owned_texture(device, queue, source, width, height);
        }
        if width == 0 || height == 0 {
            return source_to_owned_texture(device, queue, source, width.max(1), height.max(1));
        }

        let need_input = matches!(source, EffectSource::Cpu(_));
        self.ensure_resources(device, width, height, need_input);

        let resources = self
            .resources
            .as_ref()
            .ok_or_else(|| anyhow!("effect resources not initialized"))?;

        let input_view = match source {
            EffectSource::Cpu(img) => {
                let pixels = image_pixels_rgba8(img)?;
                let size = wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                };
                let input_tex = resources
                    .input
                    .as_ref()
                    .ok_or_else(|| anyhow!("effect input texture missing"))?;
                queue.write_texture(
                    wgpu::TexelCopyTextureInfo {
                        texture: input_tex,
                        mip_level: 0,
                        origin: wgpu::Origin3d::ZERO,
                        aspect: wgpu::TextureAspect::All,
                    },
                    &pixels,
                    wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(width * 4),
                        rows_per_image: Some(height),
                    },
                    size,
                );
                input_tex.create_view(&wgpu::TextureViewDescriptor {
                    label: Some("native-effect-input-view"),
                    base_mip_level: 0,
                    mip_level_count: Some(1),
                    base_array_layer: 0,
                    array_layer_count: Some(1),
                    ..Default::default()
                })
            }
            EffectSource::Gpu(tex) => tex.create_view(&wgpu::TextureViewDescriptor::default()),
        };
        let ping_view = resources.ping_view.clone();
        let pong_view = resources.pong_view.clone();
        // `resources` (immutable borrow of self) больше не нужен — дальше идут
        // мутабельные вызовы (uniform-буфер, пул owned-текстур).

        // Финальный результат пишем сразу в owned-текстуру, а не в кешированную ping/pong
        // с последующей копией: раньше `copy_texture_owned` делал лишний полнокадровый
        // GPU→GPU копи на каждый слой с эффектами на каждый кадр. Последний пасс целится
        // прямо в эту текстуру; промежуточные по-прежнему пинг-понгуют по кешу.
        // Текстуру берём из пула (reclaim по strong_count), а не аллоцируем каждый кадр.
        let (owned, owned_view) = self.owned_pool.acquire(device, width, height);

        // Все uniform'ы пассов — в один постоянный буфер; пассы адресуются dynamic offset'ом.
        self.ensure_uniform_buffer(device, passes.len());
        let stride = self.uniform_stride as usize;
        let mut staging = vec![0u8; stride * passes.len()];
        for (i, pass) in passes.iter().enumerate() {
            let bytes = bytemuck::bytes_of(&pass.uniform);
            staging[i * stride..i * stride + bytes.len()].copy_from_slice(bytes);
        }
        {
            let uniform_buffer = self
                .uniform_buffer
                .as_ref()
                .ok_or_else(|| anyhow!("effect uniform buffer not initialized"))?;
            queue.write_buffer(uniform_buffer, 0, &staging);
        }
        let uniform_size = wgpu::BufferSize::new(std::mem::size_of::<EffectUniform>() as u64);

        let last_index = passes.len() - 1;
        let mut last_is_ping = false;
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("native-effect-encoder"),
        });

        for (index, pass) in passes.iter().enumerate() {
            let uniform_offset = (index as u64 * self.uniform_stride) as u32;
            let source_view = if index == 0 {
                &input_view
            } else if last_is_ping {
                &ping_view
            } else {
                &pong_view
            };
            // Промежуточный таргет в пинг-понг-кеше; на последнем пассе пишем в owned.
            let intermediate_target = if index == 0 || !last_is_ping {
                &ping_view
            } else {
                &pong_view
            };
            let target_view = if index == last_index {
                &owned_view
            } else {
                intermediate_target
            };
            // Bloom compose (mode 18) reads original via input_tex and blurred bloom
            // via secondary_tex; for all other passes secondary_tex is bound to the
            // original source (unused in shader).
            let is_compose = pass.uniform.mode == 18;
            let (bind_src, bind_secondary) = if is_compose {
                (&input_view, source_view)
            } else {
                (source_view, &input_view)
            };
            // Сначала разрешаем pipeline (&mut self для кеша кастомных шейдеров),
            // затем берём иммутабельную ссылку на постоянный uniform-буфер.
            let pipeline = if let Some(ref src) = pass.custom_source {
                self.get_or_create_custom_pipeline(device, src)?
            } else {
                Arc::clone(&self.pipeline)
            };
            let uniform_buffer = self
                .uniform_buffer
                .as_ref()
                .ok_or_else(|| anyhow!("effect uniform buffer not initialized"))?;
            let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("native-effect-bind-group"),
                layout: &self.bind_layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(bind_src),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::TextureView(target_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                            buffer: uniform_buffer,
                            offset: 0,
                            size: uniform_size,
                        }),
                    },
                    wgpu::BindGroupEntry {
                        binding: 3,
                        resource: wgpu::BindingResource::TextureView(bind_secondary),
                    },
                ],
            });
            {
                let mut cpass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                    label: Some("native-effect-pass"),
                    timestamp_writes: None,
                });
                cpass.set_pipeline(&pipeline);
                cpass.set_bind_group(0, &bind_group, &[uniform_offset]);
                cpass.dispatch_workgroups(width.div_ceil(8), height.div_ceil(8), 1);
            }
            last_is_ping = index == 0 || !last_is_ping;
        }

        queue.submit([encoder.finish()]);
        Ok(owned)
    }
}

/// Множитель для пространственных параметров эффектов (blur radius, pixelate size,
/// chromatic aberration, …), задаваемых пользователем в «пикселях @1080p». Текстура
/// эффекта = кадр в его реальном разрешении (preview-scaled или export full-res),
/// поэтому без нормировки одинаковый radius давал РАЗНЫЙ визуальный масштаб в preview
/// и в экспорте. Нормируем к высоте 1080 → эффект становится фиксированной долей кадра
/// и совпадает между preview/export и между разными разрешениями источника.
fn spatial_scale(height: u32) -> f32 {
    (height as f32 / 1080.0).clamp(0.1, 8.0)
}

/// Верхняя граница радиуса гауссова размытия. Совпадает с клампом в шейдере
/// (`sample_blur_h/v`), чтобы значения из UI не упирались в «тихий потолок».
const MAX_BLUR_RADIUS: f32 = 64.0;

fn build_passes(effects: &[EffectSpec], width: u32, height: u32) -> Vec<EffectPass> {
    let scale = spatial_scale(height);
    let mut passes = Vec::new();
    for effect in effects {
        match *effect {
            EffectSpec::GaussianBlur { radius } => {
                let clamped_r = (radius * scale).clamp(0.0, MAX_BLUR_RADIUS);
                if clamped_r > 0.0 {
                    // Pass 1: Horizontal Blur (mode 4)
                    passes.push(EffectPass {
                        uniform: EffectUniform {
                            mode: 4,
                            width,
                            height,
                            seed: 0,
                            p0: clamped_r,
                            ..Default::default()
                        },
                        custom_source: None,
                    });
                    // Pass 2: Vertical Blur (mode 14)
                    passes.push(EffectPass {
                        uniform: EffectUniform {
                            mode: 14,
                            width,
                            height,
                            seed: 0,
                            p0: clamped_r,
                            ..Default::default()
                        },
                        custom_source: None,
                    });
                }
            }
            EffectSpec::Bloom {
                threshold,
                strength,
                radius,
            } => {
                let clamped_r = (radius * scale).clamp(0.0, 16.0);
                if clamped_r > 0.0 {
                    passes.push(EffectPass {
                        uniform: EffectUniform {
                            mode: 15,
                            width,
                            height,
                            seed: 0,
                            p0: threshold.clamp(0.0, 1.0),
                            ..Default::default()
                        },
                        custom_source: None,
                    });
                    passes.push(EffectPass {
                        uniform: EffectUniform {
                            mode: 4,
                            width,
                            height,
                            seed: 0,
                            p0: clamped_r,
                            ..Default::default()
                        },
                        custom_source: None,
                    });
                    passes.push(EffectPass {
                        uniform: EffectUniform {
                            mode: 14,
                            width,
                            height,
                            seed: 0,
                            p0: clamped_r,
                            ..Default::default()
                        },
                        custom_source: None,
                    });
                    passes.push(EffectPass {
                        uniform: EffectUniform {
                            mode: 18,
                            width,
                            height,
                            seed: 0,
                            p0: 0.0,
                            p1: strength.clamp(0.0, 2.0),
                            ..Default::default()
                        },
                        custom_source: None,
                    });
                }
            }
            _ => {
                if let Some(pass) = effect_to_pass(effect, width, height) {
                    passes.push(pass);
                }
            }
        }
    }
    passes
}

fn effect_to_pass(effect: &EffectSpec, width: u32, height: u32) -> Option<EffectPass> {
    let scale = spatial_scale(height);
    let base = |mode, p0, p1, p2, p3, p4, p5, seed| EffectPass {
        uniform: EffectUniform {
            mode,
            width,
            height,
            seed,
            p0,
            p1,
            p2,
            p3,
            p4,
            p5,
            p6: 0.0,
            p7: 0.0,
        },
        custom_source: None,
    };
    match effect {
        EffectSpec::Brightness { value } => {
            Some(base(1, value.clamp(0.0, 2.0), 0.0, 0.0, 0.0, 0.0, 0.0, 0))
        }
        EffectSpec::Contrast { value } => {
            Some(base(2, value.clamp(0.0, 2.0), 0.0, 0.0, 0.0, 0.0, 0.0, 0))
        }
        EffectSpec::Saturation { value } => {
            Some(base(3, value.clamp(0.0, 2.0), 0.0, 0.0, 0.0, 0.0, 0.0, 0))
        }
        EffectSpec::GaussianBlur { .. } => None, // Handled in build_passes
        EffectSpec::Sharpen { amount } => {
            Some(base(5, amount.clamp(0.0, 1.0), 0.0, 0.0, 0.0, 0.0, 0.0, 0))
        }
        EffectSpec::Pixelate { size } => Some(base(
            6,
            (size * scale).clamp(1.0, 256.0),
            0.0,
            0.0,
            0.0,
            0.0,
            0.0,
            0,
        )),
        EffectSpec::Bloom { .. } => None, // Handled in build_passes
        EffectSpec::Vignette {
            strength,
            radius,
            softness,
        } => Some(base(
            8,
            strength.clamp(0.0, 1.0),
            radius.clamp(0.0, 1.0),
            softness.clamp(0.001, 1.0),
            0.0,
            0.0,
            0.0,
            0,
        )),
        EffectSpec::Noise { amount, seed } => Some(base(
            9,
            amount.clamp(0.0, 1.0),
            0.0,
            0.0,
            0.0,
            0.0,
            0.0,
            *seed,
        )),
        EffectSpec::ChromaticAberration { amount, angle_deg } => Some(base(
            10,
            (amount * scale).clamp(0.0, 80.0),
            *angle_deg,
            0.0,
            0.0,
            0.0,
            0.0,
            0,
        )),
        EffectSpec::Hue { degrees } => Some(base(11, *degrees, 0.0, 0.0, 0.0, 0.0, 0.0, 0)),
        EffectSpec::Levels {
            in_black,
            in_white,
            gamma,
            out_black,
            out_white,
        } => Some(base(
            12,
            in_black.clamp(0.0, 1.0),
            in_white.clamp(0.001, 1.0),
            gamma.clamp(0.01, 8.0),
            out_black.clamp(0.0, 1.0),
            out_white.clamp(0.0, 1.0),
            0.0,
            0,
        )),
        EffectSpec::ChromaKey {
            key_rgba,
            threshold,
            smoothness,
        } => Some(base(
            13,
            key_rgba[0] as f32 / 255.0,
            key_rgba[1] as f32 / 255.0,
            key_rgba[2] as f32 / 255.0,
            threshold.clamp(0.0, 1.0),
            smoothness.clamp(0.0001, 1.0),
            0.0,
            0,
        )),
        EffectSpec::CustomWgsl { source, params } => {
            let mut p = [0.0f32; 8];
            if let serde_json::Value::Object(map) = params {
                for (i, pi) in p.iter_mut().enumerate() {
                    let key = format!("p{}", i);
                    if let Some(v) = map.get(&key).and_then(|v| v.as_f64()) {
                        *pi = v as f32;
                    }
                }
            }
            Some(EffectPass {
                uniform: EffectUniform {
                    mode: 0,
                    width,
                    height,
                    seed: 0,
                    p0: p[0],
                    p1: p[1],
                    p2: p[2],
                    p3: p[3],
                    p4: p[4],
                    p5: p[5],
                    p6: p[6],
                    p7: p[7],
                },
                custom_source: Some(source.clone()),
            })
        }
    }
}

fn source_to_owned_texture(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    source: &EffectSource,
    width: u32,
    height: u32,
) -> Result<Arc<wgpu::Texture>> {
    match source {
        EffectSource::Cpu(img) => {
            let texture = device.create_texture(&wgpu::TextureDescriptor {
                label: Some("native-effect-owned-cpu-source"),
                size: wgpu::Extent3d {
                    width,
                    height,
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
            let pixels = image_pixels_rgba8(img)?;
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
                    bytes_per_row: Some(width * 4),
                    rows_per_image: Some(height),
                },
                wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                },
            );
            Ok(Arc::new(texture))
        }
        EffectSource::Gpu(texture) => Ok(texture.clone()),
    }
}

const EFFECT_SHADER: &str = r#"
struct EffectUniform {
    mode: u32,
    width: u32,
    height: u32,
    seed: u32,
    p0: f32,
    p1: f32,
    p2: f32,
    p3: f32,
    p4: f32,
    p5: f32,
    p6: f32,
    p7: f32,
};

@group(0) @binding(0) var input_tex: texture_2d<f32>;
@group(0) @binding(1) var output_tex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> effect: EffectUniform;
@group(0) @binding(3) var secondary_tex: texture_2d<f32>;

fn clamp_coord(coord: vec2<i32>) -> vec2<i32> {
    return vec2<i32>(
        clamp(coord.x, 0, i32(effect.width) - 1),
        clamp(coord.y, 0, i32(effect.height) - 1)
    );
}

fn load_px(coord: vec2<i32>) -> vec4<f32> {
    return textureLoad(input_tex, clamp_coord(coord), 0);
}

fn load_secondary(coord: vec2<i32>) -> vec4<f32> {
    return textureLoad(secondary_tex, clamp_coord(coord), 0);
}

fn luma(color: vec3<f32>) -> f32 {
    return dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn hash21(p: vec2<f32>) -> f32 {
    let q = fract(vec3<f32>(p.x, p.y, p.x) * vec3<f32>(0.1031, 0.1030, 0.0973));
    let r = q + dot(q, q.yzx + vec3<f32>(33.33));
    return fract((r.x + r.y) * r.z);
}

fn rotate_hue(color: vec3<f32>, degrees: f32) -> vec3<f32> {
    let angle = degrees * 0.017453292519943295;
    let s = sin(angle);
    let c = cos(angle);
    let k = vec3<f32>(0.57735026919);
    return color * c + cross(k, color) * s + k * dot(k, color) * (1.0 - c);
}

fn sample_blur_h(coord: vec2<i32>, radius: f32) -> vec4<f32> {
    let r = i32(clamp(round(radius), 0.0, 64.0));
    if (r == 0) {
        return load_px(coord);
    }
    var sum = vec4<f32>(0.0);
    var weight_sum = 0.0;
    let sigma = max(radius * 0.5, 1.0);
    let double_sigma_sq = 2.0 * sigma * sigma;
    for (var x = -r; x <= r; x = x + 1) {
        let dist = f32(x * x);
        let w = exp(-dist / double_sigma_sq);
        sum += load_px(coord + vec2<i32>(x, 0)) * w;
        weight_sum += w;
    }
    return sum / max(weight_sum, 0.0001);
}

fn sample_blur_v(coord: vec2<i32>, radius: f32) -> vec4<f32> {
    let r = i32(clamp(round(radius), 0.0, 64.0));
    if (r == 0) {
        return load_px(coord);
    }
    var sum = vec4<f32>(0.0);
    var weight_sum = 0.0;
    let sigma = max(radius * 0.5, 1.0);
    let double_sigma_sq = 2.0 * sigma * sigma;
    for (var y = -r; y <= r; y = y + 1) {
        let dist = f32(y * y);
        let w = exp(-dist / double_sigma_sq);
        sum += load_px(coord + vec2<i32>(0, y)) * w;
        weight_sum += w;
    }
    return sum / max(weight_sum, 0.0001);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= effect.width || gid.y >= effect.height) {
        return;
    }
    let coord = vec2<i32>(i32(gid.x), i32(gid.y));
    let uv = vec2<f32>(f32(gid.x) / max(f32(effect.width - 1u), 1.0), f32(gid.y) / max(f32(effect.height - 1u), 1.0));
    var color = load_px(coord);

    switch effect.mode {
        case 1u: {
            color = vec4<f32>(color.rgb * effect.p0, color.a);
        }
        case 2u: {
            color = vec4<f32>((color.rgb - vec3<f32>(0.5)) * effect.p0 + vec3<f32>(0.5), color.a);
        }
        case 3u: {
            let gray = vec3<f32>(luma(color.rgb));
            color = vec4<f32>(mix(gray, color.rgb, effect.p0), color.a);
        }
        case 4u: {
            color = sample_blur_h(coord, effect.p0);
        }
        case 5u: {
            let center = load_px(coord);
            let neighbors = load_px(coord + vec2<i32>(1, 0)) + load_px(coord + vec2<i32>(-1, 0)) + load_px(coord + vec2<i32>(0, 1)) + load_px(coord + vec2<i32>(0, -1));
            color = vec4<f32>(center.rgb + (center.rgb * 4.0 - neighbors.rgb) * effect.p0, center.a);
        }
        case 6u: {
            let size = max(effect.p0, 1.0);
            let px = vec2<i32>(i32(floor(f32(gid.x) / size) * size), i32(floor(f32(gid.y) / size) * size));
            color = load_px(px);
        }
        case 8u: {
            let d = distance(uv, vec2<f32>(0.5, 0.5));
            let mask = smoothstep(effect.p1, effect.p1 + effect.p2, d);
            color = vec4<f32>(color.rgb * (1.0 - mask * effect.p0), color.a);
        }
        case 9u: {
            let n = hash21(vec2<f32>(f32(gid.x) + f32(effect.seed), f32(gid.y) - f32(effect.seed)));
            color = vec4<f32>(color.rgb + (n - 0.5) * effect.p0, color.a);
        }
        case 10u: {
            let angle = effect.p1 * 0.017453292519943295;
            let offset = vec2<i32>(i32(round(cos(angle) * effect.p0)), i32(round(sin(angle) * effect.p0)));
            let r = load_px(coord + offset).r;
            let g = color.g;
            let b = load_px(coord - offset).b;
            color = vec4<f32>(r, g, b, color.a);
        }
        case 11u: {
            color = vec4<f32>(rotate_hue(color.rgb, effect.p0), color.a);
        }
        case 12u: {
            let in_black = effect.p0;
            let in_white = effect.p1;
            let gamma = effect.p2;
            let out_black = effect.p3;
            let out_white = effect.p4;
            let normalized = clamp((color.rgb - vec3<f32>(in_black)) / max(in_white - in_black, 0.001), vec3<f32>(0.0), vec3<f32>(1.0));
            color = vec4<f32>(mix(vec3<f32>(out_black), vec3<f32>(out_white), pow(normalized, vec3<f32>(1.0 / gamma))), color.a);
        }
        case 13u: {
            let key = vec3<f32>(effect.p0, effect.p1, effect.p2);
            let threshold = effect.p3;
            let smoothness = effect.p4;
            let diff = distance(color.rgb, key);
            color = vec4<f32>(color.rgb, color.a * smoothstep(threshold, threshold + smoothness, diff));
        }
        case 14u: {
            color = sample_blur_v(coord, effect.p0);
        }
        case 15u: {
            let bright = smoothstep(effect.p0, 1.0, luma(color.rgb));
            color = vec4<f32>(color.rgb * bright, 1.0);
        }
        case 18u: {
            // input_tex = оригинальный кадр (bind_src), secondary_tex = размытая
            // яркая маска (bind_secondary). Bloom = оригинал + glow * strength;
            // раньше слагаемые были перепутаны (база — размытие, оригинал слабым
            // множителем), из-за чего кадр получался размыто-засвеченным.
            let orig = color;
            let bloom = load_secondary(coord);
            color = vec4<f32>(orig.rgb + bloom.rgb * effect.p1, orig.a);
        }
        default: {}
    }

    textureStore(output_tex, coord, clamp(color, vec4<f32>(0.0), vec4<f32>(1.0)));
}
"#;

#[cfg(test)]
mod tests {
    use super::*;
    use vello::peniko::{Blob, ImageAlphaType, ImageFormat};

    #[test]
    fn build_passes_includes_custom_wgsl() {
        let passes = build_passes(
            &[
                EffectSpec::Brightness { value: 1.2 },
                EffectSpec::CustomWgsl {
                    source: "x".into(),
                    params: serde_json::Value::Null,
                },
            ],
            1920,
            1080,
        );
        assert_eq!(passes.len(), 2);
        assert_eq!(passes[0].uniform.mode, 1);
        assert_eq!(passes[1].uniform.mode, 0);
        assert_eq!(passes[1].custom_source, Some("x".into()));
    }

    #[test]
    fn bgra_image_pixels_are_converted_to_rgba() {
        let image = ImageData {
            data: Blob::new(Arc::new(vec![1, 2, 3, 4])),
            format: ImageFormat::Bgra8,
            alpha_type: ImageAlphaType::Alpha,
            width: 1,
            height: 1,
        };

        assert_eq!(image_pixels_rgba8(&image).unwrap(), vec![3, 2, 1, 4]);
    }

    #[test]
    fn build_passes_gaussian_blur_splits_to_h_and_v() {
        let passes = build_passes(&[EffectSpec::GaussianBlur { radius: 10.0 }], 1920, 1080);
        assert_eq!(passes.len(), 2);
        assert_eq!(passes[0].uniform.mode, 4); // Horizontal
        assert_eq!(passes[1].uniform.mode, 14); // Vertical
        assert_eq!(passes[0].uniform.p0, 10.0);
        assert_eq!(passes[1].uniform.p0, 10.0);
    }

    #[test]
    fn build_passes_bloom_uses_separable_pipeline() {
        let passes = build_passes(
            &[EffectSpec::Bloom {
                threshold: 0.75,
                strength: 0.6,
                radius: 12.0,
            }],
            1920,
            1080,
        );
        assert_eq!(passes.len(), 4);
        assert_eq!(passes[0].uniform.mode, 15); // extract
        assert_eq!(passes[1].uniform.mode, 4); // blur_h
        assert_eq!(passes[2].uniform.mode, 14); // blur_v
        assert_eq!(passes[3].uniform.mode, 18); // compose
        assert_eq!(passes[3].uniform.p1, 0.6);
    }
}
