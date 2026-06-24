//! Playback timeline clock.
//!
//! Tracks the current position (`pts`) from two sources:
//!   - while paused — `pts_origin` (the stop frame);
//!   - while playing — `pts_origin + (wall_now − wall_origin)`.
//!
//! Knows nothing about the scene, layers or GPU — pure time arithmetic.

use std::time::Instant;

/// Abstract timeline clock so tests can inject a deterministic/mock time source.
pub trait Clock: Send + Sync {
    fn is_playing(&self) -> bool;
    fn current_pts(&self) -> f64;
    fn play(&mut self);
    fn pause(&mut self) -> f64;
    fn seek(&mut self, t: f64);
    fn sync_to_audio_pts(&mut self, audio_pts: f64);
    /// Global transport speed (timeline-time multiplier relative to wall-clock).
    /// 1.0 = normal, 2.0 = 2× forward, -1.0 = reverse 1×.
    fn set_speed(&mut self, speed: f64);
    fn speed(&self) -> f64;
}

pub struct PlaybackClock {
    /// PTS at the last pause/seek (timeline seconds).
    pts_origin: f64,
    /// Wall-time when playback started. `None` = paused.
    wall_origin: Option<Instant>,
    /// Playback speed: timeline seconds per one wall second. May be negative
    /// (reverse) — then `current_pts` runs backward.
    speed: f64,
}

impl PlaybackClock {
    /// Tolerance window for wall-clock↔audio drift. Must exceed audible-PTS jitter
    /// (≈ one audio chunk, ~50ms) AND the startup prebuffer (~100ms), otherwise the
    /// clock jerks at start: audio begins after the prebuffer delay while the wall
    /// clock already ticks → sync teleports video back 100ms, the cache misses → a
    /// black flash.
    const RESYNC_THRESHOLD_SEC: f64 = 0.2;

    pub fn new() -> Self {
        Self {
            pts_origin: 0.0,
            wall_origin: None,
            speed: 1.0,
        }
    }

    fn sanitize_speed(speed: f64) -> f64 {
        if speed.is_finite() && speed != 0.0 {
            speed.clamp(-100.0, 100.0)
        } else {
            1.0
        }
    }

    pub fn is_playing(&self) -> bool {
        self.wall_origin.is_some()
    }

    pub fn speed(&self) -> f64 {
        self.speed
    }

    pub fn current_pts(&self) -> f64 {
        match self.wall_origin {
            Some(origin) => {
                self.pts_origin + Instant::now().duration_since(origin).as_secs_f64() * self.speed
            }
            None => self.pts_origin,
        }
    }

    /// Changes the speed, re-anchoring the position to the current PTS so the switch
    /// is seamless (no time jump). While playing it re-takes the wall-origin.
    pub fn set_speed(&mut self, speed: f64) {
        let now_pts = self.current_pts();
        self.pts_origin = now_pts;
        self.speed = Self::sanitize_speed(speed);
        if self.wall_origin.is_some() {
            self.wall_origin = Some(Instant::now());
        }
    }

    pub fn play(&mut self) {
        if self.wall_origin.is_none() {
            self.wall_origin = Some(Instant::now());
        }
    }

    /// Pins the current PTS and returns it.
    pub fn pause(&mut self) -> f64 {
        let t = self.current_pts();
        self.pts_origin = t;
        self.wall_origin = None;
        t
    }

    pub fn seek(&mut self, t: f64) {
        self.pts_origin = t.max(0.0);
        // If we were playing, reset wall_origin to continue from the new position.
        if self.wall_origin.is_some() {
            self.wall_origin = Some(Instant::now());
        }
    }

    /// Corrects the wall-clock against the real audio PTS so it doesn't drift relative
    /// to the audio. Called every monitor frame.
    ///
    /// IMPORTANT: `audio_pts` (the audible position) jitters by an audio-chunk amount
    /// (±~50ms) because it subtracts the instantaneous ring fill. Correcting the clock
    /// on EVERY frame injects that jitter into `current_pts()` → video frames jerk
    /// backward. So the clock free-runs on the wall-clock (smooth, monotonic) and is
    /// hard-pulled to audio only on significant drift (outside the jitter window) —
    /// e.g. after an underrun/seek.
    pub fn sync_to_audio_pts(&mut self, audio_pts: f64) {
        if let Some(origin) = self.wall_origin {
            let elapsed = Instant::now().duration_since(origin).as_secs_f64();
            let wall_pts = self.pts_origin + elapsed * self.speed;
            if (wall_pts - audio_pts).abs() > Self::RESYNC_THRESHOLD_SEC {
                self.pts_origin = audio_pts - elapsed * self.speed;
            }
        } else {
            self.pts_origin = audio_pts.max(0.0);
        }
    }
}

impl Clock for PlaybackClock {
    fn is_playing(&self) -> bool {
        self.is_playing()
    }

    fn current_pts(&self) -> f64 {
        self.current_pts()
    }

    fn play(&mut self) {
        self.play();
    }

    fn pause(&mut self) -> f64 {
        self.pause()
    }

    fn seek(&mut self, t: f64) {
        self.seek(t);
    }

    fn sync_to_audio_pts(&mut self, audio_pts: f64) {
        self.sync_to_audio_pts(audio_pts);
    }

    fn set_speed(&mut self, speed: f64) {
        self.set_speed(speed);
    }

    fn speed(&self) -> f64 {
        self.speed()
    }
}

#[cfg(test)]
mod tests {
    use super::{Clock, PlaybackClock};

    #[test]
    fn starts_at_zero_paused() {
        let c = PlaybackClock::new();
        assert!(!c.is_playing());
        assert_eq!(c.current_pts(), 0.0);
    }

    #[test]
    fn seek_clamps_negative() {
        let mut c = PlaybackClock::new();
        c.seek(-5.0);
        assert_eq!(c.current_pts(), 0.0);
    }

    #[test]
    fn pause_returns_frozen_pts() {
        let mut c = PlaybackClock::new();
        c.seek(3.5);
        let t = c.pause();
        assert!((t - 3.5).abs() < 1e-6);
        assert!(!c.is_playing());
        assert!((c.current_pts() - 3.5).abs() < 1e-6);
    }

    #[test]
    fn play_advances_pts() {
        let mut c = PlaybackClock::new();
        c.seek(1.0);
        c.play();
        assert!(c.is_playing());
        // Small delay — PTS should be a bit above 1.0.
        std::thread::sleep(std::time::Duration::from_millis(10));
        assert!(c.current_pts() > 1.0);
    }

    #[test]
    fn seek_while_playing_resets_origin() {
        let mut c = PlaybackClock::new();
        c.play();
        c.seek(10.0);
        // After seek PTS should be around 10 (not drift from wall).
        assert!((c.current_pts() - 10.0).abs() < 0.1);
    }

    #[test]
    fn seek_while_paused_keeps_paused() {
        let mut c = PlaybackClock::new();
        c.seek(5.0);
        c.pause();
        c.seek(7.0);
        // seek() after pause must not restart the clock.
        assert!(!c.is_playing());
        assert_eq!(c.current_pts(), 7.0);
    }

    #[test]
    fn sync_to_audio_pts_ignores_small_backward_jitter() {
        let mut c = PlaybackClock::new();
        c.play();
        std::thread::sleep(std::time::Duration::from_millis(20));
        let before = c.current_pts();
        // audible-PTS jitters backward within the window — the clock must NOT roll
        // back, otherwise video frames jerk backward. The wall-clock keeps advancing.
        c.sync_to_audio_pts(before - 0.02);
        let after = c.current_pts();
        assert!(
            after >= before - 1e-3,
            "clock jumped backwards on small jitter: before={before}, after={after}"
        );
    }

    #[test]
    fn sync_to_audio_pts_corrects_large_drift() {
        let mut c = PlaybackClock::new();
        c.play();
        std::thread::sleep(std::time::Duration::from_millis(20));
        let before = c.current_pts();
        // Significant drift (audio clearly ahead) — hard-correct to audio_pts.
        c.sync_to_audio_pts(before + 1.0);
        let after = c.current_pts();
        assert!(
            (after - (before + 1.0)).abs() < 0.02,
            "large drift not corrected: before={before}, after={after}"
        );
    }

    #[test]
    fn default_speed_is_one() {
        let c = PlaybackClock::new();
        assert_eq!(c.speed(), 1.0);
    }

    #[test]
    fn speed_scales_pts_advance() {
        let mut c = PlaybackClock::new();
        c.set_speed(2.0);
        c.seek(1.0);
        c.play();
        std::thread::sleep(std::time::Duration::from_millis(20));
        // At 2× the timeline advances twice wall time: ~0.04s of timeline per 20ms.
        let pts = c.current_pts();
        assert!(pts > 1.02, "expected >1.02 at 2x after 20ms, got {pts}");
    }

    #[test]
    fn negative_speed_runs_backwards() {
        let mut c = PlaybackClock::new();
        c.seek(5.0);
        c.set_speed(-1.0);
        c.play();
        std::thread::sleep(std::time::Duration::from_millis(20));
        let pts = c.current_pts();
        assert!(pts < 5.0, "reverse must decrease pts, got {pts}");
        assert!(pts > 4.9, "reverse drifted too far, got {pts}");
    }

    #[test]
    fn set_speed_reanchors_without_jump() {
        let mut c = PlaybackClock::new();
        c.seek(10.0);
        c.play();
        std::thread::sleep(std::time::Duration::from_millis(10));
        let before = c.current_pts();
        // Switching speed must not teleport the playhead — it continues from `before`.
        c.set_speed(4.0);
        let after = c.current_pts();
        assert!(
            (after - before).abs() < 0.01,
            "set_speed jumped: before={before}, after={after}"
        );
    }

    #[test]
    fn set_speed_rejects_zero_and_non_finite() {
        let mut c = PlaybackClock::new();
        c.set_speed(0.0);
        assert_eq!(c.speed(), 1.0);
        c.set_speed(f64::NAN);
        assert_eq!(c.speed(), 1.0);
        c.set_speed(f64::INFINITY);
        assert_eq!(c.speed(), 1.0);
    }

    #[test]
    fn playback_clock_implements_clock_trait() {
        let mut clock: Box<dyn Clock> = Box::new(PlaybackClock::new());
        assert!(!clock.is_playing());
        assert_eq!(clock.current_pts(), 0.0);
        clock.seek(3.5);
        assert_eq!(clock.current_pts(), 3.5);
        clock.play();
        assert!(clock.is_playing());
        let pts = clock.pause();
        assert!((pts - 3.5).abs() < 1e-6);
        assert!(!clock.is_playing());
    }
}
