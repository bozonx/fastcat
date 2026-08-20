//! Global concurrency limiter for "heavy" media-open operations.
//!
//! Each video layer, on load, runs `ffprobe` + spawns `ffmpeg` + does an initial decode —
//! a burst of CPU/processes. With a scene of many video/image/svg layers (or during fast
//! scrubbing, when layers appear/disappear often), without a limiter just as many parallel
//! heavy opens would start. The semaphore caps the number of CONCURRENT opens; the
//! continuing decode lives in its own thread without a permit (the number of live ffmpeg
//! processes is still bounded by the number of simultaneously visible video layers).
//!
//! This is the native analogue of the browser `io-governor` idea (see `src/utils/io/`), but
//! without `SharedArrayBuffer`/OPFS semantics: in Tauri filesystem access is direct, so what
//! must be limited is decoder/process parallelism, not Chromium data pipes.
//!
//! Audio is intentionally NOT routed through this gate — it has its own bounded
//! windowed look-ahead (audio/shared.rs, WINDOW_SEC=12). Do NOT route audio
//! through this semaphore to avoid creating contention with video/live loads.

use std::sync::OnceLock;
use std::time::Duration;

use parking_lot::{Condvar, Mutex};

const ACQUIRE_POLL_MS: u64 = 25;

/// Priority tier for acquiring a decoder load permit.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum LoadPriority {
    /// Live monitor layers (video/image/svg on the current timeline frame).
    /// Can acquire as long as any permit is available.
    Live,
    /// Background work (thumbnails, proxies). Only acquires when enough
    /// permits are free to leave the live reserve untouched.
    Background,
}

/// A simple counting semaphore (std has no blocking semaphore, tokio's is async
/// only; here we need a blocking one usable from plain threads).
pub struct Semaphore {
    permits: Mutex<usize>,
    available: Condvar,
    /// Permits reserved for `Live` priority. Background acquires only when
    /// `available > reserved`, so at least this many Live loads can always
    /// proceed even if Background tasks are queued.
    reserved: usize,
}

impl Semaphore {
    pub fn new(permits: usize) -> Self {
        let permits = permits.max(1);
        // Default reserve = 1, clamped so that at least 1 permit remains
        // available for Background when the machine has few cores.
        let reserved = 1usize.min(permits.saturating_sub(1));
        Self {
            permits: Mutex::new(permits),
            available: Condvar::new(),
            reserved,
        }
    }

    /// Attempt to acquire a permit, checking `cancel` at the start of every
    /// iteration. Returns `None` immediately if `cancel()` is true.
    pub fn acquire(
        &self,
        priority: LoadPriority,
        cancel: &dyn Fn() -> bool,
    ) -> Option<SemaphorePermit<'_>> {
        let mut guard = self.permits.lock();
        loop {
            if cancel() {
                return None;
            }
            let can_acquire = match priority {
                LoadPriority::Live => *guard > 0,
                LoadPriority::Background => *guard > self.reserved,
            };
            if can_acquire {
                *guard -= 1;
                return Some(SemaphorePermit { sem: self });
            }
            let _ = self
                .available
                .wait_for(&mut guard, Duration::from_millis(ACQUIRE_POLL_MS));
        }
    }

    fn release(&self) {
        let mut guard = self.permits.lock();
        *guard += 1;
        // notify_all: with a reserve, a waking Background may fail its predicate
        // and must yield to a waiting Live on its next iteration.
        self.available.notify_all();
    }
}

pub struct SemaphorePermit<'a> {
    sem: &'a Semaphore,
}

impl Drop for SemaphorePermit<'_> {
    fn drop(&mut self) {
        self.sem.release();
    }
}

/// Gate that limits the number of concurrent heavy decoder initialisations.
/// Backward-compatible wrapper around a [`Semaphore`].
pub struct DecoderLoadGate {
    sem: Semaphore,
}

impl Default for DecoderLoadGate {
    fn default() -> Self {
        Self {
            sem: Semaphore::new(default_permits()),
        }
    }
}

impl DecoderLoadGate {
    /// Backward-compatible wrapper: always Live priority, never cancelled.
    pub fn acquire(&self) -> SemaphorePermit<'_> {
        self.sem
            .acquire(LoadPriority::Live, &|| false)
            .expect("Live without cancel never fails")
    }

    /// Acquire with explicit priority and cancellation support.
    pub fn acquire_with_priority(
        &self,
        priority: LoadPriority,
        cancel: &dyn Fn() -> bool,
    ) -> Option<SemaphorePermit<'_>> {
        self.sem.acquire(priority, cancel)
    }
}

static DECODER_LOAD_GATE: OnceLock<DecoderLoadGate> = OnceLock::new();

/// Global gate for media-decoder opens. Lazily initialized from the core count.
pub fn decoder_load_gate() -> &'static DecoderLoadGate {
    DECODER_LOAD_GATE.get_or_init(DecoderLoadGate::default)
}

/// Half the logical cores, clamped to [2; 4]: enough for parallel loading without
/// saturating the CPU with a burst of simultaneous ffmpeg starts.
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
    fn live_acquires_when_available() {
        let sem = Semaphore::new(2);
        let p = sem.acquire(LoadPriority::Live, &|| false);
        assert!(p.is_some());
    }

    #[test]
    fn background_needs_reserve_free() {
        let sem = Semaphore::new(2);
        // Take the one non-reserved permit with Live.
        let _live = sem.acquire(LoadPriority::Live, &|| false);
        // Background cannot acquire because available (1) is not > reserved (1).
        // Use a cancel token to break out of the wait instead of deadlocking.
        let cancelled = AtomicBool::new(false);
        let sem_ref = &sem;
        std::thread::scope(|s| {
            s.spawn(|| {
                std::thread::sleep(Duration::from_millis(30));
                cancelled.store(true, Ordering::Relaxed);
            });
            let bg = sem_ref.acquire(LoadPriority::Background, &|| {
                cancelled.load(Ordering::Relaxed)
            });
            assert!(bg.is_none());
        });
    }

    #[test]
    fn background_acquires_when_fully_free() {
        let sem = Semaphore::new(2);
        let bg = sem.acquire(LoadPriority::Background, &|| false);
        assert!(bg.is_some());
    }

    #[test]
    fn cancel_returns_none_immediately() {
        let sem = Semaphore::new(1);
        let cancelled = AtomicBool::new(true);
        let p = sem.acquire(LoadPriority::Live, &|| cancelled.load(Ordering::Relaxed));
        assert!(p.is_none());
    }

    #[test]
    fn cancel_returns_none_after_waiting() {
        let sem = Semaphore::new(1);
        // Hold the only permit.
        let _holder = sem.acquire(LoadPriority::Live, &|| false);
        let cancelled = AtomicBool::new(false);
        let sem_ref = &sem;
        std::thread::scope(|s| {
            s.spawn(|| {
                std::thread::sleep(Duration::from_millis(50));
                cancelled.store(true, Ordering::Relaxed);
            });
            let p = sem_ref.acquire(LoadPriority::Live, &|| cancelled.load(Ordering::Relaxed));
            assert!(p.is_none());
        });
    }

    #[test]
    fn gate_backward_compatible_acquire() {
        let gate = DecoderLoadGate::default();
        let _permit = gate.acquire();
        // Live without cancel must always succeed when permits are available.
    }

    #[test]
    fn notify_all_wakes_waiters() {
        let sem = Semaphore::new(1);
        let _holder = sem.acquire(LoadPriority::Live, &|| false);
        let acquired = AtomicBool::new(false);
        let sem_ref = &sem;
        std::thread::scope(|s| {
            s.spawn(|| {
                let p = sem_ref.acquire(LoadPriority::Live, &|| false);
                if p.is_some() {
                    acquired.store(true, Ordering::Relaxed);
                }
            });
            std::thread::sleep(Duration::from_millis(30));
            drop(_holder);
        });
        assert!(acquired.load(Ordering::Relaxed));
    }
}
