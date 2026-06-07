use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

/// Lock-free clock/state shared with the real-time output callback. The audio
/// callback must never block on a mutex, so playback state and frame counters
/// live in atomics that the callback reads/writes without locking.
#[derive(Default)]
pub(crate) struct RealtimeClock {
    pub(crate) playing: AtomicBool,
    pub(crate) frames_written: AtomicU64,
    // f64 output latency (seconds) stored as raw bits for atomic access.
    pub(crate) output_latency_bits: AtomicU64,
    // Underrun instrumentation. The real-time callback only increments these
    // (Relaxed, never blocks); the producer thread reads + logs them throttled.
    // `underrun_events` counts callbacks that found the ring short of the
    // requested frame count; `underrun_frames` is the total silent frames
    // emitted as a result. Both are cumulative since the last `reset_frames`.
    pub(crate) underrun_events: AtomicU64,
    pub(crate) underrun_frames: AtomicU64,
}

impl RealtimeClock {
    pub(crate) fn reset_frames(&self) {
        self.frames_written.store(0, Ordering::Release);
        self.output_latency_bits.store(0, Ordering::Release);
        self.underrun_events.store(0, Ordering::SeqCst);
        self.underrun_frames.store(0, Ordering::SeqCst);
    }

    pub(crate) fn frames(&self) -> u64 {
        self.frames_written.load(Ordering::Acquire)
    }

    pub(crate) fn output_latency_sec(&self) -> f64 {
        f64::from_bits(self.output_latency_bits.load(Ordering::Acquire))
    }
}
