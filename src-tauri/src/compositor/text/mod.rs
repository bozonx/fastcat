//! Текстовый рендер: parley (layout + shaping) -> vello Glyph runs.

use std::sync::{Mutex, OnceLock};
use parley::{FontContext, LayoutContext};

pub static TEXT_CTX: OnceLock<Mutex<(FontContext, LayoutContext<[u8; 4]>)>> = OnceLock::new();

pub fn get_text_context() -> &'static Mutex<(FontContext, LayoutContext<[u8; 4]>)>{
    TEXT_CTX.get_or_init(|| Mutex::new((FontContext::new(), LayoutContext::new())))
}

pub fn clean_font_family(raw: &str) -> String {
    let first_part = raw.split(',').next().unwrap_or(raw).trim();
    first_part.trim_matches(|c| c == '\'' || c == '"').to_string()
}
