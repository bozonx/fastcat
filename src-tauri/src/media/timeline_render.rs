use anyhow::{anyhow, Result};
use image::{ColorType, ImageFormat};
use parking_lot::Mutex;
use std::path::Path;
use std::sync::Arc;
use vello::peniko::{Blob, Color, ImageAlphaType, ImageData, ImageFormat as VelloImageFormat};

use crate::compositor::scene::{LayerKind as CompLayerKind, RasterSource, Scene};
use crate::compositor::Compositor;
use crate::media::decode::{open as open_decoder, VideoFrame};
use crate::media::image_decode::decode_image;
use crate::monitor::scene::{LayerKind, MonitorScene, SceneLayer};
use crate::monitor::scene_build::{build_virtual_kind, finalize_layer, rasterize_svg};

/// Пул offscreen-компоновщиков, переиспользуемый между вызовами рендера миниатюр.
/// Раньше каждый thumbnail делал `Compositor::new()` → новый wgpu device + vello
/// Renderer на КАЖДУЮ миниатюру (дорогое пересоздание GPU-контекста). При генерации
/// дорожки маркеров/таймлайн-миниатюр это давало десятки device-инициализаций.
/// Теперь один общий compositor живёт между вызовами (ленивая инициализация).
static THUMBNAIL_COMPOSITOR: once_cell::sync::Lazy<Mutex<Option<Compositor>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(None));

/// Рендерит одну compositor-сцену в RGBA-пиксели через общий пул-компоновщик.
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
    let compositor_scene = build_export_scene(&scene, time_sec, (width.max(1), height.max(1)))?;
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

/// Строит compositor-снимок таймлайна в момент `time_sec`, целясь в `target_size`
/// (= размер выходного кадра: миниатюра или export-разрешение). Растровые слои
/// (video/image/svg) декодируются синхронно; виртуальные строит общий `scene_build`.
/// SVG растеризуется под длинную сторону `target_size`, чтобы не мылиться/не жечь память.
pub(crate) fn build_export_scene(
    scene: &MonitorScene,
    time_sec: f64,
    target_size: (u32, u32),
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
        let layer_kind = match build_raster_kind(layer, time_sec, svg_long_edge)? {
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

/// Синхронно декодирует растровый слой (video/image/svg). Для виртуальных kind'ов
/// возвращает `None` (их строит `build_virtual_kind`).
fn build_raster_kind(
    layer: &SceneLayer,
    time_sec: f64,
    svg_long_edge: u32,
) -> Result<Option<CompLayerKind>> {
    let kind = match layer.kind {
        LayerKind::Video => {
            let frame = decode_video_frame(Path::new(&layer.path), layer.source_pts_at(time_sec))?;
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
