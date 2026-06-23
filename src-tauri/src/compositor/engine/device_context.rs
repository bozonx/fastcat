use std::collections::HashMap;

use vello::util::RenderContext;
use vello::Renderer;

/// GPU resources whose lifetime is tied to a Vello device id.
pub(super) struct DeviceContext {
    pub(super) render_cx: RenderContext,
    pub(super) renderers: HashMap<usize, Renderer>,
    pub(super) offscreen: HashMap<usize, OffscreenTarget>,
    pub(super) pipeline_caches: HashMap<usize, wgpu::PipelineCache>,
}

impl DeviceContext {
    pub(super) fn new() -> Self {
        Self {
            render_cx: RenderContext::new(),
            renderers: HashMap::new(),
            offscreen: HashMap::new(),
            pipeline_caches: HashMap::new(),
        }
    }
}

/// Reusable target for synchronous offscreen rendering and pixel readback.
pub(super) struct OffscreenTarget {
    pub(super) width: u32,
    pub(super) height: u32,
    pub(super) texture: wgpu::Texture,
    pub(super) view: wgpu::TextureView,
    pub(super) buffer: wgpu::Buffer,
    pub(super) aligned_row_bytes: usize,
}
