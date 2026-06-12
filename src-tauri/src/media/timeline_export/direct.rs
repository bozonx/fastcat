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
//! export still matches the monitor. Anything it cannot prove falls back to vello.

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
/// the export frame, or `None` (fall back to the vello pipeline) otherwise.
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
    if !options.video_enabled.unwrap_or(true) {
        return None;
    }
    // Alpha export carries straight-alpha pixels that only the VP9 software path emits
    // correctly via the compositor; never shortcut it.
    if export_uses_alpha(options) {
        return None;
    }
    // Master effects apply to the final composite frame; the direct path has no compositor.
    if !scene.master_effects.is_empty() {
        return None;
    }

    // Exactly one visible layer, and it must be a plain video clip.
    if scene.layers.len() != 1 {
        return None;
    }
    let layer = &scene.layers[0];
    if !matches!(layer.kind, LayerKind::Video) {
        return None;
    }
    if layer.path.is_empty() {
        return None;
    }

    // It must span the entire export range (no gaps where the background shows).
    const EPS: f64 = 1e-6;
    if layer.timeline_start_sec > start + EPS || layer.timeline_end_sec < end - EPS {
        return None;
    }

    // Anything below would force the compositor to do real work; bail to vello.
    if (layer.opacity - 1.0).abs() > EPS {
        return None;
    }
    if !layer.effects.is_empty() {
        return None;
    }
    if layer.transition_in.is_some() || layer.transition_out.is_some() {
        return None;
    }
    if layer.transform.is_some() {
        return None;
    }
    if (layer.speed - 1.0).abs() > EPS {
        return None;
    }
    if layer.freeze_frame_source_sec.is_some() {
        return None;
    }
    if !matches!(layer.blend_mode, BlendMode::Normal) {
        return None;
    }
    // Explicit orientation overrides the source's own rotation handling; let vello own it.
    // Frontend sends "auto" for the default case, which is equivalent to `None` here:
    // the probe below still rejects rotated sources so direct output matches the monitor.
    if !matches!(layer.source_orientation.as_deref(), None | Some("auto")) {
        return None;
    }

    // The export viewport must equal the scene, so vello's scene→viewport letterbox fit
    // is the identity and the only mapping left is the clip→scene fit handled below.
    if even(scene.width) != width || even(scene.height) != height {
        return None;
    }

    // Probe the source. The clip aspect must match the frame (so vello's centre-fit is a
    // plain resize with no letterbox bars) and it must carry no rotation metadata (which
    // would otherwise need a transpose to match the monitor).
    let decoder =
        crate::media::decode::open(Path::new(&layer.path), None, HwAccelMode::None, None).ok()?;
    let info = decoder.info();
    if info.rotation != 0 || info.width == 0 || info.height == 0 {
        return None;
    }
    let src_aspect = info.width as f64 / info.height as f64;
    let out_aspect = width as f64 / height as f64;
    // ~0.5% tolerance absorbs rounding between stored display size and even() output.
    if (src_aspect - out_aspect).abs() > out_aspect * 0.005 {
        return None;
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
        return None;
    }

    Some(DirectPlan {
        source: PathBuf::from(&layer.path),
        source_start_sec,
        duration_sec,
    })
}
