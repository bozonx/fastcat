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
