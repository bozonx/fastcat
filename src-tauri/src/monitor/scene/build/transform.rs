//! Трансформации, ориентация и crop-логика для слоёв.

use crate::compositor::scene::{LayerKind as CompLayerKind, Transform};
use crate::media::ffmpeg_utils::is_quarter_turn;
use crate::monitor::scene::SceneLayerTransform;

impl From<&SceneLayerTransform> for Transform {
    fn from(t: &SceneLayerTransform) -> Self {
        Transform {
            x: t.x,
            y: t.y,
            scale_x: t.scale_x,
            scale_y: t.scale_y,
            rotation_deg: t.rotation_deg,
            anchor_x: t.anchor_x,
            anchor_y: t.anchor_y,
            crop_top: t.crop_top,
            crop_bottom: t.crop_bottom,
            crop_left: t.crop_left,
            crop_right: t.crop_right,
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
    match sl.source_orientation.as_deref() {
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
            let inner_w = spec.frame_width as f64 + spec.border_width as f64 * 2.0;
            let inner_h = spec.frame_height as f64 + spec.border_width as f64 * 2.0;
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
