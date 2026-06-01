use anyhow::{anyhow, Result};
use image::{ColorType, ImageFormat};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use vello::peniko::{Blob, Color, ImageAlphaType, ImageData, ImageFormat as VelloImageFormat};

use crate::compositor::scene::{LayerKind as CompLayerKind, RasterSource, Scene};
use crate::compositor::Compositor;
use crate::media::decode::{open as open_decoder, VideoDecoder, VideoFrame};
use crate::media::image_decode::decode_image;
use crate::monitor::scene::{LayerKind, MonitorScene, SceneLayer};
use crate::monitor::scene_build::{build_virtual_kind, finalize_layer, rasterize_svg};

pub struct VideoDecoderCache {
    decoders: HashMap<PathBuf, Box<dyn VideoDecoder>>,
}

impl VideoDecoderCache {
    pub fn new() -> Self {
        Self {
            decoders: HashMap::new(),
        }
    }

    pub fn get_or_insert(&mut self, path: &Path) -> Result<&mut dyn VideoDecoder> {
        let path_buf = path.to_path_buf();
        if !self.decoders.contains_key(&path_buf) {
            let decoder = open_decoder(path, None)?;
            self.decoders.insert(path_buf.clone(), decoder);
        }
        Ok(self.decoders.get_mut(&path_buf).unwrap().as_mut())
    }
}

static THUMBNAIL_COMPOSITOR: once_cell::sync::Lazy<Mutex<Option<Compositor>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(None));

fn render_pooled(scene: &Scene, width: u32, height: u32) -> Result<Vec<u8>> {
    let mut guard = THUMBNAIL_COMPOSITOR.lock();
    let compositor = guard.get_or_insert_with(Compositor::new);
    let dev_id = compositor.ensure_offscreen_device()?;
    compositor.render_scene_to_pixels(dev_id, scene, width.max(1), height.max(1))
}

pub fn render_timeline_frame_to_file(
    scene: MonitorScene,
    time_sec: f64,
    width: u32,
    height: u32,
    target_path: &Path,
    quality: f32,
) -> Result<()> {
    let mut cache = VideoDecoderCache::new();
    let compositor_scene = build_export_scene(&scene, time_sec, (width.max(1), height.max(1)), &mut cache)?;
    let pixels = render_pooled(&compositor_scene, width, height)?;
    save_rgba_as_webp(target_path, &pixels, width.max(1), height.max(1), quality)
}

pub fn render_timeline_frame_to_webp(
    scene: MonitorScene,
    time_sec: f64,
    width: u32,
    height: u32,
    _quality: f32,
) -> Result<Vec<u8>> {
    let mut cache = VideoDecoderCache::new();
    let compositor_scene = build_export_scene(&scene, time_sec, (width.max(1), height.max(1)), &mut cache)?;
    let pixels = render_pooled(&compositor_scene, width, height)?;

    let mut bytes = Vec::new();
    image::write_buffer_with_format(
        &mut std::io::Cursor::new(&mut bytes),
        &pixels,
        width.max(1),
        height.max(1),
        ColorType::Rgba8,
        ImageFormat::WebP,
    )?;
    Ok(bytes)
}

pub(crate) fn build_export_scene(
    scene: &MonitorScene,
    time_sec: f64,
    target_size: (u32, u32),
    cache: &mut VideoDecoderCache,
) -> Result<Scene> {
    let scene_w = scene.width.max(1);
    let scene_h = scene.height.max(1);
    let svg_long_edge = target_size.0.max(target_size.1).max(1);
    let mut active: Vec<&SceneLayer> = scene
        .layers
        .iter()
        .filter(|layer| layer.covers(time_sec))
        .collect();
    active.sort_by_key(|layer| layer.z);

    let mut layers = Vec::with_capacity(active.len());
    for layer in active {
        if layer.opacity.clamp(0.0, 1.0) <= 0.0 {
            continue;
        }
        let layer_kind = match build_raster_kind(layer, time_sec, svg_long_edge, cache)? {
            Some(kind) => kind,
            None => match build_virtual_kind(layer, (scene_w, scene_h)) {
                Some(kind) => kind,
                None => continue,
            },
        };
        layers.push(finalize_layer(layer, layer_kind, (scene_w, scene_h)));
    }

    Ok(Scene {
        width: scene_w,
        height: scene_h,
        time: time_sec,
        background: Color::BLACK,
        layers,
    })
}

fn build_raster_kind(
    layer: &SceneLayer,
    time_sec: f64,
    svg_long_edge: u32,
    cache: &mut VideoDecoderCache,
) -> Result<Option<CompLayerKind>> {
    let kind = match layer.kind {
        LayerKind::Video => {
            let frame = decode_video_frame_cached(Path::new(&layer.path), layer.source_pts_at(time_sec), cache)?;
            let size = (frame.width, frame.height);
            CompLayerKind::Raster {
                source: RasterSource::Image(video_frame_to_image(frame)),
                natural_size: size,
            }
        }
        LayerKind::Image => {
            let decoded = decode_image(Path::new(&layer.path))?;
            CompLayerKind::Raster {
                source: RasterSource::Image(decoded.image),
                natural_size: (decoded.width, decoded.height),
            }
        }
        LayerKind::Svg => {
            let (image, size) = rasterize_svg(Path::new(&layer.path), svg_long_edge)?;
            CompLayerKind::Raster {
                source: RasterSource::Image(image),
                natural_size: size,
            }
        }
        LayerKind::Background | LayerKind::Shape | LayerKind::Text => return Ok(None),
    };
    Ok(Some(kind))
}

fn decode_video_frame_cached(
    path: &Path,
    time_sec: f64,
    cache: &mut VideoDecoderCache,
) -> Result<VideoFrame> {
    let decoder = cache.get_or_insert(path)?;
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
