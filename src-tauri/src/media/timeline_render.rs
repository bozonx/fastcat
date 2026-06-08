use anyhow::{anyhow, Context, Result};
use parking_lot::Mutex;
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use vello::peniko::{Blob, Color, ImageAlphaType, ImageData, ImageFormat as VelloImageFormat};

use crate::compositor::scene::{LayerKind as CompLayerKind, RasterSource, Scene};
use crate::compositor::Compositor;
use crate::media::decode::{open as open_decoder, VideoDecoder};
use crate::media::image_decode::decode_image;
use crate::media::types::HwAccelMode;
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

#[derive(Clone)]
struct CachedRaster {
    image: ImageData,
    natural_size: (u32, u32),
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
    images: HashMap<PathBuf, CachedRaster>,
    svgs: HashMap<(PathBuf, u32), CachedRaster>,
    lru: VecDeque<PathBuf>,
    capacity: usize,
    hw_mode: HwAccelMode,
    vaapi_device: Option<String>,
}

impl Default for VideoDecoderCache {
    fn default() -> Self {
        Self::new()
    }
}

impl VideoDecoderCache {
    pub fn new() -> Self {
        Self {
            decoders: HashMap::new(),
            images: HashMap::new(),
            svgs: HashMap::new(),
            lru: VecDeque::new(),
            capacity: 8,
            hw_mode: HwAccelMode::None,
            vaapi_device: None,
        }
    }

    pub fn new_with_hw_decode(hw_mode: HwAccelMode, vaapi_device: Option<String>) -> Self {
        Self {
            hw_mode,
            vaapi_device,
            ..Self::new()
        }
    }

    fn get_or_insert(
        &mut self,
        path: &Path,
        max_output_long_edge: Option<u32>,
    ) -> Result<&mut CachedDecoder> {
        let path_buf = path.to_path_buf();
        let needs_new = match self.decoders.get(&path_buf) {
            Some(entry) => entry.max_output_long_edge != max_output_long_edge,
            None => true,
        };
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
            let decoder = open_decoder(
                path,
                max_output_long_edge,
                self.hw_mode,
                self.vaapi_device.as_deref(),
            )?;
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
        self.decoders
            .get_mut(&path_buf)
            .context("decoder cache insertion failed")
    }

    fn image_raster(&mut self, path: &Path) -> Result<CachedRaster> {
        let path_buf = path.to_path_buf();
        if let Some(cached) = self.images.get(&path_buf) {
            return Ok(cached.clone());
        }

        let decoded = decode_image(path)?;
        let raster = CachedRaster {
            image: decoded.image,
            natural_size: (decoded.width, decoded.height),
        };
        self.images.insert(path_buf, raster.clone());
        Ok(raster)
    }

    fn svg_raster(&mut self, path: &Path, target_long_edge: u32) -> Result<CachedRaster> {
        let path_buf = path.to_path_buf();
        let key = (path_buf, target_long_edge);
        if let Some(cached) = self.svgs.get(&key) {
            return Ok(cached.clone());
        }

        let (image, natural_size) = rasterize_svg(path, target_long_edge)?;
        let raster = CachedRaster {
            image,
            natural_size,
        };
        self.svgs.insert(key, raster.clone());
        Ok(raster)
    }
}

/// Holds a lazily-initialised compositor for off-screen thumbnail rendering.
/// Extracted from a global static so tests can inject a fake compositor.
pub struct ThumbnailRenderer {
    compositor: Mutex<Option<Compositor>>,
}

impl Default for ThumbnailRenderer {
    fn default() -> Self {
        Self::new()
    }
}

impl ThumbnailRenderer {
    pub fn new() -> Self {
        Self {
            compositor: Mutex::new(None),
        }
    }

    pub fn render(&self, scene: &Scene, width: u32, height: u32) -> Result<Vec<u8>> {
        let mut guard = self.compositor.lock();
        let compositor = guard.get_or_insert_with(Compositor::new);
        let dev_id = compositor.ensure_offscreen_device()?;
        compositor.render_scene_to_pixels(dev_id, scene, width.max(1), height.max(1))
    }

    pub fn render_to_file(
        &self,
        scene: MonitorScene,
        time_sec: f64,
        width: u32,
        height: u32,
        target_path: &Path,
        quality: f32,
        hw_mode: HwAccelMode,
        vaapi_device: Option<String>,
    ) -> Result<()> {
        let mut cache = VideoDecoderCache::new_with_hw_decode(hw_mode, vaapi_device);
        let compositor_scene = build_export_scene(
            &scene,
            time_sec,
            (width.max(1), height.max(1)),
            &mut cache,
            None,
        )?;
        let pixels = self.render(&compositor_scene, width, height)?;
        save_rgba_as_webp(
            target_path,
            &pixels,
            width.max(1),
            height.max(1),
            webp_quality_percent(quality),
        )
    }

    pub fn render_to_webp(
        &self,
        scene: MonitorScene,
        time_sec: f64,
        width: u32,
        height: u32,
        quality: f32,
        hw_mode: HwAccelMode,
        vaapi_device: Option<String>,
    ) -> Result<Vec<u8>> {
        let mut cache = VideoDecoderCache::new_with_hw_decode(hw_mode, vaapi_device);
        let compositor_scene = build_export_scene(
            &scene,
            time_sec,
            (width.max(1), height.max(1)),
            &mut cache,
            None,
        )?;
        let pixels = self.render(&compositor_scene, width, height)?;
        encode_rgba_as_webp(
            &pixels,
            width.max(1),
            height.max(1),
            webp_quality_percent(quality),
        )
    }
}

static GLOBAL_RENDERER: std::sync::LazyLock<ThumbnailRenderer> =
    std::sync::LazyLock::new(ThumbnailRenderer::new);

pub fn render_timeline_frame_to_file(
    scene: MonitorScene,
    time_sec: f64,
    width: u32,
    height: u32,
    target_path: &Path,
    quality: f32,
    hw_mode: HwAccelMode,
    vaapi_device: Option<String>,
) -> Result<()> {
    GLOBAL_RENDERER.render_to_file(scene, time_sec, width, height, target_path, quality, hw_mode, vaapi_device)
}

pub fn render_timeline_frame_to_webp(
    scene: MonitorScene,
    time_sec: f64,
    width: u32,
    height: u32,
    quality: f32,
    hw_mode: HwAccelMode,
    vaapi_device: Option<String>,
) -> Result<Vec<u8>> {
    GLOBAL_RENDERER.render_to_webp(scene, time_sec, width, height, quality, hw_mode, vaapi_device)
}

/// JS callers pass WebP quality as a 0..1 fraction, but [`encode_rgba_as_webp`]
/// expects the `webp` crate's 0..100 scale. Without this conversion marker and
/// timeline thumbnails were encoded at quality 0.6/0.8 (≈1%), i.e. heavily blocky.
fn webp_quality_percent(fraction: f32) -> f32 {
    if fraction.is_finite() {
        fraction.clamp(0.0, 1.0) * 100.0
    } else {
        70.0
    }
}

pub(crate) fn build_export_scene(
    scene: &MonitorScene,
    time_sec: f64,
    target_size: (u32, u32),
    cache: &mut VideoDecoderCache,
    on_warning: Option<&(dyn Fn(String) + Send + Sync)>,
) -> Result<Scene> {
    let scene_w = scene.width.max(1);
    let scene_h = scene.height.max(1);
    let svg_long_edge = target_size.0.max(target_size.1).max(1);

    let mut active_indices = HashSet::new();
    for i in 0..scene.layers.len() {
        if scene.layers[i].covers(time_sec) {
            active_indices.insert(i);
            if let Some(t_in) = &scene.layers[i].transition_in {
                let local_t = time_sec - scene.layers[i].timeline_start_sec;
                if local_t < t_in.duration_sec && local_t >= 0.0 {
                    if let Some(from_id) = &t_in.from_layer_id {
                        if let Some(from_idx) =
                            (0..scene.layers.len()).find(|&idx| &scene.layers[idx].id == from_id)
                        {
                            active_indices.insert(from_idx);
                        }
                    }
                }
            }
        }
    }

    let mut indices: Vec<usize> = active_indices.into_iter().collect();
    indices.sort_by_key(|&i| scene.layers[i].z);

    let mut layers = Vec::with_capacity(indices.len());
    for i in indices {
        let layer = &scene.layers[i];
        if layer.opacity.clamp(0.0, 1.0) <= 0.0 {
            continue;
        }
        let (layer_kind, source_rotation) = match build_raster_kind(
            layer,
            time_sec,
            svg_long_edge,
            Some(svg_long_edge),
            cache,
            on_warning,
        )? {
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
    on_warning: Option<&(dyn Fn(String) + Send + Sync)>,
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
                    let message = format!(
                        "Video layer could not be decoded and was skipped: {}. Some exported frames may be blank.",
                        layer.path
                    );
                    log::warn!(
                        "[native-export] skipping video layer {} at {:.3}s: {e}",
                        layer.path,
                        time_sec
                    );
                    if let Some(callback) = on_warning {
                        callback(message);
                    }
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
            let raster = cache.image_raster(Path::new(&layer.path))?;
            RasterBuild {
                kind: CompLayerKind::Raster {
                    source: RasterSource::Image(raster.image),
                    natural_size: raster.natural_size,
                },
                source_rotation: 0,
            }
        }
        LayerKind::Svg => {
            let raster = cache.svg_raster(Path::new(&layer.path), svg_long_edge)?;
            RasterBuild {
                kind: CompLayerKind::Raster {
                    source: RasterSource::Image(raster.image),
                    natural_size: raster.natural_size,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decoder_cache_new_has_default_capacity() {
        let cache = VideoDecoderCache::new();
        assert_eq!(cache.capacity, 8);
        assert!(cache.decoders.is_empty());
        assert!(cache.images.is_empty());
        assert!(cache.svgs.is_empty());
        assert!(cache.lru.is_empty());
        assert_eq!(cache.hw_mode, HwAccelMode::None);
        assert_eq!(cache.vaapi_device, None);
    }

    #[test]
    fn decoder_cache_can_store_hw_decode_settings() {
        let cache = VideoDecoderCache::new_with_hw_decode(
            HwAccelMode::Vaapi,
            Some("/dev/dri/renderD128".to_string()),
        );

        assert_eq!(cache.hw_mode, HwAccelMode::Vaapi);
        assert_eq!(cache.vaapi_device.as_deref(), Some("/dev/dri/renderD128"));
    }

    #[test]
    fn static_image_raster_is_cached() {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("test/fixtures/media/sample-red-1280x720.png");
        let mut cache = VideoDecoderCache::new();

        let first = cache.image_raster(&fixture).unwrap();
        let second = cache.image_raster(&fixture).unwrap();

        assert_eq!(cache.images.len(), 1);
        assert_eq!(first.natural_size, (1280, 720));
        assert_eq!(second.natural_size, first.natural_size);
    }

    #[test]
    fn svg_raster_is_cached_per_target_size() {
        let path = std::env::temp_dir().join(format!(
            "fastcat-export-cache-test-{}-{}.svg",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::write(
            &path,
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="10" height="20"><rect width="10" height="20" fill="red"/></svg>"#,
        )
        .unwrap();

        let mut cache = VideoDecoderCache::new();
        let first = cache.svg_raster(&path, 100).unwrap();
        let second = cache.svg_raster(&path, 100).unwrap();
        let different_size = cache.svg_raster(&path, 50).unwrap();

        let _ = std::fs::remove_file(&path);

        assert_eq!(cache.svgs.len(), 2);
        assert_eq!(first.natural_size, second.natural_size);
        assert_ne!(different_size.natural_size, first.natural_size);
    }

    #[test]
    fn webp_quality_percent_maps_fraction_to_0_100_scale() {
        assert!((webp_quality_percent(0.6) - 60.0).abs() < 0.01);
        assert!((webp_quality_percent(0.8) - 80.0).abs() < 0.01);
        assert!((webp_quality_percent(0.0) - 0.0).abs() < 0.01);
        assert!((webp_quality_percent(1.0) - 100.0).abs() < 0.01);
        // Out-of-range and non-finite inputs are clamped / defaulted.
        assert!((webp_quality_percent(2.0) - 100.0).abs() < 0.01);
        assert!((webp_quality_percent(-1.0) - 0.0).abs() < 0.01);
        assert!((webp_quality_percent(f32::NAN) - 70.0).abs() < 0.01);
    }

    #[test]
    fn export_scene_includes_from_layer_during_transition_in() {
        let from = SceneLayer {
            id: "from".into(),
            kind: LayerKind::Background,
            path: String::new(),
            timeline_start_sec: 0.0,
            timeline_end_sec: 5.0,
            source_start_sec: 0.0,
            source_range_duration_sec: 5.0,
            speed: 1.0,
            freeze_frame_source_sec: None,
            source_orientation: None,
            z: 0,
            opacity: 1.0,
            blend_mode: crate::compositor::scene::BlendMode::Normal,
            background_color: Some("#000000".into()),
            text: None,
            style: None,
            shape_type: None,
            fill_color: None,
            stroke_color: None,
            stroke_width: None,
            shape_config: None,
            transform: None,
            transition_in: None,
            transition_out: None,
            effects: Vec::new(),
        };
        let to = SceneLayer {
            id: "to".into(),
            kind: LayerKind::Background,
            path: String::new(),
            timeline_start_sec: 2.0,
            timeline_end_sec: 7.0,
            source_start_sec: 0.0,
            source_range_duration_sec: 5.0,
            speed: 1.0,
            freeze_frame_source_sec: None,
            source_orientation: None,
            z: 1,
            opacity: 1.0,
            blend_mode: crate::compositor::scene::BlendMode::Normal,
            background_color: Some("#ffffff".into()),
            text: None,
            style: None,
            shape_type: None,
            fill_color: None,
            stroke_color: None,
            stroke_width: None,
            shape_config: None,
            transform: None,
            transition_in: Some(crate::monitor::scene::SceneTransition {
                transition_type: "dissolve".into(),
                duration_sec: 1.0,
                curve: None,
                from_layer_id: Some("from".into()),
                spec: None,
            }),
            transition_out: None,
            effects: Vec::new(),
        };
        let scene = MonitorScene {
            layers: vec![from, to],
            audio_layers: vec![],
            audio_tracks: vec![],
            audio_master_gain: 1.0,
            audio_master_muted: false,
            width: 1920,
            height: 1080,
            preview_scale: None,
            preview_fps: 30.0,
            preview_sync_mode: crate::monitor::scene::PreviewSyncMode::Balanced,
        };
        let mut cache = VideoDecoderCache::new();
        let export = build_export_scene(&scene, 2.5, (1920, 1080), &mut cache, None).unwrap();

        let ids: Vec<_> = export.layers.iter().map(|l| l.id.as_str()).collect();
        assert!(ids.contains(&"from"), "from_layer must be present during transition");
        assert!(ids.contains(&"to"), "to_layer must be present during transition");
    }
}
