//! Vello-based video compositor.
//!
//! Раскладка:
//! - `scene`         — доменная модель кадра (`Scene`, `Layer`, `LayerKind`,
//!                     `Transform`, `BlendMode`, `Mask`, `RasterSource`).
//!                     `Scene::to_vello(w, h)` — единственное место, строящее
//!                     `vello::Scene` из доменной; вызывается внутри `Compositor`.
//! - `effects`       — `EffectSpec` enum + wgpu runtime для raster layers.
//! - `transitions`   — `TransitionSpec` enum. Runtime отсутствует.
//! - `text`, `svg`   — модули-документация для будущих слоёв.
//!
//! GPU-resident видеокадры держат `wgpu::Texture` напрямую в `RasterSource::GpuTexture`
//! (Arc), время жизни текстуры = время жизни кадра в per-layer кеше; отдельного
//! глобального texture-кеша с независимым вытеснением больше нет.
//!
//! Entrypoint: [`Compositor`] — high-level `render_scene_to_*` + low-level `render_to_*`.

pub mod effects;
pub mod scene;
pub mod svg;
pub mod text;
pub mod transitions;

mod compositor;
pub use compositor::{Compositor, PipelinedReadback};
