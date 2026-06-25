use anyhow::{anyhow, Result};
use vello::peniko::{ImageData, ImageFormat};

/// Builds a 2D texture with the single-mip / single-sample settings used
/// everywhere in the compositor, leaving format and usage to the caller. Collapses
/// the dozen-plus near-identical `TextureDescriptor` literals scattered across the
/// effect / transition / yuv / engine paths into one call.
pub fn create_texture_2d(
    device: &wgpu::Device,
    label: &str,
    width: u32,
    height: u32,
    format: wgpu::TextureFormat,
    usage: wgpu::TextureUsages,
) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some(label),
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage,
        view_formats: &[],
    })
}

/// `create_texture_2d` specialised to `Rgba8Unorm` — the compositor's working format.
pub fn create_rgba8_texture(
    device: &wgpu::Device,
    label: &str,
    width: u32,
    height: u32,
    usage: wgpu::TextureUsages,
) -> wgpu::Texture {
    create_texture_2d(
        device,
        label,
        width,
        height,
        wgpu::TextureFormat::Rgba8Unorm,
        usage,
    )
}

/// Bytes per row padded up to wgpu's 256-byte copy alignment (`COPY_BYTES_PER_ROW_ALIGNMENT`)
/// for tightly-packed RGBA8 rows.
pub fn aligned_row_bytes(width: u32) -> usize {
    let row_bytes = width as usize * 4;
    (row_bytes + 255) & !255
}

/// Creates an offscreen RGBA8 render target (`STORAGE_BINDING | COPY_SRC`) paired
/// with a mappable readback buffer sized for 256-aligned row copies. Returns
/// `(texture, view, buffer, aligned_row_bytes)`. Shared by the monitor offscreen
/// target and the pipelined readback ring, which built this identically.
pub fn create_readback_target(
    device: &wgpu::Device,
    label_prefix: &str,
    width: u32,
    height: u32,
) -> (wgpu::Texture, wgpu::TextureView, wgpu::Buffer, usize) {
    let aligned = aligned_row_bytes(width);
    let buffer_size = (aligned * height as usize) as u64;
    let texture = create_rgba8_texture(
        device,
        &format!("{label_prefix}-offscreen"),
        width,
        height,
        wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_SRC,
    );
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some(&format!("{label_prefix}-readback")),
        size: buffer_size,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    (texture, view, buffer, aligned)
}

/// Extract dense RGBA8 bytes from an `ImageData`, converting BGRA8 if needed.
pub fn image_pixels_rgba8(image: &ImageData) -> Result<Vec<u8>> {
    let expected = image
        .format
        .size_in_bytes(image.width, image.height)
        .ok_or_else(|| anyhow!("image byte size overflow"))?;
    let data = image.data.data();
    if data.len() < expected {
        return Err(anyhow!(
            "image data is too small: {} bytes for {}x{}",
            data.len(),
            image.width,
            image.height
        ));
    }
    match image.format {
        ImageFormat::Rgba8 => Ok(data[..expected].to_vec()),
        ImageFormat::Bgra8 => {
            let mut rgba = data[..expected].to_vec();
            for px in rgba.chunks_exact_mut(4) {
                px.swap(0, 2);
            }
            Ok(rgba)
        }
        _ => Err(anyhow!("unsupported image format for GPU texture upload")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use vello::peniko::{Blob, ImageAlphaType};

    #[test]
    fn aligned_row_bytes_width_1_is_256() {
        // 1px * 4 bytes = 4, padded to 256.
        assert_eq!(aligned_row_bytes(1), 256);
    }

    #[test]
    fn aligned_row_bytes_width_64_is_256() {
        // 64px * 4 bytes = 256, already aligned.
        assert_eq!(aligned_row_bytes(64), 256);
    }

    #[test]
    fn aligned_row_bytes_width_65_is_512() {
        // 65px * 4 bytes = 260, padded to 512.
        assert_eq!(aligned_row_bytes(65), 512);
    }

    #[test]
    fn aligned_row_bytes_width_1920_is_7680() {
        // 1920px * 4 = 7680, already aligned (7680 / 256 = 30).
        assert_eq!(aligned_row_bytes(1920), 7680);
    }

    #[test]
    fn aligned_row_bytes_width_1921_is_7936() {
        // 1921px * 4 = 7684, padded to 7936 (31 * 256).
        assert_eq!(aligned_row_bytes(1921), 7936);
    }

    #[test]
    fn aligned_row_bytes_zero_width_is_zero() {
        // 0px * 4 = 0, (0 + 255) & !255 = 0.
        assert_eq!(aligned_row_bytes(0), 0);
    }

    fn make_image(format: ImageFormat, w: u32, h: u32, pixels: Vec<u8>) -> ImageData {
        ImageData {
            data: Blob::new(Arc::new(pixels)),
            format,
            alpha_type: ImageAlphaType::Alpha,
            width: w,
            height: h,
        }
    }

    #[test]
    fn image_pixels_rgba8_passes_through() {
        let pixels = vec![10, 20, 30, 40, 50, 60, 70, 80];
        let img = make_image(ImageFormat::Rgba8, 2, 1, pixels.clone());
        assert_eq!(image_pixels_rgba8(&img).unwrap(), pixels);
    }

    #[test]
    fn image_pixels_bgra8_swaps_r_and_b() {
        let pixels = vec![10, 20, 30, 40, 50, 60, 70, 80];
        let img = make_image(ImageFormat::Bgra8, 2, 1, pixels);
        let result = image_pixels_rgba8(&img).unwrap();
        assert_eq!(result, vec![30, 20, 10, 40, 70, 60, 50, 80]);
    }

    #[test]
    fn image_pixels_too_small_returns_error() {
        let img = make_image(ImageFormat::Rgba8, 2, 2, vec![0u8; 4]);
        assert!(image_pixels_rgba8(&img).is_err());
    }
}
