use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

/// Lock-free clock/state shared with the real-time output callback. The audio
/// callback must never block on a mutex, so playback state and frame counters
/// live in atomics that the callback reads/writes without locking.
pub(crate) struct RealtimeClock {
    pub(crate) playing: AtomicBool,
    pub(crate) frames_written: AtomicU64,
    // f64 output latency (seconds) stored as raw bits for atomic access.
    pub(crate) output_latency_bits: AtomicU64,
    // f64 monitor output gain stored as raw bits for the real-time callback.
    // This is intentionally post-mix so monitor volume/mute applies immediately
    // to already-buffered ring samples and never affects export/master-bus data.
    pub(crate) output_gain_bits: AtomicU64,
    // Linear post-output RMS/peak levels. Written by the real-time callback and
    // read by the monitor event loop for UI meters.
    pub(crate) output_rms_bits: AtomicU64,
    pub(crate) output_peak_bits: AtomicU64,
    // Underrun instrumentation. The real-time callback only increments these
    // (Relaxed, never blocks); the producer thread reads + logs them throttled.
    // `underrun_events` counts callbacks that found the ring short of the
    // requested frame count; `underrun_frames` is the total silent frames
    // emitted as a result. Both are cumulative since the last `reset_frames`.
    pub(crate) underrun_events: AtomicU64,
    pub(crate) underrun_frames: AtomicU64,
}

impl Default for RealtimeClock {
    fn default() -> Self {
        Self {
            playing: AtomicBool::default(),
            frames_written: AtomicU64::default(),
            output_latency_bits: AtomicU64::default(),
            output_gain_bits: AtomicU64::new(1.0f64.to_bits()),
            output_rms_bits: AtomicU64::default(),
            output_peak_bits: AtomicU64::default(),
            underrun_events: AtomicU64::default(),
            underrun_frames: AtomicU64::default(),
        }
    }
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

    pub(crate) fn set_output_gain(&self, gain: f64) {
        let sanitized = if gain.is_finite() {
            gain.clamp(0.0, 10.0)
        } else {
            1.0
        };
        self.output_gain_bits
            .store(sanitized.to_bits(), Ordering::Release);
    }

    pub(crate) fn output_gain(&self) -> f64 {
        f64::from_bits(self.output_gain_bits.load(Ordering::Acquire))
    }

    pub(crate) fn set_output_levels(&self, rms: f64, peak: f64) {
        let rms = if rms.is_finite() { rms.max(0.0) } else { 0.0 };
        let peak = if peak.is_finite() { peak.max(0.0) } else { 0.0 };
        self.output_rms_bits.store(rms.to_bits(), Ordering::Release);
        self.output_peak_bits
            .store(peak.to_bits(), Ordering::Release);
    }

    pub(crate) fn output_levels_db(&self) -> (f64, f64) {
        fn to_db(linear: f64) -> f64 {
            if linear > 0.001 {
                20.0 * linear.log10()
            } else {
                -60.0
            }
        }

        let rms = f64::from_bits(self.output_rms_bits.load(Ordering::Acquire));
        let peak = f64::from_bits(self.output_peak_bits.load(Ordering::Acquire));
        (to_db(rms), to_db(peak))
    }
}
