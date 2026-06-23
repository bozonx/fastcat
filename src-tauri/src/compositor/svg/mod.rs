//! SVG-слой.
//!
//! SVG сейчас приходит в compositor уже как raster `ImageData`: live-preview делает это в
//! `monitor::runtime`, thumbnail/export — в `media::timeline_render`, общий rasterizer живёт в
//! `monitor::scene::build::rasterize_svg`. Размер растра выбирается под целевую длинную сторону:
//! monitor preview учитывает `preview_scale`, export/thumbnail — выходное разрешение кадра.
