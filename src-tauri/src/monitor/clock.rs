//! Таймлайн-клок воспроизведения.
//!
//! Отслеживает текущую позицию (`pts`) по двум источникам:
//!   - во время паузы — `pts_origin` (стоп-кадр);
//!   - во время воспроизведения — `pts_origin + (wall_now − wall_origin)`.
//!
//! Не знает о сцене, слоях или GPU — чистая арифметика времени.

use std::time::Instant;

pub struct PlaybackClock {
    /// PTS в момент последнего pause/seek (секунды timeline).
    pts_origin: f64,
    /// Wall-time начала воспроизведения. `None` — на паузе.
    wall_origin: Option<Instant>,
}

impl PlaybackClock {
    pub fn new() -> Self {
        Self {
            pts_origin: 0.0,
            wall_origin: None,
        }
    }

    pub fn is_playing(&self) -> bool {
        self.wall_origin.is_some()
    }

    pub fn current_pts(&self) -> f64 {
        match self.wall_origin {
            Some(origin) => self.pts_origin + Instant::now().duration_since(origin).as_secs_f64(),
            None => self.pts_origin,
        }
    }

    pub fn play(&mut self) {
        if self.wall_origin.is_none() {
            self.wall_origin = Some(Instant::now());
        }
    }

    /// Фиксирует текущий PTS, возвращает его.
    pub fn pause(&mut self) -> f64 {
        let t = self.current_pts();
        self.pts_origin = t;
        self.wall_origin = None;
        t
    }

    pub fn seek(&mut self, t: f64) {
        self.pts_origin = t.max(0.0);
        // Если играли — сбрасываем wall_origin, чтобы продолжить с новой позиции.
        if self.wall_origin.is_some() {
            self.wall_origin = Some(Instant::now());
        }
    }

    /// Корректирует wall_origin по реальному audio PTS, чтобы
    /// wall-clock не дрейфовал относительно audio clock.
    /// Вызывать из тика монитора при наличии аудио.
    pub fn sync_to_audio_pts(&mut self, audio_pts: f64) {
        if let Some(origin) = self.wall_origin {
            // Preserve the elapsed wall time so current_pts() does not jump
            // backwards when audio_pts is slightly behind the wall clock.
            let elapsed = Instant::now().duration_since(origin).as_secs_f64();
            self.pts_origin = audio_pts - elapsed;
        } else {
            self.pts_origin = audio_pts.max(0.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::PlaybackClock;

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
        // Небольшая задержка — PTS должен быть чуть больше 1.0.
        std::thread::sleep(std::time::Duration::from_millis(10));
        assert!(c.current_pts() > 1.0);
    }

    #[test]
    fn seek_while_playing_resets_origin() {
        let mut c = PlaybackClock::new();
        c.play();
        c.seek(10.0);
        // После seek PTS должен быть около 10 (не дрейфовать от wall).
        assert!((c.current_pts() - 10.0).abs() < 0.1);
    }

    #[test]
    fn sync_to_audio_pts_does_not_jump_backwards() {
        let mut c = PlaybackClock::new();
        c.play();
        std::thread::sleep(std::time::Duration::from_millis(20));
        let before = c.current_pts();
        // Simulate audio lagging slightly behind wall clock.
        c.sync_to_audio_pts(before - 0.02);
        let after = c.current_pts();
        // Should be approximately the audio_pts (within a few ms), not
        // snapping to Instant::now() which would create a backwards jump.
        assert!(
            (after - (before - 0.02)).abs() < 0.005,
            "sync created a jump: before={before}, after={after}"
        );
    }
}
