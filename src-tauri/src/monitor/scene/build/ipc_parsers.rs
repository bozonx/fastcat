//! Parsing IPC fields from `serde_json::Value` into compositor types.

use vello::peniko::Color;

use crate::compositor::scene::{BlendMode, ShapeGeometry, TextAlign, TextVerticalAlign};

/// Maps a string blend mode from the timeline to `compositor::scene::BlendMode`.
/// Supports the full set of CSS/Pixi modes (the same list as the frontend
/// `TimelineBlendMode`). An unknown value → `Normal`.
pub fn parse_blend_mode(value: &str) -> BlendMode {
    match value {
        "add" | "plus" | "linear-dodge" => BlendMode::Add,
        "multiply" => BlendMode::Multiply,
        "screen" => BlendMode::Screen,
        "overlay" => BlendMode::Overlay,
        "darken" => BlendMode::Darken,
        "lighten" => BlendMode::Lighten,
        "color-dodge" => BlendMode::ColorDodge,
        "color-burn" => BlendMode::ColorBurn,
        "hard-light" => BlendMode::HardLight,
        "soft-light" => BlendMode::SoftLight,
        "difference" => BlendMode::Difference,
        "exclusion" => BlendMode::Exclusion,
        "hue" => BlendMode::Hue,
        "saturation" => BlendMode::Saturation,
        "color" => BlendMode::Color,
        "luminosity" => BlendMode::Luminosity,
        _ => BlendMode::Normal,
    }
}

pub fn parse_color(input: &str, alpha: f64) -> Color {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Color::TRANSPARENT;
    }
    let lower = trimmed.to_lowercase();

    // `transparent` keyword
    if lower == "transparent" {
        return Color::TRANSPARENT;
    }

    // Named colors (subset of CSS)
    let named = match lower.as_str() {
        "black" => Some((0, 0, 0)),
        "white" => Some((255, 255, 255)),
        "red" => Some((255, 0, 0)),
        "green" => Some((0, 128, 0)),
        "blue" => Some((0, 0, 255)),
        "yellow" => Some((255, 255, 0)),
        "cyan" => Some((0, 255, 255)),
        "magenta" => Some((255, 0, 255)),
        "silver" => Some((192, 192, 192)),
        "gray" | "grey" => Some((128, 128, 128)),
        "maroon" => Some((128, 0, 0)),
        "olive" => Some((128, 128, 0)),
        "lime" => Some((0, 255, 0)),
        "aqua" => Some((0, 255, 255)),
        "teal" => Some((0, 128, 128)),
        "navy" => Some((0, 0, 128)),
        "fuchsia" => Some((255, 0, 255)),
        "purple" => Some((128, 0, 128)),
        "orange" => Some((255, 165, 0)),
        _ => None,
    };
    if let Some((r, g, b)) = named {
        let a = (255_f64 * alpha.clamp(0.0, 1.0)).round() as u8;
        return Color::from_rgba8(r, g, b, a);
    }

    fn parse_color_channel(s: &str) -> Option<u8> {
        let s = s.trim();
        if let Some(pct) = s.strip_suffix('%') {
            let pct = pct.trim().parse::<f64>().ok()?;
            return Some(((pct / 100.0) * 255.0).round().clamp(0.0, 255.0) as u8);
        }
        // Allow floats by rounding to nearest u8
        if let Ok(v) = s.parse::<f64>() {
            return Some(v.round().clamp(0.0, 255.0) as u8);
        }
        s.parse::<u8>().ok()
    }

    // rgb(r, g, b)
    if let Some(caps) = lower.strip_prefix("rgb(").and_then(|s| s.strip_suffix(")")) {
        let parts: Vec<&str> = caps.split(',').collect();
        if parts.len() == 3 {
            if let (Some(r), Some(g), Some(b)) = (
                parse_color_channel(parts[0]),
                parse_color_channel(parts[1]),
                parse_color_channel(parts[2]),
            ) {
                let a = (255_f64 * alpha.clamp(0.0, 1.0)).round() as u8;
                return Color::from_rgba8(r, g, b, a);
            }
        }
    }

    // rgba(r, g, b, a)
    if let Some(caps) = lower
        .strip_prefix("rgba(")
        .and_then(|s| s.strip_suffix(")"))
    {
        let parts: Vec<&str> = caps.split(',').collect();
        if parts.len() == 4 {
            if let (Some(r), Some(g), Some(b), Some(a_in)) = (
                parse_color_channel(parts[0]),
                parse_color_channel(parts[1]),
                parse_color_channel(parts[2]),
                parts[3].trim().parse::<f64>().ok(),
            ) {
                let a = ((255.0 * a_in * alpha).clamp(0.0, 255.0)).round() as u8;
                return Color::from_rgba8(r, g, b, a);
            }
        }
    }

    // Hex
    let hex = trimmed.trim_start_matches('#');
    let parse_pair = |s: &str| u8::from_str_radix(s, 16).ok();
    let (r, g, b, a) = match hex.len() {
        3 | 4 => {
            let mut chars = hex.chars();
            let dbl =
                |c: Option<char>| c.and_then(|c| u8::from_str_radix(&format!("{c}{c}"), 16).ok());
            let (r, g, b) = (dbl(chars.next()), dbl(chars.next()), dbl(chars.next()));
            // 4-digit hex form carries alpha in the fourth nibble.
            let a = if hex.len() == 4 {
                dbl(chars.next())
            } else {
                Some(255)
            };
            (r, g, b, a)
        }
        6 | 8 => (
            parse_pair(&hex[0..2]),
            parse_pair(&hex[2..4]),
            parse_pair(&hex[4..6]),
            if hex.len() == 8 {
                parse_pair(&hex[6..8])
            } else {
                Some(255)
            },
        ),
        _ => (None, None, None, None),
    };

    // Invalid / unknown strings fall back to transparent.
    match (r, g, b, a) {
        (Some(r), Some(g), Some(b), Some(a_raw)) => {
            let a = ((a_raw as f64) * alpha.clamp(0.0, 1.0)).round() as u8;
            Color::from_rgba8(r, g, b, a)
        }
        _ => Color::TRANSPARENT,
    }
}

pub fn number(value: &serde_json::Value, key: &str, fallback: f64) -> f64 {
    number_opt(value, key).unwrap_or(fallback)
}

pub fn number_opt(value: &serde_json::Value, key: &str) -> Option<f64> {
    value
        .get(key)
        .and_then(|v| v.as_f64())
        .filter(|v| v.is_finite())
}

/// Fraction from a percentage field: `number/100`, clamped to 0..10.
pub fn percent(value: &serde_json::Value, key: &str, fallback: f64) -> f64 {
    (number(value, key, fallback) / 100.0).clamp(0.0, 10.0)
}

pub fn parse_shape_geometry(shape_type: &str, cfg: &serde_json::Value) -> ShapeGeometry {
    match shape_type {
        "circle" => ShapeGeometry::Circle {
            squash_x: percent(cfg, "squashX", 0.0),
            squash_y: percent(cfg, "squashY", 0.0),
        },
        "triangle" => ShapeGeometry::Triangle {
            base_length: percent(cfg, "baseLength", 100.0),
            vertex_offset: percent(cfg, "vertexOffset", 50.0),
        },
        "star" => ShapeGeometry::Star {
            rays: number(cfg, "rays", 5.0).round().max(2.0) as usize,
            inner_radius: percent(cfg, "innerRadius", 40.0),
        },
        "bang" => ShapeGeometry::Bang {
            rays: number(cfg, "rays", 12.0).round().max(2.0) as usize,
            inner_radius: percent(cfg, "innerRadius", 70.0),
        },
        "speech_bubble" => ShapeGeometry::SpeechBubble {
            width: percent(cfg, "width", 100.0),
            height: percent(cfg, "height", 70.0),
            corner_radius: percent(cfg, "cornerRadius", 20.0),
            pointer_x: percent(cfg, "pointerX", 30.0),
            pointer_w: percent(cfg, "pointerAngle", 20.0),
            pointer_h: percent(cfg, "pointerSharpness", 40.0),
            pointer_right: cfg.get("pointerDirection").and_then(|v| v.as_str()) == Some("right"),
        },
        "cloud" => ShapeGeometry::Cloud {
            cloud_type: number(cfg, "cloudType", 1.0).round() as i32,
        },
        _ => ShapeGeometry::Rectangle {
            width: percent(cfg, "width", 100.0),
            height: percent(cfg, "height", 100.0),
            corner_radius: percent(cfg, "cornerRadius", 0.0),
        },
    }
}

pub fn string_value(value: &serde_json::Value, key: &str, fallback: &str) -> String {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .filter(|v| !v.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

pub fn bool_value(value: &serde_json::Value, key: &str, fallback: bool) -> bool {
    value.get(key).and_then(|v| v.as_bool()).unwrap_or(fallback)
}

pub fn font_weight(value: &serde_json::Value) -> f32 {
    match value.get("fontWeight") {
        Some(v) if v.is_number() => v.as_f64().unwrap_or(700.0) as f32,
        Some(v) if v.as_str() == Some("normal") => 400.0,
        Some(v) if v.as_str() == Some("bold") => 700.0,
        Some(v) => v
            .as_str()
            .and_then(|s| s.parse::<f32>().ok())
            .unwrap_or(700.0),
        None => 700.0,
    }
}

pub fn text_align(value: &serde_json::Value) -> TextAlign {
    match value.get("align").and_then(|v| v.as_str()) {
        Some("left") => TextAlign::Left,
        Some("right") => TextAlign::Right,
        _ => TextAlign::Center,
    }
}

pub fn text_vertical_align(value: &serde_json::Value) -> TextVerticalAlign {
    match value.get("verticalAlign").and_then(|v| v.as_str()) {
        Some("top") => TextVerticalAlign::Top,
        Some("bottom") => TextVerticalAlign::Bottom,
        _ => TextVerticalAlign::Middle,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_blend_mode_known_modes() {
        assert_eq!(parse_blend_mode("normal"), BlendMode::Normal);
        assert_eq!(parse_blend_mode("add"), BlendMode::Add);
        assert_eq!(parse_blend_mode("plus"), BlendMode::Add);
        assert_eq!(parse_blend_mode("linear-dodge"), BlendMode::Add);
        assert_eq!(parse_blend_mode("multiply"), BlendMode::Multiply);
        assert_eq!(parse_blend_mode("screen"), BlendMode::Screen);
        assert_eq!(parse_blend_mode("overlay"), BlendMode::Overlay);
        assert_eq!(parse_blend_mode("darken"), BlendMode::Darken);
        assert_eq!(parse_blend_mode("lighten"), BlendMode::Lighten);
        assert_eq!(parse_blend_mode("color-dodge"), BlendMode::ColorDodge);
        assert_eq!(parse_blend_mode("color-burn"), BlendMode::ColorBurn);
        assert_eq!(parse_blend_mode("hard-light"), BlendMode::HardLight);
        assert_eq!(parse_blend_mode("soft-light"), BlendMode::SoftLight);
        assert_eq!(parse_blend_mode("difference"), BlendMode::Difference);
        assert_eq!(parse_blend_mode("exclusion"), BlendMode::Exclusion);
        assert_eq!(parse_blend_mode("hue"), BlendMode::Hue);
        assert_eq!(parse_blend_mode("saturation"), BlendMode::Saturation);
        assert_eq!(parse_blend_mode("color"), BlendMode::Color);
        assert_eq!(parse_blend_mode("luminosity"), BlendMode::Luminosity);
    }

    #[test]
    fn parse_blend_mode_unknown_falls_back_to_normal() {
        assert_eq!(parse_blend_mode("nonexistent"), BlendMode::Normal);
        assert_eq!(parse_blend_mode(""), BlendMode::Normal);
    }

    #[test]
    fn parse_color_empty_and_transparent() {
        assert_eq!(parse_color("", 1.0), Color::TRANSPARENT);
        assert_eq!(parse_color("   ", 1.0), Color::TRANSPARENT);
        assert_eq!(parse_color("transparent", 1.0), Color::TRANSPARENT);
        assert_eq!(parse_color("TRANSPARENT", 1.0), Color::TRANSPARENT);
    }

    #[test]
    fn parse_color_named_colors() {
        assert_eq!(parse_color("black", 1.0), Color::from_rgba8(0, 0, 0, 255));
        assert_eq!(
            parse_color("white", 1.0),
            Color::from_rgba8(255, 255, 255, 255)
        );
        assert_eq!(parse_color("red", 1.0), Color::from_rgba8(255, 0, 0, 255));
        assert_eq!(parse_color("blue", 1.0), Color::from_rgba8(0, 0, 255, 255));
        assert_eq!(
            parse_color("gray", 1.0),
            Color::from_rgba8(128, 128, 128, 255)
        );
        assert_eq!(
            parse_color("grey", 1.0),
            Color::from_rgba8(128, 128, 128, 255)
        );
        assert_eq!(
            parse_color("orange", 1.0),
            Color::from_rgba8(255, 165, 0, 255)
        );
    }

    #[test]
    fn parse_color_named_with_alpha() {
        assert_eq!(parse_color("red", 0.5), Color::from_rgba8(255, 0, 0, 128));
        assert_eq!(parse_color("red", 0.0), Color::from_rgba8(255, 0, 0, 0));
    }

    #[test]
    fn parse_color_hex_3_digit() {
        assert_eq!(parse_color("#f00", 1.0), Color::from_rgba8(255, 0, 0, 255));
        assert_eq!(parse_color("#0f0", 1.0), Color::from_rgba8(0, 255, 0, 255));
        assert_eq!(parse_color("#00f", 1.0), Color::from_rgba8(0, 0, 255, 255));
    }

    #[test]
    fn parse_color_hex_4_digit_with_alpha() {
        let c = parse_color("#f00f", 1.0);
        assert_eq!(c, Color::from_rgba8(255, 0, 0, 255));

        let c = parse_color("#f008", 1.0);
        assert_eq!(c, Color::from_rgba8(255, 0, 0, 0x88));
    }

    #[test]
    fn parse_color_hex_6_digit() {
        assert_eq!(
            parse_color("#ff0000", 1.0),
            Color::from_rgba8(255, 0, 0, 255)
        );
        assert_eq!(
            parse_color("#00ff00", 1.0),
            Color::from_rgba8(0, 255, 0, 255)
        );
        assert_eq!(
            parse_color("#0000ff", 1.0),
            Color::from_rgba8(0, 0, 255, 255)
        );
    }

    #[test]
    fn parse_color_hex_8_digit_with_alpha() {
        assert_eq!(
            parse_color("#ff0000ff", 1.0),
            Color::from_rgba8(255, 0, 0, 255)
        );
        assert_eq!(
            parse_color("#ff000080", 1.0),
            Color::from_rgba8(255, 0, 0, 0x80)
        );
    }

    #[test]
    fn parse_color_hex_without_hash() {
        assert_eq!(
            parse_color("ff0000", 1.0),
            Color::from_rgba8(255, 0, 0, 255)
        );
    }

    #[test]
    fn parse_color_rgb_function() {
        assert_eq!(
            parse_color("rgb(255, 0, 0)", 1.0),
            Color::from_rgba8(255, 0, 0, 255)
        );
        assert_eq!(
            parse_color("rgb(100%, 0%, 0%)", 1.0),
            Color::from_rgba8(255, 0, 0, 255)
        );
        assert_eq!(
            parse_color("RGB(128, 128, 128)", 1.0),
            Color::from_rgba8(128, 128, 128, 255)
        );
    }

    #[test]
    fn parse_color_rgba_function() {
        assert_eq!(
            parse_color("rgba(255, 0, 0, 1.0)", 1.0),
            Color::from_rgba8(255, 0, 0, 255)
        );
        assert_eq!(
            parse_color("rgba(255, 0, 0, 0.5)", 1.0),
            Color::from_rgba8(255, 0, 0, 128)
        );
    }

    #[test]
    fn parse_color_invalid_falls_back_to_transparent() {
        assert_eq!(parse_color("notacolor", 1.0), Color::TRANSPARENT);
        assert_eq!(parse_color("#zzz", 1.0), Color::TRANSPARENT);
        assert_eq!(parse_color("#1", 1.0), Color::TRANSPARENT);
    }

    #[test]
    fn number_returns_value_or_fallback() {
        let v = json!({"x": 42.5});
        assert!((number(&v, "x", 0.0) - 42.5).abs() < 1e-9);
        assert!((number(&v, "missing", 99.0) - 99.0).abs() < 1e-9);
    }

    #[test]
    fn number_opt_filters_non_finite() {
        let v = json!({"a": 1.0, "b": null, "c": "string"});
        assert!(number_opt(&v, "a").is_some());
        assert!(number_opt(&v, "b").is_none());
        assert!(number_opt(&v, "c").is_none());
    }

    #[test]
    fn percent_divides_and_clamps() {
        let v = json!({"x": 50.0, "y": 200.0, "z": -10.0});
        assert!((percent(&v, "x", 0.0) - 0.5).abs() < 1e-9);
        assert!((percent(&v, "y", 0.0) - 2.0).abs() < 1e-9);
        assert!((percent(&v, "z", 0.0) - 0.0).abs() < 1e-9);
        assert!((percent(&v, "missing", 100.0) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn parse_shape_geometry_rectangle_default() {
        let cfg = json!({});
        let geom = parse_shape_geometry("square", &cfg);
        assert_eq!(
            geom,
            ShapeGeometry::Rectangle {
                width: 1.0,
                height: 1.0,
                corner_radius: 0.0,
            }
        );
    }

    #[test]
    fn parse_shape_geometry_circle() {
        let cfg = json!({"squashX": 50.0, "squashY": 30.0});
        let geom = parse_shape_geometry("circle", &cfg);
        assert_eq!(
            geom,
            ShapeGeometry::Circle {
                squash_x: 0.5,
                squash_y: 0.3,
            }
        );
    }

    #[test]
    fn parse_shape_geometry_star() {
        let cfg = json!({"rays": 8, "innerRadius": 40.0});
        let geom = parse_shape_geometry("star", &cfg);
        assert_eq!(
            geom,
            ShapeGeometry::Star {
                rays: 8,
                inner_radius: 0.4,
            }
        );
    }

    #[test]
    fn parse_shape_geometry_star_min_rays() {
        let cfg = json!({"rays": 1});
        let geom = parse_shape_geometry("star", &cfg);
        match geom {
            ShapeGeometry::Star { rays, .. } => assert!(rays >= 2),
            _ => panic!("expected Star"),
        }
    }

    #[test]
    fn parse_shape_geometry_speech_bubble() {
        let cfg = json!({"pointerDirection": "right"});
        let geom = parse_shape_geometry("speech_bubble", &cfg);
        match geom {
            ShapeGeometry::SpeechBubble { pointer_right, .. } => assert!(pointer_right),
            _ => panic!("expected SpeechBubble"),
        }
    }

    #[test]
    fn parse_shape_geometry_unknown_falls_back_to_rectangle() {
        let cfg = json!({});
        let geom = parse_shape_geometry("nonexistent", &cfg);
        assert!(matches!(geom, ShapeGeometry::Rectangle { .. }));
    }

    #[test]
    fn string_value_returns_value_or_fallback() {
        let v = json!({"name": "hello", "empty": ""});
        assert_eq!(string_value(&v, "name", "default"), "hello");
        assert_eq!(string_value(&v, "empty", "default"), "default");
        assert_eq!(string_value(&v, "missing", "default"), "default");
    }

    #[test]
    fn bool_value_returns_value_or_fallback() {
        let v = json!({"a": true, "b": false});
        assert!(bool_value(&v, "a", false));
        assert!(!bool_value(&v, "b", true));
        assert!(bool_value(&v, "missing", true));
        assert!(!bool_value(&v, "missing", false));
    }

    #[test]
    fn font_weight_numeric_and_named() {
        assert!((font_weight(&json!({"fontWeight": 400})) - 400.0).abs() < 1e-6);
        assert!((font_weight(&json!({"fontWeight": "normal"})) - 400.0).abs() < 1e-6);
        assert!((font_weight(&json!({"fontWeight": "bold"})) - 700.0).abs() < 1e-6);
        assert!((font_weight(&json!({"fontWeight": "300"})) - 300.0).abs() < 1e-6);
        assert!((font_weight(&json!({})) - 700.0).abs() < 1e-6);
    }

    #[test]
    fn text_align_values() {
        assert_eq!(text_align(&json!({"align": "left"})), TextAlign::Left);
        assert_eq!(text_align(&json!({"align": "right"})), TextAlign::Right);
        assert_eq!(text_align(&json!({"align": "center"})), TextAlign::Center);
        assert_eq!(text_align(&json!({})), TextAlign::Center);
        assert_eq!(text_align(&json!({"align": "unknown"})), TextAlign::Center);
    }

    #[test]
    fn text_vertical_align_values() {
        assert_eq!(
            text_vertical_align(&json!({"verticalAlign": "top"})),
            TextVerticalAlign::Top
        );
        assert_eq!(
            text_vertical_align(&json!({"verticalAlign": "bottom"})),
            TextVerticalAlign::Bottom
        );
        assert_eq!(
            text_vertical_align(&json!({"verticalAlign": "middle"})),
            TextVerticalAlign::Middle
        );
        assert_eq!(text_vertical_align(&json!({})), TextVerticalAlign::Middle);
    }
}
