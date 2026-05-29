//! Vello-based video compositor.
//!
//! Layout:
//! - `scene`       — описание кадра (что рендерить): слои, маски, blend modes, transform.
//! - `layers`      — типы слоёв (video frame, image, shape, svg, text, group).
//! - `effects`     — пост-эффекты на слой (blur, color, chroma key, ...): wgpu compute/render passes.
//! - `transitions` — переходы между сценами (crossfade, wipe, dissolve): wgpu shader passes.
//! - `text`        — обвязка над parley для титров.
//! - `svg`         — usvg/vello_svg адаптер.
//! - `gpu`         — wgpu device, surface, текстуры, ресурс-менеджер.
//!
//! Entrypoint: [`Compositor`] держит wgpu device/queue, vello renderer и собирает кадр
//! из [`scene::Scene`] в указанный target (window surface или offscreen texture для экспорта).

pub mod gpu;
pub mod scene;
pub mod layers;
pub mod effects;
pub mod transitions;
pub mod text;
pub mod svg;

mod compositor;
pub use compositor::Compositor;
