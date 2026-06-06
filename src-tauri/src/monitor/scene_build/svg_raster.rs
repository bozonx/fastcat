//! Декод растровых ресурсов: SVG → `ImageData` + глобальная база шрифтов.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::SystemTime;

use anyhow::Result;
use vello::peniko::{Blob, ImageAlphaType, ImageData, ImageFormat};

static GLOBAL_FONT_DB: OnceLock<Arc<resvg::usvg::fontdb::Database>> = OnceLock::new();

fn get_font_db() -> Arc<resvg::usvg::fontdb::Database> {
    GLOBAL_FONT_DB
        .get_or_init(|| {
            log::info!("[svg] scanning system fonts once for the global database...");
            let mut db = resvg::usvg::fontdb::Database::new();
            db.load_system_fonts();
            Arc::new(db)
        })
        .clone()
}

/// Уникальные имена семейств шрифтов, установленных в системе, отсортированные
/// по алфавиту. Берётся из той же глобальной базы, что и растеризация SVG, поэтому
/// список ровно соответствует тому, чем реально умеет рисовать нативный рендер.
pub fn system_font_families() -> Vec<String> {
    let db = get_font_db();
    let mut families: Vec<String> = db
        .faces()
        .filter_map(|face| face.families.first().map(|(name, _)| name.clone()))
        .collect();
    families.sort_unstable_by_key(|name| name.to_lowercase());
    families.dedup();
    families
}

struct SvgCacheEntry {
    modified: SystemTime,
    image: ImageData,
    size: (u32, u32),
}

static SVG_CACHE: OnceLock<Mutex<lru::LruCache<(PathBuf, u32), SvgCacheEntry>>> = OnceLock::new();

/// Растеризует SVG в `ImageData`, целясь в `target_long_edge` пикселей по длинной
/// стороне (= разрешение, в котором слой будет показан: монитор для preview,
/// export-кадр для экспорта). Раньше растеризация шла всегда в натуральном размере
/// SVG, из-за чего мелкие иконки на весь экран были мыными, а большие SVG в
/// маленьком preview зря жгли память.
pub fn rasterize_svg(path: &Path, target_long_edge: u32) -> Result<(ImageData, (u32, u32))> {
    let path_buf = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let maybe_modified = fs::metadata(&path_buf).and_then(|m| m.modified()).ok();

    let cache_lock = SVG_CACHE.get_or_init(|| {
        Mutex::new(lru::LruCache::new(
            std::num::NonZeroUsize::new(128).unwrap(),
        ))
    });
    if let (Some(modified), Ok(mut cache)) = (maybe_modified, cache_lock.lock()) {
        if let Some(entry) = cache.get(&(path_buf.clone(), target_long_edge)) {
            if entry.modified == modified {
                return Ok((entry.image.clone(), entry.size));
            }
        }
    }

    let options = resvg::usvg::Options {
        resources_dir: path_buf.parent().map(|p| p.to_path_buf()),
        fontdb: get_font_db(),
        ..resvg::usvg::Options::default()
    };

    let bytes = fs::read(&path_buf)?;

    let tree = resvg::usvg::Tree::from_data(&bytes, &options)?;
    let natural = tree.size().to_int_size();
    let (nw, nh) = (natural.width().max(1), natural.height().max(1));

    // Масштаб так, чтобы длинная сторона == target_long_edge. Кламп, чтобы не
    // улетать в гигантские pixmap'ы при экзотических target'ах.
    let long = nw.max(nh) as f64;
    let target = target_long_edge.max(1) as f64;
    let scale = (target / long).clamp(0.01, 64.0);
    let out_w = ((nw as f64 * scale).round() as u32).max(1);
    let out_h = ((nh as f64 * scale).round() as u32).max(1);

    let mut pixmap = resvg::tiny_skia::Pixmap::new(out_w, out_h)
        .ok_or_else(|| anyhow::anyhow!("cannot create svg pixmap {out_w}x{out_h}"))?;
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::from_scale(scale as f32, scale as f32),
        &mut pixmap.as_mut(),
    );
    let width = pixmap.width();
    let height = pixmap.height();
    let data = pixmap.take();

    let image = ImageData {
        data: Blob::new(Arc::new(data)),
        format: ImageFormat::Rgba8,
        alpha_type: ImageAlphaType::AlphaPremultiplied,
        width,
        height,
    };
    let size = (width, height);

    if let (Some(modified), Ok(mut cache)) = (maybe_modified, cache_lock.lock()) {
        cache.push(
            (path_buf, target_long_edge),
            SvgCacheEntry {
                modified,
                image: image.clone(),
                size,
            },
        );
    }

    Ok((image, size))
}
