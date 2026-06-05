//! GPU layer effects for the native compositor.
//!
//! This is intentionally independent from the Pixi/Web renderer. Each effect is
//! a wgpu compute pass over a texture, so the same code path can be used by the
//! native monitor and export.

use anyhow::{Result, anyhow};
use bytemuck::{Pod, Zeroable};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::sync::Arc;
use vello::peniko::{ImageData, ImageFormat};
use wgpu::util::DeviceExt;

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

#[derive(Clone, Copy)]
struct EffectPass {
    uniform: EffectUniform,
}

pub enum EffectSource {
    Cpu(ImageData),
    Gpu(Arc<wgpu::Texture>),
}

struct CachedResources {
    width: u32,
    height: u32,
    input: Option<wgpu::Texture>,
    ping: wgpu::Texture,
    ping_view: wgpu::TextureView,
    pong: wgpu::Texture,
    pong_view: wgpu::TextureView,
}

pub struct EffectPipeline {
    bind_layout: wgpu::BindGroupLayout,
    pipeline: wgpu::ComputePipeline,
    resources: Option<CachedResources>,
}

impl EffectPipeline {
    pub fn new(device: &wgpu::Device) -> Self {
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
                        has_dynamic_offset: false,
                        min_binding_size: None,
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
        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("native-effect-pipeline"),
            layout: Some(&pipeline_layout),
            module: &shader,
            entry_point: Some("main"),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            cache: None,
        });
        Self {
            bind_layout,
            pipeline,
            resources: None,
        }
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
            if res.width >= width && res.height >= height {
                if !need_input || res.input.is_some() {
                    recreate = false;
                }
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
    ) -> Result<wgpu::Texture> {
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

        let resources = self.resources.as_ref()
            .ok_or_else(|| anyhow!("effect resources not initialized"))?;

        let input_view = match source {
            EffectSource::Cpu(img) => {
                let pixels = image_pixels_rgba8(img)?;
                let size = wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                };
                let input_tex = resources.input.as_ref()
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

        let ping_view = &resources.ping_view;
        let pong_view = &resources.pong_view;
        let mut last_is_ping = false;
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("native-effect-encoder"),
        });

        for (index, pass) in passes.iter().enumerate() {
            let uniform = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("native-effect-uniform"),
                contents: bytemuck::bytes_of(&pass.uniform),
                usage: wgpu::BufferUsages::UNIFORM,
            });
            let source_view = if index == 0 {
                &input_view
            } else if last_is_ping {
                ping_view
            } else {
                pong_view
            };
            let target_view = if index == 0 || !last_is_ping {
                ping_view
            } else {
                pong_view
            };
            let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("native-effect-bind-group"),
                layout: &self.bind_layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(source_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::TextureView(target_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: uniform.as_entire_binding(),
                    },
                ],
            });
            {
                let mut cpass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                    label: Some("native-effect-pass"),
                    timestamp_writes: None,
                });
                cpass.set_pipeline(&self.pipeline);
                cpass.set_bind_group(0, &bind_group, &[]);
                cpass.dispatch_workgroups(width.div_ceil(8), height.div_ceil(8), 1);
            }
            last_is_ping = index == 0 || !last_is_ping;
        }

        queue.submit([encoder.finish()]);
        let output = if last_is_ping {
            &resources.ping
        } else {
            &resources.pong
        };
        copy_texture_owned(device, queue, output, width, height)
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
    };
    match *effect {
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
        EffectSpec::Pixelate { size } => {
            Some(base(6, (size * scale).clamp(1.0, 256.0), 0.0, 0.0, 0.0, 0.0, 0.0, 0))
        }
        EffectSpec::Bloom {
            threshold,
            strength,
            radius,
        } => Some(base(
            7,
            threshold.clamp(0.0, 1.0),
            strength.clamp(0.0, 4.0),
            // Bloom — 2D-ядро (дорогое), шейдер клампит радиус до 16; держим тот же
            // потолок, чтобы UI-значение отражало реальный эффект.
            (radius * scale).clamp(0.0, 16.0),
            0.0,
            0.0,
            0.0,
            0,
        )),
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
            seed,
        )),
        EffectSpec::ChromaticAberration { amount, angle_deg } => Some(base(
            10,
            (amount * scale).clamp(0.0, 80.0),
            angle_deg,
            0.0,
            0.0,
            0.0,
            0.0,
            0,
        )),
        EffectSpec::Hue { degrees } => Some(base(11, degrees, 0.0, 0.0, 0.0, 0.0, 0.0, 0)),
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
        EffectSpec::CustomWgsl { .. } => None,
    }
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
        ImageFormat::Rgba8 => Ok(data[..expected].to_vec()),
        ImageFormat::Bgra8 => {
            let mut rgba = data[..expected].to_vec();
            for px in rgba.chunks_exact_mut(4) {
                px.swap(0, 2);
            }
            Ok(rgba)
        }
        _ => Err(anyhow!("unsupported image format for effects")),
    }
}

fn source_to_owned_texture(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    source: &EffectSource,
    width: u32,
    height: u32,
) -> Result<wgpu::Texture> {
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
            Ok(texture)
        }
        EffectSource::Gpu(texture) => copy_texture_owned(device, queue, texture, width, height),
    }
}

fn copy_texture_owned(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    texture: &wgpu::Texture,
    width: u32,
    height: u32,
) -> Result<wgpu::Texture> {
    let output = device.create_texture(&wgpu::TextureDescriptor {
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
            | wgpu::TextureUsages::COPY_DST
            | wgpu::TextureUsages::TEXTURE_BINDING,
        view_formats: &[],
    });
    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
        label: Some("native-effect-output-copy-encoder"),
    });
    encoder.copy_texture_to_texture(
        wgpu::TexelCopyTextureInfo {
            texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        wgpu::TexelCopyTextureInfo {
            texture: &output,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
    );
    queue.submit([encoder.finish()]);
    Ok(output)
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

fn clamp_coord(coord: vec2<i32>) -> vec2<i32> {
    return vec2<i32>(
        clamp(coord.x, 0, i32(effect.width) - 1),
        clamp(coord.y, 0, i32(effect.height) - 1)
    );
}

fn load_px(coord: vec2<i32>) -> vec4<f32> {
    return textureLoad(input_tex, clamp_coord(coord), 0);
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

fn sample_bloom(coord: vec2<i32>, threshold: f32, strength: f32, radius: f32) -> vec3<f32> {
    let r = i32(clamp(round(radius), 0.0, 16.0));
    if (r == 0) {
        return vec3<f32>(0.0);
    }
    var sum = vec3<f32>(0.0);
    var weight_sum = 0.0;
    let sigma = max(radius * 0.5, 1.0);
    let double_sigma_sq = 2.0 * sigma * sigma;
    for (var y = -r; y <= r; y = y + 1) {
        for (var x = -r; x <= r; x = x + 1) {
            let color_val = load_px(coord + vec2<i32>(x, y)).rgb;
            let bright = smoothstep(threshold, 1.0, luma(color_val));
            let dist = f32(x * x + y * y);
            let w = exp(-dist / double_sigma_sq);
            sum += color_val * bright * w;
            weight_sum += w;
        }
    }
    return (sum / max(weight_sum, 0.0001)) * strength;
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
        case 7u: {
            color = vec4<f32>(color.rgb + sample_bloom(coord, effect.p0, effect.p1, effect.p2), color.a);
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
        default: {}
    }

    textureStore(output_tex, coord, clamp(color, vec4<f32>(0.0), vec4<f32>(1.0)));
}
"#;

#[cfg(test)]
mod tests {
    use super::*;
    use vello::peniko::{Blob, ImageAlphaType};

    #[test]
    fn build_passes_skips_custom_wgsl() {
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
        assert_eq!(passes.len(), 1);
        assert_eq!(passes[0].uniform.mode, 1);
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
}
