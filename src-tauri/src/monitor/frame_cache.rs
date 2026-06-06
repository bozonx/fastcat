//! Кеш декодированных видеокадров на слой + политика выборки кадра (sampler).
//!
//! Зачем: раньше любой seek назад приводил к респауну ffmpeg и пере-декоду от ключевого
//! кадра — дорого при скрабе. Кеш хранит «окно» недавно декодированных кадров вокруг
//! текущей позиции; скраб в пределах окна обслуживается без перезапуска декодера.
//!
//! Это нативный аналог `VideoFrameCache` + `FrameSampleOrchestrator` из старого веб-ядра:
//! - кеш (`VideoFrameCache`) — хранение/вытеснение кадров по индексу PTS;
//! - sampler — выбор кадра на момент времени (`frame_le` — кадр с PTS ≤ target) и
//!   эвристика вытеснения «дальше всех от текущей позиции» (локальность скраба).
//!
//! Память ограничена бюджетом байт на слой; вытесняется кадр, наиболее удалённый по
//! индексу от последнего запрошенного времени.

use std::collections::BTreeMap;
use std::sync::Arc;

use vello::peniko::ImageData;

/// Один декодированный кадр внутри исходника (PTS в секундах).
///
/// GPU-резидентный кадр держит `texture` (Arc на `wgpu::Texture`) — текстура жива ровно
/// пока кадр в кеше или показывается (`current`), без отдельного глобального кеша с
/// независимым вытеснением. `image` (CPU-blob RGBA) хранится ТОЛЬКО как fallback, когда
/// GPU-аплоад недоступен (у декодера нет wgpu device): иначе это был бы чистый дубль
/// GPU-кадра (~8 МБ @1080p на кадр впустую).
#[derive(Clone)]
pub struct DecodedVideoFrame {
    pub pts_sec: f64,
    pub image: Option<ImageData>,
    pub texture: Option<Arc<wgpu::Texture>>,
}

/// Бюджет памяти кеша на один слой. ~192 МБ: для 1080p (~8 МБ/кадр) это ~23 кадра,
/// для 540p-превью (~2 МБ) ~90 кадров — достаточное «окно» для скраба, не раздувает память.
const CACHE_BUDGET_BYTES: usize = 192 * 1024 * 1024;
const MIN_FRAMES: usize = 6;
const MAX_FRAMES: usize = 300;

pub struct VideoFrameCache {
    fps: f64,
    capacity: usize,
    /// Ключ — PTS, квантованный к миллисекундам (`round(pts * 1000)`): абсолютная позиция
    /// в исходнике, стабильная между поколениями декодера (один файл+scale). Миллисекундная
    /// сетка (а не `round(pts*fps)`) не схлопывает соседние кадры на VFR-источниках, где
    /// реальный интервал между кадрами не равен 1/avg_fps.
    frames: BTreeMap<i64, DecodedVideoFrame>,
    /// Последний запрошенный ключ (мс) — центр локальности для вытеснения.
    last_request: i64,
}

/// Квантизация PTS (секунды) в ключ кеша — миллисекунды.
const CACHE_KEY_HZ: f64 = 1000.0;

impl VideoFrameCache {
    pub fn new(fps: f64, frame_bytes: usize) -> Self {
        let capacity = if frame_bytes == 0 {
            MIN_FRAMES
        } else {
            (CACHE_BUDGET_BYTES / frame_bytes).clamp(MIN_FRAMES, MAX_FRAMES)
        };
        Self {
            fps: if fps > 0.0 { fps } else { 30.0 },
            capacity,
            frames: BTreeMap::new(),
            last_request: 0,
        }
    }

    fn index_of(&self, pts_sec: f64) -> i64 {
        (pts_sec * CACHE_KEY_HZ).round() as i64
    }

    /// Вставляет кадр. Вытесненные/перезаписанные кадры освобождают свою GPU-текстуру
    /// автоматически через `Drop` Arc'а — отдельной синхронизации с внешним кешем не нужно.
    pub fn insert(&mut self, frame: DecodedVideoFrame) {
        let key = self.index_of(frame.pts_sec);
        self.frames.insert(key, frame);
        self.evict();
    }

    /// Кадр с наибольшим PTS ≤ target (то, что должно быть на экране в момент target).
    pub fn frame_le(&mut self, target_pts: f64) -> Option<DecodedVideoFrame> {
        let key = self.index_of(target_pts);
        self.last_request = key;
        self.frames
            .range(..=key)
            .next_back()
            .map(|(_, f)| f.clone())
    }

    /// Кадр с наибольшим PTS ≤ target, но только если он не отстал дальше
    /// допустимого AV-sync окна.
    pub fn frame_le_with_max_lag(
        &mut self,
        target_pts: f64,
        max_lag_sec: f64,
    ) -> Option<DecodedVideoFrame> {
        let frame = self.frame_le(target_pts)?;
        if target_pts - frame.pts_sec <= max_lag_sec.max(0.0) {
            Some(frame)
        } else {
            None
        }
    }

    /// Есть ли в кеше кадр в пределах `tolerance_frames` от target (для fast-path seek).
    pub fn has_near(&mut self, target_pts: f64, tolerance_frames: i64) -> bool {
        let key = self.index_of(target_pts);
        self.last_request = key;
        let floor = self
            .frames
            .range(..=key)
            .next_back()
            .map(|(k, _)| (key - *k).abs());
        let ceil = self
            .frames
            .range(key..)
            .next()
            .map(|(k, _)| (*k - key).abs());
        let best = match (floor, ceil) {
            (Some(a), Some(b)) => a.min(b),
            (Some(a), None) => a,
            (None, Some(b)) => b,
            (None, None) => return false,
        };
        // Ключи в миллисекундах → переводим допуск из кадров в мс по fps.
        let tolerance_ms = ((tolerance_frames as f64) * CACHE_KEY_HZ / self.fps).round() as i64;
        best <= tolerance_ms
    }

    /// Расстояние (секунды) до ближайшего кешированного кадра от `target`.
    /// `None` — кеш пуст. Не трогает `last_request` (чистый запрос для эвристик).
    pub fn nearest_distance_sec(&self, target_pts: f64) -> Option<f64> {
        let key = self.index_of(target_pts);
        let floor = self
            .frames
            .range(..=key)
            .next_back()
            .map(|(k, _)| (key - *k).abs());
        let ceil = self
            .frames
            .range(key..)
            .next()
            .map(|(k, _)| (*k - key).abs());
        let best = match (floor, ceil) {
            (Some(a), Some(b)) => a.min(b),
            (Some(a), None) => a,
            (None, Some(b)) => b,
            (None, None) => return None,
        };
        Some(best as f64 / CACHE_KEY_HZ)
    }

    /// Ближайший кадр к `target` в любую сторону (для показа во время репозиции
    /// декодера, чтобы экран не застывал при reverse/fast-forward).
    pub fn frame_nearest(&mut self, target_pts: f64) -> Option<DecodedVideoFrame> {
        let key = self.index_of(target_pts);
        self.last_request = key;
        let floor = self.frames.range(..=key).next_back();
        let ceil = self.frames.range(key..).next();
        match (floor, ceil) {
            (Some((fk, ff)), Some((ck, cf))) => {
                if (key - *fk).abs() <= (*ck - key).abs() {
                    Some(ff.clone())
                } else {
                    Some(cf.clone())
                }
            }
            (Some((_, ff)), None) => Some(ff.clone()),
            (None, Some((_, cf))) => Some(cf.clone()),
            (None, None) => None,
        }
    }

    fn evict(&mut self) {
        while self.frames.len() > self.capacity {
            // Вытесняем кадр, наиболее удалённый по индексу от последнего запроса:
            // при скрабе/воспроизведении локальность доступа — вокруг текущей позиции.
            let victim = self
                .frames
                .keys()
                .copied()
                .max_by_key(|k| (*k - self.last_request).abs());
            match victim {
                // GPU-текстура вытесненного кадра освобождается дропом его Arc.
                Some(k) => {
                    self.frames.remove(&k);
                }
                None => break,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use vello::peniko::{Blob, ImageAlphaType, ImageFormat};

    fn frame(pts: f64) -> DecodedVideoFrame {
        let image = ImageData {
            data: Blob::new(Arc::new(vec![0u8; 4])),
            format: ImageFormat::Rgba8,
            alpha_type: ImageAlphaType::Alpha,
            width: 1,
            height: 1,
        };
        DecodedVideoFrame {
            pts_sec: pts,
            image: Some(image),
            texture: None,
        }
    }

    #[test]
    fn frame_le_returns_floor() {
        let mut c = VideoFrameCache::new(30.0, 4);
        let _ = c.insert(frame(0.0));
        let _ = c.insert(frame(1.0));
        let _ = c.insert(frame(2.0));
        assert_eq!(c.frame_le(1.4).map(|f| f.pts_sec), Some(1.0));
        assert_eq!(c.frame_le(-1.0).map(|f| f.pts_sec), None);
    }

    #[test]
    fn frame_le_with_max_lag_rejects_stale_frames() {
        let mut c = VideoFrameCache::new(30.0, 4);
        let _ = c.insert(frame(1.0));

        assert_eq!(
            c.frame_le_with_max_lag(1.05, 0.1).map(|f| f.pts_sec),
            Some(1.0)
        );
        assert_eq!(c.frame_le_with_max_lag(1.5, 0.1).map(|f| f.pts_sec), None);
    }

    #[test]
    fn regular_frame_floor_still_allows_holding_last_frame() {
        let mut c = VideoFrameCache::new(30.0, 4);
        let _ = c.insert(frame(1.0));

        assert_eq!(c.frame_le(1.5).map(|f| f.pts_sec), Some(1.0));
    }

    #[test]
    fn vfr_frames_closer_than_avg_interval_do_not_collide() {
        // avg fps=30 → интервал 33мс. Два кадра в 10мс друг от друга (типично для VFR)
        // при старом ключе round(pts*fps) схлопнулись бы в один индекс; мс-ключ их различает.
        let mut c = VideoFrameCache::new(30.0, 4);
        let _ = c.insert(frame(1.00));
        let _ = c.insert(frame(1.01));
        assert_eq!(c.frames.len(), 2);
        assert_eq!(c.frame_le(1.005).map(|f| f.pts_sec), Some(1.00));
        assert_eq!(c.frame_le(1.02).map(|f| f.pts_sec), Some(1.01));
    }

    #[test]
    fn nearest_distance_picks_closest_side() {
        let mut c = VideoFrameCache::new(30.0, 4);
        assert_eq!(c.nearest_distance_sec(1.0), None);
        let _ = c.insert(frame(1.0));
        let _ = c.insert(frame(3.0));
        assert!((c.nearest_distance_sec(1.2).unwrap() - 0.2).abs() < 1e-6);
        // Ближе к 3.0 (0.4), чем к 1.0 (0.6).
        assert!((c.nearest_distance_sec(2.6).unwrap() - 0.4).abs() < 1e-6);
    }

    #[test]
    fn frame_nearest_returns_either_side() {
        let mut c = VideoFrameCache::new(30.0, 4);
        let _ = c.insert(frame(1.0));
        let _ = c.insert(frame(3.0));
        // Промах le (target < min) всё равно даёт ближайший кадр, а не None.
        assert_eq!(c.frame_nearest(0.0).map(|f| f.pts_sec), Some(1.0));
        assert_eq!(c.frame_nearest(2.9).map(|f| f.pts_sec), Some(3.0));
        assert_eq!(c.frame_nearest(1.9).map(|f| f.pts_sec), Some(1.0));
    }

    #[test]
    fn has_near_within_tolerance() {
        let mut c = VideoFrameCache::new(30.0, 4);
        let _ = c.insert(frame(1.0));
        assert!(c.has_near(1.0, 1));
        assert!(!c.has_near(5.0, 1));
    }

    #[test]
    fn evicts_to_capacity_keeping_locality() {
        // frame_bytes huge → capacity = MIN_FRAMES (6).
        let mut c = VideoFrameCache::new(30.0, usize::MAX);
        for i in 0..20 {
            let _ = c.insert(frame(i as f64));
        }
        // Запрос у конца — дальние от него (нулевые) кадры должны быть вытеснены.
        let _ = c.frame_le(19.0);
        let _ = c.insert(frame(20.0));
        assert!(c.frames.len() <= MIN_FRAMES + 1);
        assert!(c.frame_le(0.5).map(|f| f.pts_sec) != Some(0.0));
    }
}
