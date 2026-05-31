//! Глобальный ограничитель параллелизма «тяжёлых» операций открытия медиа.
//!
//! Каждый видеослой при загрузке делает `ffprobe` + спавн `ffmpeg` + первичный декод —
//! это всплеск CPU/процессов. При сцене с многими video/image/svg-слоями (или при быстром
//! скрабе, когда слои часто появляются/исчезают) без ограничителя стартует столько же
//! параллельных тяжёлых открытий. Семафор ограничивает число ОДНОВРЕМЕННЫХ открытий;
//! продолжающийся декод живёт в своём потоке уже без пермита (число живых ffmpeg-процессов
//! всё равно ограничено числом одновременно видимых видеослоёв).
//!
//! Это нативный аналог идеи браузерного `io-governor` (см. `src/utils/io/`), но без
//! `SharedArrayBuffer`/OPFS-семантики: в Tauri доступ к ФС прямой, ограничивать нужно
//! именно параллелизм декодеров/процессов, а не датапайпы Chromium.

use std::sync::OnceLock;

use parking_lot::{Condvar, Mutex};

/// Простой счётный семафор (std не предоставляет блокирующего семафора, tokio —
/// только async; здесь нужен блокирующий из обычных потоков).
pub struct Semaphore {
    permits: Mutex<usize>,
    available: Condvar,
}

impl Semaphore {
    pub fn new(permits: usize) -> Self {
        Self {
            permits: Mutex::new(permits.max(1)),
            available: Condvar::new(),
        }
    }

    /// Блокирует поток, пока не освободится пермит. Пермит держится живым через guard
    /// и автоматически возвращается при его drop.
    pub fn acquire(&self) -> SemaphorePermit<'_> {
        let mut guard = self.permits.lock();
        while *guard == 0 {
            self.available.wait(&mut guard);
        }
        *guard -= 1;
        SemaphorePermit { sem: self }
    }

    fn release(&self) {
        let mut guard = self.permits.lock();
        *guard += 1;
        self.available.notify_one();
    }
}

pub struct SemaphorePermit<'a> {
    sem: &'a Semaphore,
}

impl Drop for SemaphorePermit<'_> {
    fn drop(&mut self) {
        self.sem.release();
    }
}

static DECODER_LOAD_GATE: OnceLock<Semaphore> = OnceLock::new();

/// Глобальный гейт открытий медиа-декодеров. Лениво инициализируется по числу ядер.
pub fn decoder_load_gate() -> &'static Semaphore {
    DECODER_LOAD_GATE.get_or_init(|| Semaphore::new(default_permits()))
}

/// Половина логических ядер, зажатая в [2; 4]: достаточно для параллельной загрузки,
/// но не насыщает CPU пачкой одновременных ffmpeg-стартов.
fn default_permits() -> usize {
    std::thread::available_parallelism()
        .map(|n| (n.get() / 2).clamp(2, 4))
        .unwrap_or(2)
}
