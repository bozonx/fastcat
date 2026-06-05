//! Текстовый рендер: parley (layout + shaping) -> vello Glyph runs.

use std::sync::{Mutex, OnceLock};
use parley::{FontContext, LayoutContext};
use parley::fontique::GenericFamily;

pub static TEXT_CTX: OnceLock<Mutex<(FontContext, LayoutContext<[u8; 4]>)>> = OnceLock::new();

pub fn get_text_context() -> &'static Mutex<(FontContext, LayoutContext<[u8; 4]>)> {
    TEXT_CTX.get_or_init(|| Mutex::new((FontContext::new(), LayoutContext::new())))
}

/// Parse a CSS font-family stack and return the primary name + inferred generic fallback.
pub fn resolve_font_family(raw: &str) -> (String, GenericFamily) {
    let parts: Vec<&str> = raw.split(',').map(|s| s.trim()).collect();
    let primary = parts
        .first()
        .unwrap_or(&"sans-serif")
        .trim_matches(|c| c == '\'' || c == '"')
        .to_string();

    let generic = parts
        .iter()
        .skip(1)
        .find_map(|p| {
            match p.trim_matches(|c| c == '\'' || c == '"').to_lowercase().as_str() {
                "sans-serif" => Some(GenericFamily::SansSerif),
                "serif" => Some(GenericFamily::Serif),
                "monospace" => Some(GenericFamily::Monospace),
                "cursive" => Some(GenericFamily::Cursive),
                "fantasy" => Some(GenericFamily::Fantasy),
                _ => None,
            }
        })
        .unwrap_or(GenericFamily::SansSerif);

    (primary, generic)
}

/// Resolve a font name through the font context, falling back to a generic family
/// when the primary font is not available in the system.
pub fn build_font_family<'a>(
    font_cx: &mut FontContext,
    primary: &'a str,
    fallback: GenericFamily,
) -> parley::style::FontFamily<'a> {
    if font_cx.collection.family_id(primary).is_some() {
        parley::style::FontFamily::named(primary)
    } else {
        log::warn!(
            "[text] font '{}' not found in system collection, falling back to {:?}",
            primary,
            fallback
        );
        let fallback_str = match fallback {
            GenericFamily::Serif => "serif",
            GenericFamily::Monospace => "monospace",
            GenericFamily::Cursive => "cursive",
            GenericFamily::Fantasy => "fantasy",
            _ => "sans-serif",
        };
        parley::style::FontFamily::from(fallback_str)
    }
}

pub fn clean_font_family(raw: &str) -> String {
    let first_part = raw.split(',').next().unwrap_or(raw).trim();
    first_part.trim_matches(|c| c == '\'' || c == '"').to_string()
}
