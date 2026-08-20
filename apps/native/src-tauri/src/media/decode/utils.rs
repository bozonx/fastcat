use ffmpeg_next as ffmpeg;

use super::types::{YuvColor, YuvColorMatrix, YuvColorRange, YuvFrame};
use crate::media::ffmpeg::utils::is_quarter_turn;

/// Stream start time in seconds, or 0 when unset. `start_time` is `AV_NOPTS_VALUE`
/// (`i64::MIN`) when the demuxer doesn't expose one; a negative start (some edit
/// lists) is treated as 0 so seeking never targets before the file begins.
pub(crate) fn stream_start_time_sec(
    stream: &ffmpeg::Stream<'_>,
    time_base: ffmpeg::Rational,
) -> f64 {
    let start = stream.start_time();
    if start == i64::MIN || start <= 0 {
        0.0
    } else {
        start as f64 * rational_as_f64(time_base)
    }
}

/// True when the decoder's colour signalling indicates HDR or a wide gamut: a PQ
/// (SMPTE 2084) or HLG (ARIB STD-B67) transfer function, or BT.2020 primaries. The
/// direct-transcode export keeps the source's colour tags while the vello path forces
/// BT.709, so these sources must not take the direct fast path.
pub(crate) fn is_hdr_signal(
    transfer: ffmpeg::util::color::TransferCharacteristic,
    primaries: ffmpeg::util::color::Primaries,
) -> bool {
    use ffmpeg::util::color::{Primaries, TransferCharacteristic};
    matches!(
        transfer,
        TransferCharacteristic::SMPTE2084 | TransferCharacteristic::ARIB_STD_B67
    ) || matches!(primaries, Primaries::BT2020)
}

pub(crate) fn input_duration_sec(
    ictx: &ffmpeg::format::context::Input,
    stream: &ffmpeg::Stream<'_>,
) -> f64 {
    if stream.duration() > 0 {
        stream.duration() as f64 * rational_as_f64(stream.time_base())
    } else if ictx.duration() > 0 {
        ictx.duration() as f64 / 1_000_000.0
    } else {
        0.0
    }
}

pub(crate) fn metadata_rotation(stream: &ffmpeg::Stream<'_>) -> i32 {
    stream
        .metadata()
        .get("rotate")
        .and_then(|rotation| rotation.trim().parse::<f64>().ok())
        .map(|rotation| rotation.round() as i32)
        .or_else(|| {
            stream.side_data().find_map(|item| {
                if item.kind() == ffmpeg::packet::side_data::Type::DisplayMatrix {
                    display_matrix_rotation(item.data())
                } else {
                    None
                }
            })
        })
        .unwrap_or(0)
}

pub(crate) fn display_matrix_rotation(data: &[u8]) -> Option<i32> {
    if data.len() < 9 * std::mem::size_of::<i32>() {
        return None;
    }

    let read_i32 = |index: usize| -> Option<i32> {
        let start = index * std::mem::size_of::<i32>();
        // ffmpeg converts container big-endian values to native endian when
        // building side data, so native-endian read is correct.
        Some(i32::from_ne_bytes(data[start..start + 4].try_into().ok()?))
    };
    let a = read_i32(0)? as f64;
    let b = read_i32(1)? as f64;
    if a == 0.0 && b == 0.0 {
        return None;
    }

    let degrees = (b.atan2(a).to_degrees()).round() as i32;
    Some(((degrees % 360) + 360) % 360)
}

pub(crate) fn rational_to_f64(value: ffmpeg::Rational) -> Option<f64> {
    if value.denominator() == 0 || value.numerator() == 0 {
        None
    } else {
        Some(rational_as_f64(value))
    }
}

pub(crate) fn rational_as_f64(value: ffmpeg::Rational) -> f64 {
    value.numerator() as f64 / value.denominator() as f64
}

pub(crate) fn coded_output_dimensions(visual_w: u32, visual_h: u32, rotation: i32) -> (u32, u32) {
    if is_quarter_turn(rotation as f64) {
        (visual_h, visual_w)
    } else {
        (visual_w, visual_h)
    }
}

/// Computes decode target dimensions while preserving aspect ratio and NEVER upscaling.
pub(crate) fn compute_output_dims(
    src_w: u32,
    src_h: u32,
    max_long_edge: Option<u32>,
) -> (u32, u32) {
    let Some(max) = max_long_edge else {
        return (src_w, src_h);
    };
    if max == 0 {
        return (src_w, src_h);
    }
    let long = src_w.max(src_h);
    if long <= max {
        return (src_w, src_h);
    }
    let scale = max as f64 / long as f64;
    // Even dimensions — ffmpeg requires even sizes for YUV target formats; we use RGBA,
    // but keeping them even still avoids rare scaler-filter artefacts.
    let w = ((src_w as f64 * scale).round() as u32).max(2) & !1;
    let h = ((src_h as f64 * scale).round() as u32).max(2) & !1;
    (w, h)
}

pub(crate) fn visual_dimensions(width: u32, height: u32, rotation: i32) -> (u32, u32) {
    if is_quarter_turn(rotation as f64) {
        (height, width)
    } else {
        (width, height)
    }
}

pub(crate) fn is_supported_yuv_fast_path(format: ffmpeg::format::Pixel) -> bool {
    matches!(
        format,
        ffmpeg::format::Pixel::NV12
            | ffmpeg::format::Pixel::YUV420P
            | ffmpeg::format::Pixel::YUVJ420P
    )
}

pub(crate) fn yuv_color(frame: &ffmpeg::util::frame::Video) -> YuvColor {
    let matrix = match frame.color_space() {
        ffmpeg::util::color::Space::BT709 => YuvColorMatrix::Bt709,
        ffmpeg::util::color::Space::BT2020NCL | ffmpeg::util::color::Space::BT2020CL => {
            YuvColorMatrix::Bt2020
        }
        ffmpeg::util::color::Space::BT470BG
        | ffmpeg::util::color::Space::SMPTE170M
        | ffmpeg::util::color::Space::FCC
        | ffmpeg::util::color::Space::SMPTE240M => YuvColorMatrix::Bt601,
        _ => {
            if frame.width() >= 1280 || frame.height() > 576 {
                YuvColorMatrix::Bt709
            } else {
                YuvColorMatrix::Bt601
            }
        }
    };
    let range = if frame.color_range() == ffmpeg::util::color::Range::JPEG
        || frame.format() == ffmpeg::format::Pixel::YUVJ420P
    {
        YuvColorRange::Full
    } else {
        YuvColorRange::Limited
    };
    YuvColor { matrix, range }
}

pub(crate) fn copy_nv12_frame(frame: &ffmpeg::util::frame::Video, color: YuvColor) -> YuvFrame {
    let width = frame.width() as usize;
    let height = frame.height() as usize;
    let uv_width = width.div_ceil(2);
    let uv_height = height.div_ceil(2);
    let y = copy_plane_rows(frame.data(0), frame.stride(0), width, height);
    let uv = copy_plane_rows(frame.data(1), frame.stride(1), uv_width * 2, uv_height);
    YuvFrame {
        y,
        uv,
        y_stride: width as u32,
        uv_stride: (uv_width * 2) as u32,
        uv_width: uv_width as u32,
        uv_height: uv_height as u32,
        color,
    }
}

pub(crate) fn copy_yuv420p_as_nv12_frame(
    frame: &ffmpeg::util::frame::Video,
    color: YuvColor,
) -> YuvFrame {
    let width = frame.width() as usize;
    let height = frame.height() as usize;
    let uv_width = width.div_ceil(2);
    let uv_height = height.div_ceil(2);
    let y = copy_plane_rows(frame.data(0), frame.stride(0), width, height);
    let mut uv = vec![0u8; uv_width * 2 * uv_height];
    for row in 0..uv_height {
        let u_start = row * frame.stride(1);
        let v_start = row * frame.stride(2);
        let dst_start = row * uv_width * 2;
        for col in 0..uv_width {
            uv[dst_start + col * 2] = frame.data(1)[u_start + col];
            uv[dst_start + col * 2 + 1] = frame.data(2)[v_start + col];
        }
    }
    YuvFrame {
        y,
        uv,
        y_stride: width as u32,
        uv_stride: (uv_width * 2) as u32,
        uv_width: uv_width as u32,
        uv_height: uv_height as u32,
        color,
    }
}

pub(crate) fn copy_plane_rows(src: &[u8], stride: usize, row_bytes: usize, rows: usize) -> Vec<u8> {
    let mut out = vec![0u8; row_bytes * rows];
    for row in 0..rows {
        let src_start = row * stride;
        let dst_start = row * row_bytes;
        out[dst_start..dst_start + row_bytes]
            .copy_from_slice(&src[src_start..src_start + row_bytes]);
    }
    out
}

pub(crate) fn probe_rotation(video: &serde_json::Value) -> i32 {
    video
        .get("tags")
        .and_then(|tags| tags.get("rotate"))
        .and_then(parse_rotation_value)
        .or_else(|| {
            video
                .get("side_data_list")
                .and_then(|items| items.as_array())
                .and_then(|items| {
                    items
                        .iter()
                        .find_map(|item| item.get("rotation").and_then(parse_rotation_value))
                        .map(|r| -r)
                })
        })
        .unwrap_or(0)
}

pub(crate) fn parse_rotation_value(value: &serde_json::Value) -> Option<i32> {
    if let Some(rotation) = value.as_i64() {
        return Some(rotation as i32);
    }
    value
        .as_str()
        .and_then(|s| s.trim().parse::<f64>().ok())
        .map(|rotation| rotation.round() as i32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_matrix_rotation_identity_returns_none() {
        // Identity matrix: a=1, b=0 → atan2(0, 1) = 0°, but a==1, b==0 not both 0
        // Actually: a=1.0, b=0.0 → degrees = 0 → Some(0)
        let data = make_display_matrix(1, 0, 0, 1, 0, 0, 0, 0, 0);
        assert_eq!(display_matrix_rotation(&data), Some(0));
    }

    #[test]
    fn display_matrix_rotation_90_degrees() {
        // 90° rotation: a=0, b=1 → atan2(1, 0) = 90°
        let data = make_display_matrix(0, 1, 0, -1, 0, 0, 0, 0, 0);
        assert_eq!(display_matrix_rotation(&data), Some(90));
    }

    #[test]
    fn display_matrix_rotation_180_degrees() {
        // 180°: a=-1, b=0 → atan2(0, -1) = 180°
        let data = make_display_matrix(-1, 0, 0, -1, 0, 0, 0, 0, 0);
        assert_eq!(display_matrix_rotation(&data), Some(180));
    }

    #[test]
    fn display_matrix_rotation_270_degrees() {
        // 270°: a=0, b=-1 → atan2(-1, 0) = -90 → ((-90 % 360) + 360) % 360 = 270
        let data = make_display_matrix(0, -1, 0, 1, 0, 0, 0, 0, 0);
        assert_eq!(display_matrix_rotation(&data), Some(270));
    }

    #[test]
    fn display_matrix_rotation_zero_a_b_returns_none() {
        let data = make_display_matrix(0, 0, 0, 0, 0, 0, 0, 0, 0);
        assert_eq!(display_matrix_rotation(&data), None);
    }

    #[test]
    fn display_matrix_rotation_short_data_returns_none() {
        let data = [0u8; 8];
        assert_eq!(display_matrix_rotation(&data), None);
    }

    fn make_display_matrix(
        a: i32,
        b: i32,
        _c: i32,
        d: i32,
        e: i32,
        _f: i32,
        _g: i32,
        _h: i32,
        _i: i32,
    ) -> Vec<u8> {
        let vals = [a, b, 0, d, e, 0, 0, 0, 0x40000000];
        vals.iter().flat_map(|v| v.to_ne_bytes()).collect()
    }

    #[test]
    fn compute_output_dims_no_max_returns_original() {
        assert_eq!(compute_output_dims(1920, 1080, None), (1920, 1080));
    }

    #[test]
    fn compute_output_dims_max_zero_returns_original() {
        assert_eq!(compute_output_dims(1920, 1080, Some(0)), (1920, 1080));
    }

    #[test]
    fn compute_output_dims_smaller_than_max_returns_original() {
        assert_eq!(compute_output_dims(100, 100, Some(500)), (100, 100));
    }

    #[test]
    fn compute_output_dims_downscales_preserving_aspect() {
        let (w, h) = compute_output_dims(1920, 1080, Some(960));
        assert_eq!(w, 960);
        assert_eq!(h, 540);
    }

    #[test]
    fn compute_output_dims_produces_even_dimensions() {
        let (w, h) = compute_output_dims(1921, 1081, Some(960));
        assert_eq!(w % 2, 0);
        assert_eq!(h % 2, 0);
    }

    #[test]
    fn compute_output_dims_min_2_when_downscaling() {
        // When downscaling, result is clamped to min 2 and made even
        let (w, h) = compute_output_dims(100, 100, Some(1));
        assert!(w >= 2);
        assert!(h >= 2);
        assert_eq!(w % 2, 0);
        assert_eq!(h % 2, 0);
    }

    #[test]
    fn coded_output_dimensions_swaps_for_quarter_turn() {
        assert_eq!(coded_output_dimensions(1920, 1080, 90), (1080, 1920));
        assert_eq!(coded_output_dimensions(1920, 1080, 270), (1080, 1920));
        assert_eq!(coded_output_dimensions(1920, 1080, 0), (1920, 1080));
        assert_eq!(coded_output_dimensions(1920, 1080, 180), (1920, 1080));
    }

    #[test]
    fn visual_dimensions_swaps_for_quarter_turn() {
        assert_eq!(visual_dimensions(1920, 1080, 90), (1080, 1920));
        assert_eq!(visual_dimensions(1920, 1080, 270), (1080, 1920));
        assert_eq!(visual_dimensions(1920, 1080, 0), (1920, 1080));
    }

    #[test]
    fn probe_rotation_from_tags() {
        let v = serde_json::json!({"tags": {"rotate": "90"}});
        assert_eq!(probe_rotation(&v), 90);
    }

    #[test]
    fn probe_rotation_from_side_data() {
        let v = serde_json::json!({"side_data_list": [{"rotation": -90}]});
        assert_eq!(probe_rotation(&v), 90);
    }

    #[test]
    fn probe_rotation_default_zero() {
        let v = serde_json::json!({});
        assert_eq!(probe_rotation(&v), 0);
    }

    #[test]
    fn parse_rotation_value_integer() {
        assert_eq!(parse_rotation_value(&serde_json::json!(90)), Some(90));
        assert_eq!(parse_rotation_value(&serde_json::json!(-90)), Some(-90));
    }

    #[test]
    fn parse_rotation_value_string() {
        assert_eq!(parse_rotation_value(&serde_json::json!("45.4")), Some(45));
        assert_eq!(
            parse_rotation_value(&serde_json::json!("  30.7 ")),
            Some(31)
        );
    }

    #[test]
    fn parse_rotation_value_invalid_returns_none() {
        assert_eq!(parse_rotation_value(&serde_json::json!("abc")), None);
    }

    #[test]
    fn copy_plane_rows_copies_dense_data() {
        let src = [1, 2, 3, 4, 5, 6];
        let out = copy_plane_rows(&src, 3, 3, 2);
        assert_eq!(out, vec![1, 2, 3, 4, 5, 6]);
    }

    #[test]
    fn copy_plane_rows_handles_stride_larger_than_row_bytes() {
        // stride=4, row_bytes=2, rows=2
        let src = [10, 20, 0, 0, 30, 40, 0, 0];
        let out = copy_plane_rows(&src, 4, 2, 2);
        assert_eq!(out, vec![10, 20, 30, 40]);
    }
}
