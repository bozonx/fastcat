//! Scene-materialization boundary.
//!
//! Detailed passes remain methods on `Compositor` because they share per-device
//! effect and transition pipelines. This module owns the ordered pipeline entry
//! point, keeping that policy separate from surface and readback management.

use anyhow::{anyhow, Result};
use std::sync::Arc;
use std::time::Instant;
use vello::peniko::ImageData;
use vello::Scene as VelloScene;

use super::{elapsed_ms, Compositor, GpuCtx};
use crate::compositor::effects::EffectSource;
use crate::compositor::render_telemetry::RenderPrepareTiming;

pub(super) fn prepare_vello_scene(
    compositor: &mut Compositor,
    dev_id: usize,
    scene: &crate::compositor::scene::Scene,
    viewport_w: u32,
    viewport_h: u32,
    registered_images: &mut Vec<ImageData>,
) -> Result<(VelloScene, RenderPrepareTiming)> {
    let device_handle = &compositor.devices.render_cx.devices[dev_id];
    let device = device_handle.device.clone();
    let queue = device_handle.queue.clone();
    let materialize_started = Instant::now();
    let effective_scene =
        compositor.materialize_transitions_and_effects(dev_id, scene, &device, &queue)?;
    let effective_scene =
        compositor.materialize_video_tracks(dev_id, &effective_scene, &device, &queue)?;
    let effective_scene =
        compositor.materialize_adjustment_clips(dev_id, &effective_scene, &device, &queue)?;
    let effective_scene =
        compositor.materialize_video_tracks(dev_id, &effective_scene, &device, &queue)?;
    let materialize_ms = elapsed_ms(materialize_started);

    let build_started = Instant::now();
    let vello = compositor.build_vello_scene_from_materialized(
        dev_id,
        &effective_scene,
        viewport_w,
        viewport_h,
        registered_images,
    )?;
    let vello = if effective_scene.master_effects.is_empty() {
        vello
    } else {
        let aa = compositor.aa_config_for(dev_id, effective_scene.effect_quality);
        let texture = compositor.render_to_owned_texture(
            dev_id,
            &vello,
            viewport_w,
            viewport_h,
            effective_scene.background,
            aa,
        )?;
        let (processed, _) = compositor.apply_effects_to_texture(
            dev_id,
            GpuCtx {
                device: &device,
                queue: &queue,
            },
            &EffectSource::Gpu(Arc::new(crate::media::SharedTexture::new_shared(Arc::new(
                texture,
            )))),
            &effective_scene.master_effects,
            false,
            effective_scene.effect_quality,
        )?;
        let mut out = VelloScene::new();
        let image = compositor
            .register_texture_for_vello(dev_id, &processed, registered_images)
            .map_err(|error| anyhow!("register master-effect texture: {error:?}"))?;
        out.draw_image(&image, vello::kurbo::Affine::IDENTITY);
        out
    };

    Ok((
        vello,
        RenderPrepareTiming {
            materialize_ms,
            build_vello_ms: elapsed_ms(build_started),
        },
    ))
}
