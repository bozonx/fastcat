//! Layer transform, orientation and crop logic.

use crate::compositor::scene::{LayerKind as CompLayerKind, Transform};
use crate::media::ffmpeg::utils::is_quarter_turn;
use crate::monitor::scene::SceneLayerTransform;

impl From<&SceneLayerTransform> for Transform {
    fn from(t: &SceneLayerTransform) -> Self {
        Transform {
            x: t.x,
            y: t.y,
            scale_x: t.scale_x,
            scale_y: t.scale_y,
            rotation_deg: t.rotation_deg,
            source_rotation: 0.0,
            anchor_x: t.anchor_x,
            anchor_y: t.anchor_y,
            crop_top: t.crop_top,
            crop_bottom: t.crop_bottom,
            crop_left: t.crop_left,
            crop_right: t.crop_right,
            flip_horizontal: t.flip_horizontal,
            flip_vertical: t.flip_vertical,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LocalCrop {
    pub top: f64,
    pub bottom: f64,
    pub left: f64,
    pub right: f64,
}

pub fn local_crop_from_display_transform(
    transform: &SceneLayerTransform,
    source_rotation: f64,
    is_raster_layer: bool,
) -> LocalCrop {
    let crop = LocalCrop {
        top: transform.crop_top,
        bottom: transform.crop_bottom,
        left: transform.crop_left,
        right: transform.crop_right,
    };
    if !is_raster_layer {
        return crop;
    }

    match normalized_right_angle(source_rotation) {
        90 => LocalCrop {
            top: crop.right,
            right: crop.bottom,
            bottom: crop.left,
            left: crop.top,
        },
        180 => LocalCrop {
            top: crop.bottom,
            right: crop.left,
            bottom: crop.top,
            left: crop.right,
        },
        270 => LocalCrop {
            top: crop.left,
            right: crop.top,
            bottom: crop.right,
            left: crop.bottom,
        },
        _ => crop,
    }
}

pub fn source_orientation_deg(sl: &crate::monitor::scene::SceneLayer) -> f64 {
    orientation_str_to_deg(sl.source_orientation.as_deref())
}

/// Maps an explicit clip source orientation string to degrees. `auto`, `0`, `None`
/// and any unrecognized value mean 0.
///
/// Cross-engine parity contract: the web engine maps the same values in
/// `sourceOrientationToDeg` (src/utils/video-editor/worker-clip-utils.ts), pinned by
/// `shared/parity/source-orientation-deg.cases.json`.
pub fn orientation_str_to_deg(orientation: Option<&str>) -> f64 {
    match orientation {
        Some("90") => 90.0,
        Some("180") => 180.0,
        Some("270") => 270.0,
        _ => 0.0,
    }
}

pub fn normalized_right_angle(rotation_deg: f64) -> i32 {
    let normalized = ((rotation_deg.round() as i32 % 360) + 360) % 360;
    match normalized {
        90 | 180 | 270 => normalized,
        _ => 0,
    }
}

pub fn oriented_fit_scale(natural: (u32, u32), scene_size: (u32, u32), rotation_deg: f64) -> f64 {
    let fit_natural = if is_quarter_turn(rotation_deg) {
        (natural.1, natural.0)
    } else {
        natural
    };
    let nw = fit_natural.0.max(1) as f64;
    let nh = fit_natural.1.max(1) as f64;
    let sw = scene_size.0.max(1) as f64;
    let sh = scene_size.1.max(1) as f64;
    (sw / nw).min(sh / nh)
}

pub fn text_anchor_offset(
    kind: &CompLayerKind,
    natural: (u32, u32),
    anchor_x: f64,
    anchor_y: f64,
) -> (f64, f64) {
    match kind {
        CompLayerKind::Text(spec) => {
            // The visible box spans the frame plus the border and its creative gap.
            let border_outset = (spec.border_width + spec.border_offset) as f64;
            let inner_w = spec.frame_width as f64 + border_outset * 2.0;
            let inner_h = spec.frame_height as f64 + border_outset * 2.0;
            let dx =
                (anchor_x - 0.5) * inner_w + 0.5 * ((spec.shadow_right - spec.shadow_left) as f64);
            let dy =
                (anchor_y - 0.5) * inner_h + 0.5 * ((spec.shadow_bottom - spec.shadow_top) as f64);
            (dx, dy)
        }
        _ => {
            let _nw = natural.0 as f64;
            let _nh = natural.1 as f64;
            ((anchor_x - 0.5) * _nw, (anchor_y - 0.5) * _nh)
        }
    }
}

/// Rust port of the web `isTransformSnapSafe` (src/utils/pixel-grid-snap.ts).
/// Snapping only preserves visual intent when the layer isn't rotated or
/// scaled away from 1:1 — otherwise rounding position/size would jitter the
/// rotated/scaled result. `None` transform (center-fit default) is safe.
pub fn is_transform_snap_safe(t: Option<&SceneLayerTransform>) -> bool {
    let Some(t) = t else { return true };
    let rot_norm = (t.rotation_deg % 360.0).abs();
    let rotation_ok = rot_norm < 1e-4 || (rot_norm - 360.0).abs() < 1e-4;
    let scale_ok = (t.scale_x - 1.0).abs() < 1e-4 && (t.scale_y - 1.0).abs() < 1e-4;
    rotation_ok && scale_ok
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compositor::scene::LayerKind as CompLayerKind;
    use crate::monitor::scene::SceneLayerTransform;

    /// Cross-engine parity contract — pairs with the web test
    /// `test/unit/utils/video-editor/source-orientation.parity.test.ts`.
    #[test]
    fn source_orientation_deg_matches_shared_parity_fixture() {
        const FIXTURE: &str = include_str!(
            "../../../../../../../packages/shared/parity/source-orientation-deg.cases.json"
        );
        let parsed: serde_json::Value = serde_json::from_str(FIXTURE).expect("valid fixture json");
        let cases = parsed["cases"].as_array().expect("cases array");
        assert!(!cases.is_empty());
        for c in cases {
            let orientation = c["orientation"].as_str();
            let got = orientation_str_to_deg(orientation);
            let want = c["expected"].as_f64().unwrap();
            assert!(
                (got - want).abs() < 1e-9,
                "orientation `{orientation:?}`: got {got}, want {want}"
            );
        }
    }

    #[test]
    fn normalized_right_angle_maps_to_0_90_180_270() {
        assert_eq!(normalized_right_angle(0.0), 0);
        assert_eq!(normalized_right_angle(90.0), 90);
        assert_eq!(normalized_right_angle(180.0), 180);
        assert_eq!(normalized_right_angle(270.0), 270);
        assert_eq!(normalized_right_angle(360.0), 0);
        assert_eq!(normalized_right_angle(450.0), 90);
        assert_eq!(normalized_right_angle(-90.0), 270);
        assert_eq!(normalized_right_angle(45.0), 0);
        assert_eq!(normalized_right_angle(89.4), 0);
        assert_eq!(normalized_right_angle(90.4), 90);
    }

    #[test]
    fn local_crop_no_rotation_returns_original() {
        let transform = test_transform(0.1, 0.2, 0.3, 0.4);
        let crop = local_crop_from_display_transform(&transform, 0.0, true);
        assert_eq!(crop.top, 0.1);
        assert_eq!(crop.bottom, 0.2);
        assert_eq!(crop.left, 0.3);
        assert_eq!(crop.right, 0.4);
    }

    #[test]
    fn local_crop_non_raster_returns_original() {
        let transform = test_transform(0.1, 0.2, 0.3, 0.4);
        let crop = local_crop_from_display_transform(&transform, 90.0, false);
        assert_eq!(crop.top, 0.1);
        assert_eq!(crop.bottom, 0.2);
        assert_eq!(crop.left, 0.3);
        assert_eq!(crop.right, 0.4);
    }

    #[test]
    fn is_transform_snap_safe_none_is_safe() {
        assert!(is_transform_snap_safe(None));
    }

    #[test]
    fn is_transform_snap_safe_identity_is_safe() {
        let transform = test_transform(0.0, 0.0, 0.0, 0.0);
        assert!(is_transform_snap_safe(Some(&transform)));
    }

    #[test]
    fn is_transform_snap_safe_rejects_rotation() {
        let mut transform = test_transform(0.0, 0.0, 0.0, 0.0);
        transform.rotation_deg = 45.0;
        assert!(!is_transform_snap_safe(Some(&transform)));
    }

    #[test]
    fn is_transform_snap_safe_accepts_near_360_rotation() {
        let mut transform = test_transform(0.0, 0.0, 0.0, 0.0);
        transform.rotation_deg = 359.99995;
        assert!(is_transform_snap_safe(Some(&transform)));
    }

    #[test]
    fn is_transform_snap_safe_rejects_scale() {
        let mut transform = test_transform(0.0, 0.0, 0.0, 0.0);
        transform.scale_x = 1.5;
        assert!(!is_transform_snap_safe(Some(&transform)));
    }

    #[test]
    fn local_crop_90_degrees_rotates_crop() {
        let transform = test_transform(0.1, 0.2, 0.3, 0.4);
        let crop = local_crop_from_display_transform(&transform, 90.0, true);
        // 90°: top=right, right=bottom, bottom=left, left=top
        assert_eq!(crop.top, 0.4);
        assert_eq!(crop.right, 0.2);
        assert_eq!(crop.bottom, 0.3);
        assert_eq!(crop.left, 0.1);
    }

    #[test]
    fn local_crop_180_degrees_rotates_crop() {
        let transform = test_transform(0.1, 0.2, 0.3, 0.4);
        let crop = local_crop_from_display_transform(&transform, 180.0, true);
        // 180°: top=bottom, right=left, bottom=top, left=right
        assert_eq!(crop.top, 0.2);
        assert_eq!(crop.right, 0.3);
        assert_eq!(crop.bottom, 0.1);
        assert_eq!(crop.left, 0.4);
    }

    #[test]
    fn local_crop_270_degrees_rotates_crop() {
        let transform = test_transform(0.1, 0.2, 0.3, 0.4);
        let crop = local_crop_from_display_transform(&transform, 270.0, true);
        // 270°: top=left, right=top, bottom=right, left=bottom
        assert_eq!(crop.top, 0.3);
        assert_eq!(crop.right, 0.1);
        assert_eq!(crop.bottom, 0.4);
        assert_eq!(crop.left, 0.2);
    }

    #[test]
    fn oriented_fit_scale_no_rotation() {
        // 1920x1080 into 1920x1080 → 1.0
        let scale = oriented_fit_scale((1920, 1080), (1920, 1080), 0.0);
        assert!((scale - 1.0).abs() < 1e-9);

        // 1920x1080 into 960x540 → 0.5
        let scale = oriented_fit_scale((1920, 1080), (960, 540), 0.0);
        assert!((scale - 0.5).abs() < 1e-9);
    }

    #[test]
    fn oriented_fit_scale_quarter_turn_swaps_natural() {
        // 1920x1080 rotated 90° → natural becomes 1080x1920, fit into 1920x1080
        let scale = oriented_fit_scale((1920, 1080), (1920, 1080), 90.0);
        // fit_natural = (1080, 1920), scale = min(1920/1080, 1080/1920) = 1080/1920 = 0.5625
        assert!((scale - 1080.0 / 1920.0).abs() < 1e-9);
    }

    #[test]
    fn oriented_fit_scale_zero_dimensions_clamped_to_one() {
        let scale = oriented_fit_scale((0, 0), (1920, 1080), 0.0);
        assert!(scale.is_finite() && scale > 0.0);
    }

    #[test]
    fn text_anchor_offset_center_anchor_returns_zero() {
        let kind = CompLayerKind::Adjustment;
        let (dx, dy) = text_anchor_offset(&kind, (1920, 1080), 0.5, 0.5);
        assert!((dx - 0.0).abs() < 1e-9);
        assert!((dy - 0.0).abs() < 1e-9);
    }

    #[test]
    fn text_anchor_offset_non_text_uses_natural_size() {
        let kind = CompLayerKind::Adjustment;
        let (dx, dy) = text_anchor_offset(&kind, (1920, 1080), 0.0, 1.0);
        // dx = (0.0 - 0.5) * 1920 = -960
        assert!((dx - (-960.0)).abs() < 1e-6);
        // dy = (1.0 - 0.5) * 1080 = 540
        assert!((dy - 540.0).abs() < 1e-6);
    }

    fn test_transform(top: f64, bottom: f64, left: f64, right: f64) -> SceneLayerTransform {
        SceneLayerTransform {
            x: 0.0,
            y: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
            rotation_deg: 0.0,
            anchor_x: 0.5,
            anchor_y: 0.5,
            crop_top: top,
            crop_bottom: bottom,
            crop_left: left,
            crop_right: right,
            flip_horizontal: false,
            flip_vertical: false,
        }
    }
}
