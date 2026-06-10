//! Таймлайн-клок воспроизведения.
//!
//! Отслеживает текущую позицию (`pts`) по двум источникам:
//!   - во время паузы — `pts_origin` (стоп-кадр);
//!   - во время воспроизведения — `pts_origin + (wall_now − wall_origin)`.
//!
//! Не знает о сцене, слоях или GPU — чистая арифметика времени.

use std::time::Instant;

/// Abstract timeline clock so tests can inject a deterministic/mock time source.
pub trait Clock: Send + Sync {
    fn is_playing(&self) -> bool;
    fn current_pts(&self) -> f64;
    fn play(&mut self);
    fn pause(&mut self) -> f64;
    fn seek(&mut self, t: f64);
    fn sync_to_audio_pts(&mut self, audio_pts: f64);
    /// Глобальная скорость транспорта (мультипликатор таймлайн-времени относительно
    /// wall-clock). 1.0 — норма, 2.0 — 2× вперёд, -1.0 — реверс 1×.
    fn set_speed(&mut self, speed: f64);
    fn speed(&self) -> f64;
}

pub struct PlaybackClock {
    /// PTS в момент последнего pause/seek (секунды timeline).
    pts_origin: f64,
    /// Wall-time начала воспроизведения. `None` — на паузе.
    wall_origin: Option<Instant>,
    /// Скорость воспроизведения: timeline-секунд на одну wall-секунду. Может быть
    /// отрицательной (реверс) — тогда `current_pts` идёт назад.
    speed: f64,
}

impl PlaybackClock {
    /// Окно допуска рассинхрона wall-clock↔audio. Должно быть больше джиттера audible-PTS
    /// (≈ один аудио-чанк, ~50мс) И startup prebuffer (~100мс), иначе клок дёргается на
    /// старте: аудио начинает с задержкой prebuffer, а wall-клок уже тикает → синк
    /// телепортирует видео назад на 100мс, кэш не попадает → черная вспышка.
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

    /// Меняет скорость, переанкоривая позицию на текущий PTS, чтобы переключение было
    /// бесшовным (без скачка времени). При воспроизведении заново берёт wall-origin.
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

    /// Корректирует wall-clock по реальному audio PTS, чтобы он не дрейфовал относительно
    /// аудио. Вызывается каждый кадр монитора.
    ///
    /// ВАЖНО: `audio_pts` (audible-позиция) джиттерит на величину аудио-чанка (±~50мс),
    /// потому что вычитает мгновенную заполненность ринга. Если корректировать клок на КАЖДЫЙ
    /// кадр, этот джиттер впрыскивается в `current_pts()` → видеокадры дёргаются назад. Поэтому
    /// клок свободно идёт по wall-clock (плавно, монотонно) и жёстко подтягивается к аудио
    /// только при значимом дрейфе (за пределами джиттер-окна) — например, после underrun/seek.
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
        // audible-PTS джиттерит назад в пределах окна — клок НЕ должен откатываться,
        // иначе видеокадры дёргаются назад. Wall-clock продолжает идти вперёд.
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
        // Значимый дрейф (аудио заметно впереди) — жёсткая коррекция к audio_pts.
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
