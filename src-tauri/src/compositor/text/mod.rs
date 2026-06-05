//! Текстовый рендер: parley (layout + shaping) -> vello Glyph runs.

use std::sync::{Mutex, OnceLock};
use parley::{FontContext, LayoutContext};
use parley::fontique::GenericFamily;

pub static TEXT_CTX: OnceLock<Mutex<(FontContext, LayoutContext<[u8; 4]>)>> = OnceLock::new();

pub fn get_text_context() -> &'static Mutex<(FontContext, LayoutContext<[u8; 4]>)> {
    TEXT_CTX.get_or_init(|| Mutex::new((FontContext::new(), LayoutContext::new())))
}

fn parse_generic_family(name: &str) -> Option<GenericFamily> {
    match name.to_lowercase().as_str() {
        "sans-serif" => Some(GenericFamily::SansSerif),
        "serif" => Some(GenericFamily::Serif),
        "monospace" => Some(GenericFamily::Monospace),
        "cursive" => Some(GenericFamily::Cursive),
        "fantasy" => Some(GenericFamily::Fantasy),
        _ => None,
    }
}

fn generic_family_str(family: GenericFamily) -> &'static str {
    match family {
        GenericFamily::Serif => "serif",
        GenericFamily::Monospace => "monospace",
        GenericFamily::Cursive => "cursive",
        GenericFamily::Fantasy => "fantasy",
        _ => "sans-serif",
    }
}

/// Parse a CSS font-family stack and return the primary name + inferred generic fallback.
pub fn resolve_font_family(raw: &str) -> (String, GenericFamily) {
    let parts: Vec<&str> = raw.split(',').map(|s| s.trim()).collect();
    let primary = parts
        .first()
        .unwrap_or(&"sans-serif")
        .trim_matches(|c| c == '\'' || c == '"')
        .to_string();

    // If the primary itself is a generic CSS family name, treat it as the fallback.
    let generic_from_primary = parse_generic_family(&primary);

    let generic = parts
        .iter()
        .skip(1)
        .find_map(|p| parse_generic_family(p.trim_matches(|c| c == '\'' || c == '"')))
        .or(generic_from_primary)
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
    // CSS generic family names (e.g. "sans-serif") are not real font names —
    // resolve them directly without querying the system collection.
    if let Some(generic) = parse_generic_family(primary) {
        return parley::style::FontFamily::from(generic_family_str(generic));
    }

    if font_cx.collection.family_id(primary).is_some() {
        return parley::style::FontFamily::named(primary);
    }

    log::warn!(
        "[text] font '{}' not found in system collection, falling back to {:?}",
        primary,
        fallback
    );
    parley::style::FontFamily::from(generic_family_str(fallback))
}

pub fn clean_font_family(raw: &str) -> String {
    let first_part = raw.split(',').next().unwrap_or(raw).trim();
    first_part.trim_matches(|c| c == '\'' || c == '"').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_generic_family_recognises_css_names() {
        assert_eq!(parse_generic_family("sans-serif"), Some(GenericFamily::SansSerif));
        assert_eq!(parse_generic_family("Sans-Serif"), Some(GenericFamily::SansSerif));
        assert_eq!(parse_generic_family("serif"), Some(GenericFamily::Serif));
        assert_eq!(parse_generic_family("monospace"), Some(GenericFamily::Monospace));
        assert_eq!(parse_generic_family("cursive"), Some(GenericFamily::Cursive));
        assert_eq!(parse_generic_family("fantasy"), Some(GenericFamily::Fantasy));
        assert_eq!(parse_generic_family("Inter"), None);
        assert_eq!(parse_generic_family(""), None);
    }

    #[test]
    fn resolve_font_family_extracts_primary_and_generic() {
        let (primary, generic) = resolve_font_family("Inter, sans-serif");
        assert_eq!(primary, "Inter");
        assert!(matches!(generic, GenericFamily::SansSerif));

        let (primary, generic) = resolve_font_family("'Times New Roman', serif");
        assert_eq!(primary, "Times New Roman");
        assert!(matches!(generic, GenericFamily::Serif));
    }

    #[test]
    fn resolve_font_family_treats_primary_generic_as_fallback() {
        let (primary, generic) = resolve_font_family("sans-serif");
        assert_eq!(primary, "sans-serif");
        assert!(matches!(generic, GenericFamily::SansSerif));

        let (primary, generic) = resolve_font_family("monospace");
        assert_eq!(primary, "monospace");
        assert!(matches!(generic, GenericFamily::Monospace));
    }

    #[test]
    fn build_font_family_resolves_generic_without_lookup() {
        let mut font_cx = FontContext::new();

        // Generic CSS family names should resolve directly without warn / family_id lookup
        let family = build_font_family(&mut font_cx, "sans-serif", GenericFamily::Serif);
        assert_eq!(family, parley::style::FontFamily::from("sans-serif"));

        let family = build_font_family(&mut font_cx, "serif", GenericFamily::SansSerif);
        assert_eq!(family, parley::style::FontFamily::from("serif"));

        let family = build_font_family(&mut font_cx, "monospace", GenericFamily::SansSerif);
        assert_eq!(family, parley::style::FontFamily::from("monospace"));
    }

    #[test]
    fn build_font_family_falls_back_for_unknown_custom_font() {
        let mut font_cx = FontContext::new();

        let family = build_font_family(&mut font_cx, "DefinitelyNotARealFontXYZ", GenericFamily::Serif);
        assert_eq!(family, parley::style::FontFamily::from("serif"));
    }
}
