use std::path::Path;

use ffmpeg_next as ffmpeg;

use crate::media::decode::{
    VideoDecoder, VideoDecoderFactory,
    ffmpeg_next::{init_ffmpeg, FfmpegNextDecoder, FfmpegNextDecoderFactory},
    types::{SharedTexture, YuvColor, YuvColorMatrix, YuvColorRange},
    utils::{
        coded_output_dimensions, compute_output_dims, copy_plane_rows, display_matrix_rotation,
        probe_rotation, visual_dimensions, yuv_color,
    },
};
use crate::media::ffmpeg::utils::{format_fps, parse_rational};
use crate::media::types::HwAccelMode;

#[test]
fn compute_output_dims_no_cap_returns_source() {
    assert_eq!(compute_output_dims(1920, 1080, None), (1920, 1080));
    assert_eq!(compute_output_dims(1920, 1080, Some(0)), (1920, 1080));
}

#[test]
fn compute_output_dims_no_upscale() {
    assert_eq!(compute_output_dims(640, 480, Some(4096)), (640, 480));
}

#[test]
fn compute_output_dims_downscale_keeps_aspect_and_even() {
    let (w, h) = compute_output_dims(3840, 2160, Some(1920));
    assert_eq!(w, 1920);
    assert_eq!(h, 1080);
    assert_eq!(w & 1, 0);
    assert_eq!(h & 1, 0);
}

#[test]
fn compute_output_dims_portrait() {
    let (w, h) = compute_output_dims(1080, 1920, Some(960));
    assert_eq!(h, 960);
    assert_eq!(w, 540);
    assert_eq!(w & 1, 0);
}

#[test]
fn visual_dimensions_swaps_quarter_turn_rotation() {
    assert_eq!(visual_dimensions(1920, 1080, 90), (1080, 1920));
    assert_eq!(visual_dimensions(1920, 1080, -90), (1080, 1920));
    assert_eq!(visual_dimensions(1920, 1080, 270), (1080, 1920));
}

#[test]
fn visual_dimensions_keeps_unrotated_and_half_turn_sources() {
    assert_eq!(visual_dimensions(1920, 1080, 0), (1920, 1080));
    assert_eq!(visual_dimensions(1920, 1080, 180), (1920, 1080));
}

#[test]
fn coded_output_dimensions_swap_quarter_turn_rotation() {
    assert_eq!(coded_output_dimensions(1080, 1920, 90), (1920, 1080));
    assert_eq!(coded_output_dimensions(1080, 1920, 270), (1920, 1080));
    assert_eq!(coded_output_dimensions(1920, 1080, 0), (1920, 1080));
}

#[test]
fn yuv_color_uses_frame_metadata() {
    let mut frame = ffmpeg::util::frame::Video::new(ffmpeg::format::Pixel::NV12, 1920, 1080);
    frame.set_color_space(ffmpeg::util::color::Space::BT709);
    frame.set_color_range(ffmpeg::util::color::Range::JPEG);

    assert_eq!(
        yuv_color(&frame),
        YuvColor {
            matrix: YuvColorMatrix::Bt709,
            range: YuvColorRange::Full,
        }
    );
}

#[test]
fn yuv_color_defaults_sd_unspecified_to_bt601_limited() {
    let frame = ffmpeg::util::frame::Video::new(ffmpeg::format::Pixel::NV12, 720, 576);

    assert_eq!(
        yuv_color(&frame),
        YuvColor {
            matrix: YuvColorMatrix::Bt601,
            range: YuvColorRange::Limited,
        }
    );
}

#[test]
fn copy_plane_rows_removes_stride_padding() {
    let src = [1, 2, 3, 9, 4, 5, 6, 9];

    assert_eq!(copy_plane_rows(&src, 4, 3, 2), vec![1, 2, 3, 4, 5, 6]);
}

#[test]
fn copy_yuv420p_as_nv12_interleaves_uv() {
    let mut frame = ffmpeg::util::frame::Video::new(ffmpeg::format::Pixel::YUV420P, 4, 2);
    let y_stride = frame.stride(0);
    let u_stride = frame.stride(1);
    let v_stride = frame.stride(2);
    frame.data_mut(0)[..4].copy_from_slice(&[1, 2, 3, 4]);
    frame.data_mut(0)[y_stride..y_stride + 4].copy_from_slice(&[5, 6, 7, 8]);
    frame.data_mut(1)[..2].copy_from_slice(&[10, 11]);
    frame.data_mut(2)[..2].copy_from_slice(&[20, 21]);

    let yuv = crate::media::decode::utils::copy_yuv420p_as_nv12_frame(
        &frame,
        YuvColor {
            matrix: YuvColorMatrix::Bt709,
            range: YuvColorRange::Limited,
        },
    );

    assert_eq!(u_stride, frame.stride(1));
    assert_eq!(v_stride, frame.stride(2));
    assert_eq!(yuv.y, vec![1, 2, 3, 4, 5, 6, 7, 8]);
    assert_eq!(yuv.uv, vec![10, 20, 11, 21]);
}

#[test]
fn probe_rotation_reads_tags_rotate() {
    let video = serde_json::json!({
        "tags": {
            "rotate": "90"
        }
    });

    assert_eq!(probe_rotation(&video), 90);
}

#[test]
fn probe_rotation_reads_side_data_rotation() {
    let video = serde_json::json!({
        "side_data_list": [
            {
                "side_data_type": "Display Matrix",
                "rotation": -90
            }
        ]
    });

    assert_eq!(probe_rotation(&video), 90);
}

#[test]
fn display_matrix_rotation_reads_quarter_turn() {
    let mut matrix = [0i32; 9];
    matrix[1] = 1 << 16;
    let data: Vec<u8> = matrix
        .iter()
        .flat_map(|value| value.to_ne_bytes())
        .collect();

    assert_eq!(display_matrix_rotation(&data), Some(90));
}

#[test]
fn display_matrix_rotation_reads_identity() {
    let mut matrix = [0i32; 9];
    matrix[0] = 1 << 16;
    matrix[4] = 1 << 16;
    matrix[8] = 1 << 30;
    let data: Vec<u8> = matrix
        .iter()
        .flat_map(|value| value.to_ne_bytes())
        .collect();

    assert_eq!(display_matrix_rotation(&data), Some(0));
}

#[test]
fn compute_output_dims_floors_to_even_and_min_two() {
    let (w, h) = compute_output_dims(3, 5, Some(2));
    assert!(w >= 2 && h >= 2);
    assert_eq!(w & 1, 0);
    assert_eq!(h & 1, 0);
}

#[test]
fn parse_rational_basic() {
    assert_eq!(parse_rational("30000/1001"), Some(30000.0 / 1001.0));
    assert_eq!(parse_rational("25"), Some(25.0));
    assert_eq!(parse_rational("0/0"), None);
    assert_eq!(parse_rational("abc"), None);
}

#[test]
fn format_fps_handles_invalid() {
    assert_eq!(format_fps(0.0), "30.000000");
    assert_eq!(format_fps(f64::NAN), "30.000000");
    assert_eq!(format_fps(23.976), "23.976000");
}

#[test]
fn ffmpeg_next_decoder_reads_fixture_first_frame() {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("test/fixtures/media/sample-1s-720p.mp4");
    let mut decoder = FfmpegNextDecoder::open(&fixture, None, HwAccelMode::None, None).unwrap();
    let frame = decoder.next_frame().unwrap().unwrap();

    assert_eq!(decoder.info().width, 1280);
    assert_eq!(decoder.info().height, 720);
    assert_eq!(frame.width, 1280);
    assert_eq!(frame.height, 720);
    assert_eq!(frame.pixels.len(), 1280 * 720 * 4);
    assert!(frame.pts_sec >= 0.0);
}

#[test]
fn ffmpeg_next_decoder_reads_alpha_webm() {
    init_ffmpeg().unwrap();
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("test/fixtures/media/test_alpha_simple.webm");
    let mut decoder = FfmpegNextDecoder::open(&fixture, None, HwAccelMode::None, None).unwrap();
    let frame = decoder.next_frame().unwrap().unwrap();

    assert_eq!(decoder.info().codec, "vp9");
    assert_eq!(frame.width, 200);
    assert_eq!(frame.height, 200);
    assert_eq!(frame.pixels.len(), 200 * 200 * 4);

    // Verify that the video contains transparency (at least one pixel has alpha < 255)
    let mut has_transparency = false;
    for i in 0..(frame.pixels.len() / 4) {
        let alpha = frame.pixels[i * 4 + 3];
        if alpha < 255 {
            has_transparency = true;
            break;
        }
    }
    assert!(
        has_transparency,
        "Expected some transparent pixels in alpha webm"
    );
}

#[test]
fn ffmpeg_next_decoder_hwaccel_graceful_fallback() {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("test/fixtures/media/sample-1s-720p.mp4");
    // Requesting VAAPI on a build without a driver should still open and
    // decode frames because we fall back to software decode.
    let mut decoder =
        FfmpegNextDecoder::open(&fixture, None, HwAccelMode::Vaapi, None).unwrap();
    let frame = decoder.next_frame().unwrap().unwrap();
    assert_eq!(frame.width, 1280);
    assert_eq!(frame.height, 720);
    assert_eq!(frame.pixels.len(), 1280 * 720 * 4);
}

#[test]
fn ffmpeg_next_decoder_seek_is_frame_accurate() {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("test/fixtures/media/sample-1s-720p.mp4");
    let mut decoder = FfmpegNextDecoder::open(&fixture, None, HwAccelMode::None, None).unwrap();
    let fps = decoder.effective_fps();

    // A seek to the middle of the clip must return the frame AT the requested position
    // (frame-accurate), not the preceding key frame. Tolerance is half a frame.
    let target = 0.5;
    decoder.seek(target).unwrap();
    let frame = decoder
        .next_frame()
        .unwrap()
        .expect("frame after mid-clip seek");
    assert!(
        (frame.pts_sec - target).abs() <= 0.5 / fps + 1e-6,
        "seek not frame-accurate: target={target}, got pts={}",
        frame.pts_sec
    );
}

#[test]
fn ffmpeg_next_decoder_seek_keep_preseek_emits_preseek_frames() {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("test/fixtures/media/sample-1s-720p.mp4");
    let mut decoder = FfmpegNextDecoder::open(&fixture, None, HwAccelMode::None, None).unwrap();

    let target = 0.5;
    decoder.seek(target).unwrap();

    // In keep_preseek mode we must get frames BEFORE target (starting from the keyframe at 0.0)
    let mut frames = Vec::new();
    while let Some(frame) = decoder.next_frame_keep_preseek().unwrap() {
        frames.push(frame);
        // Stop once we reach target (so we don't decode the whole file to the end)
        if decoder.seek_target.is_none() {
            break;
        }
    }

    // We must get several frames
    assert!(
        frames.len() > 1,
        "expected multiple preseek frames, got {}",
        frames.len()
    );
    // The first frame should be near 0.0 (the keyframe)
    assert!(
        frames[0].pts_sec < 0.1,
        "first frame should be keyframe, got {}",
        frames[0].pts_sec
    );
    // The last frame should be close to target
    let last_pts = frames.last().unwrap().pts_sec;
    let fps = decoder.effective_fps();
    assert!(
        (last_pts - target).abs() <= 0.5 / fps + 1e-6,
        "last frame not near target: target={target}, got pts={}",
        last_pts
    );
}

#[test]
fn ffmpeg_next_decoder_factory_opens_fixture_via_trait() {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("test/fixtures/media/sample-1s-720p.mp4");
    let factory = FfmpegNextDecoderFactory;
    let mut decoder = factory
        .open(&fixture, None, HwAccelMode::None, None)
        .unwrap();
    let frame = decoder.next_frame().unwrap().unwrap();

    assert_eq!(decoder.info().width, 1280);
    assert_eq!(decoder.info().height, 720);
    assert_eq!(frame.width, 1280);
    assert_eq!(frame.height, 720);
}

#[test]
fn test_shared_texture_drop_recycles_to_pool() {
    let instance = wgpu::Instance::default();
    let adapter = match pollster::block_on(
        instance.request_adapter(&wgpu::RequestAdapterOptions::default()),
    ) {
        Ok(adapter) => adapter,
        Err(_) => return,
    };
    let (device, _queue) =
        match pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default())) {
            Ok(res) => res,
            Err(_) => return,
        };

    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("test-recycle"),
        size: wgpu::Extent3d {
            width: 128,
            height: 128,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::TEXTURE_BINDING,
        view_formats: &[],
    });

    let pool = std::sync::Arc::new(parking_lot::Mutex::new(std::collections::HashMap::new()));

    {
        let shared = SharedTexture::new_owned(texture, pool.clone());
        assert_eq!(shared.size().width, 128);
        assert_eq!(shared.size().height, 128);
        assert!(pool.lock().is_empty());
    }

    let p = pool.lock();
    let textures = p.get(&(128, 128)).expect("expected slot for 128x128");
    assert_eq!(textures.len(), 1);
}
