//! Переходы между двумя сценами (например A→B на стыке клипов).
//! Каждый transition — wgpu shader pass над двумя текстурами (from, to) + прогресс 0..1.

use anyhow::{Result, anyhow};
use bytemuck::{Pod, Zeroable};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::Arc;
use vello::peniko::ImageData;
use wgpu::util::DeviceExt;

use crate::compositor::effects::EffectSource;
use crate::compositor::gpu_utils::image_pixels_rgba8;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum TransitionSpec {
    Crossfade,
    Wipe {
        angle_deg: f32,
        softness: f32,
    },
    Slide {
        direction: SlideDirection,
    },
    Dissolve {
        seed: u32,
    },
    CircleReveal {
        center: [f32; 2],
        softness: f32,
    },
    FadeThroughColor {
        color: String,
    },
    /// Произвольный WGSL.
    CustomWgsl {
        source: String,
        params: serde_json::Value,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SlideDirection {
    Left,
    Right,
    Up,
    Down,
}

#[repr(C)]
#[derive(Clone, Copy, Default, Pod, Zeroable)]
pub struct TransitionUniform {
    pub progress: f32,
    pub width: u32,
    pub height: u32,
    pub pad: u32,
    pub p0: f32,
    pub p1: f32,
    pub p2: f32,
    pub p3: f32,
    pub p4: f32,
    pub p5: f32,
    pub p6: f32,
    pub p7: f32,
}

pub struct TransitionPipeline {
    bind_layout: wgpu::BindGroupLayout,
    pipelines: HashMap<u64, Arc<wgpu::ComputePipeline>>,
    pipeline_cache: Option<wgpu::PipelineCache>,
    /// Билинейный blit-проход: приводит входы перехода к выходному размеру.
    blit_layout: wgpu::BindGroupLayout,
    blit_pipeline: wgpu::ComputePipeline,
}

#[repr(C)]
#[derive(Clone, Copy, Default, Pod, Zeroable)]
struct BlitUniform {
    out_w: u32,
    out_h: u32,
    src_w: u32,
    src_h: u32,
}

/// Билинейное масштабирование `src` → выходной размер. Шейдеры переходов читают обе
/// текстуры по координатам выходного размера (`max(from, to)`); без этого blit'а
/// меньший вход давал `textureLoad` за границей (= чёрные/прозрачные края).
const BLIT_SHADER: &str = r#"
struct BlitU { out_w: u32, out_h: u32, src_w: u32, src_h: u32 };
@group(0) @binding(0) var src_tex: texture_2d<f32>;
@group(0) @binding(1) var dst_tex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> u: BlitU;

fn ld(p: vec2<i32>) -> vec4<f32> {
    let c = vec2<i32>(
        clamp(p.x, 0, i32(u.src_w) - 1),
        clamp(p.y, 0, i32(u.src_h) - 1)
    );
    return textureLoad(src_tex, c, 0);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= u.out_w || gid.y >= u.out_h) {
        return;
    }
    let uv = vec2<f32>(
        (f32(gid.x) + 0.5) / f32(u.out_w),
        (f32(gid.y) + 0.5) / f32(u.out_h)
    );
    let sp = uv * vec2<f32>(f32(u.src_w), f32(u.src_h)) - vec2<f32>(0.5, 0.5);
    let i0 = vec2<i32>(i32(floor(sp.x)), i32(floor(sp.y)));
    let f = fract(sp);
    let c00 = ld(i0);
    let c10 = ld(i0 + vec2<i32>(1, 0));
    let c01 = ld(i0 + vec2<i32>(0, 1));
    let c11 = ld(i0 + vec2<i32>(1, 1));
    let c = mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);
    textureStore(dst_tex, vec2<i32>(i32(gid.x), i32(gid.y)), c);
}
"#;

impl TransitionPipeline {
    pub fn new(device: &wgpu::Device, cache: Option<&wgpu::PipelineCache>) -> Self {
        let bind_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("native-transition-bind-layout"),
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

        let blit_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("native-transition-blit-layout"),
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
        let blit_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("native-transition-blit-wgsl"),
            source: wgpu::ShaderSource::Wgsl(BLIT_SHADER.into()),
        });
        let blit_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("native-transition-blit-pipeline-layout"),
            bind_group_layouts: &[Some(&blit_layout)],
            immediate_size: 0,
        });
        let blit_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("native-transition-blit-pipeline"),
            layout: Some(&blit_pipeline_layout),
            module: &blit_shader,
            entry_point: Some("main"),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            cache,
        });

        Self {
            bind_layout,
            pipelines: HashMap::new(),
            pipeline_cache: cache.cloned(),
            blit_layout,
            blit_pipeline,
        }
    }

    /// Готовит вход перехода как текстуру РОВНО `width×height`. Если GPU-источник уже
    /// нужного размера — отдаёт дешёвый клон хэндла; иначе билинейно масштабирует
    /// (CPU-источник предварительно заливается во временную текстуру).
    fn prepare_input(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        source: &EffectSource,
        width: u32,
        height: u32,
    ) -> Result<wgpu::Texture> {
        let (src_tex, src_w, src_h) = match source {
            EffectSource::Cpu(img) => {
                let tex = create_temp_texture(device, queue, img)?;
                (tex, img.width, img.height)
            }
            EffectSource::Gpu(tex) => {
                if tex.width() == width && tex.height() == height {
                    return Ok((**tex).clone());
                }
                ((**tex).clone(), tex.width(), tex.height())
            }
        };

        let dst = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("native-transition-scaled-input"),
            size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::STORAGE_BINDING,
            view_formats: &[],
        });
        let src_view = src_tex.create_view(&wgpu::TextureViewDescriptor::default());
        let dst_view = dst.create_view(&wgpu::TextureViewDescriptor::default());
        let uniform = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("native-transition-blit-uniform"),
            contents: bytemuck::bytes_of(&BlitUniform {
                out_w: width,
                out_h: height,
                src_w,
                src_h,
            }),
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("native-transition-blit-bind-group"),
            layout: &self.blit_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&src_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&dst_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: uniform.as_entire_binding(),
                },
            ],
        });
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("native-transition-blit-encoder"),
        });
        {
            let mut cpass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("native-transition-blit-pass"),
                timestamp_writes: None,
            });
            cpass.set_pipeline(&self.blit_pipeline);
            cpass.set_bind_group(0, &bind_group, &[]);
            cpass.dispatch_workgroups(width.div_ceil(8), height.div_ceil(8), 1);
        }
        queue.submit([encoder.finish()]);
        Ok(dst)
    }

    fn get_or_create_pipeline(
        &mut self,
        device: &wgpu::Device,
        shader_source: &str,
    ) -> Result<Arc<wgpu::ComputePipeline>> {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        shader_source.hash(&mut hasher);
        let key = hasher.finish();
        if !self.pipelines.contains_key(&key) {
            let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("native-transition-wgsl"),
                source: wgpu::ShaderSource::Wgsl(shader_source.into()),
            });
            let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("native-transition-pipeline-layout"),
                bind_group_layouts: &[Some(&self.bind_layout)],
                immediate_size: 0,
            });
            let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some("native-transition-pipeline"),
                layout: Some(&pipeline_layout),
                module: &shader,
                entry_point: Some("main"),
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                cache: self.pipeline_cache.as_ref(),
            });
            self.pipelines
                .insert(key, Arc::new(pipeline));
        }
        self.pipelines.get(&key).cloned()
            .ok_or_else(|| anyhow!("transition pipeline missing after insertion"))
    }

    pub fn apply_transition(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        from_source: &EffectSource,
        to_source: &EffectSource,
        spec: &TransitionSpec,
        progress: f32,
    ) -> Result<wgpu::Texture> {
        let (w_from, h_from) = match from_source {
            EffectSource::Cpu(img) => (img.width, img.height),
            EffectSource::Gpu(tex) => (tex.width(), tex.height()),
        };
        let (w_to, h_to) = match to_source {
            EffectSource::Cpu(img) => (img.width, img.height),
            EffectSource::Gpu(tex) => (tex.width(), tex.height()),
        };

        let width = w_from.max(w_to);
        let height = h_from.max(h_to);
        if width == 0 || height == 0 {
            return Err(anyhow!("Invalid texture size for transition: 0x0"));
        }

        // Выбор/компиляция шейдера (выполняется до заимствования resources, так как требует &mut self)
        let shader_source = get_shader_source(spec);
        let pipeline = self.get_or_create_pipeline(device, &shader_source)?;

        // Приводим оба входа к выходному размеру (билинейно), иначе вход меньшего
        // размера читался бы за границей в шейдере перехода → чёрные края.
        let from_tex = self.prepare_input(device, queue, from_source, width, height)?;
        let to_tex = self.prepare_input(device, queue, to_source, width, height)?;

        // Рендерим переход сразу в owned-текстуру результата. Раньше писали в кешированную
        // `resources.output` и копировали её наружу — лишний полнокадровый GPU→GPU копи на
        // каждый переход на кадр. Результат всё равно уходит вверх по сцене как owned-Arc,
        // так что финальная текстура и есть таргет compute-пасса. Кеш не нужен: аллокация
        // ровно одной выходной текстуры за вызов — то же, что делал прежний `copy_texture_owned`.
        let output = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("native-transition-owned-output"),
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
        });
        let output_view = output.create_view(&wgpu::TextureViewDescriptor::default());

        let from_texture = from_tex.create_view(&wgpu::TextureViewDescriptor::default());
        let to_texture = to_tex.create_view(&wgpu::TextureViewDescriptor::default());

        // Заполнение Uniform буфера
        let uniform_data = build_uniform(spec, progress, width, height);
        let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("native-transition-uniform"),
            contents: bytemuck::bytes_of(&uniform_data),
            usage: wgpu::BufferUsages::UNIFORM,
        });

        // Создание Bind Group
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("native-transition-bind-group"),
            layout: &self.bind_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&from_texture),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&to_texture),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::TextureView(&output_view),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: uniform_buffer.as_entire_binding(),
                },
            ],
        });

        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("native-transition-encoder"),
        });

        {
            let mut cpass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("native-transition-pass"),
                timestamp_writes: None,
            });
            cpass.set_pipeline(&pipeline);
            cpass.set_bind_group(0, &bind_group, &[]);
            cpass.dispatch_workgroups(width.div_ceil(8), height.div_ceil(8), 1);
        }

        queue.submit([encoder.finish()]);

        Ok(output)
    }
}

fn create_temp_texture(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    img: &ImageData,
) -> Result<wgpu::Texture> {
    let size = wgpu::Extent3d {
        width: img.width,
        height: img.height,
        depth_or_array_layers: 1,
    };
    let tex = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("native-transition-temp-source"),
        size,
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::TEXTURE_BINDING,
        view_formats: &[],
    });

    let pixels = image_pixels_rgba8(img)?;
    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture: &tex,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        &pixels,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(img.width * 4),
            rows_per_image: Some(img.height),
        },
        size,
    );

    Ok(tex)
}

fn build_uniform(
    spec: &TransitionSpec,
    progress: f32,
    width: u32,
    height: u32,
) -> TransitionUniform {
    let mut uni = TransitionUniform {
        progress,
        width,
        height,
        pad: 0,
        p0: 0.0,
        p1: 0.0,
        p2: 0.0,
        p3: 0.0,
        p4: 0.0,
        p5: 0.0,
        p6: 0.0,
        p7: 0.0,
    };

    match spec {
        TransitionSpec::Wipe {
            angle_deg,
            softness,
        } => {
            uni.p0 = *angle_deg;
            uni.p1 = *softness;
        }
        TransitionSpec::Slide { direction } => {
            // p0: direction (0=left, 1=right, 2=up, 3=down)
            uni.p0 = match direction {
                SlideDirection::Left => 0.0,
                SlideDirection::Right => 1.0,
                SlideDirection::Up => 2.0,
                SlideDirection::Down => 3.0,
            };
        }
        TransitionSpec::Dissolve { seed } => {
            uni.p0 = *seed as f32;
        }
        TransitionSpec::CircleReveal { center, softness } => {
            uni.p0 = center[0];
            uni.p1 = center[1];
            uni.p2 = *softness;
        }
        TransitionSpec::FadeThroughColor { color } => {
            let rgb = parse_hex_color(color);
            uni.p0 = rgb[0];
            uni.p1 = rgb[1];
            uni.p2 = rgb[2];
        }
        TransitionSpec::CustomWgsl { params, .. } => {
            if let serde_json::Value::Object(map) = params {
                for i in 0..8 {
                    let key = format!("p{}", i);
                    if let Some(v) = map.get(&key).and_then(|v| v.as_f64()) {
                        match i {
                            0 => uni.p0 = v as f32,
                            1 => uni.p1 = v as f32,
                            2 => uni.p2 = v as f32,
                            3 => uni.p3 = v as f32,
                            4 => uni.p4 = v as f32,
                            5 => uni.p5 = v as f32,
                            6 => uni.p6 = v as f32,
                            7 => uni.p7 = v as f32,
                            _ => {}
                        }
                    }
                }
            }
        }
        _ => {}
    }

    uni
}

fn parse_hex_color(hex: &str) -> [f32; 3] {
    let clean = hex.trim().trim_start_matches('#');
    if clean.len() != 6 || !clean.as_bytes().iter().all(u8::is_ascii_hexdigit) {
        return [0.0, 0.0, 0.0];
    }
    let r = u8::from_str_radix(&clean[0..2], 16).unwrap_or(0) as f32 / 255.0;
    let g = u8::from_str_radix(&clean[2..4], 16).unwrap_or(0) as f32 / 255.0;
    let b = u8::from_str_radix(&clean[4..6], 16).unwrap_or(0) as f32 / 255.0;
    [r, g, b]
}

fn get_shader_source(spec: &TransitionSpec) -> String {
    match spec {
        TransitionSpec::CustomWgsl { source, .. } => source.clone(),
        TransitionSpec::Crossfade => include_str!("shaders/crossfade.wgsl").to_string(),
        TransitionSpec::Wipe { .. } => include_str!("shaders/wipe.wgsl").to_string(),
        TransitionSpec::Slide { .. } => include_str!("shaders/slide.wgsl").to_string(),
        TransitionSpec::Dissolve { .. } => include_str!("shaders/dissolve.wgsl").to_string(),
        TransitionSpec::CircleReveal { .. } => {
            include_str!("shaders/circle_reveal.wgsl").to_string()
        }
        TransitionSpec::FadeThroughColor { .. } => {
            include_str!("shaders/fade_through_color.wgsl").to_string()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use vello::peniko::{Blob, ImageAlphaType, ImageFormat};

    #[test]
    fn test_parse_transition_spec_json() {
        let json_data = json!({
            "type": "custom-wgsl",
            "source": "some wgsl code",
            "params": {
                "p0": 1.25,
                "p1": 2.5
            }
        });
        let spec: TransitionSpec = serde_json::from_value(json_data).unwrap();
        match spec {
            TransitionSpec::CustomWgsl { source, params } => {
                assert_eq!(source, "some wgsl code");
                assert_eq!(params["p0"], 1.25);
                assert_eq!(params["p1"], 2.5);
            }
            _ => panic!("Expected CustomWgsl variant"),
        }
    }

    #[test]
    fn test_build_uniform_custom_wgsl() {
        let spec = TransitionSpec::CustomWgsl {
            source: "code".into(),
            params: json!({
                "p0": 3.0,
                "p1": 45.0,
                "p5": 1.0,
            }),
        };
        let uni = build_uniform(&spec, 0.5, 1920, 1080);
        assert_eq!(uni.progress, 0.5);
        assert_eq!(uni.width, 1920);
        assert_eq!(uni.height, 1080);
        assert_eq!(uni.p0, 3.0);
        assert_eq!(uni.p1, 45.0);
        assert_eq!(uni.p5, 1.0);
        assert_eq!(uni.p2, 0.0);
    }

    #[test]
    fn test_parse_hex_color() {
        let rgb = parse_hex_color("#ffffff");
        assert_eq!(rgb, [1.0, 1.0, 1.0]);

        let rgb_no_hash = parse_hex_color("ff0000");
        assert_eq!(rgb_no_hash, [1.0, 0.0, 0.0]);

        assert_eq!(parse_hex_color("#f"), [0.0, 0.0, 0.0]);
        assert_eq!(parse_hex_color("not-hex"), [0.0, 0.0, 0.0]);
    }

    #[test]
    fn test_get_shader_sources_not_empty() {
        let specs = [
            TransitionSpec::Crossfade,
            TransitionSpec::Wipe {
                angle_deg: 45.0,
                softness: 0.1,
            },
            TransitionSpec::Slide {
                direction: SlideDirection::Left,
            },
            TransitionSpec::Dissolve { seed: 42 },
            TransitionSpec::CircleReveal {
                center: [0.5, 0.5],
                softness: 0.1,
            },
            TransitionSpec::FadeThroughColor {
                color: "#ff0000".into(),
            },
            TransitionSpec::CustomWgsl {
                source: "custom_code".into(),
                params: serde_json::Value::Null,
            },
        ];

        for spec in &specs {
            let src = get_shader_source(spec);
            assert!(
                !src.is_empty(),
                "Shader source for spec should not be empty"
            );
            if let TransitionSpec::CustomWgsl { source, .. } = spec {
                assert_eq!(src, *source);
            } else {
                assert!(
                    src.contains("fn main"),
                    "Builtin shaders must contain 'fn main'"
                );
            }
        }
    }

    #[test]
    fn test_image_pixels_conversion() {
        // Test Rgba8 format (should return data as-is)
        let rgba_img = ImageData {
            data: Blob::new(Arc::new(vec![10, 20, 30, 40])),
            format: ImageFormat::Rgba8,
            alpha_type: ImageAlphaType::Alpha,
            width: 1,
            height: 1,
        };
        assert_eq!(image_pixels_rgba8(&rgba_img).unwrap(), vec![10, 20, 30, 40]);

        // Test Bgra8 format (should swap red and blue channels)
        let bgra_img = ImageData {
            data: Blob::new(Arc::new(vec![10, 20, 30, 40])),
            format: ImageFormat::Bgra8,
            alpha_type: ImageAlphaType::Alpha,
            width: 1,
            height: 1,
        };
        assert_eq!(image_pixels_rgba8(&bgra_img).unwrap(), vec![30, 20, 10, 40]);
    }
}
