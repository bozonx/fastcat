use std::collections::{HashMap, HashSet};

#[cfg(test)]
use crate::compositor::scene::BlendMode;
use crate::monitor::scene::{LayerKind, NativeFrameCacheMode, PreviewSyncMode, SceneLayer};

pub(super) const VIDEO_PREWARM_LOOKAHEAD_SEC: f64 = 2.5;
pub(super) const RUNTIME_KEEP_BEHIND_SEC: f64 = 3.0;
pub(super) const RUNTIME_KEEP_AHEAD_SEC: f64 = VIDEO_PREWARM_LOOKAHEAD_SEC + 1.0;
// The ahead window must cover the prewarm lookahead so a just-prewarmed clip is
// never evicted on the same tick it was warmed. Enforced at compile time.
const _: () = assert!(RUNTIME_KEEP_AHEAD_SEC >= VIDEO_PREWARM_LOOKAHEAD_SEC);

const MB: usize = 1024 * 1024;
const LOW_CACHE_BUDGET_BYTES: usize = 96 * MB;
const BALANCED_CACHE_BUDGET_BYTES: usize = 192 * MB;
const HIGH_CACHE_BUDGET_BYTES: usize = 512 * MB;
const AUTO_CACHE_MIN_FRAMES: usize = 6;
const AUTO_CACHE_MAX_BYTES: usize = 512 * MB;
const AUTO_CACHE_TARGET_WINDOW_SEC: f64 = 0.5;

pub(super) const STRICT_VIDEO_SYNC_LAG_SEC: f64 = 0.08;
pub(super) const BALANCED_VIDEO_SYNC_LAG_SEC: f64 = 0.22;
const STRICT_VIDEO_SYNC_LAG_FRAMES: f64 = 2.0;
const BALANCED_VIDEO_SYNC_LAG_FRAMES: f64 = 6.0;

pub fn sanitize_preview_fps(fps: f64) -> f64 {
    if fps.is_finite() && fps > 0.0 {
        fps.clamp(1.0, 240.0)
    } else {
        30.0
    }
}

pub(super) fn video_sync_lag_sec(mode: PreviewSyncMode, fps: f64) -> Option<f64> {
    let fps = if fps.is_finite() && fps > 0.0 {
        fps
    } else {
        30.0
    };
    match mode {
        PreviewSyncMode::Smooth => None,
        PreviewSyncMode::Balanced => {
            Some((BALANCED_VIDEO_SYNC_LAG_FRAMES / fps).min(BALANCED_VIDEO_SYNC_LAG_SEC))
        }
        PreviewSyncMode::Strict => {
            Some((STRICT_VIDEO_SYNC_LAG_FRAMES / fps).min(STRICT_VIDEO_SYNC_LAG_SEC))
        }
    }
}

pub(super) fn active_layer_indices(scene: &[SceneLayer], t: f64) -> HashSet<usize> {
    let indices_by_id: HashMap<&str, usize> = scene
        .iter()
        .enumerate()
        .map(|(index, layer)| (layer.id.as_str(), index))
        .collect();
    let mut active: HashSet<usize> = scene
        .iter()
        .enumerate()
        .filter_map(|(index, layer)| layer.covers(t).then_some(index))
        .collect();

    for id in transition_from_ids(scene, t) {
        if let Some(index) = indices_by_id.get(id.as_str()) {
            active.insert(*index);
        }
    }
    active
}

pub(super) fn transition_from_ids(scene: &[SceneLayer], t: f64) -> HashSet<String> {
    let mut ids = HashSet::new();
    for layer in scene.iter().filter(|layer| layer.covers(t)) {
        if let Some(transition) = &layer.transition_in {
            let local_t = t - layer.timeline_start_sec;
            if local_t >= 0.0 && local_t < transition.duration_sec {
                if let Some(from_id) = &transition.from_layer_id {
                    ids.insert(from_id.clone());
                }
            }
        }
        if let Some(transition) = &layer.transition_out {
            let local_t = t - layer.timeline_start_sec;
            let duration = layer.timeline_end_sec - layer.timeline_start_sec;
            let out_start = (duration - transition.duration_sec).max(0.0);
            if local_t >= out_start && local_t < duration {
                if let Some(from_id) = &transition.from_layer_id {
                    ids.insert(from_id.clone());
                }
            }
        }
    }
    ids
}

pub(super) fn has_loaded_runtime(kind: LayerKind) -> bool {
    matches!(kind, LayerKind::Video | LayerKind::Image | LayerKind::Svg)
}

pub(super) fn is_refreshable_display_runtime(kind: LayerKind) -> bool {
    has_loaded_runtime(kind)
}

/// Keep window around the playhead for runtime eviction. `reverse` swaps which side
/// gets the bigger (prewarm-lookahead-sized) margin: during reverse playback the
/// clip about to be entered lies *earlier* on the timeline, so the generous margin
/// must extend backward from `t`, not forward — otherwise a reverse-playing clip's
/// upcoming neighbour is evicted right before the playhead reaches it (cold-start
/// stutter at every cut), while the already-passed forward margin sits unused.
pub(super) fn layer_near_playhead(
    layer: &SceneLayer,
    t: f64,
    prewarm_lookahead_sec: f64,
    reverse: bool,
) -> bool {
    let keep_margin = RUNTIME_KEEP_AHEAD_SEC.max(prewarm_lookahead_sec + 1.0);
    if reverse {
        layer.timeline_start_sec < t + RUNTIME_KEEP_BEHIND_SEC
            && layer.timeline_end_sec > t - keep_margin
    } else {
        layer.timeline_start_sec < t + keep_margin
            && layer.timeline_end_sec > t - RUNTIME_KEEP_BEHIND_SEC
    }
}

/// Whether `layer` should be proactively opened/prewarmed because the playhead
/// will reach it within `lookahead_sec`, given the transport direction. Checks
/// interval OVERLAP between the layer's timeline span and the probe window
/// `[t, t+lookahead]` (forward) or `[t-lookahead, t]` (reverse) — not just whether
/// the single point `t ± lookahead` lands inside the layer. A point check misses
/// short clips: at high transport speed the probe point can step clear over a clip
/// shorter than one prewarm step without ever landing inside it, so it never gets
/// prewarmed and starts cold at the cut.
pub(super) fn layer_in_prewarm_window(
    layer: &SceneLayer,
    t: f64,
    lookahead_sec: f64,
    reverse: bool,
) -> bool {
    let (lo, hi) = if reverse {
        (t - lookahead_sec, t)
    } else {
        (t, t + lookahead_sec)
    };
    layer.timeline_start_sec < hi && layer.timeline_end_sec > lo
}

pub(super) fn sanitize_transport_speed(speed: f64) -> f64 {
    if speed.is_finite() && speed != 0.0 {
        speed.clamp(-100.0, 100.0)
    } else {
        1.0
    }
}

pub(super) fn scaled_prewarm_lookahead_sec(playback_speed: f64) -> f64 {
    VIDEO_PREWARM_LOOKAHEAD_SEC * sanitize_transport_speed(playback_speed).abs().max(1.0)
}

pub(super) fn allows_stale_video_fallback(mode: PreviewSyncMode) -> bool {
    matches!(mode, PreviewSyncMode::Smooth | PreviewSyncMode::Balanced)
}

pub(super) fn frame_cache_budget_bytes(
    mode: NativeFrameCacheMode,
    custom_mb: u32,
    media_size: (u32, u32),
    fps: f64,
    concurrent_video_layers: usize,
) -> usize {
    let base = match mode {
        NativeFrameCacheMode::Low => LOW_CACHE_BUDGET_BYTES,
        NativeFrameCacheMode::Balanced => BALANCED_CACHE_BUDGET_BYTES,
        NativeFrameCacheMode::High => HIGH_CACHE_BUDGET_BYTES,
        NativeFrameCacheMode::Custom => (custom_mb as usize).saturating_mul(MB),
        NativeFrameCacheMode::Auto => {
            let frame_bytes = (media_size.0 as usize)
                .saturating_mul(media_size.1 as usize)
                .saturating_mul(4)
                .max(1);
            let fps = if fps.is_finite() && fps > 0.0 {
                fps
            } else {
                30.0
            };
            let target_frames =
                ((fps * AUTO_CACHE_TARGET_WINDOW_SEC).ceil() as usize).max(AUTO_CACHE_MIN_FRAMES);
            frame_bytes
                .saturating_mul(target_frames)
                .clamp(BALANCED_CACHE_BUDGET_BYTES, AUTO_CACHE_MAX_BYTES)
        }
    };
    base / concurrent_video_layers.max(1)
}

pub(super) fn max_concurrent_video_layers_within(scene: &[SceneLayer], lo: f64, hi: f64) -> usize {
    let mut events: Vec<(f64, i32)> = Vec::new();
    for layer in scene.iter().filter(|layer| layer.kind == LayerKind::Video) {
        let start = layer.timeline_start_sec.max(lo);
        let end = layer.timeline_end_sec.min(hi);
        if end <= start {
            continue;
        }
        events.push((start, 1));
        events.push((end, -1));
    }
    events.sort_by(|a, b| {
        a.0.partial_cmp(&b.0)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.1.cmp(&b.1))
    });
    let mut current = 0i32;
    let mut max = 0i32;
    for (_, delta) in events {
        current += delta;
        max = max.max(current);
    }
    max.max(1) as usize
}

pub(super) fn svg_target_long_edge(scene_size: (u32, u32), preview_scale: Option<f32>) -> u32 {
    let long = match scene_size.0.max(scene_size.1) {
        0 => 1920,
        value => value,
    };
    let scale = preview_scale.filter(|scale| *scale > 0.0).unwrap_or(1.0);
    ((long as f32 * scale).round() as u32).max(1)
}

pub(super) fn approx_eq_opt_scale(a: Option<f32>, b: Option<f32>) -> bool {
    (a.unwrap_or(1.0) - b.unwrap_or(1.0)).abs() < 1e-4
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prewarm_window_forward_checks_interval_not_point() {
        // A clip that starts and ends strictly BETWEEN t and t+lookahead: the old
        // point check `layer.covers(t + lookahead)` misses it entirely (neither
        // endpoint of the probe lands inside the clip), so a short clip at high
        // transport speed would never get prewarmed. The interval-overlap check
        // must catch it.
        let short_future = test_video_layer("short", 1.0, 1.2);
        assert!(layer_in_prewarm_window(&short_future, 0.0, 2.0, false));
        // Outside the window entirely → not prewarmed.
        assert!(!layer_in_prewarm_window(&short_future, 0.0, 0.5, false));
    }

    #[test]
    fn prewarm_window_reverse_probes_backward() {
        // Reverse: the clip the playhead is backing toward lies BEFORE t, so the
        // probe window must extend backward, not forward.
        let past_clip = test_video_layer("past", 8.0, 8.5);
        assert!(layer_in_prewarm_window(&past_clip, 9.0, 2.0, true));
        // The same clip is irrelevant to a forward-playing probe from the same t.
        assert!(!layer_in_prewarm_window(&past_clip, 9.0, 2.0, false));
    }

    #[test]
    fn prewarm_window_excludes_clip_already_behind_reverse_direction() {
        // A clip that lies AHEAD in timeline (i.e. behind the reverse-playing
        // direction) must not be considered "coming up" for a reverse probe.
        let ahead_clip = test_video_layer("ahead", 10.0, 12.0);
        assert!(!layer_in_prewarm_window(&ahead_clip, 9.0, 2.0, true));
    }

    #[test]
    fn sanitize_preview_fps_clamps_and_defaults() {
        assert!((sanitize_preview_fps(60.0) - 60.0).abs() < 1e-9);
        assert!((sanitize_preview_fps(0.0) - 30.0).abs() < 1e-9);
        assert!((sanitize_preview_fps(-5.0) - 30.0).abs() < 1e-9);
        assert!((sanitize_preview_fps(f64::NAN) - 30.0).abs() < 1e-9);
        assert!((sanitize_preview_fps(f64::INFINITY) - 30.0).abs() < 1e-9);
        assert!((sanitize_preview_fps(0.5) - 1.0).abs() < 1e-9);
        assert!((sanitize_preview_fps(300.0) - 240.0).abs() < 1e-9);
    }

    #[test]
    fn video_sync_lag_smooth_returns_none() {
        assert!(video_sync_lag_sec(PreviewSyncMode::Smooth, 30.0).is_none());
    }

    #[test]
    fn video_sync_lag_strict_caps_at_constant() {
        let lag = video_sync_lag_sec(PreviewSyncMode::Strict, 30.0).unwrap();
        // 2 frames / 30 fps = 0.0667, capped at 0.08 → 0.0667
        assert!((lag - 2.0 / 30.0).abs() < 1e-9);

        // Low FPS: 2/10 = 0.2, capped at 0.08
        let lag = video_sync_lag_sec(PreviewSyncMode::Strict, 10.0).unwrap();
        assert!((lag - STRICT_VIDEO_SYNC_LAG_SEC).abs() < 1e-9);
    }

    #[test]
    fn video_sync_lag_balanced_caps_at_constant() {
        let lag = video_sync_lag_sec(PreviewSyncMode::Balanced, 30.0).unwrap();
        // 6/30 = 0.2, capped at 0.22 → 0.2
        assert!((lag - 6.0 / 30.0).abs() < 1e-9);

        // Low FPS: 6/10 = 0.6, capped at 0.22
        let lag = video_sync_lag_sec(PreviewSyncMode::Balanced, 10.0).unwrap();
        assert!((lag - BALANCED_VIDEO_SYNC_LAG_SEC).abs() < 1e-9);
    }

    #[test]
    fn video_sync_lag_invalid_fps_defaults_to_30() {
        let lag = video_sync_lag_sec(PreviewSyncMode::Strict, 0.0).unwrap();
        assert!((lag - 2.0 / 30.0).abs() < 1e-9);
    }

    #[test]
    fn sanitize_transport_speed_clamps_and_defaults() {
        assert!((sanitize_transport_speed(2.0) - 2.0).abs() < 1e-9);
        assert!((sanitize_transport_speed(-2.0) - (-2.0)).abs() < 1e-9);
        assert!((sanitize_transport_speed(0.0) - 1.0).abs() < 1e-9);
        assert!((sanitize_transport_speed(f64::NAN) - 1.0).abs() < 1e-9);
        assert!((sanitize_transport_speed(200.0) - 100.0).abs() < 1e-9);
        assert!((sanitize_transport_speed(-200.0) - (-100.0)).abs() < 1e-9);
    }

    #[test]
    fn frame_cache_budget_fixed_modes() {
        let budget = frame_cache_budget_bytes(NativeFrameCacheMode::Low, 0, (1920, 1080), 30.0, 1);
        assert_eq!(budget, LOW_CACHE_BUDGET_BYTES);

        let budget =
            frame_cache_budget_bytes(NativeFrameCacheMode::Balanced, 0, (1920, 1080), 30.0, 1);
        assert_eq!(budget, BALANCED_CACHE_BUDGET_BYTES);

        let budget = frame_cache_budget_bytes(NativeFrameCacheMode::High, 0, (1920, 1080), 30.0, 1);
        assert_eq!(budget, HIGH_CACHE_BUDGET_BYTES);
    }

    #[test]
    fn frame_cache_budget_custom_uses_mb() {
        let budget =
            frame_cache_budget_bytes(NativeFrameCacheMode::Custom, 256, (1920, 1080), 30.0, 1);
        assert_eq!(budget, 256 * MB);
    }

    #[test]
    fn frame_cache_budget_divides_by_concurrent_layers() {
        let budget =
            frame_cache_budget_bytes(NativeFrameCacheMode::Balanced, 0, (1920, 1080), 30.0, 2);
        assert_eq!(budget, BALANCED_CACHE_BUDGET_BYTES / 2);
    }

    #[test]
    fn frame_cache_budget_auto_computes_from_frame_size() {
        let budget = frame_cache_budget_bytes(NativeFrameCacheMode::Auto, 0, (1920, 1080), 30.0, 1);
        let frame_bytes = 1920 * 1080 * 4;
        let target_frames = ((30.0_f64 * 0.5).ceil() as usize).max(AUTO_CACHE_MIN_FRAMES);
        let expected =
            (frame_bytes * target_frames).clamp(BALANCED_CACHE_BUDGET_BYTES, AUTO_CACHE_MAX_BYTES);
        assert_eq!(budget, expected);
    }

    #[test]
    fn frame_cache_budget_auto_clamps_to_min() {
        // Tiny frame: should hit the balanced minimum
        let budget = frame_cache_budget_bytes(NativeFrameCacheMode::Auto, 0, (2, 2), 1.0, 1);
        assert!(budget >= BALANCED_CACHE_BUDGET_BYTES);
    }

    #[test]
    fn frame_cache_budget_auto_clamps_to_max() {
        // Huge frame: should hit the auto max
        let budget = frame_cache_budget_bytes(NativeFrameCacheMode::Auto, 0, (7680, 4320), 60.0, 1);
        assert!(budget <= AUTO_CACHE_MAX_BYTES);
    }

    #[test]
    fn max_concurrent_video_layers_counts_overlap() {
        let scene = vec![
            test_video_layer("a", 0.0, 10.0),
            test_video_layer("b", 5.0, 15.0),
            test_video_layer("c", 8.0, 12.0),
        ];
        assert_eq!(max_concurrent_video_layers_within(&scene, 0.0, 20.0), 3);
    }

    #[test]
    fn max_concurrent_video_layers_no_overlap() {
        let scene = vec![
            test_video_layer("a", 0.0, 5.0),
            test_video_layer("b", 5.0, 10.0),
        ];
        assert_eq!(max_concurrent_video_layers_within(&scene, 0.0, 20.0), 1);
    }

    #[test]
    fn max_concurrent_video_layers_filters_non_video() {
        let scene = vec![
            test_video_layer("a", 0.0, 10.0),
            test_layer("b", LayerKind::Text, 0.0, 10.0),
        ];
        assert_eq!(max_concurrent_video_layers_within(&scene, 0.0, 20.0), 1);
    }

    #[test]
    fn max_concurrent_video_layers_empty_returns_one() {
        let scene: Vec<SceneLayer> = vec![];
        assert_eq!(max_concurrent_video_layers_within(&scene, 0.0, 10.0), 1);
    }

    #[test]
    fn svg_target_long_edge_defaults() {
        assert_eq!(svg_target_long_edge((1920, 1080), None), 1920);
        assert_eq!(svg_target_long_edge((1080, 1920), None), 1920);
        // Zero dims → 1920 fallback
        assert_eq!(svg_target_long_edge((0, 0), None), 1920);
    }

    #[test]
    fn svg_target_long_edge_applies_scale() {
        assert_eq!(svg_target_long_edge((1920, 1080), Some(0.5)), 960);
        assert_eq!(svg_target_long_edge((1920, 1080), Some(2.0)), 3840);
        // Zero/negative scale → 1.0
        assert_eq!(svg_target_long_edge((1920, 1080), Some(0.0)), 1920);
    }

    #[test]
    fn approx_eq_opt_scale_both_none() {
        assert!(approx_eq_opt_scale(None, None));
    }

    #[test]
    fn approx_eq_opt_scale_one_none() {
        assert!(!approx_eq_opt_scale(Some(0.5), None));
        assert!(!approx_eq_opt_scale(None, Some(0.5)));
    }

    #[test]
    fn approx_eq_opt_scale_close_values() {
        assert!(approx_eq_opt_scale(Some(1.0), Some(1.00001)));
        assert!(!approx_eq_opt_scale(Some(1.0), Some(1.001)));
    }

    fn test_video_layer(id: &str, start: f64, end: f64) -> SceneLayer {
        test_layer(id, LayerKind::Video, start, end)
    }

    fn test_layer(id: &str, kind: LayerKind, start: f64, end: f64) -> SceneLayer {
        SceneLayer {
            id: id.to_string(),
            kind,
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
            transform: None,
            transition_in: None,
            transition_out: None,
            effects: vec![],
        }
    }
}
