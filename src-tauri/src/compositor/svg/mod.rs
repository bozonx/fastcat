//! SVG layer.
//!
//! SVG currently arrives at the compositor already as a raster `ImageData`: live preview does this in
//! `monitor::runtime`, thumbnail/export in `media::timeline_render`, and the shared rasterizer lives in
//! `monitor::scene::build::rasterize_svg`. The raster size is chosen for the target long edge:
//! monitor preview accounts for `preview_scale`, export/thumbnail for the output frame resolution.
