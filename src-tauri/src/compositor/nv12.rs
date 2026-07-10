//! GPU-side RGBA→NV12 conversion for the export readback path.
//!
//! The export pipeline used to read back full RGBA frames (4 B/px) and let
//! ffmpeg's swscale do the RGB→YUV conversion on the CPU. Converting to NV12 on
//! the GPU cuts the readback + stdin-pipe volume to 1.5 B/px and removes the
//! swscale conversion from the encode hot path. This is native-only (the web
//! engine has no ffmpeg pipe), so the shader lives here rather than in
//! `shared/` — see the Engine Coupling Contract in AGENTS.md.
//!
//! The conversion mirrors what the ffmpeg args used to request
//! (`scale=out_color_matrix=bt709|bt601:out_range=tv`): limited-range studio
//! swing with the conventional matrix for the output height. The ffmpeg args
//! builder declares the matrix on the input (`setparams`) instead of
//! converting, and keeps writing the same colour tags.

use bytemuck::{Pod, Zeroable};

/// RGB→YUV matrix; mirror of `ColorSpec::for_output_height` (bt709 for HD,
/// bt601/smpte170m for SD).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Nv12Matrix {
    Bt709,
    Bt601,
}

impl Nv12Matrix {
    pub fn for_output_height(height: u32) -> Self {
        if height > 576 {
            Nv12Matrix::Bt709
        } else {
            Nv12Matrix::Bt601
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Default, Pod, Zeroable)]
struct Nv12Uniform {
    width: u32,
    height: u32,
    y_stride_words: u32,
    uv_offset_words: u32,
    uv_stride_words: u32,
    /// 0 = BT.709, 1 = BT.601.
    matrix: u32,
    _pad0: u32,
    _pad1: u32,
}

/// Buffer geometry of one NV12 frame in the GPU storage buffer. Rows are padded
/// to whole u32 words (the storage buffer is `array<u32>`); `repack` strips the
/// padding into the tight NV12 layout ffmpeg expects. Pure math — unit-tested.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Nv12Plan {
    pub(crate) width: u32,
    pub(crate) height: u32,
    /// u32 words per padded Y row (4 luma bytes per word).
    pub(crate) y_stride_words: u32,
    /// Word offset of the UV plane inside the storage buffer.
    pub(crate) uv_offset_words: u32,
    /// u32 words per padded UV row (2 interleaved U/V pairs per word).
    pub(crate) uv_stride_words: u32,
    /// UV plane rows (height / 2 — NV12 requires even dimensions).
    pub(crate) uv_rows: u32,
}

impl Nv12Plan {
    /// `None` when the dimensions cannot form a valid NV12 frame (odd sides).
    pub(crate) fn new(width: u32, height: u32) -> Option<Self> {
        if width == 0 || height == 0 || !width.is_multiple_of(2) || !height.is_multiple_of(2) {
            return None;
        }
        let y_stride_words = width.div_ceil(4);
        let uv_rows = height / 2;
        Some(Self {
            width,
            height,
            y_stride_words,
            uv_offset_words: y_stride_words * height,
            // A UV row carries `width` bytes (width/2 interleaved U,V pairs).
            uv_stride_words: width.div_ceil(4),
            uv_rows,
        })
    }

    /// Size of the padded GPU buffer in bytes.
    pub(crate) fn padded_bytes(&self) -> u64 {
        (self.uv_offset_words + self.uv_stride_words * self.uv_rows) as u64 * 4
    }

    /// Size of the tight NV12 frame ffmpeg expects on stdin.
    pub(crate) fn tight_bytes(&self) -> usize {
        self.width as usize * self.height as usize * 3 / 2
    }

    /// Strips the per-row word padding from a mapped GPU buffer into the tight
    /// NV12 layout. When the width is a multiple of 4 the padded layout already
    /// IS tight, and this is a single memcpy.
    pub(crate) fn repack(&self, mapped: &[u8]) -> Vec<u8> {
        let row_bytes = self.width as usize;
        let y_stride = self.y_stride_words as usize * 4;
        let uv_stride = self.uv_stride_words as usize * 4;
        let uv_offset = self.uv_offset_words as usize * 4;

        if y_stride == row_bytes && uv_stride == row_bytes {
            return mapped[..self.tight_bytes()].to_vec();
        }

        let mut out = Vec::with_capacity(self.tight_bytes());
        for row in 0..self.height as usize {
            let start = row * y_stride;
            out.extend_from_slice(&mapped[start..start + row_bytes]);
        }
        for row in 0..self.uv_rows as usize {
            let start = uv_offset + row * uv_stride;
            out.extend_from_slice(&mapped[start..start + row_bytes]);
        }
        out
    }
}

const RGBA_TO_NV12_SHADER: &str = r#"
struct Nv12Uniform {
    width: u32,
    height: u32,
    y_stride_words: u32,
    uv_offset_words: u32,
    uv_stride_words: u32,
    matrix: u32,
    _pad0: u32,
    _pad1: u32,
};

@group(0) @binding(0) var src_tex: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> out_buf: array<u32>;
@group(0) @binding(2) var<uniform> u: Nv12Uniform;

fn kr_kb() -> vec2<f32> {
    if (u.matrix == 1u) {
        return vec2<f32>(0.299, 0.114); // BT.601
    }
    return vec2<f32>(0.2126, 0.0722); // BT.709
}

fn load_rgb(x: u32, y: u32) -> vec3<f32> {
    let cx = min(x, u.width - 1u);
    let cy = min(y, u.height - 1u);
    return textureLoad(src_tex, vec2<i32>(i32(cx), i32(cy)), 0).rgb;
}

// Limited-range ("tv") luma byte: Y = 16 + 219 * Y'.
fn luma_byte(rgb: vec3<f32>) -> u32 {
    let k = kr_kb();
    let yp = k.x * rgb.r + (1.0 - k.x - k.y) * rgb.g + k.y * rgb.b;
    return u32(clamp(round(16.0 + 219.0 * yp), 0.0, 255.0));
}

// Limited-range chroma bytes: Cb/Cr = 128 + 224 * Pb/Pr.
fn chroma_bytes(rgb: vec3<f32>) -> vec2<u32> {
    let k = kr_kb();
    let yp = k.x * rgb.r + (1.0 - k.x - k.y) * rgb.g + k.y * rgb.b;
    let pb = 0.5 * (rgb.b - yp) / (1.0 - k.y);
    let pr = 0.5 * (rgb.r - yp) / (1.0 - k.x);
    return vec2<u32>(
        u32(clamp(round(128.0 + 224.0 * pb), 0.0, 255.0)),
        u32(clamp(round(128.0 + 224.0 * pr), 0.0, 255.0)),
    );
}

// One invocation packs 4 horizontal luma bytes into one u32 word.
@compute @workgroup_size(8, 8, 1)
fn y_pass(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= u.y_stride_words || gid.y >= u.height) {
        return;
    }
    let x0 = gid.x * 4u;
    let b0 = luma_byte(load_rgb(x0, gid.y));
    let b1 = luma_byte(load_rgb(x0 + 1u, gid.y));
    let b2 = luma_byte(load_rgb(x0 + 2u, gid.y));
    let b3 = luma_byte(load_rgb(x0 + 3u, gid.y));
    out_buf[gid.y * u.y_stride_words + gid.x] = b0 | (b1 << 8u) | (b2 << 16u) | (b3 << 24u);
}

// One invocation packs one u32 = [U0, V0, U1, V1]: two interleaved chroma
// pairs, each averaged over its 2x2 source block (rows 2*gid.y .. 2*gid.y+1).
@compute @workgroup_size(8, 8, 1)
fn uv_pass(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= u.uv_stride_words || gid.y >= u.height / 2u) {
        return;
    }
    let sy = gid.y * 2u;
    var word = 0u;
    for (var pair = 0u; pair < 2u; pair += 1u) {
        let sx = (gid.x * 2u + pair) * 2u;
        let avg = (load_rgb(sx, sy) + load_rgb(sx + 1u, sy)
            + load_rgb(sx, sy + 1u) + load_rgb(sx + 1u, sy + 1u)) * 0.25;
        let uv = chroma_bytes(avg);
        word |= (uv.x | (uv.y << 8u)) << (pair * 16u);
    }
    out_buf[u.uv_offset_words + gid.y * u.uv_stride_words + gid.x] = word;
}
"#;

/// Compute pipelines converting an RGBA texture into a padded NV12 storage
/// buffer. Device-scoped; created once per readback session.
pub(crate) struct Nv12Converter {
    bind_layout: wgpu::BindGroupLayout,
    pipeline_y: wgpu::ComputePipeline,
    pipeline_uv: wgpu::ComputePipeline,
    uniform_buffer: wgpu::Buffer,
    pub(crate) plan: Nv12Plan,
}

impl Nv12Converter {
    pub(crate) fn new(
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        plan: Nv12Plan,
        matrix: Nv12Matrix,
    ) -> Self {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("rgba-to-nv12"),
            source: wgpu::ShaderSource::Wgsl(RGBA_TO_NV12_SHADER.into()),
        });
        let bind_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("rgba-to-nv12-bind-layout"),
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
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: false },
                        has_dynamic_offset: false,
                        min_binding_size: None,
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
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("rgba-to-nv12-pipeline-layout"),
            bind_group_layouts: &[Some(&bind_layout)],
            immediate_size: 0,
        });
        let make_pipeline = |entry: &str| {
            device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some(&format!("rgba-to-nv12-{entry}")),
                layout: Some(&pipeline_layout),
                module: &shader,
                entry_point: Some(entry),
                compilation_options: Default::default(),
                cache: None,
            })
        };
        let pipeline_y = make_pipeline("y_pass");
        let pipeline_uv = make_pipeline("uv_pass");

        let uniform = Nv12Uniform {
            width: plan.width,
            height: plan.height,
            y_stride_words: plan.y_stride_words,
            uv_offset_words: plan.uv_offset_words,
            uv_stride_words: plan.uv_stride_words,
            matrix: match matrix {
                Nv12Matrix::Bt709 => 0,
                Nv12Matrix::Bt601 => 1,
            },
            _pad0: 0,
            _pad1: 0,
        };
        let uniform_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("rgba-to-nv12-uniform"),
            size: std::mem::size_of::<Nv12Uniform>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        queue.write_buffer(&uniform_buffer, 0, bytemuck::bytes_of(&uniform));

        Self {
            bind_layout,
            pipeline_y,
            pipeline_uv,
            uniform_buffer,
            plan,
        }
    }

    /// Creates the per-slot bind group (texture view + storage buffer).
    pub(crate) fn bind_group(
        &self,
        device: &wgpu::Device,
        view: &wgpu::TextureView,
        storage: &wgpu::Buffer,
    ) -> wgpu::BindGroup {
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("rgba-to-nv12-bind-group"),
            layout: &self.bind_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: storage.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: self.uniform_buffer.as_entire_binding(),
                },
            ],
        })
    }

    /// Records the two conversion dispatches into `encoder`.
    pub(crate) fn encode(&self, encoder: &mut wgpu::CommandEncoder, bind_group: &wgpu::BindGroup) {
        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("rgba-to-nv12"),
            timestamp_writes: None,
        });
        pass.set_pipeline(&self.pipeline_y);
        pass.set_bind_group(0, bind_group, &[]);
        pass.dispatch_workgroups(
            self.plan.y_stride_words.div_ceil(8),
            self.plan.height.div_ceil(8),
            1,
        );
        pass.set_pipeline(&self.pipeline_uv);
        pass.set_bind_group(0, bind_group, &[]);
        pass.dispatch_workgroups(
            self.plan.uv_stride_words.div_ceil(8),
            self.plan.uv_rows.div_ceil(8),
            1,
        );
    }
}

/// Reference CPU implementation of the shader's colour math, for tests and for
/// documenting the exact contract (limited-range studio swing).
#[cfg(test)]
pub(crate) fn reference_yuv(rgb: [f32; 3], matrix: Nv12Matrix) -> (u8, u8, u8) {
    let (kr, kb) = match matrix {
        Nv12Matrix::Bt709 => (0.2126f32, 0.0722f32),
        Nv12Matrix::Bt601 => (0.299f32, 0.114f32),
    };
    let yp = kr * rgb[0] + (1.0 - kr - kb) * rgb[1] + kb * rgb[2];
    let pb = 0.5 * (rgb[2] - yp) / (1.0 - kb);
    let pr = 0.5 * (rgb[0] - yp) / (1.0 - kr);
    let y = (16.0 + 219.0 * yp).round().clamp(0.0, 255.0) as u8;
    let cb = (128.0 + 224.0 * pb).round().clamp(0.0, 255.0) as u8;
    let cr = (128.0 + 224.0 * pr).round().clamp(0.0, 255.0) as u8;
    (y, cb, cr)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_rejects_odd_dimensions() {
        assert!(Nv12Plan::new(1919, 1080).is_none());
        assert!(Nv12Plan::new(1920, 1079).is_none());
        assert!(Nv12Plan::new(0, 0).is_none());
    }

    #[test]
    fn plan_word_aligned_width_is_tight() {
        let plan = Nv12Plan::new(1920, 1080).unwrap();
        assert_eq!(plan.y_stride_words, 480);
        assert_eq!(plan.uv_offset_words, 480 * 1080);
        assert_eq!(plan.uv_rows, 540);
        assert_eq!(plan.padded_bytes(), 1920 * 1080 * 3 / 2);
        assert_eq!(plan.tight_bytes(), 1920 * 1080 * 3 / 2);
    }

    #[test]
    fn plan_non_word_width_pads_rows() {
        // 1282 % 4 == 2 → rows pad up to the next word.
        let plan = Nv12Plan::new(1282, 720).unwrap();
        assert_eq!(plan.y_stride_words, 321);
        assert_eq!(plan.uv_stride_words, 321);
        assert!(plan.padded_bytes() > plan.tight_bytes() as u64);
    }

    #[test]
    fn repack_tight_is_prefix_copy() {
        let plan = Nv12Plan::new(4, 2).unwrap();
        let mapped: Vec<u8> = (0..plan.padded_bytes() as usize as u8).collect();
        let out = plan.repack(&mapped);
        assert_eq!(out.len(), plan.tight_bytes());
        assert_eq!(&out[..], &mapped[..plan.tight_bytes()]);
    }

    #[test]
    fn repack_strips_row_padding() {
        // width 6 → y rows are 6 bytes tight, 8 bytes padded (2 words).
        let plan = Nv12Plan::new(6, 2).unwrap();
        assert_eq!(plan.y_stride_words, 2);
        let padded = plan.padded_bytes() as usize;
        let mut mapped = vec![0u8; padded];
        for (i, b) in mapped.iter_mut().enumerate() {
            *b = (i % 251) as u8;
        }
        let out = plan.repack(&mapped);
        assert_eq!(out.len(), plan.tight_bytes());
        // Y row 0 = padded bytes 0..6, Y row 1 = 8..14, UV row 0 = 16..22.
        assert_eq!(&out[0..6], &mapped[0..6]);
        assert_eq!(&out[6..12], &mapped[8..14]);
        assert_eq!(&out[12..18], &mapped[16..22]);
    }

    #[test]
    fn reference_yuv_matches_standard_anchor_points() {
        // Black / white / primary anchors of the limited-range BT.709 transform.
        assert_eq!(
            reference_yuv([0.0, 0.0, 0.0], Nv12Matrix::Bt709),
            (16, 128, 128)
        );
        assert_eq!(
            reference_yuv([1.0, 1.0, 1.0], Nv12Matrix::Bt709),
            (235, 128, 128)
        );
        // Pure red BT.709: Y = 16 + 219*0.2126 ≈ 63, Cr = 128 + 112 = 240.
        let (y, cb, cr) = reference_yuv([1.0, 0.0, 0.0], Nv12Matrix::Bt709);
        assert_eq!(y, 63);
        assert_eq!(cr, 240);
        assert!(cb < 128);
        // BT.601 red luma is noticeably higher (Kr 0.299): Y ≈ 81.
        let (y601, _, cr601) = reference_yuv([1.0, 0.0, 0.0], Nv12Matrix::Bt601);
        assert_eq!(y601, 81);
        assert_eq!(cr601, 240);
    }

    #[test]
    fn matrix_follows_output_height_convention() {
        assert_eq!(Nv12Matrix::for_output_height(1080), Nv12Matrix::Bt709);
        assert_eq!(Nv12Matrix::for_output_height(720), Nv12Matrix::Bt709);
        assert_eq!(Nv12Matrix::for_output_height(576), Nv12Matrix::Bt601);
        assert_eq!(Nv12Matrix::for_output_height(480), Nv12Matrix::Bt601);
    }
}
