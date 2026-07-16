//! Keyframe animation evaluation for the native compositor (v1: transform + opacity).
//!
//! This is the Rust mirror of the web `src/timeline/animation/evaluate.ts`. The
//! two backends evaluate keyframes independently, so the interpolation math here
//! MUST match the TS core exactly — it is pinned by the shared parity fixture
//! (`shared/parity/keyframe-interp.cases.json`). Keep it pure.
//!
//! Keyframe times are source-relative timeline ticks (see `TIMELINE_TICKS_PER_SECOND`,
//! the Premiere-compatible timebase mirrored from the web `TICKS_PER_SECOND`). The
//! timeline playhead is mapped through layer trim/speed before sampling, without
//! the decode end-frame guard used for video reads. Animated values are in the
//! same design-space units as the web `ClipTransform` (position in 1920×1080
//! design px, scale as a factor, rotation in degrees); this module converts
//! position to scene-space
//! the same way the TS DTO builder (`buildNativeTransform`) does.

use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;

use crate::compositor::effects::EffectSpec;
use crate::monitor::scene::{SceneLayer, SceneLayerTransform};

/// Transform design base — must match `TRANSFORM_DESIGN_BASE` on the web side.
const DESIGN_BASE_W: f64 = 1920.0;
const DESIGN_BASE_H: f64 = 1080.0;

/// Canonical timeline timebase in ticks per second. MUST match the web
/// `TICKS_PER_SECOND` (`src/utils/time/ticks.ts`): keyframe times (`tUs`) and the
/// derived per-frame sample time are expressed in these ticks, not microseconds.
pub const TIMELINE_TICKS_PER_SECOND: f64 = 254_016_000_000.0;

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
    #[serde(rename = "tTicks")]
    pub t_ticks: f64,
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

    pub fn eval(&self, path: &str, at_ticks: f64) -> Option<f64> {
        eval_track_at(self.tracks.get(path)?, at_ticks)
    }
}

/// Evaluate a keyframe track at `at_ticks` (source-relative timeline ticks).
/// Returns `None` for an empty track. Holds boundary values (no extrapolation);
/// mirrors the web `evalTrackAt`. The interpolation itself is unit-agnostic, so
/// the shared parity fixture may use small abstract time values.
pub fn eval_track_at(track: &KeyframeTrack, at_ticks: f64) -> Option<f64> {
    let kfs = &track.keyframes;
    if kfs.is_empty() {
        return None;
    }
    let t = if at_ticks.is_finite() { at_ticks } else { 0.0 };

    let first = &kfs[0];
    let last = &kfs[kfs.len() - 1];
    if kfs.len() == 1 || t <= first.t_ticks {
        return Some(first.value);
    }
    if t >= last.t_ticks {
        return Some(last.value);
    }

    // Segment [left, right] with left.t_ticks <= t < right.t_ticks (must exist here).
    let mut left = first;
    let mut right = last;
    for i in 1..kfs.len() {
        if kfs[i].t_ticks > t {
            left = &kfs[i - 1];
            right = &kfs[i];
            break;
        }
    }

    if left.easing == Easing::Hold {
        return Some(left.value);
    }

    let span = right.t_ticks - left.t_ticks;
    if span <= 0.0 {
        return Some(right.value);
    }

    let frac = (t - left.t_ticks) / span;
    let eased = match left.easing {
        Easing::Ease => frac * frac * (3.0 - 2.0 * frac),
        _ => frac,
    };
    Some(left.value + (right.value - left.value) * eased)
}

// --- Baked effect-parameter animation --------------------------------------
// Effect params are baked (on the web side) into per-field keyframe tracks over
// the finished `VideoEffectSpec`s, so the native side never needs each
// manifest's `toEffectSpecs`. We patch numeric/boolean fields on the base specs
// by name via `serde_json::Value`, then re-type them — fully generic across all
// spec variants. Mirrors the web `patchBakedEffectSpecs`; pinned by a parity
// fixture.

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BakeKind {
    Number,
    Bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BakedEffectField {
    #[serde(rename = "specIndex")]
    pub spec_index: usize,
    pub field: String,
    pub kind: BakeKind,
    #[serde(default)]
    pub keyframes: Vec<Keyframe>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ClipBakedEffects {
    /// Base specs kept as raw JSON so any field can be patched by name.
    #[serde(rename = "baseSpecs")]
    pub base_specs: Vec<Value>,
    #[serde(default)]
    pub fields: Vec<BakedEffectField>,
}

/// Patch the base specs at `animation_t_ticks`, overwriting each baked field with
/// its sampled value. Pure JSON in/out; mirrors the web `patchBakedEffectSpecs`
/// and is pinned by the shared parity fixture.
pub fn patch_baked_specs(baked: &ClipBakedEffects, animation_t_ticks: f64) -> Vec<Value> {
    let mut specs = baked.base_specs.clone();
    for field in &baked.fields {
        if field.spec_index >= specs.len() {
            continue;
        }
        let track = KeyframeTrack {
            keyframes: field.keyframes.clone(),
        };
        let Some(value) = eval_track_at(&track, animation_t_ticks) else {
            continue;
        };
        if let Some(obj) = specs[field.spec_index].as_object_mut() {
            let json_value = match field.kind {
                BakeKind::Bool => Value::Bool(value >= 0.5),
                BakeKind::Number => Value::from(value),
            };
            obj.insert(field.field.clone(), json_value);
        }
    }
    specs
}

/// Resolve a layer's effect specs at `animation_t_ticks` (source-relative ticks)
/// from its baked effect-param tracks. Returns `None` when the layer has no baked
/// effects (callers then use the static `sl.effects`).
pub fn resolve_baked_effect_specs(
    sl: &SceneLayer,
    animation_t_ticks: f64,
) -> Option<Vec<EffectSpec>> {
    let baked: ClipBakedEffects =
        serde_json::from_value(sl.baked_effects.as_ref()?.clone()).ok()?;
    // Re-type the patched JSON specs, dropping any that no longer deserialize.
    Some(
        patch_baked_specs(&baked, animation_t_ticks)
            .into_iter()
            .filter_map(|v| serde_json::from_value(v).ok())
            .collect(),
    )
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

/// Convert timeline seconds to the source-relative timeline ticks used by
/// keyframes. Mirrors `resolveClipAnimationTimeUs` in the TS evaluator (whose
/// output — despite the `Us` name — is in ticks since the time-units migration).
pub fn resolve_layer_animation_time_ticks(sl: &SceneLayer, time_sec: f64) -> f64 {
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
    ((sl.source_start_sec.max(0.0) + source_offset_sec) * TIMELINE_TICKS_PER_SECOND).round()
}

/// Sample a layer's animation tracks at `animation_t_ticks` (source-relative
/// ticks) and produce the effective transform + opacity overrides. Position
/// keyframes are converted design-space → scene-space identically to the TS DTO
/// builder.
pub fn resolve_animation_override(
    sl: &SceneLayer,
    animation_t_ticks: f64,
    scene_size: (u32, u32),
) -> AnimationOverride {
    let Some(anims) = sl.animations.as_ref().and_then(ClipAnimations::from_value) else {
        return NONE;
    };

    let opacity = anims
        .eval("opacity", animation_t_ticks)
        .map(|v| v.clamp(0.0, 1.0) as f32);

    let px = anims.eval("transform.position.x", animation_t_ticks);
    let py = anims.eval("transform.position.y", animation_t_ticks);
    let sx = anims.eval("transform.scale.x", animation_t_ticks);
    let sy = anims.eval("transform.scale.y", animation_t_ticks);
    let rot = anims.eval("transform.rotationDeg", animation_t_ticks);
    let anchor_x = anims.eval("transform.anchor.x", animation_t_ticks);
    let anchor_y = anims.eval("transform.anchor.y", animation_t_ticks);
    let crop_top = anims.eval("transform.crop.top", animation_t_ticks);
    let crop_bottom = anims.eval("transform.crop.bottom", animation_t_ticks);
    let crop_left = anims.eval("transform.crop.left", animation_t_ticks);
    let crop_right = anims.eval("transform.crop.right", animation_t_ticks);
    let flip_horizontal = anims.eval("transform.flipHorizontal", animation_t_ticks);
    let flip_vertical = anims.eval("transform.flipVertical", animation_t_ticks);

    let has_transform = px.is_some()
        || py.is_some()
        || sx.is_some()
        || sy.is_some()
        || rot.is_some()
        || anchor_x.is_some()
        || anchor_y.is_some()
        || crop_top.is_some()
        || crop_bottom.is_some()
        || crop_left.is_some()
        || crop_right.is_some()
        || flip_horizontal.is_some()
        || flip_vertical.is_some();

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
        if let Some(anchor_x) = anchor_x {
            t.anchor_x = anchor_x.clamp(-10.0, 10.0);
        }
        if let Some(anchor_y) = anchor_y {
            t.anchor_y = anchor_y.clamp(-10.0, 10.0);
        }
        if let Some(crop_top) = crop_top {
            t.crop_top = crop_top.clamp(0.0, 100.0);
        }
        if let Some(crop_bottom) = crop_bottom {
            t.crop_bottom = crop_bottom.clamp(0.0, 100.0);
        }
        if let Some(crop_left) = crop_left {
            t.crop_left = crop_left.clamp(0.0, 100.0);
        }
        if let Some(crop_right) = crop_right {
            t.crop_right = crop_right.clamp(0.0, 100.0);
        }
        if let Some(flip_horizontal) = flip_horizontal {
            t.flip_horizontal = flip_horizontal >= 0.5;
        }
        if let Some(flip_vertical) = flip_vertical {
            t.flip_vertical = flip_vertical >= 0.5;
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
                .map(|&(t_ticks, value, easing)| Keyframe {
                    t_ticks,
                    value,
                    easing,
                })
                .collect(),
        }
    }

    /// Cross-engine parity contract — pairs with the TS test
    /// `effect-bake-patch.parity.test.ts`. Both must patch every baked case in
    /// `shared/parity/effect-bake-patch.cases.json` identically.
    #[test]
    fn patch_baked_specs_matches_shared_parity_fixture() {
        const FIXTURE: &str =
            include_str!("../../../../../shared/parity/effect-bake-patch.cases.json");
        let parsed: serde_json::Value = serde_json::from_str(FIXTURE).expect("valid fixture json");
        let cases = parsed["cases"].as_array().expect("cases array");
        assert!(!cases.is_empty());

        fn value_eq(a: &Value, b: &Value) -> bool {
            match (a, b) {
                (Value::Number(x), Value::Number(y)) => {
                    (x.as_f64().unwrap() - y.as_f64().unwrap()).abs() < 1e-9
                }
                _ => a == b,
            }
        }

        for c in cases {
            let name = c["name"].as_str().unwrap_or("<unnamed>");
            let baked: ClipBakedEffects =
                serde_json::from_value(c["baked"].clone()).expect("valid baked payload");
            let at_ticks = c["atTicks"].as_f64().unwrap();
            let got = patch_baked_specs(&baked, at_ticks);
            let want = c["expected"].as_array().expect("expected array");
            assert_eq!(got.len(), want.len(), "{name}: spec count");
            for (g, w) in got.iter().zip(want.iter()) {
                let go = g.as_object().expect("spec object");
                let wo = w.as_object().expect("spec object");
                assert_eq!(go.len(), wo.len(), "{name}: field count");
                for (k, wv) in wo {
                    let gv = go
                        .get(k)
                        .unwrap_or_else(|| panic!("{name}: missing field {k}"));
                    assert!(
                        value_eq(gv, wv),
                        "{name}: field {k}: got {gv:?}, want {wv:?}"
                    );
                }
            }
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
            let query_t_ticks = c["queryTTicks"].as_f64().unwrap();
            let got = eval_track_at(&track, query_t_ticks);
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

    /// Regression guard for the time-units migration: the per-frame animation
    /// sample time MUST be in canonical timeline ticks, not microseconds, so it
    /// matches the tick-valued keyframe `tUs` produced by the web side. A
    /// microsecond scale (the pre-migration bug) would sample ~254016× too early
    /// and freeze every clip on its first keyframe on the native engine.
    #[test]
    fn resolve_layer_animation_time_is_in_ticks() {
        let layer: SceneLayer = serde_json::from_value(serde_json::json!({
            "id": "l",
            "kind": "video",
            "timeline_start_sec": 0.0,
            "timeline_end_sec": 10.0,
            "source_start_sec": 0.0,
            "source_range_duration_sec": 10.0,
            "speed": 1.0,
            "z": 0,
            "opacity": 1.0,
        }))
        .expect("valid layer");

        // 1 s into the clip → exactly one second of source ticks.
        let got = resolve_layer_animation_time_ticks(&layer, 1.0);
        assert!(
            (got - TIMELINE_TICKS_PER_SECOND).abs() < 1.0,
            "expected {TIMELINE_TICKS_PER_SECOND} ticks, got {got}"
        );
        // Guard against a regression back to the microsecond scale.
        assert!(
            got > 1_000_000.0 * 2.0,
            "sample time must not be microseconds"
        );
    }

    #[test]
    fn parses_and_evaluates_from_value() {
        let v = serde_json::json!({
            "opacity": { "keyframes": [
                { "tTicks": 0, "value": 0, "easing": "linear" },
                { "tTicks": 1000, "value": 1, "easing": "linear" },
            ] },
        });
        let anims = ClipAnimations::from_value(&v).unwrap();
        assert!((anims.eval("opacity", 500.0).unwrap() - 0.5).abs() < 1e-9);
        assert_eq!(anims.eval("transform.scale.x", 500.0), None);
    }
}
