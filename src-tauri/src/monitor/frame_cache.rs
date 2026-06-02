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

use vello::peniko::ImageData;

/// Один декодированный кадр: PTS внутри исходника (секунды) + готовый к отрисовке RGBA.
#[derive(Clone)]
pub struct DecodedVideoFrame {
    pub pts_sec: f64,
    pub image: ImageData,
}

/// Бюджет памяти кеша на один слой. ~192 МБ: для 1080p (~8 МБ/кадр) это ~23 кадра,
/// для 540p-превью (~2 МБ) ~90 кадров — достаточное «окно» для скраба, не раздувает память.
const CACHE_BUDGET_BYTES: usize = 192 * 1024 * 1024;
const MIN_FRAMES: usize = 6;
const MAX_FRAMES: usize = 300;

pub struct VideoFrameCache {
    fps: f64,
    capacity: usize,
    /// Ключ — индекс кадра `round(pts * fps)`: абсолютная позиция в исходнике,
    /// стабильная между поколениями декодера (один файл+scale).
    frames: BTreeMap<i64, DecodedVideoFrame>,
    /// Последний запрошенный индекс — центр локальности для вытеснения.
    last_request: i64,
}

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
        (pts_sec * self.fps).round() as i64
    }

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
        best <= tolerance_frames
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
            image,
        }
    }

    #[test]
    fn frame_le_returns_floor() {
        let mut c = VideoFrameCache::new(30.0, 4);
        c.insert(frame(0.0));
        c.insert(frame(1.0));
        c.insert(frame(2.0));
        assert_eq!(c.frame_le(1.4).map(|f| f.pts_sec), Some(1.0));
        assert_eq!(c.frame_le(-1.0).map(|f| f.pts_sec), None);
    }

    #[test]
    fn frame_le_with_max_lag_rejects_stale_frames() {
        let mut c = VideoFrameCache::new(30.0, 4);
        c.insert(frame(1.0));

        assert_eq!(
            c.frame_le_with_max_lag(1.05, 0.1).map(|f| f.pts_sec),
            Some(1.0)
        );
        assert_eq!(c.frame_le_with_max_lag(1.5, 0.1).map(|f| f.pts_sec), None);
    }

    #[test]
    fn regular_frame_floor_still_allows_holding_last_frame() {
        let mut c = VideoFrameCache::new(30.0, 4);
        c.insert(frame(1.0));

        assert_eq!(c.frame_le(1.5).map(|f| f.pts_sec), Some(1.0));
    }

    #[test]
    fn has_near_within_tolerance() {
        let mut c = VideoFrameCache::new(30.0, 4);
        c.insert(frame(1.0));
        assert!(c.has_near(1.0, 1));
        assert!(!c.has_near(5.0, 1));
    }

    #[test]
    fn evicts_to_capacity_keeping_locality() {
        // frame_bytes huge → capacity = MIN_FRAMES (6).
        let mut c = VideoFrameCache::new(30.0, usize::MAX);
        for i in 0..20 {
            c.insert(frame(i as f64));
        }
        // Запрос у конца — дальние от него (нулевые) кадры должны быть вытеснены.
        let _ = c.frame_le(19.0);
        c.insert(frame(20.0));
        assert!(c.frames.len() <= MIN_FRAMES + 1);
        assert!(c.frame_le(0.5).map(|f| f.pts_sec) != Some(0.0));
    }
}
