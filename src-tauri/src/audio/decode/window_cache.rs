use std::sync::Arc;

use parking_lot::{Condvar, Mutex};

use super::{
    decode_range_symphonia, is_no_audio_track_error, path_known_silent, remember_silent_path,
};
use crate::audio::shared::{AudioShared, AudioWindow, WINDOW_SEC};

/// Maximum number of concurrent bounded background decodes.
pub(super) const WINDOW_FILL_MAX_CONCURRENCY: usize = 2;

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
        if priority == WindowFillPriority::Speculative
            && state.active_window_fill_count >= WINDOW_FILL_MAX_CONCURRENCY
        {
            return;
        }
        if state.active_window_fill_count >= WINDOW_FILL_MAX_CONCURRENCY {
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

    if path_known_silent(&path) {
        return;
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
            if state.window_fill_in_flight.get(&layer_id) == Some(&target_start_frame) {
                state.layer_windows.insert(layer_id, window);
                shared.1.notify_all();
            }
        }
        Ok(_) => {}
        Err(error) if is_no_audio_track_error(&error) => remember_silent_path(&path),
        Err(error) => log::warn!("[audio] audio window fill failed for {path}: {error:?}"),
    }
}
