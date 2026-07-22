use anyhow::{anyhow, Context, Result};
use parking_lot::Mutex;
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use vello::peniko::{Blob, Color, ImageAlphaType, ImageData, ImageFormat as VelloImageFormat};

use crate::compositor::scene::{LayerKind as CompLayerKind, RasterSource, Scene, VideoTrack};
use crate::compositor::Compositor;
use crate::media::decode::{open as open_decoder, VideoDecoder};
use crate::media::image_decode::decode_image;
use crate::media::types::HwAccelMode;
use crate::monitor::scene::build::{
    build_virtual_kind, finalize_layer, layer_with_auto_source_rotation, rasterize_svg,
};
use crate::monitor::scene::{LayerKind, MonitorScene, SceneLayer};

struct RasterBuild {
    kind: CompLayerKind,
    source_rotation: i32,
}

/// Per-frame decode trace for diagnosing export stutter at clip boundaries. Gated
/// behind `FASTCAT_EXPORT_DECODE_TRACE=1` so it costs nothing on normal exports.
/// When a returned PTS stays constant while the requested time advances, the export
/// is holding a single source frame (visible as an fps drop) — usually a content gap
/// after seeking into a different source.
fn export_decode_trace_enabled() -> bool {
    static FLAG: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *FLAG.get_or_init(|| {
        std::env::var("FASTCAT_EXPORT_DECODE_TRACE")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false)
    })
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
    /// Source frame currently "active" at the last requested time (latest PTS that
    /// is <= the target). Held and re-emitted until the target crosses into the
    /// next source frame.
    last: Option<ExportFrame>,
    /// One frame decoded past `last` whose PTS is still in the future relative to
    /// the last target. Kept so we only pull a new frame once the target actually
    /// reaches it — the core of the sample-and-hold cadence.
    pending: Option<ExportFrame>,
    max_output_long_edge: Option<u32>,
    /// Source path, kept only so the decode trace can name the file.
    trace_path: PathBuf,
}

#[derive(Clone)]
struct CachedRaster {
    image: ImageData,
    natural_size: (u32, u32),
}

/// LRU key for the decoded image / SVG raster cache. Images key on path; SVGs
/// also key on the rasterised long edge (the same SVG can be cached at several
/// target sizes).
#[derive(Clone, PartialEq, Eq)]
enum RasterKey {
    Image(PathBuf),
    Svg(PathBuf, u32),
}

/// Approximate retained bytes of a cached raster (RGBA8 at natural size). The
/// pixel buffer is `Arc`-backed, so this is the cost of the single shared copy.
fn raster_estimated_bytes(raster: &CachedRaster) -> u64 {
    let (w, h) = raster.natural_size;
    (w as u64).saturating_mul(h as u64).saturating_mul(4)
}

impl CachedDecoder {
    /// Forward gap (seconds) beyond which seeking to a nearer keyframe beats
    /// decoding every intermediate frame.
    const MAX_SEQUENTIAL_GAP_SEC: f64 = 2.0;

    /// Returns the source frame that is *displayed* at `time_sec`: the latest frame
    /// whose PTS is at or before the target (classic sample-and-hold), advancing the
    /// decoder by exactly the frames the target has crossed since the last call.
    ///
    /// Export samples the CENTRE of each output interval (`(i+0.5)/fps`), so the
    /// target sits ~half a source frame away from any source-frame boundary. Matching
    /// on `pts <= target` therefore never lands on the equality knife-edge that the
    /// previous `pts >= target - half_frame` test did — that test made a 25→25 fps
    /// export flip between dropping and duplicating frames depending only on where a
    /// cut's seek happened to land (a phase-dependent, multi-second fps dip after
    /// some clip boundaries). Genuine rate changes still drop/duplicate, but evenly.
    fn frame_at(&mut self, time_sec: f64) -> Result<ExportFrame> {
        let fps = if self.fps.is_finite() && self.fps > 0.0 {
            self.fps
        } else {
            30.0
        };
        // A frame whose PTS is within this slack of the target counts as already on
        // screen, absorbing float error so a frame landing on the exact sample
        // instant isn't deferred a frame (which would desync the cadence). Far below
        // half a frame, so it can never pull in the *next* source frame early.
        let match_eps = 0.01 / fps;
        // Ignore sub-frame backward jitter before paying for a re-seek.
        let back_tol = 0.5 / fps;

        let trace = export_decode_trace_enabled();
        let need_seek = match &self.last {
            None => self.pending.is_none(),
            Some(last) => {
                time_sec < last.pts_sec - back_tol
                    || time_sec - last.pts_sec > Self::MAX_SEQUENTIAL_GAP_SEC
            }
        };
        if need_seek {
            if trace {
                log::info!(
                    "[export-decode-trace] SEEK    {} want={:.4} last={:?}",
                    self.trace_path.display(),
                    time_sec,
                    self.last.as_ref().map(|l| (l.pts_sec * 1e4).round() / 1e4),
                );
            }
            self.decoder.seek(time_sec)?;
            self.last = None;
            self.pending = None;
        }

        let mut decoded_count: u32 = 0;
        loop {
            // Promote an already-decoded look-ahead frame once the target reaches it.
            if let Some(pending) = &self.pending {
                if pending.pts_sec <= time_sec + match_eps {
                    self.last = self.pending.take();
                    continue;
                }
                // Look-ahead frame is still in the future: hold the current frame.
                break;
            }
            match self.decoder.next_frame()? {
                Some(mut frame) => {
                    decoded_count += 1;
                    // VideoFrame implements Drop (texture pooling), so move pixels out
                    // via take rather than a field move.
                    let ef = ExportFrame {
                        width: frame.width,
                        height: frame.height,
                        pts_sec: frame.pts_sec,
                        pixels: Arc::new(std::mem::take(&mut frame.pixels)),
                    };
                    if ef.pts_sec <= time_sec + match_eps {
                        // Still at or before the target: this becomes the active frame.
                        self.last = Some(ef);
                    } else {
                        // Overshot the target: stash for a later call and stop.
                        self.pending = Some(ef);
                        break;
                    }
                }
                None => break, // EOF: hold the last frame we decoded.
            }
        }

        // Before the first decodable frame (target precedes the stream), fall back to
        // the earliest frame we have so a clip never renders empty.
        if self.last.is_none() {
            self.last = self.pending.take();
        }
        match &self.last {
            Some(ef) => {
                if trace {
                    log::info!(
                        "[export-decode-trace] FRAME   {} want={:.4} got={:.4} ahead={:.4} decoded={}",
                        self.trace_path.display(),
                        time_sec,
                        ef.pts_sec,
                        ef.pts_sec - time_sec,
                        decoded_count,
                    );
                }
                Ok(ef.clone())
            }
            None => Err(anyhow!("video decoder returned no frame")),
        }
    }
}

/// Memory budget for the decoded image / SVG raster cache. A long export over a
/// timeline with many distinct stills (e.g. a slideshow of high-res photos) would
/// otherwise retain one full decoded raster per source path for the whole render
/// and OOM; the rasters are evicted LRU once their combined size exceeds this.
const RASTER_CACHE_BUDGET_BYTES: u64 = 256 * 1024 * 1024;

pub struct VideoDecoderCache {
    decoders: HashMap<PathBuf, CachedDecoder>,
    images: HashMap<PathBuf, CachedRaster>,
    svgs: HashMap<(PathBuf, u32), CachedRaster>,
    lru: VecDeque<PathBuf>,
    capacity: usize,
    /// LRU + retained-byte accounting for `images`/`svgs`, bounded by
    /// `RASTER_CACHE_BUDGET_BYTES`.
    raster_lru: VecDeque<RasterKey>,
    raster_bytes: u64,
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
            raster_lru: VecDeque::new(),
            raster_bytes: 0,
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
                    pending: None,
                    max_output_long_edge,
                    trace_path: path_buf.clone(),
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
        if self.images.contains_key(&path_buf) {
            self.mark_raster_recent(&RasterKey::Image(path_buf.clone()));
            return Ok(self.images[&path_buf].clone());
        }

        let decoded = decode_image(path)?;
        let raster = CachedRaster {
            image: decoded.image,
            natural_size: (decoded.width, decoded.height),
        };
        self.images.insert(path_buf.clone(), raster.clone());
        self.track_raster_insert(RasterKey::Image(path_buf), raster_estimated_bytes(&raster));
        Ok(raster)
    }

    fn svg_raster(&mut self, path: &Path, target_long_edge: u32) -> Result<CachedRaster> {
        let path_buf = path.to_path_buf();
        let key = (path_buf, target_long_edge);
        if self.svgs.contains_key(&key) {
            self.mark_raster_recent(&RasterKey::Svg(key.0.clone(), key.1));
            return Ok(self.svgs[&key].clone());
        }

        let (image, natural_size) = rasterize_svg(path, target_long_edge)?;
        let raster = CachedRaster {
            image,
            natural_size,
        };
        self.svgs.insert(key.clone(), raster.clone());
        self.track_raster_insert(
            RasterKey::Svg(key.0, key.1),
            raster_estimated_bytes(&raster),
        );
        Ok(raster)
    }

    /// Move an already-cached raster to the most-recently-used end without
    /// changing the retained-byte total.
    fn mark_raster_recent(&mut self, key: &RasterKey) {
        if let Some(pos) = self.raster_lru.iter().position(|k| k == key) {
            if let Some(k) = self.raster_lru.remove(pos) {
                self.raster_lru.push_back(k);
            }
        }
    }

    /// Record a freshly-inserted raster and evict the least-recently-used entries
    /// until the cache fits `RASTER_CACHE_BUDGET_BYTES`. The just-inserted entry
    /// sits at the MRU end, so it is only dropped when it is the sole entry and is
    /// itself larger than the budget.
    fn track_raster_insert(&mut self, key: RasterKey, bytes: u64) {
        self.raster_lru.retain(|k| k != &key);
        self.raster_lru.push_back(key);
        self.raster_bytes = self.raster_bytes.saturating_add(bytes);
        while self.raster_bytes > RASTER_CACHE_BUDGET_BYTES && self.raster_lru.len() > 1 {
            let Some(oldest) = self.raster_lru.pop_front() else {
                break;
            };
            let removed = match &oldest {
                RasterKey::Image(p) => self.images.remove(p),
                RasterKey::Svg(p, edge) => self.svgs.remove(&(p.clone(), *edge)),
            };
            if let Some(raster) = removed {
                self.raster_bytes = self
                    .raster_bytes
                    .saturating_sub(raster_estimated_bytes(&raster));
            }
        }
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

    fn render_request_pixels(&self, req: &TimelineFrameRequest) -> Result<Vec<u8>> {
        let mut cache =
            VideoDecoderCache::new_with_hw_decode(req.hw_mode, req.vaapi_device.clone());
        let mut compositor_scene = build_export_scene(
            &req.scene,
            req.time_sec,
            (req.width.max(1), req.height.max(1)),
            &mut cache,
            None,
            req.effect_quality,
        )?;
        compositor_scene.background = if req.is_transparent.unwrap_or(false) {
            Color::TRANSPARENT
        } else {
            Color::BLACK
        };
        self.render(&compositor_scene, req.width, req.height)
    }

    pub fn render_to_file(&self, req: TimelineFrameRequest, target_path: &Path) -> Result<()> {
        let pixels = self.render_request_pixels(&req)?;
        save_rgba_as_webp(
            target_path,
            &pixels,
            req.width.max(1),
            req.height.max(1),
            webp_quality_percent(req.quality),
        )
    }

    pub fn render_to_webp(&self, req: TimelineFrameRequest) -> Result<Vec<u8>> {
        let pixels = self.render_request_pixels(&req)?;
        encode_rgba_as_webp(
            &pixels,
            req.width.max(1),
            req.height.max(1),
            webp_quality_percent(req.quality),
        )
    }
}

/// Parameters for rendering a single timeline frame. Bundled into one struct so
/// the render entry points stay readable instead of taking a long positional
/// argument list.
pub struct TimelineFrameRequest {
    pub scene: MonitorScene,
    pub time_sec: f64,
    pub width: u32,
    pub height: u32,
    pub quality: f32,
    pub hw_mode: HwAccelMode,
    pub vaapi_device: Option<String>,
    pub is_transparent: Option<bool>,
    /// Effect / antialiasing tier. Thumbnails pass `Low` (cheap sample budgets +
    /// analytic-area AA); stop-frame / still-export callers pass `Ultra`.
    pub effect_quality: crate::compositor::effects::EffectQuality,
}

static GLOBAL_RENDERER: std::sync::LazyLock<ThumbnailRenderer> =
    std::sync::LazyLock::new(ThumbnailRenderer::new);

pub fn render_timeline_frame_to_file(req: TimelineFrameRequest, target_path: &Path) -> Result<()> {
    GLOBAL_RENDERER.render_to_file(req, target_path)
}

pub fn render_timeline_frame_to_webp(req: TimelineFrameRequest) -> Result<Vec<u8>> {
    GLOBAL_RENDERER.render_to_webp(req)
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

#[cfg_attr(not(feature = "test-support"), allow(dead_code))]
pub fn build_export_scene(
    scene: &MonitorScene,
    time_sec: f64,
    target_size: (u32, u32),
    cache: &mut VideoDecoderCache,
    on_warning: Option<&(dyn Fn(String) + Send + Sync)>,
    effect_quality: crate::compositor::effects::EffectQuality,
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
            if let Some(t_out) = &scene.layers[i].transition_out {
                let local_t = time_sec - scene.layers[i].timeline_start_sec;
                let duration =
                    scene.layers[i].timeline_end_sec - scene.layers[i].timeline_start_sec;
                let out_start = (duration - t_out.duration_sec).max(0.0);
                if local_t >= out_start && local_t < duration {
                    if let Some(from_id) = &t_out.from_layer_id {
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
        let (layer_kind, source_rotation) = if matches!(layer.kind, LayerKind::Adjustment) {
            (CompLayerKind::Adjustment, 0)
        } else {
            match build_raster_kind(
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
            }
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
        video_tracks: scene
            .video_tracks
            .iter()
            .map(|track| VideoTrack {
                id: track.id.clone(),
                z: track.z,
                layer_ids: track.layer_ids.clone(),
                opacity: track.opacity.clamp(0.0, 1.0) as f32,
                blend: track.blend_mode,
                effects: track.effects.clone(),
            })
            .collect(),
        master_effects: scene.master_effects.clone(),
        effect_quality,
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
        LayerKind::Adjustment => return Ok(None),
        LayerKind::Video => {
            // A layer that does not `covers(time_sec)` but is still being rendered is
            // a transition peer: either the FROM side of an `in` transition whose
            // overlap runs past this clip's end (→ trailing handle), or the incoming
            // `to` side of the previous clip's `out` transition, composited before its
            // own start (→ leading handle). `transition_peer_source_pts_at` picks the
            // correct handle; using the tail unconditionally froze the incoming clip on
            // its out-point (or seeked past EOF → decode failed → the layer was skipped
            // and the transition vanished from exports/snapshots), matching neither the
            // web compositor nor the live preview.
            let source_pts = if layer.covers(time_sec) {
                layer.source_pts_at(time_sec)
            } else {
                layer.transition_peer_source_pts_at(time_sec)
            };
            let (frame, source_rotation) = match decode_video_frame_cached(
                Path::new(&layer.path),
                source_pts,
                max_output_long_edge,
                cache,
            ) {
                Ok(decoded) => decoded,
                Err(e) => {
                    let message = format!(
                        "Video layer could not be decoded at {time_sec:.3}s: {layer.path}."
                    );
                    log::warn!(
                        "[native-export] aborting after video decode failure {layer.path} at {time_sec:.3}s: {e}"
                    );
                    if let Some(callback) = on_warning {
                        callback(message.clone());
                    }
                    return Err(anyhow!("{message} {e}"));
                }
            };
            let size = (frame.width, frame.height);
            RasterBuild {
                kind: CompLayerKind::Raster {
                    source: RasterSource::Image(export_frame_to_image(&frame)),
                    natural_size: size,
                    padding: None,
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
                    padding: None,
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
                    padding: None,
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
    use crate::media::decode::{MediaInfo, VideoFrame};

    /// Emits frames on a fixed fps grid (`phase + k/fps`). `seek` mimics ffmpeg-next's
    /// frame-accurate seek: it positions so the next frame is the first one within
    /// half a frame of the target.
    struct GridDecoder {
        info: MediaInfo,
        times: Vec<f64>,
        cursor: usize,
    }

    impl GridDecoder {
        fn new(fps: f64, phase: f64, count: usize) -> Self {
            let times = (0..count).map(|k| phase + k as f64 / fps).collect();
            Self {
                info: MediaInfo {
                    duration_sec: count as f64 / fps,
                    width: 2,
                    height: 2,
                    rotation: 0,
                    fps,
                    codec: "h264".into(),
                    has_audio: false,
                    start_time_sec: 0.0,
                    is_hdr: false,
                },
                times,
                cursor: 0,
            }
        }
    }

    impl VideoDecoder for GridDecoder {
        fn info(&self) -> &MediaInfo {
            &self.info
        }
        fn seek(&mut self, time_sec: f64) -> Result<()> {
            let tol = 0.5 / self.info.fps;
            self.cursor = self
                .times
                .iter()
                .position(|&p| p >= time_sec - tol)
                .unwrap_or(self.times.len());
            Ok(())
        }
        fn next_frame(&mut self) -> Result<Option<VideoFrame>> {
            if self.cursor >= self.times.len() {
                return Ok(None);
            }
            let pts_sec = self.times[self.cursor];
            self.cursor += 1;
            Ok(Some(VideoFrame {
                width: 2,
                height: 2,
                pixels: vec![0u8; 16],
                yuv: None,
                pts_sec,
                texture: None,
            }))
        }
    }

    fn cached(decoder: GridDecoder) -> CachedDecoder {
        let fps = decoder.info.fps;
        CachedDecoder {
            decoder: Box::new(decoder),
            rotation: 0,
            fps,
            last: None,
            pending: None,
            max_output_long_edge: None,
            trace_path: PathBuf::from("test"),
        }
    }

    /// Drives `frame_at` over an export at `export_fps` and returns the source PTS
    /// of each emitted frame (centre sampling, `start + (i+0.5)/export_fps`).
    fn emit_pts(mut cd: CachedDecoder, export_fps: f64, start: f64, frames: usize) -> Vec<f64> {
        (0..frames)
            .map(|i| {
                let t = start + (i as f64 + 0.5) / export_fps;
                cd.frame_at(t).unwrap().pts_sec
            })
            .collect()
    }

    /// Asserts every consecutive pair of emitted source PTS advances by exactly one
    /// source-frame interval — i.e. strict 1:1, no duplicates (delta 0) and no drops
    /// (delta 2x). `skip` ignores leading frames whose seek landing is allowed slack.
    fn assert_one_to_one(pts: &[f64], source_fps: f64, skip: usize, ctx: &str) {
        let step = 1.0 / source_fps;
        for w in pts[skip..].windows(2) {
            let delta = w[1] - w[0];
            assert!(
                (delta - step).abs() < 1e-6,
                "{ctx}: expected 1:1 cadence (delta {step}), got {delta} between {} and {}",
                w[0],
                w[1],
            );
        }
    }

    #[test]
    fn matched_fps_export_is_one_to_one_for_every_phase() {
        // 25fps source exported at 25fps must advance exactly one source frame per
        // output frame — no duplicates, no drops — regardless of how the source grid
        // is phased against the sample grid AND of where the export range starts (a
        // clip's source-in point sets that phase at each cut). The pathological phase
        // (source frames on 0.00/0.04/... while the sample grid lands on the
        // boundaries) is exactly the "bad" clip-boundary case the old half-frame
        // tolerance match juddered on with periodic dup+drop pairs.
        for &phase in &[0.0, 0.01, 0.02, 0.019, 0.021, 0.0333] {
            // start offsets include grid-aligned multiples of the frame interval,
            // which put `target - half_frame` exactly on source boundaries.
            for &start in &[0.0, 0.02, 1.0 / 25.0, 2.0 / 25.0, 0.013] {
                let pts = emit_pts(cached(GridDecoder::new(25.0, phase, 600)), 25.0, start, 200);
                assert_one_to_one(&pts, 25.0, 1, &format!("phase {phase} start {start}"));
            }
        }
    }

    #[test]
    fn cut_forward_to_new_phase_resumes_one_to_one() {
        // The reported bug: a cut to a *different file* re-seeks the decoder, landing
        // at an arbitrary phase. Model the jump with a forward gap past the
        // sequential-decode threshold so `frame_at` re-seeks, then assert the new
        // segment is still clean 1:1 (no judder cluster after the cut).
        let mut cd = cached(GridDecoder::new(25.0, 0.0, 2000));
        // First segment, then jump ~30s ahead (a "different clip" further in the file).
        let mut pts: Vec<f64> = (0..40)
            .map(|i| cd.frame_at(0.5 + (i as f64 + 0.5) / 25.0).unwrap().pts_sec)
            .collect();
        let after_cut: Vec<f64> = (0..40)
            .map(|i| cd.frame_at(30.0 + (i as f64 + 0.5) / 25.0).unwrap().pts_sec)
            .collect();
        // Each segment must be internally 1:1 (skip the segment's seek-landing frame).
        assert_one_to_one(&pts, 25.0, 1, "pre-cut");
        assert_one_to_one(&after_cut, 25.0, 1, "post-cut");
        pts.extend(after_cut);
        assert!(
            pts.windows(2).all(|w| w[1] >= w[0] - 1e-9),
            "PTS must not regress"
        );
    }

    #[test]
    fn backward_seek_then_forward_stays_one_to_one() {
        // A backward cut (target before the held frame by > half a frame) must
        // re-seek and resume cleanly, not freeze on the old frame.
        let mut cd = cached(GridDecoder::new(25.0, 0.0, 2000));
        let _forward: Vec<f64> = (0..30)
            .map(|i| cd.frame_at(20.0 + (i as f64 + 0.5) / 25.0).unwrap().pts_sec)
            .collect();
        let rewound: Vec<f64> = (0..30)
            .map(|i| cd.frame_at(2.0 + (i as f64 + 0.5) / 25.0).unwrap().pts_sec)
            .collect();
        assert!(
            rewound[0] < 3.0,
            "backward seek should land near 2s, got {}",
            rewound[0]
        );
        assert_one_to_one(&rewound, 25.0, 1, "after rewind");
    }

    #[test]
    fn holds_last_frame_at_end_of_stream() {
        // Sampling at/just past the final source frame holds it (duplicates), rather
        // than erroring or advancing past EOF.
        let count = 25; // frames at 0.00..0.96
        let mut cd = cached(GridDecoder::new(25.0, 0.0, count));
        // Walk to the end, then request a few frames beyond the last source frame.
        let pts: Vec<f64> = (0..count + 5)
            .map(|i| cd.frame_at((i as f64 + 0.5) / 25.0).unwrap().pts_sec)
            .collect();
        let last_real = (count as f64 - 1.0) / 25.0;
        assert!(
            (pts[pts.len() - 1] - last_real).abs() < 1e-6,
            "tail should hold the last source frame {last_real}, got {}",
            pts[pts.len() - 1]
        );
        // The held tail repeats the same frame (deltas of 0), never advances past EOF.
        assert!(pts.iter().all(|&p| p <= last_real + 1e-6));
    }

    #[test]
    fn matched_fractional_fps_is_one_to_one() {
        // 30000/1001 (29.97) source exported at the same rate stays 1:1; the float
        // grid is irregular but sample-and-hold tracks it without dup/drop.
        let fps = 30000.0 / 1001.0;
        let pts = emit_pts(cached(GridDecoder::new(fps, 0.0, 600)), fps, 0.0, 200);
        assert_one_to_one(&pts, fps, 1, "29.97 matched");
    }

    #[test]
    fn matched_fps_real_decode_is_one_to_one() {
        // Integration: drive the real ffmpeg decoder + cache + seek path over a real
        // 25fps fixture exported at 25fps across several start phases (incl. grid
        // aligned). Exercises exactly the code the bug lived in, end to end.
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("test/fixtures/media/sample-1s-720p.mp4");
        let fps = 25.0;
        for &start in &[0.0, 0.5 / fps, 0.25 / fps, 1.0 / fps] {
            let mut cache = VideoDecoderCache::new();
            // 1s fixture; keep within range after the start offset.
            let frames = 18;
            let pts: Vec<f64> = (0..frames)
                .map(|i| {
                    let t = start + (i as f64 + 0.5) / fps;
                    decode_video_frame_cached(&fixture, t, None, &mut cache)
                        .unwrap()
                        .0
                        .pts_sec
                })
                .collect();
            // Real PTS carry timebase rounding, so allow a looser (still sub-frame) tol.
            for w in pts[1..].windows(2) {
                let delta = w[1] - w[0];
                assert!(
                    (delta - 1.0 / fps).abs() < 1.0 / fps * 0.25,
                    "real decode start {start}: expected ~1:1, got delta {delta} ({} -> {})",
                    w[0],
                    w[1],
                );
            }
        }
    }

    #[test]
    fn upsampling_duplicates_evenly_and_downsampling_drops_evenly() {
        // 25fps source at 50fps export: each source frame shows for exactly two output
        // frames (delta alternates 0 / one source frame), never three.
        let up = emit_pts(cached(GridDecoder::new(25.0, 0.0, 200)), 50.0, 0.0, 100);
        for w in up[1..].windows(2) {
            let delta = w[1] - w[0];
            assert!(
                delta < 1.0 / 25.0 + 1e-6,
                "upsample should never advance more than one source frame, got {delta}"
            );
        }
        assert!(
            up.windows(2).any(|w| (w[1] - w[0]).abs() < 1e-9),
            "expected some holds"
        );

        // 50fps source at 25fps export: every other source frame is dropped, evenly.
        let down = emit_pts(cached(GridDecoder::new(50.0, 0.0, 400)), 25.0, 0.0, 100);
        for w in down[1..].windows(2) {
            let delta = w[1] - w[0];
            assert!(
                (delta - 1.0 / 25.0).abs() < 1e-6,
                "downsample to 25fps should advance one output-frame interval, got {delta}"
            );
        }
    }

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
        // The repeat hit must not double-count bytes or duplicate the LRU entry.
        assert_eq!(cache.raster_lru.len(), 1);
        assert_eq!(cache.raster_bytes, 1280 * 720 * 4);
        assert_eq!(first.natural_size, (1280, 720));
        assert_eq!(second.natural_size, first.natural_size);
    }

    #[test]
    fn raster_cache_evicts_lru_over_budget() {
        let mut cache = VideoDecoderCache::new();
        // One entry that alone fills the whole budget so any further insert evicts it.
        let big = (RASTER_CACHE_BUDGET_BYTES / 4) as u32;
        let make = |bytes: u64| CachedRaster {
            image: ImageData {
                data: Blob::new(std::sync::Arc::new(vec![0u8; 4])),
                format: VelloImageFormat::Rgba8,
                alpha_type: ImageAlphaType::Alpha,
                width: 1,
                height: 1,
            },
            natural_size: ((bytes / 4) as u32, 1),
        };

        let old_path = PathBuf::from("/old.png");
        let old = make(big as u64 * 4);
        cache.images.insert(old_path.clone(), old.clone());
        cache.track_raster_insert(
            RasterKey::Image(old_path.clone()),
            raster_estimated_bytes(&old),
        );
        assert_eq!(cache.images.len(), 1);

        let new_path = PathBuf::from("/new.png");
        let new = make(big as u64 * 4);
        cache.images.insert(new_path.clone(), new.clone());
        cache.track_raster_insert(
            RasterKey::Image(new_path.clone()),
            raster_estimated_bytes(&new),
        );

        // The older, less-recently-used entry is dropped; the new one survives.
        assert!(!cache.images.contains_key(&old_path));
        assert!(cache.images.contains_key(&new_path));
        assert_eq!(cache.raster_lru.len(), 1);
        assert!(cache.raster_bytes <= RASTER_CACHE_BUDGET_BYTES);
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
            source_duration_sec: None,
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
            snap_to_pixel_grid: false,
            transform: None,
            animations: None,
            baked_effects: None,
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
            source_duration_sec: None,
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
            snap_to_pixel_grid: false,
            transform: None,
            animations: None,
            baked_effects: None,
            transition_in: Some(crate::monitor::scene::SceneTransition {
                transition_type: "dissolve".into(),
                duration_sec: 1.0,
                curve: None,
                from_layer_id: Some("from".into()),
                mode: Some("adjacent".into()),
                spec: None,
            }),
            transition_out: None,
            effects: Vec::new(),
        };
        let scene = MonitorScene {
            master_effects: Vec::new(),
            layers: vec![from, to],
            video_tracks: vec![],
            audio_layers: vec![],
            audio_tracks: vec![],
            audio_master_gain: 1.0,
            audio_master_muted: false,
            audio_master_effects: Vec::new(),
            width: 1920,
            height: 1080,
            preview_scale: None,
            preview_fps: 30.0,
            preview_sync_mode: crate::monitor::scene::PreviewSyncMode::Balanced,
            preview_effect_quality: crate::compositor::effects::EffectQuality::Ultra,
            frame_cache_mode: crate::monitor::scene::NativeFrameCacheMode::Auto,
            frame_cache_custom_mb: 0,
        };
        let mut cache = VideoDecoderCache::new();
        let export = build_export_scene(
            &scene,
            2.5,
            (1920, 1080),
            &mut cache,
            None,
            crate::compositor::effects::EffectQuality::Ultra,
        )
        .unwrap();

        let ids: Vec<_> = export.layers.iter().map(|l| l.id.as_str()).collect();
        assert!(
            ids.contains(&"from"),
            "from_layer must be present during transition"
        );
        assert!(
            ids.contains(&"to"),
            "to_layer must be present during transition"
        );
    }

    #[test]
    fn export_scene_keeps_adjustment_layer_effects() {
        let background = SceneLayer {
            id: "bg".into(),
            kind: LayerKind::Background,
            path: String::new(),
            timeline_start_sec: 0.0,
            timeline_end_sec: 5.0,
            source_start_sec: 0.0,
            source_range_duration_sec: 5.0,
            source_duration_sec: None,
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
            snap_to_pixel_grid: false,
            transform: None,
            animations: None,
            baked_effects: None,
            transition_in: None,
            transition_out: None,
            effects: Vec::new(),
        };
        let mut adjustment = background.clone();
        adjustment.id = "adj".into();
        adjustment.kind = LayerKind::Adjustment;
        adjustment.z = 1;
        adjustment.effects = vec![crate::compositor::effects::EffectSpec::GaussianBlur {
            radius: 12.0,
            bleed: false,
            blur_type: "gaussian".to_string(),
            mix: 1.0,
        }];
        let scene = MonitorScene {
            master_effects: Vec::new(),
            layers: vec![background, adjustment],
            video_tracks: vec![],
            audio_layers: vec![],
            audio_tracks: vec![],
            audio_master_gain: 1.0,
            audio_master_muted: false,
            audio_master_effects: Vec::new(),
            width: 1920,
            height: 1080,
            preview_scale: None,
            preview_fps: 30.0,
            preview_sync_mode: crate::monitor::scene::PreviewSyncMode::Balanced,
            preview_effect_quality: crate::compositor::effects::EffectQuality::Ultra,
            frame_cache_mode: crate::monitor::scene::NativeFrameCacheMode::Auto,
            frame_cache_custom_mb: 0,
        };
        let mut cache = VideoDecoderCache::new();
        let export = build_export_scene(
            &scene,
            2.5,
            (1920, 1080),
            &mut cache,
            None,
            crate::compositor::effects::EffectQuality::Ultra,
        )
        .unwrap();

        let adjustment_layer = export
            .layers
            .iter()
            .find(|layer| matches!(layer.kind, CompLayerKind::Adjustment))
            .expect("adjustment layer should be present in export scene");
        assert_eq!(adjustment_layer.effects.len(), 1);
    }
}
