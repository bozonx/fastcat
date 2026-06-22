//! Direct-transcode fast path for the trivial export case.
//!
//! When the timeline is a single, untouched video clip — no effects, transitions,
//! transform, crop, speed change, freeze frame or non-default blend — there is nothing
//! for the compositor to do: every output frame is just the source frame resized to the
//! export resolution. Routing such an export through the per-frame vello pipeline
//! (decode → CPU RGBA → GPU upload → render → 33 MB/frame readback → raw stream) is pure
//! overhead. [`plan_direct`] detects this case so the caller can hand the whole job to a
//! single ffmpeg `decode → scale → encode` invocation instead.
//!
//! The check is deliberately conservative: it only engages when the result is provably
//! identical (modulo the encoder's resampler) to what vello would have produced, so the
//! export still matches the monitor. Anything it cannot prove falls back to vello — and
//! [`plan_direct`] logs *why*, so a real-world clip that unexpectedly takes the slow path
//! can be diagnosed (and the blocker targeted) instead of silently degrading.

use std::path::{Path, PathBuf};

use crate::compositor::scene::BlendMode;
use crate::media::ffmpeg_utils::even;
use crate::media::types::HwAccelMode;
use crate::monitor::scene::{LayerKind, MonitorScene};

use super::ffmpeg_args_builder::export_uses_alpha;
use super::options::NativeExportOptions;

/// A validated plan for the direct-transcode path.
pub(crate) struct DirectPlan {
    /// Absolute path to the single source clip.
    pub source: PathBuf,
    /// Source PTS (seconds) corresponding to the start of the export range.
    pub source_start_sec: f64,
    /// Output duration (seconds) — the encode is trimmed to exactly this.
    pub duration_sec: f64,
}

/// Returns a [`DirectPlan`] when the scene is a single untouched video clip that fills
/// the export frame, or `None` (fall back to the vello pipeline) otherwise. The reason
/// for any fall-back is logged at info level so the slow path is never a silent mystery.
pub(crate) fn plan_direct(
    scene: &MonitorScene,
    options: &NativeExportOptions,
    width: u32,
    height: u32,
    start: f64,
    end: f64,
    fps: f64,
    frame_count: u64,
) -> Option<DirectPlan> {
    match evaluate_direct(scene, options, width, height, start, end, fps, frame_count) {
        Ok(plan) => Some(plan),
        Err(reason) => {
            log::info!(
                "[native-export] direct transcode not used ({reason}); using compositor path"
            );
            None
        }
    }
}

/// The actual fast-path gate. Returns the reason it declined as the `Err` arm so the
/// caller can surface it. Each `return Err(...)` names the specific blocker.
fn evaluate_direct(
    scene: &MonitorScene,
    options: &NativeExportOptions,
    width: u32,
    height: u32,
    start: f64,
    end: f64,
    fps: f64,
    frame_count: u64,
) -> Result<DirectPlan, String> {
    const EPS: f64 = 1e-6;

    if !options.video_enabled.unwrap_or(true) {
        return Err("video is disabled".into());
    }
    // Alpha export carries straight-alpha pixels that only the VP9 software path emits
    // correctly via the compositor; never shortcut it.
    if export_uses_alpha(options) {
        return Err("alpha export needs the VP9 software compositor path".into());
    }
    // Master effects apply to the final composite frame; the direct path has no compositor.
    if !scene.master_effects.is_empty() {
        return Err("scene has master effects".into());
    }
    if scene.video_tracks.iter().any(|track| {
        (track.opacity - 1.0).abs() > EPS
            || !matches!(track.blend_mode, BlendMode::Normal)
            || !track.effects.is_empty()
    }) {
        return Err("scene has non-default video track compositing".into());
    }

    // Exactly one visible layer, and it must be a plain video clip.
    if scene.layers.len() != 1 {
        return Err(format!(
            "scene has {} layers (need exactly 1)",
            scene.layers.len()
        ));
    }
    let layer = &scene.layers[0];
    if !matches!(layer.kind, LayerKind::Video) {
        return Err(format!(
            "the single layer is {:?}, not a plain video clip",
            layer.kind
        ));
    }
    if layer.path.is_empty() {
        return Err("the video layer has no source path".into());
    }

    // It must span the entire export range (no gaps where the background shows).
    if layer.timeline_start_sec > start + EPS || layer.timeline_end_sec < end - EPS {
        return Err(format!(
            "clip [{:.3}s,{:.3}s] does not cover the export range [{:.3}s,{:.3}s]",
            layer.timeline_start_sec, layer.timeline_end_sec, start, end
        ));
    }

    // Anything below would force the compositor to do real work; bail to vello.
    if (layer.opacity - 1.0).abs() > EPS {
        return Err(format!("clip opacity is {:.3}, not 1.0", layer.opacity));
    }
    if !layer.effects.is_empty() {
        return Err(format!("clip has {} effect(s)", layer.effects.len()));
    }
    if layer.transition_in.is_some() || layer.transition_out.is_some() {
        return Err("clip has a transition".into());
    }
    if layer.transform.is_some() {
        return Err("clip has a transform (move/scale/rotate/crop)".into());
    }
    if (layer.speed - 1.0).abs() > EPS {
        return Err(format!("clip speed is {:.3}x, not 1.0x", layer.speed));
    }
    if layer.freeze_frame_source_sec.is_some() {
        return Err("clip is a freeze frame".into());
    }
    if !matches!(layer.blend_mode, BlendMode::Normal) {
        return Err(format!(
            "clip blend mode is {:?}, not Normal",
            layer.blend_mode
        ));
    }
    // Explicit orientation overrides the source's own rotation handling; let vello own it.
    // Frontend sends "auto" for the default case, which is equivalent to `None` here:
    // the probe below still rejects rotated sources so direct output matches the monitor.
    if !matches!(layer.source_orientation.as_deref(), None | Some("auto")) {
        return Err(format!(
            "clip has an explicit orientation override ({:?})",
            layer.source_orientation
        ));
    }

    // The export viewport must equal the scene, so vello's scene→viewport letterbox fit
    // is the identity and the only mapping left is the clip→scene fit handled below.
    if even(scene.width) != width || even(scene.height) != height {
        return Err(format!(
            "export size {width}x{height} differs from scene size {}x{}",
            even(scene.width),
            even(scene.height)
        ));
    }

    // Probe the source. The clip aspect must match the frame (so vello's centre-fit is a
    // plain resize with no letterbox bars) and it must carry no rotation metadata (which
    // would otherwise need a transpose to match the monitor).
    let decoder = crate::media::decode::open(Path::new(&layer.path), None, HwAccelMode::None, None)
        .map_err(|e| format!("could not probe source {}: {e}", layer.path))?;
    let info = decoder.info();
    if info.rotation != 0 || info.width == 0 || info.height == 0 {
        return Err(format!(
            "source carries rotation {}° or zero dimensions ({}x{})",
            info.rotation, info.width, info.height
        ));
    }
    // The vello/monitor decode path normalises a non-zero stream start time (MPEG-TS,
    // edit-list MP4) by adding it back on seek, so a 0-based timeline offset maps to the
    // right source frame. The direct path hands that 0-based offset straight to ffmpeg
    // `-ss`, which (verified empirically) targets a different absolute position — so the
    // export would no longer match the monitor. Bail to vello for any source that carries
    // a start offset.
    if info.start_time_sec.abs() > EPS {
        return Err(format!(
            "source has a stream start offset of {:.3}s (ffmpeg -ss would target the wrong frame)",
            info.start_time_sec
        ));
    }
    // HDR / wide-gamut sources: the direct path keeps the source's colour tags while the
    // vello path forces BT.709, so the two diverge. Let vello own these.
    if info.is_hdr {
        return Err("source is HDR/wide-gamut (vello forces BT.709)".into());
    }
    let src_aspect = info.width as f64 / info.height as f64;
    let out_aspect = width as f64 / height as f64;
    // ~0.5% tolerance absorbs rounding between stored display size and even() output.
    if (src_aspect - out_aspect).abs() > out_aspect * 0.005 {
        return Err(format!(
            "source aspect {:.4} ({}x{}) differs from output aspect {:.4} ({width}x{}) — would need letterboxing",
            src_aspect, info.width, info.height, out_aspect, height
        ));
    }
    let source_duration_sec = info.duration_sec;
    drop(decoder);

    // speed == 1 and no freeze, so source PTS is a straight offset from the range start.
    let source_start_sec = (layer.source_start_sec + (start - layer.timeline_start_sec)).max(0.0);
    // Match the vello path's range: frame_count/fps (>= end - start) so the last partial
    // frame and the rendered audio mix line up.
    let duration_sec = frame_count as f64 / fps;

    // The source must actually have frames for the whole range. If it ends early, the
    // vello path holds the last decoded frame to the end while ffmpeg's `-t` here would
    // simply produce a shorter video (and `-shortest` would then clip the audio mix).
    // Fall back to vello unless the source provably covers the range. A non-positive
    // (unknown) duration also bails — better a correct slow path than a truncated file.
    if !(source_duration_sec > 0.0 && source_duration_sec + EPS >= source_start_sec + duration_sec)
    {
        return Err(format!(
            "source duration {source_duration_sec:.3}s does not provably cover [{source_start_sec:.3}s, {:.3}s]",
            source_start_sec + duration_sec
        ));
    }

    Ok(DirectPlan {
        source: PathBuf::from(&layer.path),
        source_start_sec,
        duration_sec,
    })
}
