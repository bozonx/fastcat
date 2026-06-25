//! Render timing telemetry for the compositor.
//!
//! Records per-frame materialize / vello-build / render stage timings and emits
//! throttled logs under the `FASTCAT_RENDER_TIMING` environment flag.

use std::time::{Duration, Instant};

#[derive(Clone, Copy, Default)]
pub struct RenderStageTiming {
    pub materialize_ms: f64,
    pub build_vello_ms: f64,
    pub render_ms: f64,
    pub total_ms: f64,
}

#[derive(Default)]
pub struct RenderPrepareTiming {
    pub materialize_ms: f64,
    pub build_vello_ms: f64,
}

pub struct RenderTelemetry {
    enabled: bool,
    records: u64,
    frames: u64,
    warmup_frames: u64,
    last_log: Instant,
    materialize_sum_ms: f64,
    build_vello_sum_ms: f64,
    render_sum_ms: f64,
    total_sum_ms: f64,
}

impl RenderTelemetry {
    const INITIAL_WARMUP_CUTOFF_MS: f64 = 250.0;

    pub fn new() -> Self {
        Self::with_enabled(std::env::var("FASTCAT_RENDER_TIMING").is_ok_and(|value| value != "0"))
    }

    pub fn with_enabled(enabled: bool) -> Self {
        Self {
            enabled,
            records: 0,
            frames: 0,
            warmup_frames: 0,
            last_log: Instant::now(),
            materialize_sum_ms: 0.0,
            build_vello_sum_ms: 0.0,
            render_sum_ms: 0.0,
            total_sum_ms: 0.0,
        }
    }

    pub fn record(&mut self, target: &'static str, timing: RenderStageTiming) {
        if !self.enabled {
            return;
        }
        self.records += 1;

        if self.frames == 0 && timing.total_ms >= Self::INITIAL_WARMUP_CUTOFF_MS {
            self.warmup_frames += 1;
            log::info!(
                "[compositor-timing] {target}: warmup total={:.2}ms materialize={:.2}ms build_vello={:.2}ms render={:.2}ms; excluded from avg",
                timing.total_ms,
                timing.materialize_ms,
                timing.build_vello_ms,
                timing.render_ms,
            );
            self.last_log = Instant::now();
            return;
        }

        self.frames += 1;
        self.materialize_sum_ms += timing.materialize_ms;
        self.build_vello_sum_ms += timing.build_vello_ms;
        self.render_sum_ms += timing.render_ms;
        self.total_sum_ms += timing.total_ms;

        let should_log_periodic = self.frames.is_multiple_of(120);
        let should_log_slow =
            timing.total_ms >= 50.0 && self.last_log.elapsed() >= Duration::from_secs(1);
        if !should_log_periodic && !should_log_slow {
            return;
        }

        let frames = self.frames as f64;
        log::info!(
            "[compositor-timing] {target}: last total={:.2}ms materialize={:.2}ms build_vello={:.2}ms render={:.2}ms; avg total={:.2}ms materialize={:.2}ms build_vello={:.2}ms render={:.2}ms over {} frames",
            timing.total_ms,
            timing.materialize_ms,
            timing.build_vello_ms,
            timing.render_ms,
            self.total_sum_ms / frames,
            self.materialize_sum_ms / frames,
            self.build_vello_sum_ms / frames,
            self.render_sum_ms / frames,
            self.frames,
        );
        self.last_log = Instant::now();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_telemetry_disabled_ignores_records() {
        let mut telemetry = RenderTelemetry::with_enabled(false);

        telemetry.record(
            "surface",
            RenderStageTiming {
                materialize_ms: 1.0,
                build_vello_ms: 2.0,
                render_ms: 3.0,
                total_ms: 6.0,
            },
        );

        assert_eq!(telemetry.records, 0);
        assert_eq!(telemetry.frames, 0);
        assert_eq!(telemetry.total_sum_ms, 0.0);
    }

    #[test]
    fn render_telemetry_enabled_accumulates_stage_totals() {
        let mut telemetry = RenderTelemetry::with_enabled(true);

        telemetry.record(
            "surface",
            RenderStageTiming {
                materialize_ms: 1.0,
                build_vello_ms: 2.0,
                render_ms: 3.0,
                total_ms: 6.0,
            },
        );
        telemetry.record(
            "pixels",
            RenderStageTiming {
                materialize_ms: 4.0,
                build_vello_ms: 5.0,
                render_ms: 6.0,
                total_ms: 15.0,
            },
        );

        assert_eq!(telemetry.records, 2);
        assert_eq!(telemetry.frames, 2);
        assert_eq!(telemetry.warmup_frames, 0);
        assert_eq!(telemetry.materialize_sum_ms, 5.0);
        assert_eq!(telemetry.build_vello_sum_ms, 7.0);
        assert_eq!(telemetry.render_sum_ms, 9.0);
        assert_eq!(telemetry.total_sum_ms, 21.0);
    }

    #[test]
    fn render_telemetry_excludes_initial_slow_warmup_from_averages() {
        let mut telemetry = RenderTelemetry::with_enabled(true);

        telemetry.record(
            "surface",
            RenderStageTiming {
                materialize_ms: 0.1,
                build_vello_ms: 0.1,
                render_ms: 999.8,
                total_ms: 1000.0,
            },
        );
        telemetry.record(
            "surface",
            RenderStageTiming {
                materialize_ms: 1.0,
                build_vello_ms: 2.0,
                render_ms: 3.0,
                total_ms: 6.0,
            },
        );

        assert_eq!(telemetry.records, 2);
        assert_eq!(telemetry.frames, 1);
        assert_eq!(telemetry.warmup_frames, 1);
        assert_eq!(telemetry.materialize_sum_ms, 1.0);
        assert_eq!(telemetry.build_vello_sum_ms, 2.0);
        assert_eq!(telemetry.render_sum_ms, 3.0);
        assert_eq!(telemetry.total_sum_ms, 6.0);
    }

    #[test]
    fn render_telemetry_warmup_boundary_249ms_is_normal_frame() {
        // total_ms just below the 250ms cutoff → counted as a normal frame, not warmup.
        let mut telemetry = RenderTelemetry::with_enabled(true);
        telemetry.record(
            "surface",
            RenderStageTiming {
                materialize_ms: 1.0,
                build_vello_ms: 1.0,
                render_ms: 247.0,
                total_ms: 249.0,
            },
        );
        assert_eq!(telemetry.frames, 1);
        assert_eq!(telemetry.warmup_frames, 0);
        assert_eq!(telemetry.total_sum_ms, 249.0);
    }

    #[test]
    fn render_telemetry_warmup_boundary_250ms_is_warmup() {
        // total_ms exactly at the 250ms cutoff → counted as warmup (>=).
        let mut telemetry = RenderTelemetry::with_enabled(true);
        telemetry.record(
            "surface",
            RenderStageTiming {
                materialize_ms: 0.0,
                build_vello_ms: 0.0,
                render_ms: 250.0,
                total_ms: 250.0,
            },
        );
        assert_eq!(telemetry.frames, 0);
        assert_eq!(telemetry.warmup_frames, 1);
        assert_eq!(telemetry.total_sum_ms, 0.0);
    }

    #[test]
    fn render_telemetry_accumulates_many_frames_correctly() {
        let mut telemetry = RenderTelemetry::with_enabled(true);

        // Record 500 normal frames with consistent timings.
        for _ in 0..500 {
            telemetry.record(
                "surface",
                RenderStageTiming {
                    materialize_ms: 0.5,
                    build_vello_ms: 1.0,
                    render_ms: 2.0,
                    total_ms: 3.5,
                },
            );
        }

        assert_eq!(telemetry.records, 500);
        assert_eq!(telemetry.frames, 500);
        assert_eq!(telemetry.warmup_frames, 0);
        assert_eq!(telemetry.materialize_sum_ms, 250.0);
        assert_eq!(telemetry.build_vello_sum_ms, 500.0);
        assert_eq!(telemetry.render_sum_ms, 1000.0);
        assert_eq!(telemetry.total_sum_ms, 1750.0);
    }

    #[test]
    fn render_telemetry_multiple_warmup_frames_then_normal() {
        // Multiple consecutive slow frames at startup are all counted as warmup
        // until the first fast frame arrives.
        let mut telemetry = RenderTelemetry::with_enabled(true);

        for _ in 0..3 {
            telemetry.record(
                "surface",
                RenderStageTiming {
                    materialize_ms: 0.1,
                    build_vello_ms: 0.1,
                    render_ms: 400.0,
                    total_ms: 400.2,
                },
            );
        }
        assert_eq!(telemetry.warmup_frames, 3);
        assert_eq!(telemetry.frames, 0);

        // A normal frame after warmup starts counting.
        telemetry.record(
            "surface",
            RenderStageTiming {
                materialize_ms: 1.0,
                build_vello_ms: 2.0,
                render_ms: 3.0,
                total_ms: 6.0,
            },
        );
        assert_eq!(telemetry.records, 4);
        assert_eq!(telemetry.frames, 1);
        assert_eq!(telemetry.warmup_frames, 3);
        assert_eq!(telemetry.total_sum_ms, 6.0);
    }
}
