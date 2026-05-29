//! Текстовый рендер: parley (layout + shaping) -> vello Glyph runs.
//! TODO: загрузка пользовательских шрифтов из проекта (см. фронтовый load-fonts.ts).

use crate::compositor::layers::TextSpec;

pub fn layout_text(_spec: &TextSpec) {
    // TODO: parley::FontContext + LayoutContext, вернуть готовый layout
    // плюс конвертер в vello::Scene draw_glyph_run.
}
