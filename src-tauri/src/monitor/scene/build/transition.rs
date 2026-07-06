//! Transition logic (dissolve, wipe, etc.) and Bézier curves.

use crate::monitor::scene::SceneLayer;

pub fn compute_transition_opacity(sl: &SceneLayer, local_t: f64, base_opacity: f32) -> f32 {
    let clip_dur = sl.timeline_end_sec - sl.timeline_start_sec;
    if clip_dur <= 0.0 {
        return 0.0;
    }

    let in_dur = sl
        .transition_in
        .as_ref()
        .map(|t| t.duration_sec.clamp(0.0, clip_dur))
        .unwrap_or(0.0);
    let out_dur = sl
        .transition_out
        .as_ref()
        .map(|t| t.duration_sec.clamp(0.0, clip_dur))
        .unwrap_or(0.0);
    let out_start = (clip_dur - out_dur).max(0.0);

    let in_active = in_dur > 0.0 && local_t < in_dur;
    let out_active = out_dur > 0.0 && local_t >= out_start;

    let mut apply_in = in_active;
    let mut apply_out = out_active;

    if in_active && out_active {
        let dist_to_in_end = in_dur - local_t;
        let dist_to_out_start = local_t - out_start;
        if dist_to_in_end <= dist_to_out_start {
            apply_out = false;
        } else {
            apply_in = false;
        }
    }

    let mut opacity = base_opacity;

    if apply_in {
        if let Some(t_in) = &sl.transition_in {
            // A dissolve with a from-layer and spec is rendered as a shader crossfade
            // (see `finalize_layer`); fading with alpha here too would double-fade.
            // Alpha is only needed when there is nothing to blend with: a dissolve
            // without a from-layer (the first clip on the timeline) fades in from the
            // background.
            let rendered_by_shader = t_in.spec.is_some()
                && (t_in.from_layer_id.is_some()
                    || matches!(t_in.mode.as_deref(), Some("background" | "transparent")));
            if t_in.transition_type == "dissolve" && !rendered_by_shader {
                let raw_progress = (local_t / in_dur).clamp(0.0, 1.0);
                let curve = t_in.curve.as_deref().unwrap_or("linear");
                let progress = apply_transition_curve(raw_progress, curve);
                opacity *= progress as f32;
            }
        }
    } else if apply_out {
        if let Some(t_out) = &sl.transition_out {
            let rendered_by_shader = t_out.spec.is_some()
                && (t_out.from_layer_id.is_some()
                    || matches!(t_out.mode.as_deref(), Some("background" | "transparent")));
            if t_out.transition_type == "dissolve" && !rendered_by_shader {
                let raw_progress = ((local_t - out_start) / out_dur).clamp(0.0, 1.0);
                let curve = t_out.curve.as_deref().unwrap_or("linear");
                let progress = apply_transition_curve(raw_progress, curve);
                opacity *= (1.0 - progress) as f32;
            }
        }
    }

    opacity.clamp(0.0, 1.0)
}

fn solve_cubic_bezier(t: f64, x1: f64, y1: f64, x2: f64, y2: f64) -> f64 {
    if t <= 0.0 {
        return 0.0;
    }
    if t >= 1.0 {
        return 1.0;
    }
    if (x1 - y1).abs() < 1e-9 && (x2 - y2).abs() < 1e-9 {
        return t;
    }

    let mut guess = t;
    for _ in 0..5 {
        let cx = 3.0 * x1;
        let bx = 3.0 * (x2 - x1) - cx;
        let ax = 1.0 - cx - bx;
        let current_x = ((ax * guess + bx) * guess + cx) * guess;
        let current_slope = (3.0 * ax * guess + 2.0 * bx) * guess + cx;
        if current_slope.abs() < 1e-9 {
            break;
        }
        guess -= (current_x - t) / current_slope;
    }

    guess = guess.clamp(0.0, 1.0);

    let cy = 3.0 * y1;
    let by = 3.0 * (y2 - y1) - cy;
    let ay = 1.0 - cy - by;
    ((ay * guess + by) * guess + cy) * guess
}

pub fn apply_transition_curve(progress: f64, curve: &str) -> f64 {
    let t = progress.clamp(0.0, 1.0);
    match curve {
        "linear" => t,
        "ease-in" => {
            let bulge = 0.8;
            let offset = 1.0;
            let x1 = offset * bulge;
            let x2 = 1.0 - (1.0 - offset) * bulge;
            solve_cubic_bezier(t, x1, 0.0, x2, 1.0)
        }
        "ease-out" => {
            let bulge = 0.8;
            let offset = 0.0;
            let x1 = offset * bulge;
            let x2 = 1.0 - (1.0 - offset) * bulge;
            solve_cubic_bezier(t, x1, 0.0, x2, 1.0)
        }
        "smooth" => {
            let bulge = 0.8;
            let offset = 0.5;
            let x1 = offset * bulge;
            let x2 = 1.0 - (1.0 - offset) * bulge;
            solve_cubic_bezier(t, x1, 0.0, x2, 1.0)
        }
        _ => t,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compositor::scene::BlendMode;
    use crate::compositor::transitions::TransitionSpec;
    use crate::monitor::scene::{LayerKind, SceneTransition};

    /// Cross-engine parity contract — pairs with the web test
    /// `test/unit/transitions/transition-curve.parity.test.ts`.
    #[test]
    fn curve_matches_shared_parity_fixture() {
        const FIXTURE: &str =
            include_str!("../../../../../shared/parity/transition-curve.cases.json");
        let parsed: serde_json::Value = serde_json::from_str(FIXTURE).expect("valid fixture json");
        let cases = parsed["cases"].as_array().expect("cases array");
        assert!(!cases.is_empty());
        for c in cases {
            let curve = c["curve"].as_str().unwrap();
            let progress = c["progress"].as_f64().unwrap();
            let got = apply_transition_curve(progress, curve);
            let want = c["expected"].as_f64().unwrap();
            assert!(
                (got - want).abs() < 1e-9,
                "curve `{curve}`@{progress}: got {got}, want {want}"
            );
        }
    }

    #[test]
    fn apply_transition_curve_linear() {
        assert!((apply_transition_curve(0.0, "linear") - 0.0).abs() < 1e-9);
        assert!((apply_transition_curve(0.5, "linear") - 0.5).abs() < 1e-9);
        assert!((apply_transition_curve(1.0, "linear") - 1.0).abs() < 1e-9);
    }

    #[test]
    fn apply_transition_curve_unknown_falls_back_to_linear() {
        assert!((apply_transition_curve(0.5, "nonexistent") - 0.5).abs() < 1e-9);
    }

    #[test]
    fn apply_transition_curve_clamps_input() {
        assert!((apply_transition_curve(-1.0, "linear") - 0.0).abs() < 1e-9);
        assert!((apply_transition_curve(2.0, "linear") - 1.0).abs() < 1e-9);
    }

    #[test]
    fn compute_transition_opacity_no_transitions_returns_base() {
        let layer = test_layer(0.0, 10.0, None, None);
        let opacity = compute_transition_opacity(&layer, 5.0, 0.8);
        assert!((opacity - 0.8).abs() < 1e-6);
    }

    #[test]
    fn compute_transition_opacity_zero_duration_returns_zero() {
        let layer = test_layer(0.0, 0.0, None, None);
        let opacity = compute_transition_opacity(&layer, 0.0, 1.0);
        assert!((opacity - 0.0).abs() < 1e-6);
    }

    #[test]
    fn compute_transition_opacity_dissolve_in_fades_from_zero() {
        let transition = SceneTransition {
            transition_type: "dissolve".to_string(),
            duration_sec: 2.0,
            curve: Some("linear".to_string()),
            from_layer_id: None,
            mode: None,
            spec: None,
        };
        let layer = test_layer(0.0, 10.0, Some(transition), None);

        // At t=0 (start of transition): opacity = 0
        let opacity = compute_transition_opacity(&layer, 0.0, 1.0);
        assert!((opacity - 0.0).abs() < 1e-6);

        // At t=1 (midpoint): opacity = 0.5
        let opacity = compute_transition_opacity(&layer, 1.0, 1.0);
        assert!((opacity - 0.5).abs() < 1e-6);

        // At t=2 (end of transition): opacity = 1.0
        let opacity = compute_transition_opacity(&layer, 2.0, 1.0);
        assert!((opacity - 1.0).abs() < 1e-6);
    }

    #[test]
    fn compute_transition_opacity_dissolve_out_fades_to_zero() {
        let transition = SceneTransition {
            transition_type: "dissolve".to_string(),
            duration_sec: 2.0,
            curve: Some("linear".to_string()),
            from_layer_id: None,
            mode: None,
            spec: None,
        };
        let layer = test_layer(0.0, 10.0, None, Some(transition));

        // out_start = 10 - 2 = 8
        // At t=8 (start of out): opacity = 1.0
        let opacity = compute_transition_opacity(&layer, 8.0, 1.0);
        assert!((opacity - 1.0).abs() < 1e-6);

        // At t=9 (midpoint): opacity = 0.5
        let opacity = compute_transition_opacity(&layer, 9.0, 1.0);
        assert!((opacity - 0.5).abs() < 1e-6);

        // At t=10 (end): opacity = 0.0
        let opacity = compute_transition_opacity(&layer, 10.0, 1.0);
        // local_t = 10, out_start = 8, out_dur = 2, progress = (10-8)/2 = 1, opacity = 1*(1-1) = 0
        // But t=10 is not < timeline_end_sec (10.0), so covers() returns false.
        // However compute_transition_opacity doesn't check covers, it just checks local_t.
        assert!((opacity - 0.0).abs() < 1e-6);
    }

    #[test]
    fn compute_transition_opacity_shader_rendered_in_does_not_fade() {
        let transition = SceneTransition {
            transition_type: "dissolve".to_string(),
            duration_sec: 2.0,
            curve: Some("linear".to_string()),
            from_layer_id: Some("other".to_string()),
            mode: None,
            spec: Some(TransitionSpec::Crossfade),
        };
        let layer = test_layer(0.0, 10.0, Some(transition), None);

        // Shader-rendered: opacity should remain at base
        let opacity = compute_transition_opacity(&layer, 0.0, 1.0);
        assert!((opacity - 1.0).abs() < 1e-6);
    }

    #[test]
    fn compute_transition_opacity_dissolve_in_with_base_opacity() {
        let transition = SceneTransition {
            transition_type: "dissolve".to_string(),
            duration_sec: 2.0,
            curve: Some("linear".to_string()),
            from_layer_id: None,
            mode: None,
            spec: None,
        };
        let layer = test_layer(0.0, 10.0, Some(transition), None);

        // base_opacity = 0.5, at t=1 (midpoint): 0.5 * 0.5 = 0.25
        let opacity = compute_transition_opacity(&layer, 1.0, 0.5);
        assert!((opacity - 0.25).abs() < 1e-6);
    }

    #[test]
    fn compute_transition_opacity_clamps_to_0_1() {
        let transition = SceneTransition {
            transition_type: "dissolve".to_string(),
            duration_sec: 2.0,
            curve: Some("linear".to_string()),
            from_layer_id: None,
            mode: None,
            spec: None,
        };
        let layer = test_layer(0.0, 10.0, Some(transition), None);

        // base_opacity > 1.0 should be clamped
        let opacity = compute_transition_opacity(&layer, 2.0, 1.5);
        assert!((opacity - 1.0).abs() < 1e-6);
    }

    fn test_layer(
        start: f64,
        end: f64,
        transition_in: Option<SceneTransition>,
        transition_out: Option<SceneTransition>,
    ) -> SceneLayer {
        SceneLayer {
            id: "test".to_string(),
            kind: LayerKind::Video,
            path: String::new(),
            timeline_start_sec: start,
            timeline_end_sec: end,
            source_start_sec: 0.0,
            source_range_duration_sec: 0.0,
            source_duration_sec: None,
            speed: 1.0,
            freeze_frame_source_sec: None,
            source_orientation: None,
            z: 0,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            background_color: None,
            text: None,
            style: None,
            shape_type: None,
            fill_color: None,
            stroke_color: None,
            stroke_width: None,
            shape_config: None,
            snap_to_pixel_grid: false,
            transform: None,
            animations: None,
            baked_effects: None,            transition_in,
            transition_out,
            effects: vec![],
        }
    }
}
