use anyhow::{anyhow, Result};
use parking_lot::Mutex;
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use vello::peniko::{Blob, Color, ImageAlphaType, ImageData, ImageFormat as VelloImageFormat};

use crate::compositor::scene::{LayerKind as CompLayerKind, RasterSource, Scene};
use crate::compositor::Compositor;
use crate::media::decode::{open as open_decoder, VideoDecoder};
use crate::media::image_decode::decode_image;
use crate::monitor::scene::{LayerKind, MonitorScene, SceneLayer};
use crate::monitor::scene_build::{
    build_virtual_kind, finalize_layer, layer_with_auto_source_rotation, rasterize_svg,
};

struct RasterBuild {
    kind: CompLayerKind,
    source_rotation: i32,
}

/// A decoded RGBA frame produced for export. Cheap to clone: the pixel buffer is
/// shared via `Arc`, so holding/reusing the last frame costs a refcount bump.
#[derive(Clone)]
struct ExportFrame {
    width: u32,
    height: u32,
    pixels: Arc<Vec<u8>>,
    pts_sec: f64,
}

/// One open decoder plus the last frame it produced.
///
/// Export advances time monotonically, so the previous decoder position is almost
/// always exactly where the next frame should come from: we pull forward instead of
/// re-seeking. A `seek` flushes the decoder and re-decodes from the preceding
/// keyframe, so seeking every output frame was `O(N · GOP)` — pathological on long
/// GOP codecs. We only seek on a backward step or a large forward jump.
struct CachedDecoder {
    decoder: Box<dyn VideoDecoder>,
    rotation: i32,
    fps: f64,
    last: Option<ExportFrame>,
    max_output_long_edge: Option<u32>,
}

impl CachedDecoder {
    /// Forward gap (seconds) beyond which seeking to a nearer keyframe beats
    /// decoding every intermediate frame.
    const MAX_SEQUENTIAL_GAP_SEC: f64 = 2.0;

    fn frame_at(&mut self, time_sec: f64) -> Result<ExportFrame> {
        let fps = if self.fps.is_finite() && self.fps > 0.0 {
            self.fps
        } else {
            30.0
        };
        let tol = 0.5 / fps;

        let need_seek = match &self.last {
            None => true,
            Some(last) => {
                time_sec < last.pts_sec - tol
                    || time_sec - last.pts_sec > Self::MAX_SEQUENTIAL_GAP_SEC
            }
        };
        if need_seek {
            self.decoder.seek(time_sec)?;
            self.last = None;
        } else if let Some(last) = &self.last {
            // Target hasn't advanced past the frame we already hold — reuse it
            // (e.g. export fps higher than source fps, or a freeze frame).
            if last.pts_sec >= time_sec - tol {
                return Ok(last.clone());
            }
        }

        loop {
            match self.decoder.next_frame()? {
                Some(mut frame) => {
                    // VideoFrame implements Drop (texture pooling), so move pixels out
                    // via take rather than a field move.
                    let ef = ExportFrame {
                        width: frame.width,
                        height: frame.height,
                        pts_sec: frame.pts_sec,
                        pixels: Arc::new(std::mem::take(&mut frame.pixels)),
                    };
                    let reached = ef.pts_sec >= time_sec - tol;
                    self.last = Some(ef.clone());
                    if reached {
                        return Ok(ef);
                    }
                }
                None => {
                    // EOF (e.g. target rounded just past the source end): hold the
                    // last decoded frame rather than aborting the whole export.
                    if let Some(last) = &self.last {
                        return Ok(last.clone());
                    }
                    return Err(anyhow!("video decoder returned no frame"));
                }
            }
        }
    }
}

pub struct VideoDecoderCache {
    decoders: HashMap<PathBuf, CachedDecoder>,
    lru: VecDeque<PathBuf>,
    capacity: usize,
}

impl VideoDecoderCache {
    pub fn new() -> Self {
        Self {
            decoders: HashMap::new(),
            lru: VecDeque::new(),
            capacity: 8,
        }
    }

    fn get_or_insert(
        &mut self,
        path: &Path,
        max_output_long_edge: Option<u32>,
    ) -> Result<&mut CachedDecoder> {
        let path_buf = path.to_path_buf();
        let needs_new = !self.decoders.contains_key(&path_buf)
            || self.decoders[&path_buf].max_output_long_edge != max_output_long_edge;
        if needs_new {
            while self.decoders.len() >= self.capacity && !self.decoders.is_empty() {
                if let Some(oldest) = self.lru.pop_front() {
                    if oldest != path_buf {
                        self.decoders.remove(&oldest);
                    }
                }
            }
            if self.decoders.contains_key(&path_buf) {
                self.decoders.remove(&path_buf);
            }
            let decoder = open_decoder(path, max_output_long_edge, None, None)?;
            let (rotation, fps) = {
                let info = decoder.info();
                (info.rotation, info.fps)
            };
            self.decoders.insert(
                path_buf.clone(),
                CachedDecoder {
                    decoder,
                    rotation,
                    fps,
                    last: None,
                    max_output_long_edge,
                },
            );
        }
        self.lru.retain(|p| p != &path_buf);
        self.lru.push_back(path_buf.clone());
        Ok(self.decoders.get_mut(&path_buf).unwrap())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decoder_cache_new_has_default_capacity() {
        let cache = VideoDecoderCache::new();
        assert_eq!(cache.capacity, 8);
        assert!(cache.decoders.is_empty());
        assert!(cache.lru.is_empty());
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
    let compositor_scene =
        build_export_scene(&scene, time_sec, (width.max(1), height.max(1)), &mut cache)?;
    let pixels = render_pooled(&compositor_scene, width, height)?;
    save_rgba_as_webp(target_path, &pixels, width.max(1), height.max(1), quality)
}

pub fn render_timeline_frame_to_webp(
    scene: MonitorScene,
    time_sec: f64,
    width: u32,
    height: u32,
    quality: f32,
) -> Result<Vec<u8>> {
    let mut cache = VideoDecoderCache::new();
    let compositor_scene =
        build_export_scene(&scene, time_sec, (width.max(1), height.max(1)), &mut cache)?;
    let pixels = render_pooled(&compositor_scene, width, height)?;

    encode_rgba_as_webp(&pixels, width.max(1), height.max(1), quality)
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
        let (layer_kind, source_rotation) =
            match build_raster_kind(layer, time_sec, svg_long_edge, Some(svg_long_edge), cache)? {
                Some(built) => (built.kind, built.source_rotation),
                None => match build_virtual_kind(layer, (scene_w, scene_h)) {
                    Some(kind) => (kind, 0),
                    None => continue,
                },
            };
        let layer = layer_with_auto_source_rotation(layer, source_rotation);
        layers.push(finalize_layer(
            &layer,
            layer_kind,
            (scene_w, scene_h),
            time_sec,
        ));
    }

    Ok(Scene {
        width: scene_w,
        height: scene_h,
        time: time_sec,
        background: Color::TRANSPARENT,
        layers,
    })
}

fn build_raster_kind(
    layer: &SceneLayer,
    time_sec: f64,
    svg_long_edge: u32,
    max_output_long_edge: Option<u32>,
    cache: &mut VideoDecoderCache,
) -> Result<Option<RasterBuild>> {
    let built = match layer.kind {
        LayerKind::Video => {
            let (frame, source_rotation) = match decode_video_frame_cached(
                Path::new(&layer.path),
                layer.source_pts_at(time_sec),
                max_output_long_edge,
                cache,
            ) {
                Ok(decoded) => decoded,
                Err(e) => {
                    // A single unreadable frame must not abort the whole export;
                    // skip this layer for this frame and keep going.
                    log::warn!(
                        "[native-export] skipping video layer {} at {:.3}s: {e}",
                        layer.path,
                        time_sec
                    );
                    return Ok(None);
                }
            };
            let size = (frame.width, frame.height);
            RasterBuild {
                kind: CompLayerKind::Raster {
                    source: RasterSource::Image(export_frame_to_image(&frame)),
                    natural_size: size,
                },
                source_rotation,
            }
        }
        LayerKind::Image => {
            let decoded = decode_image(Path::new(&layer.path))?;
            RasterBuild {
                kind: CompLayerKind::Raster {
                    source: RasterSource::Image(decoded.image),
                    natural_size: (decoded.width, decoded.height),
                },
                source_rotation: 0,
            }
        }
        LayerKind::Svg => {
            let (image, size) = rasterize_svg(Path::new(&layer.path), svg_long_edge)?;
            RasterBuild {
                kind: CompLayerKind::Raster {
                    source: RasterSource::Image(image),
                    natural_size: size,
                },
                source_rotation: 0,
            }
        }
        LayerKind::Background | LayerKind::Shape | LayerKind::Text => return Ok(None),
    };
    Ok(Some(built))
}

fn decode_video_frame_cached(
    path: &Path,
    time_sec: f64,
    max_output_long_edge: Option<u32>,
    cache: &mut VideoDecoderCache,
) -> Result<(ExportFrame, i32)> {
    let cached = cache.get_or_insert(path, max_output_long_edge)?;
    let rotation = cached.rotation;
    let frame = cached.frame_at(time_sec)?;
    Ok((frame, rotation))
}

fn export_frame_to_image(frame: &ExportFrame) -> ImageData {
    ImageData {
        // Arc clone: shares the decoded buffer with the cached `last` frame.
        data: Blob::new(frame.pixels.clone()),
        format: VelloImageFormat::Rgba8,
        alpha_type: ImageAlphaType::Alpha,
        width: frame.width,
        height: frame.height,
    }
}

pub fn save_rgba_as_webp(
    path: &Path,
    pixels: &[u8],
    width: u32,
    height: u32,
    quality: f32,
) -> Result<()> {
    std::fs::write(path, encode_rgba_as_webp(pixels, width, height, quality)?)?;
    Ok(())
}

pub fn encode_rgba_as_webp(
    pixels: &[u8],
    width: u32,
    height: u32,
    quality: f32,
) -> Result<Vec<u8>> {
    let encoder = webp::Encoder::from_rgba(pixels, width, height);
    let quality = quality.clamp(0.0, 100.0);
    let bytes = if quality >= 100.0 {
        encoder.encode_lossless()
    } else {
        encoder.encode(quality)
    };
    Ok(bytes.to_vec())
}
