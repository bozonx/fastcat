//! GPU layer effects for the native compositor.
//!
//! This is intentionally independent from the Pixi/Web renderer. Each effect is
//! a wgpu compute pass over a texture, so the same code path can be used by the
//! native monitor and export.

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::Arc;
use vello::peniko::ImageData;

use super::gpu_utils::{create_rgba8_texture, image_pixels_rgba8};

mod passes;
use passes::{
    build_blur_fill_passes, build_passes, calculate_padding, spatial_scale, Buf, EffectUniform,
};

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/types/generated/native-monitor/")]
pub enum EffectQuality {
    Low,
    Medium,
    High,
    #[default]
    Ultra,
}

impl EffectQuality {
    fn tap_budget(self) -> f32 {
        match self {
            Self::Low => 8.0,
            Self::Medium => 16.0,
            Self::High => 32.0,
            Self::Ultra => 48.0,
        }
    }
}

// ts-rs mirrors this tagged enum to the frontend as `VideoEffectSpec`
// (`src/types/generated/native-monitor/VideoEffectSpec.ts`). It is the single
// cross-backend contract: frontend manifests (`toEffectSpecs`) emit it and both
// the native wgpu compositor and the web WebGPU compute runner consume it.

fn default_mix() -> f32 {
    1.0
}

/// Default soft-knee width for legacy bloom specs saved before `knee` existed.
/// Approximates the old fixed `smoothstep(threshold, 1.0)` softness.
fn default_bloom_knee() -> f32 {
    0.5
}

/// Default background blur radius (px @1080p) for the blur-fill effect.
fn default_blur_fill_blur() -> f32 {
    40.0
}

/// Default blur-fill tint colour (black; only matters once `tint_strength` > 0).
fn default_tint_color() -> [u8; 4] {
    [0, 0, 0, 255]
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(tag = "type", rename_all = "kebab-case")]
#[ts(
    export,
    export_to = "../../src/types/generated/native-monitor/",
    rename = "VideoEffectSpec",
    rename_all = "kebab-case"
)]
pub enum EffectSpec {
    GaussianBlur {
        radius: f32,
        /// When true, the frame is padded so the blur can bleed past the
        /// original rectangle into transparency — needed for PNGs / cutouts to
        /// blur "off the edge" naturally. When false (the default), no padding
        /// is added and the blur clamps to the frame edges, so opaque video
        /// keeps a full-bleed, crisp border instead of darkening/fading.
        #[serde(default)]
        bleed: bool,
        #[serde(default)]
        blur_type: String,
        #[serde(default = "default_mix")]
        mix: f32,
    },
    /// Internal compositor-space blur. Unlike `GaussianBlur`, the radius is
    /// already expressed in the target texture's pixels and is not normalized
    /// against the frame height.
    GaussianBlurPixels {
        radius: f32,
        #[serde(default = "default_mix")]
        mix: f32,
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
        #[serde(default = "default_mix")]
        mix: f32,
    },
    ChromaKey {
        key_rgba: [u8; 4],
        threshold: f32,
        smoothness: f32,
    },
    Sharpen {
        amount: f32,
        #[serde(default = "default_mix")]
        mix: f32,
    },
    Pixelate {
        size: f32,
        #[serde(default = "default_mix")]
        mix: f32,
    },
    Bloom {
        threshold: f32,
        strength: f32,
        radius: f32,
        #[serde(default = "default_bloom_knee")]
        knee: f32,
        #[serde(default = "default_mix")]
        mix: f32,
    },
    Vignette {
        strength: f32,
        radius: f32,
        softness: f32,
        #[serde(default = "default_mix")]
        mix: f32,
    },
    Noise {
        amount: f32,
        seed: u32,
        #[serde(default)]
        noise_type: String,
        #[serde(default)]
        scale: f32,
        #[serde(default = "default_mix")]
        mix: f32,
    },
    ChromaticAberration {
        amount: f32,
        angle_deg: f32,
        #[serde(default = "default_mix")]
        mix: f32,
    },
    ColorTone {
        color_rgba: [u8; 4],
        amount: f32,
        #[serde(default)]
        blend_mode: String,
        #[serde(default)]
        preserve_luminance: bool,
        #[serde(default)]
        range: String,
    },
    /// Blur-fill / blurred-background reframe (industry "blur fill"): show a
    /// vertical video in a landscape frame (or vice versa) by filling the frame
    /// with a cover-scaled, blurred copy of the source and compositing a
    /// contain-fit sharp copy on top. Unlike every other effect this changes the
    /// output to the *project frame* size; the engine resets the layer transform
    /// to fill the frame. Handled by `apply_blur_fill`, not `build_passes`.
    BlurFill {
        /// Foreground (sharp video) scale; 1.0 = contain-fit.
        #[serde(default = "default_mix")]
        fg_scale: f32,
        /// Background zoom on top of cover-fit; 1.0 = just cover the frame.
        #[serde(default = "default_mix")]
        bg_scale: f32,
        /// Background blur radius in px @1080p.
        #[serde(default = "default_blur_fill_blur")]
        blur: f32,
        /// Background brightness multiplier; 1.0 = no dim.
        #[serde(default = "default_mix")]
        bg_dim: f32,
        /// Background saturation; 1.0 = normal, 0 = grayscale.
        #[serde(default = "default_mix")]
        bg_saturation: f32,
        /// Background tint colour (RGBA; alpha ignored). Mixed into the
        /// background by `tint_strength`.
        #[serde(default = "default_tint_color")]
        tint_color: [u8; 4],
        /// Background tint strength; 0 = no tint, 1 = fully the tint colour.
        #[serde(default)]
        tint_strength: f32,
        /// Foreground vertical offset as a fraction of frame height (−0.5..0.5).
        #[serde(default)]
        fg_offset_y: f32,
    },
    /// Arbitrary WGSL. Not executed by the built-in pipeline yet; keep the
    /// serialized contract available for future plugin-style effects.
    CustomWgsl {
        source: String,
        #[ts(type = "Record<string, unknown>")]
        params: serde_json::Value,
    },
}

pub enum EffectSource {
    Cpu(ImageData),
    Gpu(Arc<crate::media::SharedTexture>),
}

impl EffectSource {
    /// Wraps a `wgpu::Texture` into the GPU variant of `EffectSource`.
    /// Eliminates the repeated `Arc::new(SharedTexture::new_shared(Arc::new(texture)))` pattern.
    pub fn from_texture(texture: wgpu::Texture) -> Self {
        EffectSource::Gpu(Arc::new(crate::media::SharedTexture::new_shared(Arc::new(
            texture,
        ))))
    }
}

/// Parameters for the blur-fill effect, extracted from `EffectSpec::BlurFill`.
/// Passed as a single struct to avoid excessive function arguments.
pub struct BlurFillParams {
    pub frame_w: u32,
    pub frame_h: u32,
    pub fg_scale: f32,
    pub bg_scale: f32,
    pub blur: f32,
    pub bg_dim: f32,
    pub bg_saturation: f32,
    pub tint_color: [u8; 4],
    pub tint_strength: f32,
    pub fg_offset_y: f32,
    pub quality: EffectQuality,
}

struct CachedResources {
    width: u32,
    height: u32,
    input: Option<wgpu::Texture>,
    // Textures are kept as canonical owners; passes read/write through *_view.
    // The final pass now targets a separate owned texture (see `apply_effects`),
    // so `ping`/`pong` themselves are no longer read directly — only their views.
    #[allow(dead_code)]
    ping: wgpu::Texture,
    ping_view: wgpu::TextureView,
    #[allow(dead_code)]
    pong: wgpu::Texture,
    pong_view: wgpu::TextureView,
    // Third scratch buffer used by effects that must pin the running image while
    // ping-ponging (bloom). Read/written only through `aux_view`.
    #[allow(dead_code)]
    aux: wgpu::Texture,
    aux_view: wgpu::TextureView,
}

/// Pool entry for owned effect outputs. The texture is given to the caller as
/// `Arc`, and the pool keeps its own clone — when `strong_count` drops to 1 (only
/// the pool remains), the consuming frame has released it and the texture can be reused.
struct PooledTexture {
    texture: Arc<wgpu::Texture>,
    view: wgpu::TextureView,
    width: u32,
    height: u32,
}

/// Pool of owned textures for final effect outputs. Previously, EVERY layer with
/// effects got a `device.create_texture` (+ view) on EVERY frame — constant
/// pressure on the GPU allocator and fragmentation. The pool returns a free texture
/// of the needed size (reclaim via `Arc::strong_count == 1`) or creates a new one.
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
        // A free (only the pool holds it) texture of exact size — reuse it.
        if let Some(entry) = self
            .entries
            .iter()
            .find(|e| e.width == width && e.height == height && Arc::strong_count(&e.texture) == 1)
        {
            return (entry.texture.clone(), entry.view.clone());
        }

        // Miss: evict free entries of a different size so the pool does not grow
        // monotonically after a resolution change (preview ↔ export, window resize).
        self.entries.retain(|e| {
            Arc::strong_count(&e.texture) > 1 || (e.width == width && e.height == height)
        });

        let texture = Arc::new(create_rgba8_texture(
            device,
            "native-effect-owned-output",
            width,
            height,
            wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::STORAGE_BINDING,
        ));
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
    /// One persistent uniform buffer for all passes in a frame: passes are addressed via
    /// dynamic offset (`uniform_stride`), values written with a single `write_buffer`.
    /// Previously each pass did `create_buffer_init` — allocation in the hot loop.
    uniform_buffer: Option<wgpu::Buffer>,
    uniform_capacity: u64,
    uniform_stride: u64,
    owned_pool: OwnedTexturePool,
    /// Linear, clamp-to-edge sampler used by blur / sharpen / chromatic-aberration
    /// for sub-texel sampling. Makes those effects continuous in their parameters
    /// (no integer-pixel quantization) — important for smooth animation.
    sampler: wgpu::Sampler,
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
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
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
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                // Linear clamp-to-edge sampler for sub-texel sampling.
                wgpu::BindGroupLayoutEntry {
                    binding: 4,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
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
        // Stride between pass uniforms in the shared buffer: uniform size
        // aligned to `min_uniform_buffer_offset_alignment` (dynamic offset requirement).
        let uniform_size = std::mem::size_of::<EffectUniform>() as u64;
        let align = device.limits().min_uniform_buffer_offset_alignment.max(1) as u64;
        let uniform_stride = uniform_size.div_ceil(align) * align;
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("native-effect-sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Nearest,
            ..Default::default()
        });
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
            sampler,
        }
    }

    /// Ensures the persistent uniform buffer can hold `pass_count` passes.
    /// Grows as needed; stable effect chains do not cause allocations.
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
        // The scratch textures must match the logical size *exactly*. The blur
        // samples them with normalized UVs (`textureSampleLevel`), which map
        // [0,1] over the texture's full extent — so a cached texture that is
        // merely "big enough" (e.g. left over at the padded size after a `bleed`
        // toggle, or sized by a larger sibling layer) would make the sampler
        // read the wrong region and squish/duplicate the image. Reallocating on
        // an exact-size miss is cheap for the common case (stable frame size
        // never misses) and is the price of correctness for the rare resize.
        let mut recreate = true;
        if let Some(res) = &self.resources {
            if res.width == width && res.height == height && (!need_input || res.input.is_some()) {
                recreate = false;
            }
        }

        if recreate {
            let new_w = width.max(1);
            let new_h = height.max(1);

            let usage = wgpu::TextureUsages::COPY_DST
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::STORAGE_BINDING;

            let input = need_input.then(|| {
                create_rgba8_texture(device, "native-effect-cached-input", new_w, new_h, usage)
            });

            let ping =
                create_rgba8_texture(device, "native-effect-cached-ping", new_w, new_h, usage);
            let ping_view = ping.create_view(&wgpu::TextureViewDescriptor::default());

            let pong =
                create_rgba8_texture(device, "native-effect-cached-pong", new_w, new_h, usage);
            let pong_view = pong.create_view(&wgpu::TextureViewDescriptor::default());

            let aux = create_rgba8_texture(device, "native-effect-cached-aux", new_w, new_h, usage);
            let aux_view = aux.create_view(&wgpu::TextureViewDescriptor::default());

            self.resources = Some(CachedResources {
                width: new_w,
                height: new_h,
                input,
                ping,
                ping_view,
                pong,
                pong_view,
                aux,
                aux_view,
            });
        }
    }

    pub fn apply_effects(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        source: &EffectSource,
        effects: &[EffectSpec],
        enable_padding: bool,
        quality: EffectQuality,
    ) -> Result<(Arc<crate::media::SharedTexture>, u32)> {
        let (orig_width, orig_height) = match source {
            EffectSource::Cpu(img) => (img.width, img.height),
            EffectSource::Gpu(tex) => (tex.width(), tex.height()),
        };

        let scale = spatial_scale(orig_height);
        let padding = if enable_padding {
            calculate_padding(effects, scale)
        } else {
            0
        };

        let width = orig_width + 2 * padding;
        let height = orig_height + 2 * padding;

        let passes = build_passes(effects, width, height, quality);
        if passes.is_empty() {
            let tex = source_to_owned_texture(device, queue, source, orig_width, orig_height)?;
            return Ok((tex, 0));
        }
        if orig_width == 0 || orig_height == 0 {
            let tex = source_to_owned_texture(
                device,
                queue,
                source,
                orig_width.max(1),
                orig_height.max(1),
            )?;
            return Ok((tex, 0));
        }

        let need_input = matches!(source, EffectSource::Cpu(_)) || padding > 0;
        self.ensure_resources(device, width, height, need_input);

        let resources = self
            .resources
            .as_ref()
            .ok_or_else(|| anyhow!("effect resources not initialized"))?;

        // When padding is active the source is written into the *interior* of the
        // (cached, reused) input texture at offset (padding, padding). The border
        // ring around it is never written by the copy, so without an explicit
        // clear it would retain stale pixels from a previous frame — and because
        // the padding amount changes as the radius slider moves, that stale ring
        // shows up as a sharp frame (most visible at the top-left origin). Clear
        // the whole input to transparent black first so the blur/bloom bleed into
        // clean transparency instead of garbage.
        if padding > 0 {
            if let Some(input_tex) = resources.input.as_ref() {
                let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("native-effect-input-clear-encoder"),
                });
                encoder.clear_texture(input_tex, &wgpu::ImageSubresourceRange::default());
                queue.submit(Some(encoder.finish()));
            }
        }

        let input_view = match source {
            EffectSource::Cpu(img) => {
                let pixels = image_pixels_rgba8(img)?;
                let size = wgpu::Extent3d {
                    width: orig_width,
                    height: orig_height,
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
                        origin: wgpu::Origin3d {
                            x: padding,
                            y: padding,
                            z: 0,
                        },
                        aspect: wgpu::TextureAspect::All,
                    },
                    &pixels,
                    wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(orig_width * 4),
                        rows_per_image: Some(orig_height),
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
            EffectSource::Gpu(tex) => {
                if padding > 0 {
                    let input_tex = resources
                        .input
                        .as_ref()
                        .ok_or_else(|| anyhow!("effect input texture missing"))?;
                    let mut encoder =
                        device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
                            label: Some("native-effect-input-copy-encoder"),
                        });
                    encoder.copy_texture_to_texture(
                        wgpu::TexelCopyTextureInfo {
                            texture: &**tex,
                            mip_level: 0,
                            origin: wgpu::Origin3d::ZERO,
                            aspect: wgpu::TextureAspect::All,
                        },
                        wgpu::TexelCopyTextureInfo {
                            texture: input_tex,
                            mip_level: 0,
                            origin: wgpu::Origin3d {
                                x: padding,
                                y: padding,
                                z: 0,
                            },
                            aspect: wgpu::TextureAspect::All,
                        },
                        wgpu::Extent3d {
                            width: orig_width,
                            height: orig_height,
                            depth_or_array_layers: 1,
                        },
                    );
                    queue.submit(Some(encoder.finish()));
                    input_tex.create_view(&wgpu::TextureViewDescriptor::default())
                } else {
                    tex.create_view(&wgpu::TextureViewDescriptor::default())
                }
            }
        };
        let ping_view = resources.ping_view.clone();
        let pong_view = resources.pong_view.clone();
        let aux_view = resources.aux_view.clone();
        // `resources` (immutable borrow of self) is no longer needed — mutable
        // calls follow (uniform buffer, owned texture pool).

        // The final result is written directly to an owned texture, not to a cached
        // ping/pong with a subsequent copy: previously `copy_texture_owned` did an
        // extra full-frame GPU→GPU copy for every layer with effects on every frame.
        // The last pass targets this texture directly; intermediate passes still
        // ping-pong through the cache.
        // The texture is taken from the pool (reclaim by strong_count), not allocated every frame.
        let (owned, owned_view) = self.owned_pool.acquire(device, width, height);

        // All pass uniforms go into one persistent buffer; passes are addressed via dynamic offset.
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

        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("native-effect-encoder"),
        });

        // Explicit buffer routing: each pass declares its src / secondary / dst
        // slots (see `build_passes`). The final pass is routed to `owned`.
        // Inlined (rather than a closure) so the returned references borrow the
        // local views directly without fighting closure lifetime elision.
        macro_rules! view_of {
            ($buf:expr) => {
                match $buf {
                    Buf::Input => &input_view,
                    Buf::Ping => &ping_view,
                    Buf::Pong => &pong_view,
                    Buf::Aux => &aux_view,
                    Buf::Owned => &owned_view,
                }
            };
        }

        for (index, pass) in passes.iter().enumerate() {
            let uniform_offset = (index as u64 * self.uniform_stride) as u32;
            let bind_src: &wgpu::TextureView = view_of!(pass.src);
            let bind_secondary: &wgpu::TextureView = view_of!(pass.secondary);
            let target_view: &wgpu::TextureView = view_of!(pass.dst);
            // First resolve the pipeline (&mut self for custom shader cache),
            // then take an immutable reference to the persistent uniform buffer.
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
                    wgpu::BindGroupEntry {
                        binding: 4,
                        resource: wgpu::BindingResource::Sampler(&self.sampler),
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
        }

        queue.submit([encoder.finish()]);
        Ok((
            Arc::new(crate::media::SharedTexture::new_shared(owned)),
            padding,
        ))
    }

    /// Blur-fill reframe: produce a `frame_w × frame_h` texture that fills the
    /// whole project frame with a cover-scaled, blurred copy of `source` and a
    /// contain-fit sharp copy composited on top (industry "blur fill"). Unlike
    /// `apply_effects` the output size is the *frame*, not the source — the
    /// source is sampled with computed UVs, so the input and output may differ
    /// in size and aspect. The engine resets the layer transform so this output
    /// maps 1:1 onto the frame.
    pub fn apply_blur_fill(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        source: &EffectSource,
        params: &BlurFillParams,
    ) -> Result<Arc<crate::media::SharedTexture>> {
        let (iw, ih) = match source {
            EffectSource::Cpu(img) => (img.width, img.height),
            EffectSource::Gpu(tex) => (tex.width(), tex.height()),
        };
        let frame_w = params.frame_w.max(1);
        let frame_h = params.frame_h.max(1);
        if iw == 0 || ih == 0 {
            return source_to_owned_texture(device, queue, source, iw.max(1), ih.max(1));
        }

        // Scratch buffers are frame-sized; the source is bound directly as the
        // `input` view (no resize/pad copy) and sampled with computed UVs.
        self.ensure_resources(device, frame_w, frame_h, false);
        let resources = self
            .resources
            .as_ref()
            .ok_or_else(|| anyhow!("effect resources not initialized"))?;
        let ping_view = resources.ping_view.clone();
        let pong_view = resources.pong_view.clone();
        let aux_view = resources.aux_view.clone();

        // The sharp source. A CPU source is uploaded to a GPU texture of its own
        // size first (the scratch buffers are frame-sized, not source-sized).
        // The created `TextureView` internally keeps its texture alive, so the
        // uploaded texture need not be held separately.
        let input_view = match source {
            EffectSource::Gpu(tex) => tex.create_view(&wgpu::TextureViewDescriptor::default()),
            EffectSource::Cpu(_) => {
                let tex = source_to_owned_texture(device, queue, source, iw, ih)?;
                tex.create_view(&wgpu::TextureViewDescriptor::default())
            }
        };

        let passes = build_blur_fill_passes(
            frame_w,
            frame_h,
            iw,
            ih,
            params.fg_scale,
            params.bg_scale,
            params.blur,
            params.bg_dim,
            params.bg_saturation,
            params.tint_color,
            params.tint_strength,
            params.fg_offset_y,
            params.quality,
        );

        let (owned, owned_view) = self.owned_pool.acquire(device, frame_w, frame_h);
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
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("native-blur-fill-encoder"),
        });
        macro_rules! view_of {
            ($buf:expr) => {
                match $buf {
                    Buf::Input => &input_view,
                    Buf::Ping => &ping_view,
                    Buf::Pong => &pong_view,
                    Buf::Aux => &aux_view,
                    Buf::Owned => &owned_view,
                }
            };
        }
        for (index, pass) in passes.iter().enumerate() {
            let uniform_offset = (index as u64 * self.uniform_stride) as u32;
            let bind_src: &wgpu::TextureView = view_of!(pass.src);
            let bind_secondary: &wgpu::TextureView = view_of!(pass.secondary);
            let target_view: &wgpu::TextureView = view_of!(pass.dst);
            let uniform_buffer = self
                .uniform_buffer
                .as_ref()
                .ok_or_else(|| anyhow!("effect uniform buffer not initialized"))?;
            let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("native-blur-fill-bind-group"),
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
                    wgpu::BindGroupEntry {
                        binding: 4,
                        resource: wgpu::BindingResource::Sampler(&self.sampler),
                    },
                ],
            });
            let mut cpass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("native-blur-fill-pass"),
                timestamp_writes: None,
            });
            cpass.set_pipeline(&self.pipeline);
            cpass.set_bind_group(0, &bind_group, &[uniform_offset]);
            cpass.dispatch_workgroups(frame_w.div_ceil(8), frame_h.div_ceil(8), 1);
        }
        queue.submit([encoder.finish()]);
        Ok(Arc::new(crate::media::SharedTexture::new_shared(owned)))
    }
}

// Hard render ceilings. These are the absolute clamps applied to every value
// reaching the GPU and are the single source of truth for the maximum an
// animation key can reach (the frontend `renderMin/renderMax` in
// `video-manifests.ts` mirror these). They sit well above the comfortable
// slider ranges so animations can push effects far past manual limits — but
// still bounded, so a runaway key can never DoS the GPU.
//
// The blur kernel always spans the full requested radius; for radii larger than
// the shader's tap budget the tap step grows and bilinear filtering keeps the
// result smooth (no banding / no per-frame popping), so large animated radii
// are safe and continuous.
//
// The values are defined once in `shared/effects/render-ceilings.json` and
// emitted as `const MAX_*: f32` by `build.rs`, so they stay identical to the
// web pass builder (which imports the same JSON). Edit the JSON, not here.
include!(concat!(env!("OUT_DIR"), "/render_ceilings.rs"));

fn source_to_owned_texture(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    source: &EffectSource,
    width: u32,
    height: u32,
) -> Result<Arc<crate::media::SharedTexture>> {
    match source {
        EffectSource::Cpu(img) => {
            let texture = create_rgba8_texture(
                device,
                "native-effect-owned-cpu-source",
                width,
                height,
                wgpu::TextureUsages::COPY_SRC
                    | wgpu::TextureUsages::COPY_DST
                    | wgpu::TextureUsages::TEXTURE_BINDING,
            );
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
            Ok(Arc::new(crate::media::SharedTexture::new_shared(Arc::new(
                texture,
            ))))
        }
        EffectSource::Gpu(texture) => Ok(texture.clone()),
    }
}

// The effect math lives in the shared cross-backend shader so the native
// wgpu compositor and the web WebGPU compute runner execute identical code.
// This is the effect plugin ABI — see the header of `effect.wgsl`.
const EFFECT_SHADER: &str = include_str!("../../../../shared/effects/effect.wgsl");

#[cfg(test)]
mod tests {
    use super::passes::EffectPass;
    use super::*;
    use vello::peniko::{Blob, ImageAlphaType, ImageFormat};

    fn build_passes(effects: &[EffectSpec], width: u32, height: u32) -> Vec<EffectPass> {
        super::build_passes(effects, width, height, EffectQuality::Ultra)
    }

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
        let passes = build_passes(
            &[EffectSpec::GaussianBlur {
                radius: 10.0,
                bleed: false,
                blur_type: "gaussian".to_string(),
                mix: 1.0,
            }],
            1920,
            1080,
        );
        assert_eq!(passes.len(), 2);
        assert_eq!(passes[0].uniform.mode, 4); // Horizontal
        assert_eq!(passes[1].uniform.mode, 14); // Vertical
        assert_eq!(passes[0].uniform.p0, 10.0);
        assert_eq!(passes[1].uniform.p0, 10.0);
    }

    #[test]
    fn build_passes_uses_effect_quality_tap_budget() {
        let effects = [EffectSpec::GaussianBlur {
            radius: 100.0,
            bleed: false,
            blur_type: "gaussian".to_string(),
            mix: 1.0,
        }];
        let low = super::build_passes(&effects, 1920, 1080, EffectQuality::Low);
        let high = super::build_passes(&effects, 1920, 1080, EffectQuality::High);

        assert_eq!(low[0].uniform.p7, 8.0);
        assert_eq!(low[1].uniform.p7, 8.0);
        assert_eq!(high[0].uniform.p7, 32.0);
        assert_eq!(high[1].uniform.p7, 32.0);
    }

    #[test]
    fn build_passes_gaussian_blur_pixels_keeps_texture_pixel_radius() {
        let passes = build_passes(
            &[EffectSpec::GaussianBlurPixels {
                radius: 10.0,
                mix: 1.0,
            }],
            1920,
            540,
        );
        assert_eq!(passes.len(), 2);
        assert_eq!(passes[0].uniform.mode, 4);
        assert_eq!(passes[1].uniform.mode, 14);
        assert_eq!(passes[0].uniform.p0, 10.0);
        assert_eq!(passes[1].uniform.p0, 10.0);
    }

    #[test]
    fn build_passes_gaussian_blur_pixels_clamps_to_render_ceiling() {
        // Mirror of the web pass builder: blur-pixels radius is bounded by
        // MAX_BLUR_RADIUS, not passed through raw.
        let passes = build_passes(
            &[EffectSpec::GaussianBlurPixels {
                radius: 99_999.0,
                mix: 1.0,
            }],
            1920,
            1080,
        );
        assert_eq!(passes[0].uniform.p0, MAX_BLUR_RADIUS);
        assert_eq!(passes[1].uniform.p0, MAX_BLUR_RADIUS);
    }

    #[test]
    fn build_passes_bloom_clamps_threshold_to_unit_range() {
        // Bright-pass threshold must be clamped to [0, 1], matching the web
        // pass builder (`WebGpuComputeRunner.ts`).
        let passes = build_passes(
            &[EffectSpec::Bloom {
                threshold: 5.0,
                strength: 1.0,
                radius: 8.0,
                knee: 0.5,
                mix: 1.0,
            }],
            1920,
            1080,
        );
        // First bloom pass is the bright-pass extract (mode 15); p0 = threshold.
        assert_eq!(passes[0].uniform.mode, 15);
        assert_eq!(passes[0].uniform.p0, 1.0);
    }

    #[test]
    fn build_passes_bloom_uses_separable_pipeline() {
        let passes = build_passes(
            &[EffectSpec::Bloom {
                threshold: 0.75,
                strength: 0.6,
                radius: 12.0,
                knee: 0.5,
                mix: 1.0,
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

    #[test]
    fn build_passes_pixelate_carries_size_and_mix() {
        let passes = build_passes(
            &[EffectSpec::Pixelate {
                size: 16.0,
                mix: 0.75,
            }],
            1920,
            1080,
        );
        assert_eq!(passes.len(), 1);
        assert_eq!(passes[0].uniform.mode, 6);
        assert_eq!(passes[0].uniform.p0, 16.0);
        assert_eq!(passes[0].uniform.p1, 0.75);
    }

    #[test]
    fn pixelate_mix_defaults_to_one_for_backwards_compat() {
        let passes = build_passes(
            &[EffectSpec::Pixelate {
                size: 8.0,
                mix: default_mix(),
            }],
            1920,
            1080,
        );
        assert_eq!(passes[0].uniform.p1, 1.0);
    }

    #[test]
    fn build_passes_blur_appends_mix_pass_when_mix_less_than_one() {
        let passes = build_passes(
            &[EffectSpec::GaussianBlur {
                radius: 10.0,
                bleed: false,
                blur_type: "gaussian".to_string(),
                mix: 0.5,
            }],
            1920,
            1080,
        );
        // h-blur + v-blur + mix = 3 passes
        assert_eq!(passes.len(), 3);
        assert_eq!(passes[2].uniform.mode, 19);
        assert_eq!(passes[2].uniform.p0, 0.5);
    }

    #[test]
    fn build_passes_bloom_appends_mix_pass_when_mix_less_than_one() {
        let passes = build_passes(
            &[EffectSpec::Bloom {
                threshold: 0.75,
                strength: 0.6,
                radius: 12.0,
                knee: 0.5,
                mix: 0.25,
            }],
            1920,
            1080,
        );
        // extract + blur_h + blur_v + compose + mix = 5 passes
        assert_eq!(passes.len(), 5);
        assert_eq!(passes[4].uniform.mode, 19);
        assert_eq!(passes[4].uniform.p0, 0.25);
    }

    #[test]
    fn sharpen_uniform_carries_mix_in_p2() {
        let passes = build_passes(
            &[EffectSpec::Sharpen {
                amount: 1.0,
                mix: 0.75,
            }],
            1920,
            1080,
        );
        assert_eq!(passes.len(), 1);
        assert_eq!(passes[0].uniform.mode, 5);
        assert_eq!(passes[0].uniform.p2, 0.75);
    }

    #[test]
    fn blur_fill_passes_cover_blur_adjust_compose_at_frame_dims() {
        // 1080x1920 vertical source reframed into a 1920x1080 landscape frame,
        // with a half-strength blue tint.
        let passes = build_blur_fill_passes(
            1920,
            1080,
            1080,
            1920,
            1.0,
            1.2,
            40.0,
            0.8,
            1.1,
            [0, 0, 255, 255],
            0.5,
            -0.1,
            EffectQuality::Medium,
        );
        // cover + blur_h + blur_v + adjust + compose
        assert_eq!(passes.len(), 5);
        // cover place
        assert_eq!(passes[0].uniform.mode, 20);
        assert_eq!(passes[0].uniform.width, 1920);
        assert_eq!(passes[0].uniform.height, 1080);
        assert_eq!(passes[0].uniform.p0, 1080.0); // input width
        assert_eq!(passes[0].uniform.p1, 1920.0); // input height
        assert_eq!(passes[0].uniform.p2, 1.2); // bg scale
        assert_eq!(passes[0].src, Buf::Input);
        assert_eq!(passes[0].dst, Buf::Ping);
        // separable blur on the background plate
        assert_eq!(passes[1].uniform.mode, 4);
        assert_eq!(passes[2].uniform.mode, 14);
        // radius is height-normalized (frame 1080 → scale 1.0)
        assert_eq!(passes[1].uniform.p0, 40.0);
        // background adjust: dim, saturation, tint
        assert_eq!(passes[3].uniform.mode, 22);
        assert_eq!(passes[3].src, Buf::Ping);
        assert_eq!(passes[3].dst, Buf::Pong);
        assert_eq!(passes[3].uniform.p0, 0.8); // bg dim
        assert_eq!(passes[3].uniform.p1, 1.1); // bg saturation
        assert_eq!(passes[3].uniform.p2, 0.0); // tint r
        assert_eq!(passes[3].uniform.p3, 0.0); // tint g
        assert_eq!(passes[3].uniform.p4, 1.0); // tint b
        assert_eq!(passes[3].uniform.p5, 0.5); // tint strength

        // compose: sharp fg over prepared bg, into the owned output
        assert_eq!(passes[4].uniform.mode, 21);
        assert_eq!(passes[4].src, Buf::Input);
        assert_eq!(passes[4].secondary, Buf::Pong);
        assert_eq!(passes[4].dst, Buf::Owned);
        assert_eq!(passes[4].uniform.p2, 1.0); // fg scale
        assert_eq!(passes[4].uniform.p3, -0.1); // fg offset y
    }

    #[test]
    fn blur_fill_skips_blur_passes_when_radius_zero() {
        let passes = build_blur_fill_passes(
            1920,
            1080,
            1080,
            1920,
            1.0,
            1.0,
            0.0,
            1.0,
            1.0,
            [0, 0, 0, 255],
            0.0,
            0.0,
            EffectQuality::Low,
        );
        // cover place + bg adjust + compose only
        assert_eq!(passes.len(), 3);
        assert_eq!(passes[0].uniform.mode, 20);
        assert_eq!(passes[1].uniform.mode, 22);
        assert_eq!(passes[1].src, Buf::Ping); // adjusts the cover plate directly
        assert_eq!(passes[1].dst, Buf::Pong);
        assert_eq!(passes[2].uniform.mode, 21);
        assert_eq!(passes[2].secondary, Buf::Pong);
        assert_eq!(passes[2].dst, Buf::Owned);
    }

    #[test]
    fn levels_uniform_carries_mix_in_p5() {
        let passes = build_passes(
            &[EffectSpec::Levels {
                in_black: 0.2,
                in_white: 0.8,
                gamma: 1.6,
                out_black: 0.1,
                out_white: 0.9,
                mix: 0.4,
            }],
            1920,
            1080,
        );
        assert_eq!(passes.len(), 1);
        assert_eq!(passes[0].uniform.mode, 12);
        assert_eq!(passes[0].uniform.p5, 0.4);
    }

    // ------------------------------------------------------------------
    // calculate_padding / spatial_scale
    // ------------------------------------------------------------------

    #[test]
    fn calculate_padding_zero_when_no_bleed_effects() {
        let effects = [
            EffectSpec::GaussianBlur {
                radius: 50.0,
                bleed: false,
                blur_type: "gaussian".to_string(),
                mix: 1.0,
            },
            EffectSpec::Brightness { value: 1.5 },
        ];
        assert_eq!(passes::calculate_padding(&effects, 1.0), 0);
    }

    #[test]
    fn calculate_padding_zero_for_empty_effects() {
        assert_eq!(passes::calculate_padding(&[], 1.0), 0);
    }

    #[test]
    fn calculate_padding_uses_max_bleed_radius_doubled_and_ceiled() {
        let effects = [EffectSpec::GaussianBlur {
            radius: 10.0,
            bleed: true,
            blur_type: "gaussian".to_string(),
            mix: 1.0,
        }];
        // scale=1.0 → max_r=10.0 → padding = ceil(10.0 * 2.0) = 20
        assert_eq!(passes::calculate_padding(&effects, 1.0), 20);
    }

    #[test]
    fn calculate_padding_scales_radius_by_spatial_scale() {
        let effects = [EffectSpec::GaussianBlur {
            radius: 10.0,
            bleed: true,
            blur_type: "gaussian".to_string(),
            mix: 1.0,
        }];
        // 540p → spatial_scale = 540/1080 = 0.5 → max_r = 5.0 → padding = ceil(10.0) = 10
        assert_eq!(passes::calculate_padding(&effects, 0.5), 10);
    }

    #[test]
    fn calculate_padding_picks_largest_bleed_radius() {
        let effects = [
            EffectSpec::GaussianBlur {
                radius: 5.0,
                bleed: true,
                blur_type: "gaussian".to_string(),
                mix: 1.0,
            },
            EffectSpec::GaussianBlur {
                radius: 30.0,
                bleed: true,
                blur_type: "gaussian".to_string(),
                mix: 1.0,
            },
            EffectSpec::GaussianBlur {
                radius: 100.0,
                bleed: false,
                blur_type: "gaussian".to_string(),
                mix: 1.0,
            },
        ];
        // scale=2.0 → max_r = 30.0 * 2.0 = 60.0 → padding = ceil(120.0) = 120
        assert_eq!(passes::calculate_padding(&effects, 2.0), 120);
    }

    #[test]
    fn spatial_scale_normalizes_to_1080p() {
        assert!((passes::spatial_scale(1080) - 1.0).abs() < 1e-6);
        assert!((passes::spatial_scale(540) - 0.5).abs() < 1e-6);
        assert!((passes::spatial_scale(2160) - 2.0).abs() < 1e-6);
    }

    #[test]
    fn spatial_scale_clamps_to_minimum() {
        // Very small height would produce a near-zero scale; clamp to 0.1.
        assert!((passes::spatial_scale(1) - 0.1).abs() < 1e-6);
    }

    #[test]
    fn spatial_scale_clamps_to_maximum() {
        // Very large height would produce a huge scale; clamp to 8.0.
        assert!((passes::spatial_scale(100_000) - 8.0).abs() < 1e-6);
    }
}
