//! Vello-based video compositor.
//!
//! Раскладка:
//! - `scene`          — доменная модель кадра (`Scene`, `Layer`, `LayerKind`,
//!                      `Transform`, `BlendMode`, `Mask`, `RasterSource`).
//!                      Включает `Scene::to_vello(viewport)` — единственное место
//!                      в кодовой базе, которое строит `vello::Scene` из доменной.
//! - `layers`         — спецификации будущих kind'ов (ShapeSpec, TextSpec, Paint, …).
//!                      Сейчас не подключены в `LayerKind`; «словарь» для расширения.
//! - `effects`        — `EffectSpec` enum. Runtime отсутствует (`Layer::effects`
//!                      пока игнорируется в `Scene::to_vello`).
//! - `transitions`    — `TransitionSpec` enum. Runtime отсутствует.
//! - `text`, `svg`    — модули-документация для будущих text/svg слоёв.
//! - `texture_cache`  — задел под GPU-resident текстуры (HW-decode, group cache).
//!
//! Entrypoint: [`Compositor`] держит `vello::RenderContext` + кеш `Renderer` по device.

pub mod effects;
pub mod layers;
pub mod scene;
pub mod svg;
pub mod text;
pub mod texture_cache;
pub mod transitions;

mod compositor;
pub use compositor::Compositor;
