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
