//! Audio level (RMS / peak) telemetry emitted from the monitor to the frontend.
//!
//! Split out of `app.rs` so the `monitor:audio-levels` payload shapes and the
//! change-detection / throttling logic live next to each other, independent of the
//! winit event-loop coordinator.

use std::collections::HashMap;

use tauri::{AppHandle, Emitter};

use crate::audio::engine::NativeAudioEngine;

pub(crate) const EVT_AUDIO_LEVELS: &str = "monitor:audio-levels";

#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TrackLevelsPayload {
    rms_db: f64,
    peak_db: f64,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioLevelsPayload {
    rms_db: f64,
    peak_db: f64,
    tracks: HashMap<String, TrackLevelsPayload>,
}

/// Reads the current output/track levels from `audio` and emits a
/// `monitor:audio-levels` event, but only when they changed meaningfully since the
/// last emit (master ±0.1 dB, per-track ±0.5 dB, or a track set change). The
/// `last_levels` / `last_tracks` slots are updated in place to track the last emit.
pub(crate) fn emit_audio_levels(
    app: &AppHandle,
    audio: &NativeAudioEngine,
    last_levels: &mut (f64, f64),
    last_tracks: &mut HashMap<String, (f64, f64)>,
) {
    let (rms_db, peak_db) = audio.output_levels_db();
    let track_levels = audio.track_levels_db();

    if !levels_changed(rms_db, peak_db, &track_levels, last_levels, last_tracks) {
        return;
    }

    *last_levels = (rms_db, peak_db);
    *last_tracks = track_levels.clone();

    let tracks = track_levels
        .into_iter()
        .map(|(track_id, (rms, peak))| {
            (
                track_id,
                TrackLevelsPayload {
                    rms_db: rms,
                    peak_db: peak,
                },
            )
        })
        .collect();

    let _ = app.emit(
        EVT_AUDIO_LEVELS,
        AudioLevelsPayload {
            rms_db,
            peak_db,
            tracks,
        },
    );
}

/// dB value the meter falls to when audio is silent (e.g. on pause).
pub(crate) const LEVEL_FLOOR_DB: f64 = -60.0;

/// Pushes a single zeroed (`LEVEL_FLOOR_DB`) levels update with no tracks. Used on
/// pause so the UI meter falls to the floor instead of freezing at its last value.
pub(crate) fn emit_audio_levels_floor(app: &AppHandle) {
    let _ = app.emit(
        EVT_AUDIO_LEVELS,
        AudioLevelsPayload {
            rms_db: LEVEL_FLOOR_DB,
            peak_db: LEVEL_FLOOR_DB,
            tracks: HashMap::new(),
        },
    );
}

/// Whether levels moved enough to warrant a fresh emit. A NaN baseline (first emit)
/// always counts as changed.
fn levels_changed(
    rms_db: f64,
    peak_db: f64,
    track_levels: &HashMap<String, (f64, f64)>,
    last_levels: &(f64, f64),
    last_tracks: &HashMap<String, (f64, f64)>,
) -> bool {
    let (last_rms, last_peak) = *last_levels;
    if last_rms.is_nan() || last_peak.is_nan() {
        return true;
    }
    if (rms_db - last_rms).abs() > 0.1 || (peak_db - last_peak).abs() > 0.1 {
        return true;
    }
    if track_levels.len() != last_tracks.len() {
        return true;
    }
    for (tid, &(rms, peak)) in track_levels {
        match last_tracks.get(tid) {
            Some(&(l_rms, l_peak)) => {
                if (rms - l_rms).abs() > 0.5 || (peak - l_peak).abs() > 0.5 {
                    return true;
                }
            }
            None => return true,
        }
    }
    false
}
