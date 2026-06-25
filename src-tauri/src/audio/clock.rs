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
    // Set by the cpal error callback when the output stream fails fatally (device
    // lost, backend disconnect). Read by the engine's stall watchdog to trigger a
    // rebuild. Never reset here — a failed stream is replaced, not resurrected.
    pub(crate) stream_failed: AtomicBool,
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
            stream_failed: AtomicBool::default(),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_gain_is_one() {
        let clock = RealtimeClock::default();
        assert!((clock.output_gain() - 1.0).abs() < 1e-9);
    }

    #[test]
    fn set_output_gain_clamps_finite() {
        let clock = RealtimeClock::default();
        clock.set_output_gain(5.0);
        assert!((clock.output_gain() - 5.0).abs() < 1e-9);

        clock.set_output_gain(20.0);
        assert!((clock.output_gain() - 10.0).abs() < 1e-9);

        clock.set_output_gain(-3.0);
        assert!((clock.output_gain() - 0.0).abs() < 1e-9);
    }

    #[test]
    fn set_output_gain_nan_falls_back_to_one() {
        let clock = RealtimeClock::default();
        clock.set_output_gain(f64::NAN);
        assert!((clock.output_gain() - 1.0).abs() < 1e-9);

        clock.set_output_gain(f64::INFINITY);
        assert!((clock.output_gain() - 1.0).abs() < 1e-9);
    }

    #[test]
    fn set_output_levels_sanitizes_nan_and_negative() {
        let clock = RealtimeClock::default();
        clock.set_output_levels(f64::NAN, f64::INFINITY);
        let (rms, peak) = clock.output_levels_db();
        // NaN/Inf → 0.0 linear → -60 dB
        assert!((rms - (-60.0)).abs() < 1e-9);
        assert!((peak - (-60.0)).abs() < 1e-9);

        clock.set_output_levels(-0.5, -1.0);
        let (rms, peak) = clock.output_levels_db();
        assert!((rms - (-60.0)).abs() < 1e-9);
        assert!((peak - (-60.0)).abs() < 1e-9);
    }

    #[test]
    fn output_levels_db_converts_linear_to_db() {
        let clock = RealtimeClock::default();
        // 1.0 linear → 0 dB
        clock.set_output_levels(1.0, 1.0);
        let (rms, peak) = clock.output_levels_db();
        assert!((rms - 0.0).abs() < 1e-9);
        assert!((peak - 0.0).abs() < 1e-9);

        // 0.5 linear → ~-6.02 dB
        clock.set_output_levels(0.5, 0.5);
        let (rms, peak) = clock.output_levels_db();
        let expected = 20.0 * 0.5_f64.log10();
        assert!((rms - expected).abs() < 1e-9);
        assert!((peak - expected).abs() < 1e-9);
    }

    #[test]
    fn output_levels_db_floors_below_threshold() {
        let clock = RealtimeClock::default();
        // 0.001 linear → -60 dB (exactly at threshold, still uses log10)
        clock.set_output_levels(0.001, 0.001);
        let (rms, _) = clock.output_levels_db();
        assert!((rms - 20.0 * 0.001_f64.log10()).abs() < 1e-9);

        // 0.0009 linear → below threshold → -60 dB floor
        clock.set_output_levels(0.0009, 0.0009);
        let (rms, peak) = clock.output_levels_db();
        assert!((rms - (-60.0)).abs() < 1e-9);
        assert!((peak - (-60.0)).abs() < 1e-9);
    }

    #[test]
    fn reset_frames_zeroes_counters() {
        let clock = RealtimeClock::default();
        clock.frames_written.store(42, Ordering::Release);
        clock.underrun_events.store(3, Ordering::SeqCst);
        clock.underrun_frames.store(100, Ordering::SeqCst);
        clock.output_latency_bits.store(0.5f64.to_bits(), Ordering::Release);

        clock.reset_frames();

        assert_eq!(clock.frames(), 0);
        assert_eq!(clock.underrun_events.load(Ordering::SeqCst), 0);
        assert_eq!(clock.underrun_frames.load(Ordering::SeqCst), 0);
        assert!((clock.output_latency_sec() - 0.0).abs() < 1e-9);
    }
}
