//! Keyframe animation evaluation for the native compositor (v1: transform + opacity).
//!
//! This is the Rust mirror of the web `src/timeline/animation/evaluate.ts`. The
//! two backends evaluate keyframes independently, so the interpolation math here
//! MUST match the TS core exactly — it is pinned by the shared parity fixture
//! (`shared/parity/keyframe-interp.cases.json`). Keep it pure.
//!
//! Keyframe times are source-relative microseconds. The timeline playhead is
//! mapped through layer trim/speed before sampling, without the decode end-frame
//! guard used for video reads. Animated values are in the same design-space
//! units as the web `ClipTransform` (position in 1920×1080 design px, scale as
//! a factor, rotation in degrees); this module converts position to scene-space
//! the same way the TS DTO builder (`buildNativeTransform`) does.

use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;

use crate::monitor::scene::{SceneLayer, SceneLayerTransform};

/// Transform design base — must match `TRANSFORM_DESIGN_BASE` on the web side.
const DESIGN_BASE_W: f64 = 1920.0;
const DESIGN_BASE_H: f64 = 1080.0;

#[derive(Debug, Clone, Copy, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Easing {
    #[default]
    Linear,
    Ease,
    Hold,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Keyframe {
    #[serde(rename = "tUs")]
    pub t_us: f64,
    pub value: f64,
    #[serde(default)]
    pub easing: Easing,
}

#[derive(Debug, Clone, Deserialize)]
pub struct KeyframeTrack {
    #[serde(default)]
    pub keyframes: Vec<Keyframe>,
}

/// Parsed per-clip animation tracks, keyed by param path (e.g. `"opacity"`,
/// `"transform.rotationDeg"`). Assumes each track's keyframes are already sorted
/// ascending by `tUs` (the front-end sanitizer guarantees this).
pub struct ClipAnimations {
    tracks: HashMap<String, KeyframeTrack>,
}

impl ClipAnimations {
    pub fn from_value(v: &Value) -> Option<Self> {
        let tracks: HashMap<String, KeyframeTrack> = serde_json::from_value(v.clone()).ok()?;
        if tracks.is_empty() {
            return None;
        }
        Some(Self { tracks })
    }

    pub fn eval(&self, path: &str, local_us: f64) -> Option<f64> {
        eval_track_at(self.tracks.get(path)?, local_us)
    }
}

/// Evaluate a keyframe track at `local_us`. Returns `None` for an empty track.
/// Holds boundary values (no extrapolation); mirrors the web `evalTrackAt`.
pub fn eval_track_at(track: &KeyframeTrack, local_us: f64) -> Option<f64> {
    let kfs = &track.keyframes;
    if kfs.is_empty() {
        return None;
    }
    let t = if local_us.is_finite() { local_us } else { 0.0 };

    let first = &kfs[0];
    let last = &kfs[kfs.len() - 1];
    if kfs.len() == 1 || t <= first.t_us {
        return Some(first.value);
    }
    if t >= last.t_us {
        return Some(last.value);
    }

    // Segment [left, right] with left.t_us <= t < right.t_us (must exist here).
    let mut left = first;
    let mut right = last;
    for i in 1..kfs.len() {
        if kfs[i].t_us > t {
            left = &kfs[i - 1];
            right = &kfs[i];
            break;
        }
    }

    if left.easing == Easing::Hold {
        return Some(left.value);
    }

    let span = right.t_us - left.t_us;
    if span <= 0.0 {
        return Some(right.value);
    }

    let frac = (t - left.t_us) / span;
    let eased = match left.easing {
        Easing::Ease => frac * frac * (3.0 - 2.0 * frac),
        _ => frac,
    };
    Some(left.value + (right.value - left.value) * eased)
}

/// The effective overrides sampled for a layer this frame. Both `None` when the
/// layer has no keyframes (callers keep the static values).
pub struct AnimationOverride {
    pub transform: Option<SceneLayerTransform>,
    pub opacity: Option<f32>,
}

const NONE: AnimationOverride = AnimationOverride {
    transform: None,
    opacity: None,
};

fn identity_transform(scene_w: f64, scene_h: f64) -> SceneLayerTransform {
    SceneLayerTransform {
        x: scene_w / 2.0,
        y: scene_h / 2.0,
        scale_x: 1.0,
        scale_y: 1.0,
        rotation_deg: 0.0,
        anchor_x: 0.5,
        anchor_y: 0.5,
        crop_top: 0.0,
        crop_bottom: 0.0,
        crop_left: 0.0,
        crop_right: 0.0,
        flip_horizontal: false,
        flip_vertical: false,
    }
}

fn normalize_animation_speed(speed: f64) -> f64 {
    if speed.is_finite() && speed != 0.0 {
        speed.clamp(-10.0, 10.0)
    } else {
        1.0
    }
}

/// Convert timeline seconds to the source-relative microseconds used by
/// keyframes. Mirrors `resolveClipAnimationTimeUs` in the TS evaluator.
pub fn resolve_layer_animation_time_us(sl: &SceneLayer, time_sec: f64) -> f64 {
    let local_t_sec = (time_sec - sl.timeline_start_sec).max(0.0);
    let speed = normalize_animation_speed(sl.speed);
    let abs_speed = speed.abs();
    let source_range_sec =
        if sl.source_range_duration_sec.is_finite() && sl.source_range_duration_sec > 0.0 {
            sl.source_range_duration_sec
        } else {
            (sl.timeline_end_sec - sl.timeline_start_sec).max(0.0) * abs_speed
        };
    let source_delta_sec = local_t_sec * abs_speed;
    let source_offset_sec = if source_range_sec <= 0.0 {
        source_delta_sec
    } else if speed < 0.0 {
        (source_range_sec - source_delta_sec).clamp(0.0, source_range_sec)
    } else {
        source_delta_sec.clamp(0.0, source_range_sec)
    };
    ((sl.source_start_sec.max(0.0) + source_offset_sec) * 1_000_000.0).round()
}

/// Sample a layer's animation tracks at `animation_t_us` (source-relative µs)
/// and produce the effective transform + opacity overrides. Position keyframes
/// are converted design-space → scene-space identically to the TS DTO builder.
pub fn resolve_animation_override(
    sl: &SceneLayer,
    animation_t_us: f64,
    scene_size: (u32, u32),
) -> AnimationOverride {
    let Some(anims) = sl.animations.as_ref().and_then(ClipAnimations::from_value) else {
        return NONE;
    };

    let opacity = anims
        .eval("opacity", animation_t_us)
        .map(|v| v.clamp(0.0, 1.0) as f32);

    let px = anims.eval("transform.position.x", animation_t_us);
    let py = anims.eval("transform.position.y", animation_t_us);
    let sx = anims.eval("transform.scale.x", animation_t_us);
    let sy = anims.eval("transform.scale.y", animation_t_us);
    let rot = anims.eval("transform.rotationDeg", animation_t_us);

    let has_transform =
        px.is_some() || py.is_some() || sx.is_some() || sy.is_some() || rot.is_some();

    let transform = if has_transform {
        let scene_w = scene_size.0 as f64;
        let scene_h = scene_size.1 as f64;
        let mut t = sl
            .transform
            .clone()
            .unwrap_or_else(|| identity_transform(scene_w, scene_h));
        if let Some(px) = px {
            t.x = scene_w / 2.0 + px * (scene_w / DESIGN_BASE_W);
        }
        if let Some(py) = py {
            t.y = scene_h / 2.0 + py * (scene_h / DESIGN_BASE_H);
        }
        if let Some(sx) = sx {
            t.scale_x = sx.abs();
        }
        if let Some(sy) = sy {
            t.scale_y = sy.abs();
        }
        if let Some(rot) = rot {
            t.rotation_deg = rot;
        }
        Some(t)
    } else {
        None
    };

    AnimationOverride { transform, opacity }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(kfs: &[(f64, f64, Easing)]) -> KeyframeTrack {
        KeyframeTrack {
            keyframes: kfs
                .iter()
                .map(|&(t_us, value, easing)| Keyframe {
                    t_us,
                    value,
                    easing,
                })
                .collect(),
        }
    }

    /// Cross-engine parity contract — pairs with the TS test
    /// `keyframe-interp.parity.test.ts`. Both must evaluate every case in
    /// `shared/parity/keyframe-interp.cases.json` identically.
    #[test]
    fn eval_track_at_matches_shared_parity_fixture() {
        const FIXTURE: &str =
            include_str!("../../../../../shared/parity/keyframe-interp.cases.json");
        let parsed: serde_json::Value = serde_json::from_str(FIXTURE).expect("valid fixture json");
        let cases = parsed["cases"].as_array().expect("cases array");
        assert!(!cases.is_empty());
        for c in cases {
            let name = c["name"].as_str().unwrap_or("<unnamed>");
            let keyframes: Vec<Keyframe> =
                serde_json::from_value(c["keyframes"].clone()).expect("valid keyframes");
            let track = KeyframeTrack { keyframes };
            let query_t_us = c["queryTUs"].as_f64().unwrap();
            let got = eval_track_at(&track, query_t_us);
            match c["expected"].as_f64() {
                Some(want) => {
                    let got =
                        got.unwrap_or_else(|| panic!("{name}: expected Some({want}), got None"));
                    assert!((got - want).abs() < 1e-9, "{name}: got {got}, want {want}");
                }
                None => {
                    assert!(got.is_none(), "{name}: expected None, got {got:?}");
                }
            }
        }
    }

    #[test]
    fn empty_track_is_none() {
        assert_eq!(
            eval_track_at(&KeyframeTrack { keyframes: vec![] }, 0.0),
            None
        );
    }

    #[test]
    fn holds_boundaries_without_extrapolation() {
        let t = track(&[(100.0, 0.2, Easing::Linear), (300.0, 0.8, Easing::Linear)]);
        assert_eq!(eval_track_at(&t, 0.0), Some(0.2));
        assert_eq!(eval_track_at(&t, 100.0), Some(0.2));
        assert_eq!(eval_track_at(&t, 300.0), Some(0.8));
        assert_eq!(eval_track_at(&t, 9999.0), Some(0.8));
    }

    #[test]
    fn linear_midpoint() {
        let t = track(&[(0.0, 0.0, Easing::Linear), (200.0, 1.0, Easing::Linear)]);
        assert!((eval_track_at(&t, 100.0).unwrap() - 0.5).abs() < 1e-9);
        assert!((eval_track_at(&t, 50.0).unwrap() - 0.25).abs() < 1e-9);
    }

    #[test]
    fn ease_smoothstep() {
        let t = track(&[(0.0, 0.0, Easing::Ease), (100.0, 1.0, Easing::Linear)]);
        assert!((eval_track_at(&t, 50.0).unwrap() - 0.5).abs() < 1e-9);
        assert!((eval_track_at(&t, 25.0).unwrap() - 0.15625).abs() < 1e-9);
    }

    #[test]
    fn hold_then_jump() {
        let t = track(&[(0.0, 0.3, Easing::Hold), (100.0, 0.9, Easing::Linear)]);
        assert_eq!(eval_track_at(&t, 50.0), Some(0.3));
        assert_eq!(eval_track_at(&t, 99.0), Some(0.3));
        assert_eq!(eval_track_at(&t, 100.0), Some(0.9));
    }

    #[test]
    fn coincident_mid_segment_jumps_to_right() {
        let t = track(&[
            (0.0, 0.0, Easing::Linear),
            (100.0, 0.1, Easing::Linear),
            (100.0, 0.7, Easing::Linear),
            (200.0, 1.0, Easing::Linear),
        ]);
        assert_eq!(eval_track_at(&t, 100.0), Some(0.7));
        assert!((eval_track_at(&t, 150.0).unwrap() - 0.85).abs() < 1e-9);
    }

    #[test]
    fn parses_and_evaluates_from_value() {
        let v = serde_json::json!({
            "opacity": { "keyframes": [
                { "tUs": 0, "value": 0, "easing": "linear" },
                { "tUs": 1000, "value": 1, "easing": "linear" },
            ] },
        });
        let anims = ClipAnimations::from_value(&v).unwrap();
        assert!((anims.eval("opacity", 500.0).unwrap() - 0.5).abs() < 1e-9);
        assert_eq!(anims.eval("transform.scale.x", 500.0), None);
    }
}
