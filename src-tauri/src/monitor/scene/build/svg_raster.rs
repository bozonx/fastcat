//! Decoding raster assets: SVG → `ImageData` + the global font database.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::SystemTime;

use anyhow::Result;
use vello::peniko::{Blob, ImageAlphaType, ImageData, ImageFormat};

struct SvgCacheEntry {
    modified: SystemTime,
    image: ImageData,
    size: (u32, u32),
}

/// Holds the font database and an LRU cache for rendered SVGs.
/// Extracted from global statics so tests can inject stubs or use fresh instances.
pub struct SvgRasterizer {
    font_db: OnceLock<Arc<resvg::usvg::fontdb::Database>>,
    svg_cache: Mutex<lru::LruCache<(PathBuf, u32), SvgCacheEntry>>,
}

impl Default for SvgRasterizer {
    fn default() -> Self {
        Self::new()
    }
}

impl SvgRasterizer {
    pub fn new() -> Self {
        Self {
            font_db: OnceLock::new(),
            svg_cache: Mutex::new(lru::LruCache::new(
                std::num::NonZeroUsize::new(128).unwrap(),
            )),
        }
    }

    fn get_font_db(&self) -> Arc<resvg::usvg::fontdb::Database> {
        self.font_db
            .get_or_init(|| {
                log::info!("[svg] scanning system fonts once for the global database...");
                let mut db = resvg::usvg::fontdb::Database::new();
                db.load_system_fonts();
                Arc::new(db)
            })
            .clone()
    }

    /// Unique system font family names, sorted alphabetically.
    pub fn system_font_families(&self) -> Vec<String> {
        let db = self.get_font_db();
        let mut families: Vec<String> = db
            .faces()
            .filter_map(|face| face.families.first().map(|(name, _)| name.clone()))
            .collect();
        families.sort_unstable_by_key(|name| name.to_lowercase());
        families.dedup();
        families
    }

    /// Rasterises an SVG into `ImageData` targeting `target_long_edge` pixels on
    /// the long side (the resolution at which the layer will actually be displayed).
    pub fn rasterize_svg(
        &self,
        path: &Path,
        target_long_edge: u32,
    ) -> Result<(ImageData, (u32, u32))> {
        let path_buf = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
        let maybe_modified = fs::metadata(&path_buf).and_then(|m| m.modified()).ok();

        if let (Some(modified), Ok(mut cache)) = (maybe_modified, self.svg_cache.lock()) {
            if let Some(entry) = cache.get(&(path_buf.clone(), target_long_edge)) {
                if entry.modified == modified {
                    return Ok((entry.image.clone(), entry.size));
                }
            }
        }

        let options = resvg::usvg::Options {
            resources_dir: path_buf.parent().map(|p| p.to_path_buf()),
            fontdb: self.get_font_db(),
            ..resvg::usvg::Options::default()
        };

        let bytes = fs::read(&path_buf)?;

        let tree = resvg::usvg::Tree::from_data(&bytes, &options)?;
        let natural = tree.size().to_int_size();
        let (nw, nh) = (natural.width().max(1), natural.height().max(1));

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

        if let (Some(modified), Ok(mut cache)) = (maybe_modified, self.svg_cache.lock()) {
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
}

static GLOBAL_RASTERIZER: OnceLock<SvgRasterizer> = OnceLock::new();

fn global_rasterizer() -> &'static SvgRasterizer {
    GLOBAL_RASTERIZER.get_or_init(SvgRasterizer::new)
}

/// Unique names of font families installed on the system, sorted alphabetically.
/// Taken from the same global database as SVG rasterization, so the list matches
/// exactly what the native renderer can actually draw with.
pub fn system_font_families() -> Vec<String> {
    global_rasterizer().system_font_families()
}

/// Rasterizes an SVG into `ImageData`, targeting `target_long_edge` pixels on the
/// long side (= the resolution the layer will be shown at: the monitor for preview,
/// the export frame for export). Previously rasterization always used the SVG's
/// natural size, which made small icons blurry when shown full-screen and large SVGs
/// in a small preview waste memory.
pub fn rasterize_svg(path: &Path, target_long_edge: u32) -> Result<(ImageData, (u32, u32))> {
    global_rasterizer().rasterize_svg(path, target_long_edge)
}
