//! Live-preview compositor scene assembly.
//!
//! This module resolves raster layers from monitor runtimes and delegates common
//! virtual-layer/finalization logic to the rest of `scene_build`.

use std::collections::{HashMap, HashSet};

use vello::peniko::Color;

use crate::compositor::scene::{LayerKind as CompLayerKind, RasterSource, Scene};
use crate::monitor::layer_runtime::LayerRuntime;
use crate::monitor::scene::{LayerKind, SceneLayer};

use super::{build_virtual_kind, finalize_layer, layer_with_auto_source_rotation};

/// Builds a compositor snapshot for live preview at timeline time `t`.
pub fn build_compositor_scene(
    scene: &[SceneLayer],
    scene_size: (u32, u32),
    runtimes: &HashMap<String, LayerRuntime>,
    t: f64,
) -> Scene {
    let (scene_w, scene_h) = resolved_scene_size(scene, scene_size, runtimes);

    let mut active_indices = HashSet::new();
    for i in 0..scene.len() {
        if scene[i].covers(t) {
            active_indices.insert(i);

            if let Some(t_in) = &scene[i].transition_in {
                let local_t = t - scene[i].timeline_start_sec;
                if local_t < t_in.duration_sec && local_t >= 0.0 {
                    if let Some(from_id) = &t_in.from_layer_id {
                        if let Some(from_idx) =
                            (0..scene.len()).find(|&idx| &scene[idx].id == from_id)
                        {
                            active_indices.insert(from_idx);
                        }
                    }
                }
            }
        }
    }

    let mut indices: Vec<usize> = active_indices.into_iter().collect();
    indices.sort_by_key(|&i| scene[i].z);

    let mut layers = Vec::with_capacity(indices.len());
    for i in indices {
        let sl = &scene[i];
        if sl.opacity.clamp(0.0, 1.0) <= 0.0 {
            continue;
        }

        let layer_kind = match sl.kind {
            LayerKind::Video | LayerKind::Image | LayerKind::Svg => {
                let Some(rt) = runtimes.get(&sl.id) else {
                    continue;
                };
                match rt {
                    LayerRuntime::Video(v) => match v.current.as_ref() {
                        Some(f) => CompLayerKind::Raster {
                            source: match (&f.texture, &f.image) {
                                (Some(texture), _) => RasterSource::GpuTexture(texture.clone()),
                                (None, Some(image)) => RasterSource::Image(image.clone()),
                                (None, None) => continue,
                            },
                            natural_size: v.media_size,
                        },
                        None => continue,
                    },
                    LayerRuntime::Image(im) => CompLayerKind::Raster {
                        source: RasterSource::Image(im.image.clone()),
                        natural_size: im.size,
                    },
                    LayerRuntime::Loading | LayerRuntime::Failed => continue,
                }
            }
            LayerKind::Background | LayerKind::Shape | LayerKind::Text => {
                match build_virtual_kind(sl, (scene_w, scene_h)) {
                    Some(kind) => kind,
                    None => continue,
                }
            }
            LayerKind::Adjustment => CompLayerKind::Adjustment,
        };

        let layer = match runtimes.get(&sl.id) {
            Some(LayerRuntime::Video(v)) => layer_with_auto_source_rotation(sl, v.source_rotation),
            _ => sl.clone(),
        };
        layers.push(finalize_layer(&layer, layer_kind, (scene_w, scene_h), t));
    }

    Scene {
        width: scene_w,
        height: scene_h,
        time: t,
        background: Color::TRANSPARENT,
        layers,
        master_effects: Vec::new(),
    }
}

/// Scene size from `MonitorScene.width/height` or runtime media bounding box.
pub fn resolved_scene_size(
    scene: &[SceneLayer],
    scene_size: (u32, u32),
    runtimes: &HashMap<String, LayerRuntime>,
) -> (u32, u32) {
    if scene_size.0 > 0 && scene_size.1 > 0 {
        return scene_size;
    }
    let mut w = 0u32;
    let mut h = 0u32;
    for layer in scene.iter() {
        let Some(rt) = runtimes.get(&layer.id) else {
            continue;
        };
        let (mw, mh) = match rt {
            LayerRuntime::Video(v) => v.media_size,
            LayerRuntime::Image(im) => im.size,
            LayerRuntime::Loading | LayerRuntime::Failed => continue,
        };
        w = w.max(mw);
        h = h.max(mh);
    }
    if w == 0 || h == 0 {
        (1920, 1080)
    } else {
        (w, h)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::monitor::scene::SceneLayer;

    #[test]
    fn builds_virtual_background_without_runtime() {
        let layer = test_layer(LayerKind::Background, "bg", 0);
        let scene = build_compositor_scene(&[layer], (1280, 720), &HashMap::new(), 0.0);

        assert_eq!(scene.width, 1280);
        assert_eq!(scene.height, 720);
        assert_eq!(scene.layers.len(), 1);
    }

    #[test]
    fn skips_raster_layer_without_runtime() {
        let layer = test_layer(LayerKind::Image, "img", 0);
        let scene = build_compositor_scene(&[layer], (1280, 720), &HashMap::new(), 0.0);

        assert!(scene.layers.is_empty());
    }

    fn test_layer(kind: LayerKind, id: &str, z: i32) -> SceneLayer {
        SceneLayer {
            id: id.into(),
            kind,
            path: String::new(),
            timeline_start_sec: 0.0,
            timeline_end_sec: 1.0,
            source_start_sec: 0.0,
            source_range_duration_sec: 1.0,
            speed: 1.0,
            freeze_frame_source_sec: None,
            source_orientation: None,
            z,
            opacity: 1.0,
            blend_mode: crate::compositor::scene::BlendMode::Normal,
            background_color: Some("#000000".into()),
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
            effects: Vec::new(),
        }
    }

    #[test]
    fn propagates_master_effects_into_domain_scene() {
        let mut layer = test_layer(LayerKind::Background, "bg", 0);
        layer.timeline_start_sec = 0.0;
        layer.timeline_end_sec = 10.0;
        let scene = build_compositor_scene(&[layer], (1280, 720), &HashMap::new(), 0.0);
        assert_eq!(scene.master_effects.len(), 0);
    }

    #[test]
    fn includes_adjustment_layer_in_domain_scene() {
        let adj = test_layer(LayerKind::Adjustment, "adj-1", 10);
        let bg = test_layer(LayerKind::Background, "bg", 0);
        let scene = build_compositor_scene(&[bg, adj], (1280, 720), &HashMap::new(), 0.5);

        assert_eq!(scene.layers.len(), 2);
        assert!(scene.layers.iter().any(|l| matches!(l.kind, CompLayerKind::Adjustment)));
    }

    #[test]
    fn skips_inactive_adjustment_layer_outside_timewindow() {
        let mut adj = test_layer(LayerKind::Adjustment, "adj-1", 10);
        adj.timeline_start_sec = 2.0;
        adj.timeline_end_sec = 4.0;
        let bg = test_layer(LayerKind::Background, "bg", 0);
        let scene = build_compositor_scene(&[bg, adj], (1280, 720), &HashMap::new(), 0.5);

        assert_eq!(scene.layers.len(), 1);
        assert!(!scene.layers.iter().any(|l| matches!(l.kind, CompLayerKind::Adjustment)));
    }
}
