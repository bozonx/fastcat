//! Description of the multi-layer scene the native monitor plays.
//!
//! The frontend sends a "snapshot" of all clips on the timeline (video + image) at
//! once — the monitor itself decides which layers are "active" by timeline-PTS, lazily
//! opens decoders, and composites the result via Vello.
//!
//! Boundary: this module is the IPC DTO (serializable data from the frontend).
//! The render snapshot at a moment `t` lives in [`crate::compositor::scene::Scene`].

use serde::Deserialize;
use serde_json::Value;
use ts_rs::TS;

use crate::audio::plugins::AudioEffectSpec;
use crate::compositor::effects::EffectSpec;
use crate::compositor::scene::BlendMode;
use crate::compositor::transitions::TransitionSpec;

/// Building the domain `compositor::scene::Scene` from these IPC DTOs.
pub mod build;

// ts-rs generates the TypeScript mirror of these IPC DTOs into
// `src/types/generated/native-monitor/` (see `export_to` below). The frontend
// scene builder imports them so the contract has a single source of truth.

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
#[ts(
    export,
    export_to = "../../src/types/generated/native-monitor/",
    rename_all = "lowercase"
)]
pub enum LayerKind {
    Video,
    Image,
    Svg,
    Text,
    Shape,
    Background,
    Adjustment,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
#[ts(
    export,
    export_to = "../../src/types/generated/native-monitor/",
    rename_all = "lowercase"
)]
#[derive(Default)]
pub enum NativeFrameCacheMode {
    #[default]
    Auto,
    Low,
    Balanced,
    High,
    Custom,
}

/// 2D layer transform in scene coordinates (scene-space pixels).
///
/// `anchor` semantics: an anchor point inside the layer's natural bbox in fractions
/// [0..1]. It is "pinned" to position `(x, y)` after rotate+scale.
///
/// If `transform` is absent in the JSON (None), the layer is fitted into the scene by
/// letterbox/center-fit via `Transform::center_fit` (the default behavior).
#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/native-monitor/")]
pub struct SceneLayerTransform {
    /// Anchor-point position in scene-space (pixels; (0,0) = scene top-left).
    pub x: f64,
    pub y: f64,
    #[serde(default = "one")]
    pub scale_x: f64,
    #[serde(default = "one")]
    pub scale_y: f64,
    #[serde(default)]
    pub rotation_deg: f64,
    /// Horizontal anchor point in fractions of the layer's natural width. 0.5 = center.
    #[serde(default = "half")]
    pub anchor_x: f64,
    /// Vertical anchor point in fractions of the layer's natural height. 0.5 = center.
    #[serde(default = "half")]
    pub anchor_y: f64,
    #[serde(default)]
    pub crop_top: f64,
    #[serde(default)]
    pub crop_bottom: f64,
    #[serde(default)]
    pub crop_left: f64,
    #[serde(default)]
    pub crop_right: f64,
    #[serde(default)]
    pub flip_horizontal: bool,
    #[serde(default)]
    pub flip_vertical: bool,
}

fn one() -> f64 {
    1.0
}
fn half() -> f64 {
    0.5
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/native-monitor/")]
pub struct SceneLayer {
    /// Stable clip identifier — the key for the scene diff and the runtime cache.
    pub id: String,
    pub kind: LayerKind,
    /// Absolute path to the source file. Needed only for video/image/svg.
    #[serde(default)]
    pub path: String,
    /// `[timeline_start_sec; timeline_end_sec)` — the visibility window on the timeline.
    pub timeline_start_sec: f64,
    pub timeline_end_sec: f64,
    /// PTS inside the source at `timeline_start_sec`.
    pub source_start_sec: f64,
    /// Length of the available source range in the source. Needed for speed/reverse clamp.
    #[serde(default)]
    pub source_range_duration_sec: f64,
    /// Full duration of the source media (seconds). Used during transitions so the
    /// outgoing (from) clip plays its "tail" past the cut point during the transition
    /// (as in the web version) instead of freezing on the last visible frame.
    /// `None` → duration unknown, no tail available → hold a freeze frame.
    #[serde(default)]
    #[ts(optional)]
    pub source_duration_sec: Option<f64>,
    /// Playback speed of the video source. Negative values mean reverse.
    #[serde(default = "one")]
    pub speed: f64,
    /// Freeze frame: an absolute PTS inside the source.
    #[serde(default)]
    #[ts(optional)]
    pub freeze_frame_source_sec: Option<f64>,
    /// Explicit source orientation (`auto`, `0`, `90`, `180`, `270`).
    #[serde(default)]
    #[ts(optional)]
    pub source_orientation: Option<String>,
    /// Higher = on top. Sorted ascending.
    pub z: i32,
    /// `[0; 1]`, multiplied into the layer's alpha channel.
    pub opacity: f64,
    /// Blend mode from the timeline. We support the current frontend set.
    #[serde(default = "default_blend")]
    pub blend_mode: BlendMode,
    #[serde(default)]
    #[ts(optional)]
    pub background_color: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub text: Option<String>,
    // Open-ended text style bag — mapped to the existing frontend type.
    #[serde(default)]
    #[ts(optional, type = "import('~/timeline/types').TextClipStyle")]
    pub style: Option<Value>,
    #[serde(default)]
    #[ts(optional)]
    pub shape_type: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub fill_color: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub stroke_color: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub stroke_width: Option<f64>,
    #[serde(default)]
    #[ts(optional, type = "import('~/timeline/types').ShapeConfig")]
    pub shape_config: Option<Value>,
    /// Mirrors the web `clip.snapToPixelGrid`: when true (and the transform is
    /// axis-aligned/unscaled), text and shape layers round their box size and
    /// final position to integer scene pixels for crisp edges. Ignored for
    /// video/image/svg/background/adjustment kinds.
    #[serde(default)]
    pub snap_to_pixel_grid: bool,
    /// Explicit layer transform in scene-space.
    /// `None` → letterbox center-fit (the default, backward-compatible with older versions).
    #[serde(default)]
    #[ts(optional)]
    pub transform: Option<SceneLayerTransform>,
    /// Keyframe animation tracks (transform/opacity), source-relative µs.
    /// Sampled per frame in `finalize_layer` to drive an animated
    /// transform/opacity. Mirrors the web `clip.animations`.
    #[serde(default)]
    #[ts(optional, type = "import('~/timeline/types').ClipAnimations")]
    pub animations: Option<Value>,
    #[serde(default)]
    #[ts(optional)]
    pub transition_in: Option<SceneTransition>,
    #[serde(default)]
    #[ts(optional)]
    pub transition_out: Option<SceneTransition>,
    // Video effect specs — produced by the frontend effect manifests.
    #[serde(default)]
    #[ts(type = "import('~/effects').VideoEffectSpec[]")]
    pub effects: Vec<EffectSpec>,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/native-monitor/")]
pub struct SceneVideoTrack {
    pub id: String,
    pub z: i32,
    pub layer_ids: Vec<String>,
    #[serde(default = "one")]
    pub opacity: f64,
    #[serde(default = "default_blend")]
    pub blend_mode: BlendMode,
    #[serde(default)]
    #[ts(type = "import('~/effects').VideoEffectSpec[]")]
    pub effects: Vec<EffectSpec>,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/native-monitor/")]
pub struct SceneTransition {
    #[serde(rename = "type")]
    pub transition_type: String,
    pub duration_sec: f64,
    #[ts(optional)]
    pub curve: Option<String>,
    #[ts(optional)]
    pub from_layer_id: Option<String>,
    #[serde(default)]
    #[ts(optional, type = "\"adjacent\" | \"background\" | \"transparent\"")]
    pub mode: Option<String>,
    // Transition spec — produced by the frontend transition manifests.
    #[ts(
        optional,
        type = "import('~/transitions/core/registry').TransitionSpec"
    )]
    pub spec: Option<TransitionSpec>,
}

#[derive(Debug, Clone, Copy, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(
    export,
    export_to = "../../src/types/generated/native-monitor/",
    rename_all = "lowercase"
)]
#[derive(Default)]
pub enum AudioFadeCurve {
    #[default]
    Linear,
    Logarithmic,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
#[ts(
    export,
    export_to = "../../src/types/generated/native-monitor/",
    rename_all = "lowercase"
)]
#[derive(Default)]
pub enum PreviewSyncMode {
    Smooth,
    #[default]
    Balanced,
    Strict,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/native-monitor/")]
pub struct SceneAudioLayer {
    pub id: String,
    #[serde(default)]
    #[ts(optional)]
    pub track_id: Option<String>,
    pub path: String,
    pub timeline_start_sec: f64,
    pub timeline_end_sec: f64,
    pub source_start_sec: f64,
    /// Length of the available source range in the source. Needed for speed/reverse clamp.
    #[serde(default)]
    pub source_range_duration_sec: f64,
    #[serde(default = "one")]
    pub speed: f64,
    #[serde(default = "one")]
    pub audio_gain: f64,
    #[serde(default)]
    pub audio_balance: f64,
    #[serde(default)]
    pub audio_fade_in_sec: f64,
    #[serde(default)]
    pub audio_fade_out_sec: f64,
    #[serde(default)]
    pub audio_fade_in_curve: AudioFadeCurve,
    #[serde(default)]
    pub audio_fade_out_curve: AudioFadeCurve,
    #[serde(default)]
    pub audio_effects: Vec<crate::audio::plugins::AudioEffectSpec>,
}

impl SceneAudioLayer {
    pub fn source_pts_at(&self, timeline_sec: f64) -> f64 {
        compute_source_pts_at(
            timeline_sec,
            self.timeline_start_sec,
            self.timeline_end_sec,
            self.source_start_sec,
            self.source_range_duration_sec,
            self.speed,
            None,
        )
    }
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/native-monitor/")]
pub struct SceneAudioTrack {
    pub id: String,
    #[serde(default = "one")]
    pub audio_gain: f64,
    #[serde(default)]
    pub audio_balance: f64,
    #[serde(default)]
    pub audio_muted: bool,
    #[serde(default)]
    pub audio_solo: bool,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/native-monitor/")]
pub struct MonitorScene {
    pub layers: Vec<SceneLayer>,
    #[serde(default)]
    pub video_tracks: Vec<SceneVideoTrack>,
    #[serde(default)]
    pub audio_layers: Vec<SceneAudioLayer>,
    #[serde(default)]
    pub audio_tracks: Vec<SceneAudioTrack>,
    /// Master audio bus gain. Effects/track buses will be layered on top of this model later.
    #[serde(default = "one")]
    pub audio_master_gain: f64,
    #[serde(default)]
    pub audio_master_muted: bool,
    /// Composite frame size. If 0/absent — take the bounding box from the runtimes.
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
    /// Preview scale: 1.0 = 1/1, 0.5 = 1/2, etc. Passed through to ffmpeg `-vf scale`.
    /// Saves significant CPU/GPU on 4K sources in a small preview.
    /// `None` or absent → decode at native resolution.
    #[serde(default)]
    #[ts(optional)]
    pub preview_scale: Option<f32>,
    /// Target FPS of the preview render. Default 30. Most sources are 24/25/30, so 30
    /// is enough; for 60fps sources specify 60.
    #[serde(default = "default_fps")]
    pub preview_fps: f64,
    /// Video-to-audio synchronization policy for the preview.
    #[serde(default)]
    pub preview_sync_mode: PreviewSyncMode,
    /// Sampling budget for blur-heavy preview effects.
    #[serde(default)]
    pub preview_effect_quality: crate::compositor::effects::EffectQuality,
    /// Native decoded frame cache policy. `custom + 0 MB` disables the rotating cache window.
    #[serde(default)]
    pub frame_cache_mode: NativeFrameCacheMode,
    /// Custom per-layer native decoded frame cache budget in MB when `frame_cache_mode=custom`.
    #[serde(default)]
    pub frame_cache_custom_mb: u32,
    /// Enabled video master effects applied to the final composited frame.
    #[serde(default)]
    #[ts(type = "import('~/effects').VideoEffectSpec[]")]
    pub master_effects: Vec<crate::compositor::effects::EffectSpec>,
    /// Enabled audio master effects applied post-mix on the master bus.
    #[serde(default)]
    pub audio_master_effects: Vec<AudioEffectSpec>,
}

fn default_fps() -> f64 {
    30.0
}

/// Guard against running past the end of the available source range: the last
/// "readable" PTS = the range end minus this gap (1 ms), otherwise the seek/decoder
/// could request a frame past EOF.
const SOURCE_END_GUARD_SEC: f64 = 0.001;
fn default_blend() -> BlendMode {
    BlendMode::Normal
}

impl SceneLayer {
    pub fn covers(&self, timeline_sec: f64) -> bool {
        timeline_sec >= self.timeline_start_sec && timeline_sec < self.timeline_end_sec
    }

    pub fn source_pts_at(&self, timeline_sec: f64) -> f64 {
        compute_source_pts_at(
            timeline_sec,
            self.timeline_start_sec,
            self.timeline_end_sec,
            self.source_start_sec,
            self.source_range_duration_sec,
            self.speed,
            self.freeze_frame_source_sec,
        )
    }

    /// Source PTS for this layer when it is the FROM side of a transition that runs
    /// past its own `timeline_end_sec` (the transition overlap lives in the *next*
    /// clip's `transition_in` window). Unlike [`source_pts_at`], which clamps to the
    /// trimmed range and would therefore freeze the outgoing clip, this continues
    /// into the clip's handle/tail material so the outgoing side keeps playing during
    /// the transition — matching the web compositor (`TransitionRenderer`).
    ///
    /// Only meaningful for `timeline_sec >= timeline_end_sec`. The result is clamped
    /// to the real media bounds so we never seek past EOF (or before frame 0 on
    /// reverse). When the full media duration is unknown, or there is no tail beyond
    /// the trim, the last visible frame is held (the previous native behaviour).
    pub fn transition_tail_source_pts_at(&self, timeline_sec: f64) -> f64 {
        if let Some(freeze) = self.freeze_frame_source_sec {
            return freeze.max(0.0);
        }
        let speed = sanitize_clip_speed(self.speed);
        let abs_speed = speed.abs();
        let source_range =
            if self.source_range_duration_sec.is_finite() && self.source_range_duration_sec > 0.0 {
                self.source_range_duration_sec
            } else {
                (self.timeline_end_sec - self.timeline_start_sec).max(0.0) * abs_speed
            };
        // Seconds spent past this clip's visible end, mapped into source time.
        let extra = (timeline_sec - self.timeline_end_sec).max(0.0) * abs_speed;

        if speed < 0.0 {
            // Reverse: the visible out-point sits at `source_start_sec`; the tail
            // continues backwards toward the start of the media (never below 0,
            // never forward past the out-point).
            let hi = self.source_start_sec.max(0.0);
            (self.source_start_sec - extra).clamp(0.0, hi)
        } else {
            // Forward: continue past the visible out-point into the trailing handle.
            let visible_end = self.source_start_sec + source_range;
            // Lower bound = last visible frame, so we never jump backwards at the cut.
            let lo = (visible_end - SOURCE_END_GUARD_SEC).max(0.0);
            match self.source_duration_sec {
                Some(dur) if dur.is_finite() && dur > 0.0 => {
                    let hi = (dur - SOURCE_END_GUARD_SEC).max(lo);
                    (visible_end + extra).clamp(lo, hi)
                }
                // Unknown media duration: cannot read past the trim safely → hold.
                _ => lo,
            }
        }
    }

    /// Source PTS for this layer when it is the *incoming* (`to`) side of a
    /// transition that runs *before* its own `timeline_start_sec` — i.e. the next
    /// clip composited during the previous clip's `transition_out` window. Mirrors
    /// [`transition_tail_source_pts_at`] but for the leading handle: it reads the
    /// frames *before* the trim-in point so the incoming clip rolls up to its first
    /// visible frame exactly at the cut (matching the web `TransitionRenderer`
    /// `isNextClip` branch), instead of freezing on the in-point or jumping to the
    /// tail. Only meaningful for `timeline_sec <= timeline_start_sec`.
    pub fn transition_head_source_pts_at(&self, timeline_sec: f64) -> f64 {
        if let Some(freeze) = self.freeze_frame_source_sec {
            return freeze.max(0.0);
        }
        let speed = sanitize_clip_speed(self.speed);
        let abs_speed = speed.abs();
        let source_range =
            if self.source_range_duration_sec.is_finite() && self.source_range_duration_sec > 0.0 {
                self.source_range_duration_sec
            } else {
                (self.timeline_end_sec - self.timeline_start_sec).max(0.0) * abs_speed
            };
        // Seconds before this clip's visible start, mapped into source time.
        let lead = (self.timeline_start_sec - timeline_sec).max(0.0) * abs_speed;

        if speed < 0.0 {
            // Reverse: the visible in-point sits at `source_start + range`; the
            // leading handle continues forward toward the media end (never past EOF).
            let visible_in = self.source_start_sec + source_range;
            match self.source_duration_sec {
                Some(dur) if dur.is_finite() && dur - SOURCE_END_GUARD_SEC > visible_in => {
                    let hi = dur - SOURCE_END_GUARD_SEC;
                    (visible_in + lead).clamp(visible_in, hi)
                }
                // No handle past the in-point (or unknown duration): hold first frame.
                _ => visible_in,
            }
        } else {
            // Forward: the visible in-point sits at `source_start`; the leading
            // handle reads earlier frames (before the trim-in), never below 0.
            if self.source_start_sec <= SOURCE_END_GUARD_SEC {
                // No handle before the in-point → hold the first frame.
                self.source_start_sec.max(0.0)
            } else {
                (self.source_start_sec - lead).max(0.0)
            }
        }
    }

    /// Source PTS for a layer acting as the FROM/source side of a transition it does
    /// not currently `covers`. Picks the trailing handle when `t` is past the clip
    /// (outgoing clip, an `in` transition's source) or the leading handle when `t`
    /// is before it (incoming next clip, an `out` transition's source).
    pub fn transition_peer_source_pts_at(&self, timeline_sec: f64) -> f64 {
        if timeline_sec < self.timeline_start_sec {
            self.transition_head_source_pts_at(timeline_sec)
        } else {
            self.transition_tail_source_pts_at(timeline_sec)
        }
    }
}

/// Shared implementation of source PTS computation for both video and audio layers.
fn compute_source_pts_at(
    timeline_sec: f64,
    timeline_start_sec: f64,
    timeline_end_sec: f64,
    source_start_sec: f64,
    source_range_duration_sec: f64,
    speed: f64,
    freeze_frame_source_sec: Option<f64>,
) -> f64 {
    if let Some(freeze) = freeze_frame_source_sec {
        return freeze.max(0.0);
    }

    let local = (timeline_sec - timeline_start_sec).max(0.0);
    let speed = sanitize_clip_speed(speed);
    let abs_speed = speed.abs();
    let source_range = if source_range_duration_sec.is_finite() && source_range_duration_sec > 0.0 {
        source_range_duration_sec
    } else {
        (timeline_end_sec - timeline_start_sec).max(0.0) * abs_speed
    };
    let last_readable = (source_range - SOURCE_END_GUARD_SEC).max(0.0);
    let source_delta = local * abs_speed;
    let source_offset = if speed < 0.0 {
        (last_readable - source_delta).clamp(0.0, last_readable)
    } else {
        source_delta.clamp(0.0, last_readable)
    };

    (source_start_sec + source_offset).max(0.0)
}

fn sanitize_clip_speed(speed: f64) -> f64 {
    if speed.is_finite() && speed != 0.0 {
        speed.clamp(-10.0, 10.0)
    } else {
        1.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layer(start: f64, end: f64, source_start: f64) -> SceneLayer {
        SceneLayer {
            id: "x".into(),
            kind: LayerKind::Video,
            path: "/tmp/x".into(),
            timeline_start_sec: start,
            timeline_end_sec: end,
            source_start_sec: source_start,
            source_range_duration_sec: (end - start).max(0.0),
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
            transition_in: None,
            transition_out: None,
            effects: Vec::new(),
        }
    }

    #[test]
    fn covers_is_half_open_interval() {
        let l = layer(2.0, 5.0, 0.0);
        assert!(!l.covers(1.999));
        assert!(l.covers(2.0));
        assert!(l.covers(4.999));
        assert!(!l.covers(5.0));
    }

    #[test]
    fn source_pts_at_offsets_by_timeline_start() {
        let l = layer(10.0, 20.0, 3.5);
        assert!((l.source_pts_at(10.0) - 3.5).abs() < 1e-9);
        assert!((l.source_pts_at(12.0) - 5.5).abs() < 1e-9);
    }

    #[test]
    fn source_pts_at_applies_speed_and_reverse() {
        let mut l = layer(10.0, 20.0, 3.5);
        l.source_range_duration_sec = 20.0;
        l.speed = 2.0;
        assert!((l.source_pts_at(12.0) - 7.5).abs() < 1e-9);

        l.speed = -2.0;
        assert!((l.source_pts_at(10.0) - 23.499).abs() < 1e-9);
        assert!((l.source_pts_at(12.0) - 19.499).abs() < 1e-9);
    }

    #[test]
    fn source_pts_at_uses_freeze_frame() {
        let mut l = layer(10.0, 20.0, 3.5);
        l.speed = 2.0;
        l.freeze_frame_source_sec = Some(8.25);
        assert_eq!(l.source_pts_at(15.0), 8.25);
    }

    #[test]
    fn source_pts_clamps_to_zero_before_timeline_start() {
        let l = layer(10.0, 20.0, 0.0);
        assert_eq!(l.source_pts_at(5.0), 0.0);
    }

    /// Cross-engine parity contract. This test and the web test
    /// `test/unit/utils/video-editor/source-time.parity.test.ts` read the SAME
    /// fixture, so `SceneLayer::source_pts_at` and the web `resolveClipSourceTimeUs`
    /// can never drift apart on the shared algorithm.
    #[test]
    fn clip_source_pts_matches_shared_parity_fixture() {
        const FIXTURE: &str = include_str!("../../../../shared/parity/clip-source-pts.cases.json");
        let parsed: Value = serde_json::from_str(FIXTURE).expect("valid parity fixture json");
        let guard = parsed["guardSec"].as_f64().expect("guardSec");
        assert!(
            (guard - SOURCE_END_GUARD_SEC).abs() < 1e-12,
            "fixture guard must equal SOURCE_END_GUARD_SEC"
        );
        let cases = parsed["cases"].as_array().expect("cases array");
        assert!(!cases.is_empty(), "fixture has cases");
        for c in cases {
            let name = c["name"].as_str().unwrap_or("?");
            let mut l = layer(
                c["timelineStartSec"].as_f64().unwrap(),
                c["timelineEndSec"].as_f64().unwrap(),
                c["sourceStartSec"].as_f64().unwrap(),
            );
            l.source_range_duration_sec = c["sourceRangeDurationSec"].as_f64().unwrap();
            l.speed = c["speed"].as_f64().unwrap();
            let got = l.source_pts_at(c["timelineSec"].as_f64().unwrap());
            let want = c["expectedSourceSec"].as_f64().unwrap();
            assert!(
                (got - want).abs() < 1e-6,
                "case `{name}`: got {got}, want {want}"
            );
        }
    }

    #[test]
    fn transition_tail_plays_into_handle_when_duration_known() {
        // Clip shows source [2..5] on timeline [10..13]; media is 30s long, so there
        // is plenty of tail. During a transition that runs past t=13 the outgoing
        // clip must keep advancing past its out-point (5.0) instead of freezing.
        let mut l = layer(10.0, 13.0, 2.0);
        l.source_range_duration_sec = 3.0;
        l.source_duration_sec = Some(30.0);
        // At the cut it sits on the out-point (decoder serves the last visible frame).
        assert!((l.transition_tail_source_pts_at(13.0) - 5.0).abs() < 1e-6);
        // Half a second into the transition it has advanced into the tail.
        assert!((l.transition_tail_source_pts_at(13.5) - 5.5).abs() < 1e-6);
        assert!((l.transition_tail_source_pts_at(14.0) - 6.0).abs() < 1e-6);
    }

    #[test]
    fn transition_tail_holds_last_frame_without_handle() {
        // Out-point == end of media: no tail available → hold the last frame.
        let mut l = layer(10.0, 13.0, 2.0);
        l.source_range_duration_sec = 3.0;
        l.source_duration_sec = Some(5.0); // 2.0 + 3.0 == media end
        let held = l.transition_tail_source_pts_at(13.0);
        assert!((l.transition_tail_source_pts_at(14.0) - held).abs() < 1e-9);
        assert!(held <= 5.0);
    }

    #[test]
    fn transition_tail_holds_last_frame_when_duration_unknown() {
        let mut l = layer(10.0, 13.0, 2.0);
        l.source_range_duration_sec = 3.0;
        l.source_duration_sec = None;
        let held = l.transition_tail_source_pts_at(13.0);
        assert!((l.transition_tail_source_pts_at(20.0) - held).abs() < 1e-9);
    }

    #[test]
    fn transition_tail_reverse_continues_toward_media_start() {
        // Reverse clip: visible out-point at the cut sits at source_start (2.0); the
        // tail continues backwards toward 0, never forward past 2.0.
        let mut l = layer(10.0, 13.0, 2.0);
        l.source_range_duration_sec = 3.0;
        l.source_duration_sec = Some(30.0);
        l.speed = -1.0;
        assert!((l.transition_tail_source_pts_at(13.0) - 2.0).abs() < 1e-9);
        assert!((l.transition_tail_source_pts_at(13.5) - 1.5).abs() < 1e-9);
        assert_eq!(l.transition_tail_source_pts_at(20.0), 0.0);
    }

    #[test]
    fn transition_tail_uses_freeze_frame() {
        let mut l = layer(10.0, 13.0, 2.0);
        l.source_duration_sec = Some(30.0);
        l.freeze_frame_source_sec = Some(7.25);
        assert_eq!(l.transition_tail_source_pts_at(14.0), 7.25);
    }

    #[test]
    fn transition_head_rolls_into_leading_handle() {
        // Incoming clip shows source [4..7] on timeline [13..16]. It is the `to` side
        // of the previous clip's out transition over [12..13]. Before its start it
        // must roll its leading handle up to the in-point (4.0) exactly at the cut,
        // not freeze on 4.0 nor jump to its tail.
        let mut l = layer(13.0, 16.0, 4.0);
        l.source_range_duration_sec = 3.0;
        l.source_duration_sec = Some(30.0);
        // At the cut it sits exactly on the in-point.
        assert!((l.transition_head_source_pts_at(13.0) - 4.0).abs() < 1e-6);
        // Half a second before the cut it is half a second into the leading handle.
        assert!((l.transition_head_source_pts_at(12.5) - 3.5).abs() < 1e-6);
        assert!((l.transition_head_source_pts_at(12.0) - 3.0).abs() < 1e-6);
    }

    #[test]
    fn transition_head_holds_first_frame_without_leading_handle() {
        // In-point at the very start of the media: no leading handle → hold frame 0.
        let mut l = layer(13.0, 16.0, 0.0);
        l.source_range_duration_sec = 3.0;
        l.source_duration_sec = Some(30.0);
        assert_eq!(l.transition_head_source_pts_at(13.0), 0.0);
        assert_eq!(l.transition_head_source_pts_at(12.0), 0.0);
    }

    #[test]
    fn transition_head_clamps_to_zero_deep_into_handle() {
        let mut l = layer(13.0, 16.0, 1.0);
        l.source_range_duration_sec = 3.0;
        l.source_duration_sec = Some(30.0);
        // 2s of lead, only 1s of handle available before the in-point → clamps at 0.
        assert_eq!(l.transition_head_source_pts_at(11.0), 0.0);
    }

    #[test]
    fn transition_head_reverse_continues_toward_media_end() {
        // Reverse clip: visible in-point at the cut sits at source_start + range
        // (4+3=7); the leading handle continues forward toward the media end.
        let mut l = layer(13.0, 16.0, 4.0);
        l.source_range_duration_sec = 3.0;
        l.source_duration_sec = Some(30.0);
        l.speed = -1.0;
        assert!((l.transition_head_source_pts_at(13.0) - 7.0).abs() < 1e-9);
        assert!((l.transition_head_source_pts_at(12.5) - 7.5).abs() < 1e-9);
    }

    #[test]
    fn transition_peer_picks_head_before_start_and_tail_after_end() {
        let mut l = layer(13.0, 16.0, 4.0);
        l.source_range_duration_sec = 3.0;
        l.source_duration_sec = Some(30.0);
        // Before its start → leading handle.
        assert!(
            (l.transition_peer_source_pts_at(12.5) - l.transition_head_source_pts_at(12.5)).abs()
                < 1e-9
        );
        // After its end → trailing handle.
        assert!(
            (l.transition_peer_source_pts_at(16.5) - l.transition_tail_source_pts_at(16.5)).abs()
                < 1e-9
        );
    }

    #[test]
    fn deserializes_virtual_layer_fields() {
        let json = r##"{
            "id": "text-1",
            "kind": "text",
            "timeline_start_sec": 0.0,
            "timeline_end_sec": 5.0,
            "source_start_sec": 0.0,
            "source_range_duration_sec": 5.0,
            "speed": 1.0,
            "z": 10,
            "opacity": 0.75,
            "blend_mode": "screen",
            "text": "Hello",
            "style": { "fontSize": 72, "color": "#ff00aa" }
        }"##;
        let layer: SceneLayer = serde_json::from_str(json).unwrap();
        assert_eq!(layer.kind, LayerKind::Text);
        assert_eq!(layer.path, "");
        assert_eq!(layer.blend_mode, BlendMode::Screen);
        assert_eq!(layer.text.as_deref(), Some("Hello"));
        assert_eq!(layer.style.unwrap()["fontSize"], 72);
    }

    #[test]
    fn deserializes_native_kebab_case_blend_modes() {
        let json = r##"{
            "id": "video-1",
            "kind": "video",
            "path": "/tmp/video.mp4",
            "timeline_start_sec": 0.0,
            "timeline_end_sec": 5.0,
            "source_start_sec": 0.0,
            "source_range_duration_sec": 5.0,
            "speed": 1.0,
            "z": 10,
            "opacity": 1.0,
            "blend_mode": "soft-light"
        }"##;
        let layer: SceneLayer = serde_json::from_str(json).unwrap();
        assert_eq!(layer.blend_mode, BlendMode::SoftLight);
    }

    fn audio_layer(start: f64, end: f64, source_start: f64) -> SceneAudioLayer {
        SceneAudioLayer {
            id: "a".into(),
            track_id: None,
            path: "/tmp/a.wav".into(),
            timeline_start_sec: start,
            timeline_end_sec: end,
            source_start_sec: source_start,
            source_range_duration_sec: (end - start).max(0.0),
            speed: 1.0,
            audio_gain: 1.0,
            audio_balance: 0.0,
            audio_fade_in_sec: 0.0,
            audio_fade_out_sec: 0.0,
            audio_fade_in_curve: AudioFadeCurve::Linear,
            audio_fade_out_curve: AudioFadeCurve::Linear,
            audio_effects: vec![],
        }
    }

    #[test]
    fn audio_source_pts_at_offsets_by_timeline_start() {
        let l = audio_layer(10.0, 20.0, 3.5);
        assert!((l.source_pts_at(10.0) - 3.5).abs() < 1e-9);
        assert!((l.source_pts_at(12.0) - 5.5).abs() < 1e-9);
    }

    #[test]
    fn audio_source_pts_at_applies_speed_and_reverse() {
        let mut l = audio_layer(10.0, 20.0, 3.5);
        l.source_range_duration_sec = 20.0;
        l.speed = 2.0;
        assert!((l.source_pts_at(12.0) - 7.5).abs() < 1e-9);

        l.speed = -2.0;
        assert!((l.source_pts_at(10.0) - 23.499).abs() < 1e-9);
        assert!((l.source_pts_at(12.0) - 19.499).abs() < 1e-9);
    }

    #[test]
    fn audio_source_pts_clamps_to_zero_before_timeline_start() {
        let l = audio_layer(10.0, 20.0, 0.0);
        assert_eq!(l.source_pts_at(5.0), 0.0);
    }
}
