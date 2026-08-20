//! Building the domain `compositor::scene::Scene` from the `MonitorScene` IPC DTO.
//!
//! This logic used to be duplicated in `monitor::runtime` (live preview) and
//! `media::timeline_render` (thumbnail/export) — two nearly identical sets of
//! `parse_*` helpers and layer-build branches. The shared code now lives here, and
//! the callers differ only in HOW they resolve raster layers (video/image/svg):
//!   - live: from the decoder cache (`LayerRuntimeManager`);
//!   - export/thumbnail: by synchronous decode.
//!
//! This module does NOT resolve raster kinds (`Video | Image | Svg`) — it builds
//! only the "virtual" layers (`Background | Shape | Text`) and finalizes any
//! `CompLayerKind` into a `Layer` (transform + opacity + blend).

pub mod animation;
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
