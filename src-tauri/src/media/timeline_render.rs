use anyhow::{anyhow, Result};
use image::{ColorType, ImageFormat};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use vello::peniko::{Blob, Color, ImageAlphaType, ImageData, ImageFormat as VelloImageFormat};

use crate::compositor::scene::{
    BlendMode, Layer, LayerKind as CompLayerKind, RasterSource, Scene, ShapeGeometry, ShapeLayer,
    TextAlign, TextBackground, TextLayer, Transform,
};
use crate::compositor::Compositor;
use crate::media::decode::{open as open_decoder, VideoFrame};
use crate::media::image_decode::decode_image;
use crate::monitor::runtime::rasterize_svg;
use crate::monitor::scene::{LayerKind, MonitorScene, SceneLayer};

pub fn render_timeline_frame_to_file(
    scene: MonitorScene,
    time_sec: f64,
    width: u32,
    height: u32,
    target_path: &Path,
    quality: f32,
) -> Result<()> {
    let compositor_scene = build_one_shot_scene(&scene, time_sec)?;
    let mut compositor = Compositor::new();
    let dev_id = compositor.ensure_offscreen_device()?;
    let pixels = compositor.render_scene_to_pixels(
        dev_id,
        &compositor_scene,
        width.max(1),
        height.max(1),
    )?;
    save_rgba_as_webp(target_path, &pixels, width.max(1), height.max(1), quality)
}

pub fn render_timeline_frame_to_webp(
    scene: MonitorScene,
    time_sec: f64,
    width: u32,
    height: u32,
    quality: f32,
) -> Result<Vec<u8>> {
    let file_name = format!(
        "fastcat-timeline-thumb-{}-{}.webp",
        std::process::id(),
        chrono_like_timestamp()
    );
    let target_path = std::env::temp_dir().join(file_name);
    render_timeline_frame_to_file(scene, time_sec, width, height, &target_path, quality)?;
    let bytes = std::fs::read(&target_path)?;
    let _ = std::fs::remove_file(&target_path);
    Ok(bytes)
}

fn chrono_like_timestamp() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn build_one_shot_scene(scene: &MonitorScene, time_sec: f64) -> Result<Scene> {
    let scene_w = scene.width.max(1);
    let scene_h = scene.height.max(1);
    let mut active: Vec<&SceneLayer> = scene
        .layers
        .iter()
        .filter(|layer| layer.covers(time_sec))
        .collect();
    active.sort_by_key(|layer| layer.z);

    let mut layers = Vec::with_capacity(active.len());
    for layer in active {
        let opacity = layer.opacity.clamp(0.0, 1.0) as f32;
        if opacity <= 0.0 {
            continue;
        }
        let layer_kind = build_layer_kind(layer, time_sec, (scene_w, scene_h))?;
        let media_size = layer_kind.natural_size();
        let transform = match &layer.transform {
            Some(t) => Transform {
                x: t.x,
                y: t.y,
                scale_x: t.scale_x,
                scale_y: t.scale_y,
                rotation_deg: t.rotation_deg,
                anchor_x: t.anchor_x,
                anchor_y: t.anchor_y,
            },
            None => Transform::center_fit(media_size, (scene_w, scene_h)),
        };
        layers.push(Layer {
            id: layer.id.clone(),
            kind: layer_kind,
            transform,
            opacity,
            blend: parse_blend_mode(&layer.blend_mode),
            mask: None,
            effects: Vec::new(),
        });
    }

    Ok(Scene {
        width: scene_w,
        height: scene_h,
        time: time_sec,
        background: Color::BLACK,
        layers,
    })
}

fn build_layer_kind(
    layer: &SceneLayer,
    time_sec: f64,
    scene_size: (u32, u32),
) -> Result<CompLayerKind> {
    match layer.kind {
        LayerKind::Video => {
            let frame = decode_video_frame(Path::new(&layer.path), layer.source_pts_at(time_sec))?;
            let size = (frame.width, frame.height);
            Ok(CompLayerKind::Raster {
                source: RasterSource::Image(video_frame_to_image(frame)),
                natural_size: size,
            })
        }
        LayerKind::Image => {
            let decoded = decode_image(Path::new(&layer.path))?;
            Ok(CompLayerKind::Raster {
                source: RasterSource::Image(decoded.image),
                natural_size: (decoded.width, decoded.height),
            })
        }
        LayerKind::Svg => {
            let (image, size) = rasterize_svg(&PathBuf::from(&layer.path))?;
            Ok(CompLayerKind::Raster {
                source: RasterSource::Image(image),
                natural_size: size,
            })
        }
        LayerKind::Background => Ok(CompLayerKind::Shape(ShapeLayer {
            geometry: ShapeGeometry::Rectangle {
                width: 1.0,
                height: 1.0,
                corner_radius: 0.0,
            },
            fill: parse_color(layer.background_color.as_deref().unwrap_or("#000000"), 1.0),
            stroke: Color::TRANSPARENT,
            stroke_width: 0.0,
            natural_size: scene_size,
        })),
        LayerKind::Shape => {
            let stroke_width = layer.stroke_width.unwrap_or(0.0).max(0.0);
            let size = (scene_size.0.min(scene_size.1) as f64 * 0.8 + stroke_width * 2.0)
                .ceil()
                .max(1.0) as u32;
            let config = layer
                .shape_config
                .clone()
                .unwrap_or(serde_json::Value::Null);
            Ok(CompLayerKind::Shape(ShapeLayer {
                geometry: parse_shape_geometry(
                    layer.shape_type.as_deref().unwrap_or("square"),
                    &config,
                ),
                fill: parse_color(layer.fill_color.as_deref().unwrap_or("#ffffff"), 1.0),
                stroke: parse_color(layer.stroke_color.as_deref().unwrap_or("#000000"), 1.0),
                stroke_width,
                natural_size: (size, size),
            }))
        }
        LayerKind::Text => {
            let style = layer.style.clone().unwrap_or(serde_json::Value::Null);
            let font_size = number(&style, "fontSize", 64.0).clamp(1.0, 1000.0) as f32;
            let render_scale = scene_size.1 as f64 / 1080.0;
            let text_width = number_opt(&style, "width")
                .map(|w| (w * render_scale).max(1.0) as u32)
                .unwrap_or(scene_size.0);
            let text_height = number_opt(&style, "height")
                .map(|h| (h * render_scale).max(1.0) as u32)
                .unwrap_or_else(|| ((font_size as f64 * 1.6 * render_scale).max(1.0)) as u32);
            let background = if bool_value(&style, "backgroundEnabled", false) {
                Some(TextBackground {
                    color: parse_color(
                        &string_value(&style, "backgroundColor", "#000000"),
                        number(&style, "backgroundAlpha", 1.0).clamp(0.0, 1.0),
                    ),
                    radius: number(&style, "backgroundRadius", 0.0).max(0.0) * render_scale,
                })
            } else {
                None
            };
            Ok(CompLayerKind::Text(TextLayer {
                text: layer.text.clone().unwrap_or_default(),
                font_family: string_value(&style, "fontFamily", "sans-serif"),
                font_size: (font_size as f64 * render_scale).max(1.0) as f32,
                font_weight: font_weight(&style),
                color: parse_color(
                    &string_value(&style, "color", "#ffffff"),
                    number(&style, "colorAlpha", 1.0).clamp(0.0, 1.0),
                ),
                align: text_align(&style),
                line_height: number(&style, "lineHeight", 1.2).clamp(0.1, 10.0) as f32,
                max_width: Some(text_width as f32),
                background,
                natural_size: (text_width, text_height),
            }))
        }
    }
}

fn decode_video_frame(path: &Path, time_sec: f64) -> Result<VideoFrame> {
    let mut decoder = open_decoder(path, None)?;
    decoder.seek(time_sec)?;
    decoder
        .next_frame()?
        .ok_or_else(|| anyhow!("video decoder returned no frame"))
}

fn video_frame_to_image(frame: VideoFrame) -> ImageData {
    ImageData {
        data: Blob::new(Arc::new(frame.pixels)),
        format: VelloImageFormat::Rgba8,
        alpha_type: ImageAlphaType::Alpha,
        width: frame.width,
        height: frame.height,
    }
}

fn save_rgba_as_webp(
    path: &Path,
    pixels: &[u8],
    width: u32,
    height: u32,
    _quality: f32,
) -> Result<()> {
    image::save_buffer_with_format(
        path,
        pixels,
        width,
        height,
        ColorType::Rgba8,
        ImageFormat::WebP,
    )
    .map_err(Into::into)
}

fn parse_blend_mode(value: &str) -> BlendMode {
    match value {
        "multiply" => BlendMode::Multiply,
        "screen" => BlendMode::Screen,
        "darken" => BlendMode::Darken,
        "lighten" => BlendMode::Lighten,
        "add" => BlendMode::Add,
        _ => BlendMode::Normal,
    }
}

fn parse_color(input: &str, alpha: f64) -> Color {
    let hex = input.trim().trim_start_matches('#');
    let parse_pair = |s: &str| u8::from_str_radix(s, 16).ok();
    let (r, g, b, a) = match hex.len() {
        3 => {
            let mut chars = hex.chars();
            let r = chars
                .next()
                .and_then(|c| u8::from_str_radix(&format!("{c}{c}"), 16).ok());
            let g = chars
                .next()
                .and_then(|c| u8::from_str_radix(&format!("{c}{c}"), 16).ok());
            let b = chars
                .next()
                .and_then(|c| u8::from_str_radix(&format!("{c}{c}"), 16).ok());
            (r, g, b, Some(255))
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
        _ => (Some(255), Some(255), Some(255), Some(255)),
    };
    let a = ((a.unwrap_or(255) as f64) * alpha.clamp(0.0, 1.0)).round() as u8;
    Color::from_rgba8(r.unwrap_or(255), g.unwrap_or(255), b.unwrap_or(255), a)
}

fn number(value: &serde_json::Value, key: &str, fallback: f64) -> f64 {
    number_opt(value, key).unwrap_or(fallback)
}

fn number_opt(value: &serde_json::Value, key: &str) -> Option<f64> {
    value
        .get(key)
        .and_then(|v| v.as_f64())
        .filter(|v| v.is_finite())
}

fn percent(value: &serde_json::Value, key: &str, fallback: f64) -> f64 {
    (number(value, key, fallback) / 100.0).clamp(0.0, 10.0)
}

fn parse_shape_geometry(shape_type: &str, cfg: &serde_json::Value) -> ShapeGeometry {
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

fn string_value(value: &serde_json::Value, key: &str, fallback: &str) -> String {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .filter(|v| !v.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn bool_value(value: &serde_json::Value, key: &str, fallback: bool) -> bool {
    value.get(key).and_then(|v| v.as_bool()).unwrap_or(fallback)
}

fn font_weight(value: &serde_json::Value) -> f32 {
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

fn text_align(value: &serde_json::Value) -> TextAlign {
    match value.get("align").and_then(|v| v.as_str()) {
        Some("left") => TextAlign::Left,
        Some("right") => TextAlign::Right,
        _ => TextAlign::Center,
    }
}
