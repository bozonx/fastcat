use anyhow::{anyhow, Result};
use bytemuck::{Pod, Zeroable};
use wgpu::util::DeviceExt;

use crate::media::decode::{YuvColorMatrix, YuvColorRange, YuvFrame};

#[repr(C)]
#[derive(Clone, Copy, Default, Pod, Zeroable)]
struct YuvUniform {
    width: u32,
    height: u32,
    matrix: u32,
    range: u32,
}

struct YuvTextures {
    width: u32,
    height: u32,
    uv_width: u32,
    uv_height: u32,
    y: wgpu::Texture,
    uv: wgpu::Texture,
}

pub struct YuvToRgbaPipeline {
    bind_layout: wgpu::BindGroupLayout,
    pipeline: wgpu::ComputePipeline,
    textures: Option<YuvTextures>,
}

const YUV_TO_RGBA_SHADER: &str = r#"
struct YuvUniform {
    width: u32,
    height: u32,
    matrix: u32,
    range: u32,
};

@group(0) @binding(0) var y_tex: texture_2d<f32>;
@group(0) @binding(1) var uv_tex: texture_2d<f32>;
@group(0) @binding(2) var out_tex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<uniform> u: YuvUniform;

fn convert(y_sample: f32, uv_sample: vec2<f32>) -> vec3<f32> {
    var y = y_sample;
    var cb = uv_sample.x;
    var cr = uv_sample.y;

    if (u.range == 0u) {
        y = clamp((y - (16.0 / 255.0)) * (255.0 / 219.0), 0.0, 1.0);
        cb = (cb - (128.0 / 255.0)) * (255.0 / 224.0);
        cr = (cr - (128.0 / 255.0)) * (255.0 / 224.0);
    } else {
        cb = cb - 0.5;
        cr = cr - 0.5;
    }

    var r = y;
    var g = y;
    var b = y;
    if (u.matrix == 1u) {
        r = y + 1.5748 * cr;
        g = y - 0.187324 * cb - 0.468124 * cr;
        b = y + 1.8556 * cb;
    } else if (u.matrix == 2u) {
        r = y + 1.4746 * cr;
        g = y - 0.164553 * cb - 0.571353 * cr;
        b = y + 1.8814 * cb;
    } else {
        r = y + 1.402 * cr;
        g = y - 0.344136 * cb - 0.714136 * cr;
        b = y + 1.772 * cb;
    }
    return clamp(vec3<f32>(r, g, b), vec3<f32>(0.0), vec3<f32>(1.0));
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= u.width || gid.y >= u.height) {
        return;
    }
    let y = textureLoad(y_tex, vec2<i32>(i32(gid.x), i32(gid.y)), 0).r;
    let uv = textureLoad(uv_tex, vec2<i32>(i32(gid.x / 2u), i32(gid.y / 2u)), 0).rg;
    let rgb = convert(y, uv);
    textureStore(out_tex, vec2<i32>(i32(gid.x), i32(gid.y)), vec4<f32>(rgb, 1.0));
}
"#;

impl YuvToRgbaPipeline {
    pub fn new(device: &wgpu::Device, cache: Option<&wgpu::PipelineCache>) -> Self {
        let bind_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("native-yuv-bind-layout"),
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
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::StorageTexture {
                        access: wgpu::StorageTextureAccess::WriteOnly,
                        format: wgpu::TextureFormat::Rgba8Unorm,
                        view_dimension: wgpu::TextureViewDimension::D2,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
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
            label: Some("native-yuv-to-rgba-wgsl"),
            source: wgpu::ShaderSource::Wgsl(YUV_TO_RGBA_SHADER.into()),
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("native-yuv-pipeline-layout"),
            bind_group_layouts: &[Some(&bind_layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("native-yuv-to-rgba-pipeline"),
            layout: Some(&pipeline_layout),
            module: &shader,
            entry_point: Some("main"),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            cache,
        });
        Self {
            bind_layout,
            pipeline,
            textures: None,
        }
    }

    pub fn upload_and_convert(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        frame: &YuvFrame,
        width: u32,
        height: u32,
        output: &wgpu::Texture,
    ) -> Result<()> {
        if frame.y_stride != width || frame.uv_stride != frame.uv_width * 2 {
            return Err(anyhow!("YUV frame is not densely packed"));
        }
        self.ensure_textures(device, width, height, frame.uv_width, frame.uv_height);
        let textures = self
            .textures
            .as_ref()
            .ok_or_else(|| anyhow!("YUV textures not initialized"))?;

        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &textures.y,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &frame.y,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(frame.y_stride),
                rows_per_image: Some(height),
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &textures.uv,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &frame.uv,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(frame.uv_stride),
                rows_per_image: Some(frame.uv_height),
            },
            wgpu::Extent3d {
                width: frame.uv_width,
                height: frame.uv_height,
                depth_or_array_layers: 1,
            },
        );

        let uniform = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("native-yuv-uniform"),
            contents: bytemuck::bytes_of(&YuvUniform {
                width,
                height,
                matrix: matrix_code(frame.color.matrix),
                range: range_code(frame.color.range),
            }),
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let y_view = textures
            .y
            .create_view(&wgpu::TextureViewDescriptor::default());
        let uv_view = textures
            .uv
            .create_view(&wgpu::TextureViewDescriptor::default());
        let output_view = output.create_view(&wgpu::TextureViewDescriptor::default());
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("native-yuv-bind-group"),
            layout: &self.bind_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&y_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&uv_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::TextureView(&output_view),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: uniform.as_entire_binding(),
                },
            ],
        });
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("native-yuv-encoder"),
        });
        {
            let mut cpass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("native-yuv-pass"),
                timestamp_writes: None,
            });
            cpass.set_pipeline(&self.pipeline);
            cpass.set_bind_group(0, &bind_group, &[]);
            cpass.dispatch_workgroups(width.div_ceil(8), height.div_ceil(8), 1);
        }
        queue.submit([encoder.finish()]);
        Ok(())
    }

    fn ensure_textures(
        &mut self,
        device: &wgpu::Device,
        width: u32,
        height: u32,
        uv_width: u32,
        uv_height: u32,
    ) {
        let current_matches = self.textures.as_ref().is_some_and(|textures| {
            textures.width == width
                && textures.height == height
                && textures.uv_width == uv_width
                && textures.uv_height == uv_height
        });
        if current_matches {
            return;
        }
        let y = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("native-yuv-y-plane"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::R8Unorm,
            usage: wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let uv = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("native-yuv-uv-plane"),
            size: wgpu::Extent3d {
                width: uv_width,
                height: uv_height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rg8Unorm,
            usage: wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        self.textures = Some(YuvTextures {
            width,
            height,
            uv_width,
            uv_height,
            y,
            uv,
        });
    }
}

fn matrix_code(matrix: YuvColorMatrix) -> u32 {
    match matrix {
        YuvColorMatrix::Bt601 => 0,
        YuvColorMatrix::Bt709 => 1,
        YuvColorMatrix::Bt2020 => 2,
    }
}

fn range_code(range: YuvColorRange) -> u32 {
    match range {
        YuvColorRange::Limited => 0,
        YuvColorRange::Full => 1,
    }
}
