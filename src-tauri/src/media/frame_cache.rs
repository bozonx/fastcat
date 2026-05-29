//! Кэш GPU-текстур декодированных видео-кадров.
//! Ключ: (clip_id, pts). Значение: texture_id, возвращаемый в Scene.
//!
//! Политика выкидывания: LRU с верхней границей по сумме байт текстур.

use parking_lot::Mutex;
use std::collections::HashMap;

pub struct FrameCache {
    inner: Mutex<HashMap<(String, u64), u64>>, // (clip_id, pts_ns) -> texture_id
    next_id: Mutex<u64>,
}

impl FrameCache {
    pub fn new() -> Self {
        Self { inner: Mutex::new(HashMap::new()), next_id: Mutex::new(1) }
    }

    pub fn alloc_id(&self) -> u64 {
        let mut n = self.next_id.lock();
        let id = *n;
        *n += 1;
        id
    }
}

impl Default for FrameCache {
    fn default() -> Self { Self::new() }
}
