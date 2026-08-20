//! Global limiter for long-running native media jobs.
//!
//! `spawn_blocking` keeps Tauri's async runtime responsive, but it does not bound
//! how many FFmpeg/export jobs the UI can start at once. This gate caps the total
//! number of heavy media jobs and reserves one slot for foreground timeline export
//! so background proxy/conversion work cannot starve an explicit user export.

use std::sync::OnceLock;
use std::time::Duration;

use parking_lot::{Condvar, Mutex};

const ACQUIRE_POLL_MS: u64 = 100;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum MediaJobPriority {
    Foreground,
    Background,
}

pub struct MediaJobGate {
    permits: Mutex<usize>,
    available: Condvar,
    foreground_reserved: usize,
}

impl MediaJobGate {
    fn new(permits: usize) -> Self {
        let permits = permits.max(1);
        Self {
            permits: Mutex::new(permits),
            available: Condvar::new(),
            foreground_reserved: 1usize.min(permits.saturating_sub(1)),
        }
    }

    pub fn acquire(
        &self,
        priority: MediaJobPriority,
        cancel: &dyn Fn() -> bool,
    ) -> Option<MediaJobPermit<'_>> {
        let mut guard = self.permits.lock();
        loop {
            if cancel() {
                return None;
            }

            let can_acquire = match priority {
                MediaJobPriority::Foreground => *guard > 0,
                MediaJobPriority::Background => *guard > self.foreground_reserved,
            };

            if can_acquire {
                *guard -= 1;
                return Some(MediaJobPermit { gate: self });
            }

            let _ = self
                .available
                .wait_for(&mut guard, Duration::from_millis(ACQUIRE_POLL_MS));
        }
    }

    fn release(&self) {
        let mut guard = self.permits.lock();
        *guard += 1;
        self.available.notify_all();
    }
}

pub struct MediaJobPermit<'a> {
    gate: &'a MediaJobGate,
}

impl Drop for MediaJobPermit<'_> {
    fn drop(&mut self) {
        self.gate.release();
    }
}

static MEDIA_JOB_GATE: OnceLock<MediaJobGate> = OnceLock::new();

pub fn media_job_gate() -> &'static MediaJobGate {
    MEDIA_JOB_GATE.get_or_init(|| MediaJobGate::new(default_permits()))
}

fn default_permits() -> usize {
    std::thread::available_parallelism()
        .map(|n| (n.get() / 2).clamp(2, 4))
        .unwrap_or(2)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};

    #[test]
    fn background_keeps_foreground_reserve_free() {
        let gate = MediaJobGate::new(2);
        let _bg = gate
            .acquire(MediaJobPriority::Background, &|| false)
            .expect("first background acquires non-reserved slot");

        let cancelled = AtomicBool::new(false);
        std::thread::scope(|s| {
            s.spawn(|| {
                std::thread::sleep(Duration::from_millis(30));
                cancelled.store(true, Ordering::Relaxed);
            });
            let second = gate.acquire(MediaJobPriority::Background, &|| {
                cancelled.load(Ordering::Relaxed)
            });
            assert!(second.is_none());
        });
    }

    #[test]
    fn foreground_can_use_reserved_slot() {
        let gate = MediaJobGate::new(2);
        let _bg = gate
            .acquire(MediaJobPriority::Background, &|| false)
            .expect("background acquires non-reserved slot");
        let fg = gate.acquire(MediaJobPriority::Foreground, &|| false);
        assert!(fg.is_some());
    }
}
