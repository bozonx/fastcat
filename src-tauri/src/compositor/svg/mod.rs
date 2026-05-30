//! SVG-слой.
//!
//! Сейчас runtime отсутствует. Подключение: добавить `LayerKind::Svg { source: String }`,
//! и в `Scene::to_vello` — ветку `vello_svg::append(&mut scene, svg_source)`.
