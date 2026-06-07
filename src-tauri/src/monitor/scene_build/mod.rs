//! Сборка доменной `compositor::scene::Scene` из IPC-DTO `MonitorScene`.
//!
//! Раньше эта логика была продублирована в `monitor::runtime` (live-preview) и
//! `media::timeline_render` (thumbnail/export) — два почти идентичных набора
//! `parse_*`-хелперов и веток сборки слоёв. Теперь общий код живёт здесь, а
//! вызывающие отличаются только тем, КАК резолвят растровые слои (video/image/svg):
//!   - live: из кеша декодеров (`LayerRuntimeManager`);
//!   - export/thumbnail: синхронным декодом.
//!
//! Растровые kind'ы (`Video | Image | Svg`) этот модуль НЕ резолвит — он строит
//! только «виртуальные» слои (`Background | Shape | Text`) и финализирует любой
//! `CompLayerKind` в `Layer` (transform + opacity + blend).

pub mod compositor_scene;
pub mod ipc_parsers;
pub mod layer_builder;
pub mod svg_raster;
pub mod transform;
pub mod transition;

pub use compositor_scene::*;
pub use ipc_parsers::*;
pub use layer_builder::*;
pub use svg_raster::*;
pub use transform::*;
pub use transition::*;

#[cfg(test)]
mod tests;
