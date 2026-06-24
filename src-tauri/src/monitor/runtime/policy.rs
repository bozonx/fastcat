use std::collections::{HashMap, HashSet};

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

pub(super) fn layer_near_playhead(layer: &SceneLayer, t: f64, prewarm_lookahead_sec: f64) -> bool {
    let keep_ahead = RUNTIME_KEEP_AHEAD_SEC.max(prewarm_lookahead_sec + 1.0);
    layer.timeline_start_sec < t + keep_ahead
        && layer.timeline_end_sec > t - RUNTIME_KEEP_BEHIND_SEC
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
