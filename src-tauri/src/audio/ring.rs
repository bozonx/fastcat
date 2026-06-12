use std::sync::atomic::{AtomicUsize, Ordering};

/// Lock-free SPSC ring buffer for real-time audio output.
/// Uses atomic read/write indices and bit-casts f32 samples into AtomicU32
/// slots so the backing buffer is plain atomics (no mutex/alloc on hot path).
pub(crate) struct SpscRingBuffer {
    buffer: Vec<std::sync::atomic::AtomicU32>,
    write_idx: AtomicUsize,
    read_idx: AtomicUsize,
}

impl SpscRingBuffer {
    pub(crate) fn new(capacity: usize) -> Self {
        let mut buffer = Vec::with_capacity(capacity);
        for _ in 0..capacity {
            buffer.push(std::sync::atomic::AtomicU32::new(0));
        }
        Self {
            buffer,
            write_idx: AtomicUsize::new(0),
            read_idx: AtomicUsize::new(0),
        }
    }

    pub(crate) fn len(&self) -> usize {
        let write = self.write_idx.load(Ordering::Acquire);
        let read = self.read_idx.load(Ordering::Acquire);
        let used = write.wrapping_sub(read);
        let capacity = self.buffer.len();
        if used > capacity {
            0
        } else {
            used
        }
    }

    pub(crate) fn clear(&self) {
        // SeqCst guarantees the store is visible to the real-time callback
        // and the producer thread before any subsequent push/pop.
        let write = self.write_idx.load(Ordering::SeqCst);
        self.read_idx.store(write, Ordering::SeqCst);
        std::sync::atomic::fence(Ordering::SeqCst);
    }

    /// Push as many samples as capacity allows. Returns count written.
    /// Single-producer: the data slots are written with Relaxed ordering and a
    /// single Release store of `write_idx` publishes them all to the consumer,
    /// instead of a per-sample Release (which serialized the hot path).
    pub(crate) fn push_slice(&self, samples: &[f32]) -> usize {
        let capacity = self.buffer.len();
        let write = self.write_idx.load(Ordering::Relaxed);
        let read = self.read_idx.load(Ordering::Acquire);
        let used = write.wrapping_sub(read);
        if used > capacity {
            return 0;
        }
        let available = capacity - used;
        let to_write = samples.len().min(available);
        for (i, &sample) in samples.iter().take(to_write).enumerate() {
            let idx = write.wrapping_add(i) % capacity;
            self.buffer[idx].store(sample.to_bits(), Ordering::Relaxed);
        }
        self.write_idx
            .store(write.wrapping_add(to_write), Ordering::Release);
        to_write
    }

    /// Pop up to `out.len()` samples. Returns count read.
    #[allow(clippy::needless_range_loop)]
    pub(crate) fn pop_slice(&self, out: &mut [f32]) -> usize {
        let w = self.write_idx.load(Ordering::Acquire);
        let r = self.read_idx.load(Ordering::Relaxed);
        let used = w.wrapping_sub(r);
        if used > self.buffer.len() {
            return 0;
        }
        let available = used.min(out.len());
        if available == 0 {
            return 0;
        }
        let capacity = self.buffer.len();
        let start = r % capacity;
        let end = start + available;
        if end <= capacity {
            for i in 0..available {
                out[i] = f32::from_bits(self.buffer[start + i].load(Ordering::Relaxed));
            }
        } else {
            let first = capacity - start;
            for i in 0..first {
                out[i] = f32::from_bits(self.buffer[start + i].load(Ordering::Relaxed));
            }
            for i in first..available {
                out[i] = f32::from_bits(self.buffer[i - first].load(Ordering::Relaxed));
            }
        }
        // Advance the read cursor with a compare-exchange against the value we
        // started from, NOT a blind store. A blind store races the producer's
        // `clear()` (the only other writer of `read_idx`): if a clear lands while
        // this callback is mid-pop, a `store(r + available)` would roll `read_idx`
        // back past the cleared point and make up to a full prebuffer (~800ms) of
        // already-discarded pre-seek audio readable again — heard as a stale burst
        // right after a seek/flush. On a lost CAS the clear won; we leave the
        // cursor where the clear put it and drop this (now-stale) advance. The
        // handful of samples already copied to the device this call is at most one
        // callback of glitch, vastly preferable to replaying the whole ring.
        let _ = self.read_idx.compare_exchange(
            r,
            r.wrapping_add(available),
            Ordering::AcqRel,
            Ordering::Acquire,
        );
        available
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_buffer_push_pop_round_trip() {
        let ring = SpscRingBuffer::new(16);
        let in_samples = vec![0.25, -0.5, 0.75, -0.25];
        assert_eq!(ring.push_slice(&in_samples), 4);
        let mut out = [0.0f32; 4];
        assert_eq!(ring.pop_slice(&mut out), 4);
        assert_eq!(out, [0.25, -0.5, 0.75, -0.25]);
    }

    #[test]
    fn ring_buffer_drops_excess_push() {
        let ring = SpscRingBuffer::new(4);
        let in_samples = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        assert_eq!(ring.push_slice(&in_samples), 4);
        let mut out = [0.0f32; 5];
        assert_eq!(ring.pop_slice(&mut out), 4);
        assert_eq!(out, [1.0, 2.0, 3.0, 4.0, 0.0]);
    }

    #[test]
    fn ring_buffer_clear_empties() {
        let ring = SpscRingBuffer::new(8);
        ring.push_slice(&[1.0, 2.0, 3.0]);
        ring.clear();
        assert_eq!(ring.len(), 0);
        let mut out = [0.0f32; 3];
        assert_eq!(ring.pop_slice(&mut out), 0);
    }

    #[test]
    fn ring_buffer_wraparound() {
        let ring = SpscRingBuffer::new(4);
        ring.push_slice(&[1.0, 2.0]);
        let mut out = [0.0f32; 2];
        ring.pop_slice(&mut out);
        ring.push_slice(&[3.0, 4.0, 5.0]);
        let mut out2 = [0.0f32; 4];
        assert_eq!(ring.pop_slice(&mut out2), 3);
        assert_eq!(out2[..3], [3.0, 4.0, 5.0]);
    }
}
