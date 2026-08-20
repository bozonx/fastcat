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
pub(crate) mod svg;
pub(crate) mod text;
pub mod transitions;
pub(crate) mod yuv;

mod engine;
pub use engine::Compositor;
pub(crate) use engine::GpuCtx;

mod render_telemetry;

mod text_engine;

mod nv12;
pub use nv12::Nv12Matrix;

mod readback;
pub(crate) use readback::PipelinedReadback;
pub use readback::ReadbackFormat;

mod gpu_utils;
