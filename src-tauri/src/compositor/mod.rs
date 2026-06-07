//! Vello-based video compositor.
//!
//! Layout:
//! - `scene` — domain frame model (`Scene`, `Layer`, `LayerKind`, `Transform`,
//!   `BlendMode`, `Mask`, `RasterSource`). `Scene::to_vello(w, h)` is the single
//!   place that builds a `vello::Scene` from the domain model; called inside `Compositor`.
//! - `effects` — `EffectSpec` enum + wgpu runtime for raster layers.
//! - `transitions` — `TransitionSpec` enum. No dedicated runtime.
//! - `text`, `svg` — documentation-only modules for future layers.
//!
//! GPU-resident video frames hold `wgpu::Texture` directly in `RasterSource::GpuTexture`
//! (Arc). The texture lifetime equals the frame lifetime in the per-layer cache;
//! no separate global texture cache with independent eviction remains.
//!
//! Entrypoint: [`Compositor`] — high-level `render_scene_to_*` + low-level `render_to_*`.

pub mod effects;
pub mod scene;
pub mod svg;
pub mod text;
pub mod transitions;

#[allow(clippy::module_inception)]
mod compositor;
pub use compositor::Compositor;

mod readback;
pub use readback::PipelinedReadback;

mod gpu_utils;
