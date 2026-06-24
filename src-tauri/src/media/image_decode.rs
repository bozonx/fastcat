//! Decoding static images (PNG/JPEG/WebP) via the `image` crate.
//!
//! Returns RGBA8 `ImageData` for direct drawing by the Vello compositor.
//! Alpha matters: PNG/WebP can carry transparency — we return it as straight alpha.

use std::path::Path;
use std::sync::Arc;

use anyhow::{Context, Result};
use vello::peniko::{Blob, ImageAlphaType, ImageData, ImageFormat};

pub struct DecodedImage {
    pub width: u32,
    pub height: u32,
    pub image: ImageData,
}

pub fn decode_image(path: &Path) -> Result<DecodedImage> {
    let mut reader = image::ImageReader::open(path)
        .with_context(|| format!("failed to open image {}", path.display()))?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(16384);
    limits.max_image_height = Some(16384);
    limits.max_alloc = Some(1024 * 1024 * 1024);
    reader.limits(limits);
    let img = reader
        .decode()
        .with_context(|| format!("failed to decode image {}", path.display()))?
        .to_rgba8();
    let (width, height) = img.dimensions();
    let pixels = img.into_raw();
    let blob = Blob::new(Arc::new(pixels));
    let image = ImageData {
        data: blob,
        format: ImageFormat::Rgba8,
        // `image` returns straight (unpremultiplied) RGBA.
        alpha_type: ImageAlphaType::Alpha,
        width,
        height,
    };
    Ok(DecodedImage {
        width,
        height,
        image,
    })
}

/// Extensions we treat as a "static image" — this is a marker for the
/// bridge/IPC so it can separate video vs image without re-parsing.
pub fn is_image_extension(ext: &str) -> bool {
    matches!(
        ext.to_ascii_lowercase().as_str(),
        "png" | "jpg" | "jpeg" | "webp"
    )
}
