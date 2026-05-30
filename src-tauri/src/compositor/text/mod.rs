//! Текстовый рендер: parley (layout + shaping) -> vello Glyph runs.
//!
//! Сейчас runtime отсутствует — `TextSpec` живёт в `super::layers` как «словарь
//! будущих kind'ов». Подключение: добавить `LayerKind::Text(TextSpec)`,
//! реализовать `layout_text(spec) -> ParleyLayout`, и в `Scene::to_vello` —
//! ветку `LayerKind::Text` с `scene.draw_glyph_run(...)`.
//!
//! Загрузка пользовательских шрифтов из проекта — см. фронтовый `load-fonts.ts`.
