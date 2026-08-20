//! Per-layer cache of decoded video frames + the frame-selection policy (sampler).
//!
//! Why: previously any backward seek respawned ffmpeg and re-decoded from the keyframe
//! — expensive while scrubbing. The cache holds a "window" of recently decoded frames
//! around the current position; scrubbing within the window is served without restarting
//! the decoder.
//!
//! This is the native analogue of `VideoFrameCache` + `FrameSampleOrchestrator` from the
//! old web core:
//! - the cache (`VideoFrameCache`) — store/evict frames by PTS index;
//! - the sampler — pick a frame for a moment in time (`frame_le` — the frame with PTS ≤
//!   target) plus the "farthest from the current position" eviction heuristic (scrub
//!   locality).
//!
//! Memory is bounded by a byte budget per layer; the evicted frame is the one farthest
//! by index from the last requested time.

use std::collections::BTreeMap;
use std::sync::Arc;

use vello::peniko::ImageData;

/// One decoded frame inside the source (PTS in seconds).
///
/// A GPU-resident frame holds `texture` (an Arc to a `wgpu::Texture`) — the texture lives
/// exactly as long as the frame is in the cache or being shown (`current`), with no
/// separate global cache with independent eviction. `image` (a CPU RGBA blob) is held ONLY
/// as a fallback when GPU upload is unavailable (the decoder has no wgpu device): otherwise
/// it would be a pure duplicate of the GPU frame (~8 MB @1080p per frame wasted).
#[derive(Clone)]
pub struct DecodedVideoFrame {
    pub pts_sec: f64,
    pub image: Option<ImageData>,
    pub texture: Option<Arc<crate::media::SharedTexture>>,
}

const MIN_FRAMES: usize = 6;
const MAX_FRAMES: usize = 300;

pub struct VideoFrameCache {
    fps: f64,
    capacity: usize,
    /// The key is the PTS quantized to milliseconds (`round(pts * 1000)`): an absolute
    /// position in the source, stable across decoder generations (same file+scale). A
    /// millisecond grid (rather than `round(pts*fps)`) does not collapse adjacent frames on
    /// VFR sources, where the real inter-frame interval is not 1/avg_fps.
    frames: BTreeMap<i64, DecodedVideoFrame>,
    /// The last requested key (ms) — the locality center for eviction.
    last_request: i64,
}

/// Quantization of PTS (seconds) into the cache key — milliseconds.
const CACHE_KEY_HZ: f64 = 1000.0;

impl VideoFrameCache {
    pub fn new(fps: f64, frame_bytes: usize, cache_budget_bytes: usize) -> Self {
        let capacity = cache_budget_bytes
            .checked_div(frame_bytes)
            .map(|n| {
                if n == 0 {
                    0
                } else {
                    n.clamp(MIN_FRAMES, MAX_FRAMES)
                }
            })
            .unwrap_or(0);
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

    /// Inserts a frame. Evicted/overwritten frames release their GPU texture
    /// automatically via the Arc's `Drop` — no separate synchronization with an external
    /// cache is needed.
    pub fn insert(&mut self, frame: DecodedVideoFrame) {
        if self.capacity == 0 {
            self.frames.clear();
            return;
        }

        let key = self.index_of(frame.pts_sec);
        self.frames.insert(key, frame);
        self.evict();
    }

    /// The frame with the greatest PTS ≤ target (what should be on screen at `target`).
    pub fn frame_le(&mut self, target_pts: f64) -> Option<DecodedVideoFrame> {
        let key = self.index_of(target_pts);
        self.last_request = key;
        self.frames
            .range(..=key)
            .next_back()
            .map(|(_, f)| f.clone())
    }

    /// The frame with the greatest PTS ≤ target, but only if it has not fallen further
    /// behind than the allowed AV-sync window.
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

    /// The frame with the greatest PTS ≤ target, or, if there is none, the first frame in
    /// the interval (target, target + max_lead_sec]. Lets the nearest frame be shown while
    /// paused even if it lies slightly in the future due to an inexact seek / PTS rounding.
    pub fn frame_le_with_lead(
        &mut self,
        target_pts: f64,
        max_lead_sec: f64,
    ) -> Option<DecodedVideoFrame> {
        let key = self.index_of(target_pts);
        self.last_request = key;

        // First look for a frame with PTS ≤ target_pts (a proper floor)
        if let Some((_, f)) = self.frames.range(..=key).next_back() {
            return Some(f.clone());
        }

        // If none found, look for the first frame within max_lead_sec
        let lead_key = self.index_of(target_pts + max_lead_sec);
        if let Some((_, f)) = self.frames.range(key..=lead_key).next() {
            return Some(f.clone());
        }

        None
    }

    /// Whether the cache has a frame within `tolerance_frames` of target (for fast-path seek).
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
        // Keys are in milliseconds → convert the tolerance from frames to ms via fps.
        let tolerance_ms = ((tolerance_frames as f64) * CACHE_KEY_HZ / self.fps).round() as i64;
        best <= tolerance_ms
    }

    /// Re-centers the eviction locality (the point eviction measures "farthest from")
    /// on `pts_sec`. Normally `last_request` tracks reads, but a seek changes where the
    /// decoder will produce frames BEFORE the first post-seek display read happens — so
    /// warm-up/prebuffer inserts in that gap would otherwise evict toward the stale OLD
    /// position, throwing away the frames just decoded around the new target.
    pub fn set_last_request(&mut self, pts_sec: f64) {
        self.last_request = self.index_of(pts_sec);
    }

    /// PTS (seconds) of the newest decoded frame in the cache. `None` — cache empty.
    /// Used by the decoder forward-progress detector (decode-bound 4K).
    pub fn newest_pts(&self) -> Option<f64> {
        self.frames
            .keys()
            .next_back()
            .map(|k| *k as f64 / CACHE_KEY_HZ)
    }

    /// Whether the cache has a frame with PTS ≥ `target_pts` (decoded "ahead" of the
    /// playhead). The warm-up readiness criterion before starting playback.
    pub fn has_frame_ge(&self, target_pts: f64) -> bool {
        let key = self.index_of(target_pts);
        self.frames.range(key..).next().is_some()
    }

    /// Whether the cache has a frame with PTS ≤ `target_pts` — i.e. a frame `frame_le`
    /// can show. During reverse playback this is the criterion that the decoder still
    /// covers the (decreasing) target from below; once it stops, a backward reseek is
    /// needed, otherwise the layer freezes.
    pub fn has_frame_le(&self, target_pts: f64) -> bool {
        let key = self.index_of(target_pts);
        self.frames.range(..=key).next_back().is_some()
    }

    pub fn is_disabled(&self) -> bool {
        self.capacity == 0
    }

    /// How many frames the cache can hold (budget / frame size, clamped to
    /// [MIN_FRAMES, MAX_FRAMES]). Used by future-clip warm-up so it doesn't decode
    /// further ahead than the cache can keep anyway (extra frames would be evicted
    /// immediately — decode time uselessly taken from the active layer).
    pub fn capacity(&self) -> usize {
        self.capacity
    }

    /// Distance (seconds) from `target` to the nearest cached frame.
    /// `None` — cache empty. Does not touch `last_request` (a pure query for heuristics).
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

    /// The nearest frame to `target` in either direction (to show while the decoder
    /// repositions, so the screen doesn't freeze during reverse/fast-forward).
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
            // Evict the frame farthest by index from the last request: during
            // scrubbing/playback, access locality is around the current position.
            let victim = choose_eviction_victim(self.frames.keys().copied(), self.last_request);
            match victim {
                // The evicted frame's GPU texture is released by dropping its Arc.
                Some(k) => {
                    self.frames.remove(&k);
                }
                None => break,
            }
        }
    }
}

/// Scrub-locality eviction pick: among cached frame keys (ms), the victim is the
/// one FARTHEST from `request` (the last requested position); ties resolve toward
/// the LARGER key. Order-independent, so it agrees with the previous
/// `max_by_key`-over-an-ascending-`BTreeMap` behaviour. This is the native twin of
/// the web `chooseEvictionVictimTime`
/// (src/utils/video-editor/compositor/VideoFrameCache.ts) and is pinned to it by
/// the shared `shared/parity/frame-cache-eviction.cases.json` parity fixture.
/// Returns `None` for an empty input.
pub fn choose_eviction_victim(keys: impl IntoIterator<Item = i64>, request: i64) -> Option<i64> {
    keys.into_iter().fold(None, |best, key| match best {
        None => Some(key),
        Some(b) => {
            let dk = (key - request).abs();
            let db = (b - request).abs();
            if dk > db || (dk == db && key > b) {
                Some(key)
            } else {
                Some(b)
            }
        }
    })
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

    fn cache() -> VideoFrameCache {
        VideoFrameCache::new(30.0, 4, 1024)
    }

    #[test]
    fn frame_le_returns_floor() {
        let mut c = cache();
        c.insert(frame(0.0));
        c.insert(frame(1.0));
        c.insert(frame(2.0));
        assert_eq!(c.frame_le(1.4).map(|f| f.pts_sec), Some(1.0));
        assert_eq!(c.frame_le(-1.0).map(|f| f.pts_sec), None);
    }

    #[test]
    fn frame_le_with_max_lag_rejects_stale_frames() {
        let mut c = cache();
        c.insert(frame(1.0));

        assert_eq!(
            c.frame_le_with_max_lag(1.05, 0.1).map(|f| f.pts_sec),
            Some(1.0)
        );
        assert_eq!(c.frame_le_with_max_lag(1.5, 0.1).map(|f| f.pts_sec), None);
    }

    #[test]
    fn frame_le_with_lead_allows_small_future_frames() {
        let mut c = cache();
        // We have only a future frame (1.001)
        c.insert(frame(1.001));

        // Query at position 1.000
        // Without lead - None
        assert_eq!(c.frame_le(1.000).map(|f| f.pts_sec), None);

        // With a 0.033 second lead (1 frame at 30fps) - should find 1.001
        assert_eq!(
            c.frame_le_with_lead(1.000, 0.033).map(|f| f.pts_sec),
            Some(1.001)
        );

        // Too small a lead (e.g. 0.0001) - won't find it
        assert_eq!(c.frame_le_with_lead(1.000, 0.0001).map(|f| f.pts_sec), None);

        // If both a past and a future frame exist, the past one wins (floor)
        c.insert(frame(0.999));
        assert_eq!(
            c.frame_le_with_lead(1.000, 0.033).map(|f| f.pts_sec),
            Some(0.999)
        );
    }

    #[test]
    fn regular_frame_floor_still_allows_holding_last_frame() {
        let mut c = cache();
        c.insert(frame(1.0));

        assert_eq!(c.frame_le(1.5).map(|f| f.pts_sec), Some(1.0));
    }

    #[test]
    fn vfr_frames_closer_than_avg_interval_do_not_collide() {
        // avg fps=30 → 33ms interval. Two frames 10ms apart (typical for VFR) would
        // collapse to one index under the old round(pts*fps) key; the ms key keeps them apart.
        let mut c = cache();
        c.insert(frame(1.00));
        c.insert(frame(1.01));
        assert_eq!(c.frames.len(), 2);
        assert_eq!(c.frame_le(1.005).map(|f| f.pts_sec), Some(1.00));
        assert_eq!(c.frame_le(1.02).map(|f| f.pts_sec), Some(1.01));
    }

    #[test]
    fn nearest_distance_picks_closest_side() {
        let mut c = cache();
        assert_eq!(c.nearest_distance_sec(1.0), None);
        c.insert(frame(1.0));
        c.insert(frame(3.0));
        assert!((c.nearest_distance_sec(1.2).unwrap() - 0.2).abs() < 1e-6);
        // Closer to 3.0 (0.4) than to 1.0 (0.6).
        assert!((c.nearest_distance_sec(2.6).unwrap() - 0.4).abs() < 1e-6);
    }

    #[test]
    fn frame_nearest_returns_either_side() {
        let mut c = cache();
        c.insert(frame(1.0));
        c.insert(frame(3.0));
        // An le miss (target < min) still yields the nearest frame, not None.
        assert_eq!(c.frame_nearest(0.0).map(|f| f.pts_sec), Some(1.0));
        assert_eq!(c.frame_nearest(2.9).map(|f| f.pts_sec), Some(3.0));
        assert_eq!(c.frame_nearest(1.9).map(|f| f.pts_sec), Some(1.0));
    }

    #[test]
    fn newest_pts_and_has_frame_ge_track_forward_decode() {
        let mut c = cache();
        assert_eq!(c.newest_pts(), None);
        assert!(!c.has_frame_ge(0.0));
        c.insert(frame(1.0));
        c.insert(frame(2.0));
        assert_eq!(c.newest_pts(), Some(2.0));
        // There is a frame at/after the playhead.
        assert!(c.has_frame_ge(1.5));
        assert!(c.has_frame_ge(2.0));
        // The decoder hasn't reached 2.5 yet — not ready.
        assert!(!c.has_frame_ge(2.5));
    }

    #[test]
    fn has_frame_le_tracks_backward_coverage_for_reverse() {
        let mut c = cache();
        assert!(!c.has_frame_le(5.0));
        c.insert(frame(2.0));
        c.insert(frame(3.0));
        // Reverse target within/above coverage — a frame ≤ target exists.
        assert!(c.has_frame_le(2.0));
        assert!(c.has_frame_le(2.5));
        assert!(c.has_frame_le(10.0));
        // Target dropped below the earliest frame — no frame ≤ target → reseek needed.
        assert!(!c.has_frame_le(1.9));
    }

    /// Cross-engine parity contract. This test and the web test
    /// `test/unit/utils/video-editor/frame-cache-eviction.parity.test.ts` read the
    /// SAME fixture, so the native `choose_eviction_victim` and the web
    /// `chooseEvictionVictimTime` can never drift apart on the scrub-locality
    /// eviction heuristic.
    #[test]
    fn eviction_victim_matches_shared_parity_fixture() {
        const FIXTURE: &str =
            include_str!("../../../../../packages/shared/parity/frame-cache-eviction.cases.json");
        let parsed: serde_json::Value =
            serde_json::from_str(FIXTURE).expect("valid parity fixture json");
        let cases = parsed["cases"].as_array().expect("cases array");
        assert!(!cases.is_empty(), "fixture has cases");
        for c in cases {
            let name = c["name"].as_str().unwrap_or("?");
            let ticks: Vec<i64> = c["frameTicks"]
                .as_array()
                .expect("frameTicks array")
                .iter()
                .map(|v| v.as_i64().expect("integer tick"))
                .collect();
            let request = c["requestTick"].as_i64().expect("requestTick");
            let want = c["expectedVictimTick"]
                .as_i64()
                .expect("expectedVictimTick");
            let got = choose_eviction_victim(ticks.iter().copied(), request);
            assert_eq!(got, Some(want), "case `{name}`");
        }
    }

    /// Cross-engine parity contract. This test and the web test
    /// `test/unit/utils/video-editor/frame-le-sample-hold.parity.test.ts` read the
    /// SAME fixture, so the native `frame_le_with_max_lag` and the web `frameLe` stay
    /// pinned on the VFR-safe sample-and-hold lookup (greatest PTS <= target, rejected
    /// past the max-lag guard).
    #[test]
    fn frame_le_matches_shared_parity_fixture() {
        const FIXTURE: &str =
            include_str!("../../../../../packages/shared/parity/frame-le-sample-hold.cases.json");
        let parsed: serde_json::Value =
            serde_json::from_str(FIXTURE).expect("valid parity fixture json");
        let cases = parsed["cases"].as_array().expect("cases array");
        assert!(!cases.is_empty(), "fixture has cases");
        for c in cases {
            let name = c["name"].as_str().unwrap_or("?");
            // A generous byte budget so no eviction interferes with the lookup.
            let mut cache = VideoFrameCache::new(30.0, 4, usize::MAX);
            for pts_ms in c["framePtsMs"].as_array().expect("framePtsMs array") {
                let ms = pts_ms.as_f64().expect("integer ms");
                cache.insert(frame(ms / 1000.0));
            }
            let target = c["targetMs"].as_f64().expect("targetMs") / 1000.0;
            let max_lag = c["maxLagMs"].as_f64().expect("maxLagMs") / 1000.0;
            let got = cache
                .frame_le_with_max_lag(target, max_lag)
                .map(|f| (f.pts_sec * 1000.0).round() as i64);
            let want = c["expectedPtsMs"].as_i64();
            assert_eq!(got, want, "case `{name}`");
        }
    }

    #[test]
    fn has_near_within_tolerance() {
        let mut c = cache();
        c.insert(frame(1.0));
        assert!(c.has_near(1.0, 1));
        assert!(!c.has_near(5.0, 1));
    }

    #[test]
    fn evicts_to_capacity_keeping_locality() {
        // frame_bytes huge → capacity = MIN_FRAMES (6).
        let mut c = VideoFrameCache::new(30.0, usize::MAX, usize::MAX);
        for i in 0..20 {
            c.insert(frame(i as f64));
        }
        // Request near the end — frames far from it (near zero) should be evicted.
        let _ = c.frame_le(19.0);
        c.insert(frame(20.0));
        assert!(c.frames.len() <= MIN_FRAMES + 1);
        assert!(c.frame_le(0.5).map(|f| f.pts_sec) != Some(0.0));
    }

    #[test]
    fn set_last_request_recenters_eviction_before_any_read() {
        // capacity = MIN_FRAMES (6). A seek re-centers locality at 19s BEFORE any read,
        // so warm-up inserts around there keep those frames and evict the far-away ones.
        let mut c = VideoFrameCache::new(30.0, usize::MAX, usize::MAX);
        c.set_last_request(19.0);
        for i in 0..20 {
            c.insert(frame(i as f64));
        }
        // The frame at the new target is retained; the near-zero frames are gone.
        assert_eq!(c.frame_le(19.0).map(|f| f.pts_sec), Some(19.0));
        assert!(c.frame_le(0.5).map(|f| f.pts_sec) != Some(0.0));
    }

    #[test]
    fn zero_budget_disables_rotating_cache() {
        let mut c = VideoFrameCache::new(30.0, 4, 0);
        c.insert(frame(1.0));
        assert!(c.is_disabled());
        assert_eq!(c.frame_le(1.0).map(|f| f.pts_sec), None);
        assert!(!c.has_frame_ge(1.0));
    }
}
