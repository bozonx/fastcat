use std::sync::Arc;

use parking_lot::{Condvar, Mutex};

use super::{
    decode_range_symphonia, is_no_audio_track_error, path_known_silent, remember_silent_path,
};
use crate::audio::shared::{AudioShared, AudioWindow, SilentTail, WINDOW_SEC};

/// Maximum number of concurrent bounded background decodes.
pub(super) const WINDOW_FILL_MAX_CONCURRENCY: usize = 2;
/// Extra concurrency slot reserved for Live-priority fills so they are never
/// blocked by Speculative fills already in flight.
pub(super) const LIVE_RESERVE_SLOTS: usize = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WindowFillPriority {
    Live,
    Speculative,
}

pub(crate) fn spawn_window_fill(
    shared: &Arc<(Mutex<AudioShared>, Condvar)>,
    layer_id: &str,
    path: &str,
    target_start_frame: usize,
    sample_rate: u32,
    output_channels: usize,
    priority: WindowFillPriority,
) {
    {
        let mut state = shared.0.lock();
        if state.window_fill_in_flight.get(layer_id) == Some(&target_start_frame) {
            return;
        }
        // Speculative fills are capped at MAX_CONCURRENCY. Live fills can exceed
        // the cap by LIVE_RESERVE_SLOTS so they are never blocked by speculative
        // fills already in flight.
        let active = state.active_window_fill_count;
        let cap = match priority {
            WindowFillPriority::Live => WINDOW_FILL_MAX_CONCURRENCY + LIVE_RESERVE_SLOTS,
            WindowFillPriority::Speculative => WINDOW_FILL_MAX_CONCURRENCY,
        };
        if active >= cap {
            return;
        }
        state
            .window_fill_in_flight
            .insert(layer_id.to_string(), target_start_frame);
        state.active_window_fill_count += 1;
    }

    let shared_thread = shared.clone();
    let layer_id_thread = layer_id.to_string();
    let path_thread = path.to_string();
    let spawned = std::thread::Builder::new()
        .name("fastcat-audio-window-fill".into())
        .spawn(move || {
            window_fill(
                shared_thread,
                layer_id_thread,
                path_thread,
                target_start_frame,
                sample_rate,
                output_channels,
            );
        });
    if spawned.is_err() {
        let mut state = shared.0.lock();
        if state.window_fill_in_flight.get(layer_id) == Some(&target_start_frame) {
            state.window_fill_in_flight.remove(layer_id);
        }
        state.active_window_fill_count = state.active_window_fill_count.saturating_sub(1);
        log::warn!("[audio] failed to spawn audio window fill for {path}");
    }
}

struct WindowFillGuard {
    shared: Arc<(Mutex<AudioShared>, Condvar)>,
    layer_id: String,
    start_frame: usize,
}

impl Drop for WindowFillGuard {
    fn drop(&mut self) {
        let mut state = self.shared.0.lock();
        if state.window_fill_in_flight.get(&self.layer_id) == Some(&self.start_frame) {
            state.window_fill_in_flight.remove(&self.layer_id);
        }
        state.active_window_fill_count = state.active_window_fill_count.saturating_sub(1);
        self.shared.1.notify_all();
    }
}

fn window_fill(
    shared: Arc<(Mutex<AudioShared>, Condvar)>,
    layer_id: String,
    path: String,
    target_start_frame: usize,
    sample_rate: u32,
    output_channels: usize,
) {
    let _guard = WindowFillGuard {
        shared: shared.clone(),
        layer_id: layer_id.clone(),
        start_frame: target_start_frame,
    };

    {
        let state = shared.0.lock();
        if path_known_silent(&state, &path) {
            return;
        }
    }

    let start_sec = target_start_frame as f64 / sample_rate.max(1) as f64;
    match decode_range_symphonia(&path, start_sec, WINDOW_SEC, sample_rate, output_channels) {
        Ok(samples) if !samples.is_empty() => {
            let window = AudioWindow {
                path: path.clone(),
                source_start_frame: target_start_frame,
                sample_rate,
                channels: output_channels,
                samples: Arc::new(samples),
            };
            let mut state = shared.0.lock();
            // Discard the result if the layer was removed from a non-empty scene
            // while the decode was running (seek, scene change, clip delete).
            // An empty scene (test default / not-yet-set) is allowed through.
            if !state.scene.is_empty() && !state.scene.iter().any(|l| l.id == layer_id) {
                return;
            }
            if state.window_fill_in_flight.get(&layer_id) == Some(&target_start_frame) {
                state.layer_windows.insert(layer_id.clone(), window);
                // A real window landed for this layer: any earlier "known silent
                // past here" boundary was wrong (e.g. a media replace lengthened
                // the track) and must not keep shadowing genuine audio.
                state.silent_tails.remove(&layer_id);
                shared.1.notify_all();
            }
        }
        Ok(_) => {
            // The source has no audio at/after `target_start_frame`. Cache this so
            // later requests in that range skip the fill spawn + file re-probe
            // entirely instead of repeating this exact decode (and the wasted
            // thread spawn around it) on every subsequent chunk forever.
            let mut state = shared.0.lock();
            if !state.scene.is_empty() && !state.scene.iter().any(|l| l.id == layer_id) {
                return;
            }
            if state.window_fill_in_flight.get(&layer_id) == Some(&target_start_frame) {
                let start_frame = state
                    .silent_tails
                    .get(&layer_id)
                    .filter(|tail| tail.path == path)
                    .map(|tail| tail.start_frame.min(target_start_frame))
                    .unwrap_or(target_start_frame);
                state.silent_tails.insert(
                    layer_id,
                    SilentTail {
                        path: path.clone(),
                        sample_rate,
                        channels: output_channels,
                        start_frame,
                    },
                );
            }
        }
        Err(error) if is_no_audio_track_error(&error) => {
            let mut state = shared.0.lock();
            remember_silent_path(&mut state, &path);
        }
        Err(error) => log::warn!("[audio] audio window fill failed for {path}: {error:?}"),
    }
}
