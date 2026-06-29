//! Pipelined async GPU→CPU readback for the compositor.
//!
//! `PipelinedReadback` holds `depth` slots (texture + buffer). Each frame renders
//! into the next free slot, `map_async` is launched immediately, and the CPU
//! collects the previous frame's result without blocking. This removes the
//! synchronous `device.poll(wait_indefinitely)` on every export frame.

use std::collections::BTreeMap;
use std::sync::mpsc::{Receiver, TryRecvError};

use anyhow::{anyhow, Result};

use crate::compositor::gpu_utils::create_readback_target;
use crate::compositor::Compositor;

pub(crate) enum SlotState {
    Idle,
    InFlight {
        frame: u64,
        map_rx: Receiver<Result<(), wgpu::BufferAsyncError>>,
    },
}

pub(crate) struct ReadbackSlot {
    pub(crate) texture: wgpu::Texture,
    pub(crate) view: wgpu::TextureView,
    pub(crate) buffer: wgpu::Buffer,
    pub(crate) state: SlotState,
    pub(crate) aligned_row_bytes: usize,
}

pub struct PipelinedReadback {
    pub(crate) dev_id: usize,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) row_bytes: usize,
    pub(crate) slots: Vec<ReadbackSlot>,
    pub(crate) next_slot: usize,
    pub(crate) frame_seq: u64,
    /// Ready frames waiting for ordered output by `frame_seq`.
    pub(crate) pending: BTreeMap<u64, Vec<u8>>,
    /// How many frames have already been emitted via `collect`.
    pub(crate) emitted: u64,
}

impl PipelinedReadback {
    pub fn new(
        device: &wgpu::Device,
        dev_id: usize,
        width: u32,
        height: u32,
        depth: usize,
    ) -> Self {
        let row_bytes = width as usize * 4;
        let depth = depth.max(2);
        let mut slots = Vec::with_capacity(depth);
        for i in 0..depth {
            let (texture, view, buffer, aligned_row_bytes) =
                create_readback_target(device, &format!("pipelined-{i}"), width, height);
            slots.push(ReadbackSlot {
                texture,
                view,
                buffer,
                state: SlotState::Idle,
                aligned_row_bytes,
            });
        }
        Self {
            dev_id,
            width,
            height,
            row_bytes,
            slots,
            next_slot: 0,
            frame_seq: 0,
            pending: BTreeMap::new(),
            emitted: 0,
        }
    }

    /// True if this session already targets the given device and dimensions, so a
    /// caller can reuse it instead of recreating GPU resources every frame.
    pub fn matches(&self, dev_id: usize, width: u32, height: u32) -> bool {
        self.dev_id == dev_id && self.width == width && self.height == height
    }

    /// Insert a ready frame, keeping `pending` sorted by `frame_seq`.
    ///
    /// Slots may become ready out of order (especially when depth > 2). Output must
    /// still wait for `emitted`, otherwise a later frame that mapped first could be
    /// sent to the encoder ahead of an older frame.
    pub(crate) fn push_pending(&mut self, frame: u64, pixels: Vec<u8>) {
        self.pending.insert(frame, pixels);
    }

    pub(crate) fn pop_next_ready(&mut self) -> Option<Vec<u8>> {
        pop_next_ordered(&mut self.pending, &mut self.emitted)
    }

    /// Block and collect all remaining in-flight frames.
    pub fn drain(&mut self, compositor: &mut Compositor) -> Result<Vec<Vec<u8>>> {
        let mut out = Vec::new();
        for i in 0..self.slots.len() {
            if !matches!(self.slots[i].state, SlotState::Idle) {
                compositor.drain_slot(self, i)?;
            }
        }
        while let Some(pixels) = self.pop_next_ready() {
            out.push(pixels);
        }
        Ok(out)
    }
}

fn pop_next_ordered(pending: &mut BTreeMap<u64, Vec<u8>>, emitted: &mut u64) -> Option<Vec<u8>> {
    let pixels = pending.remove(emitted)?;
    *emitted += 1;
    Some(pixels)
}

/// RAII guard that ensures `buffer.unmap()` is called on drop unless disarmed.
/// Prevents leaving a buffer in a mapped state after a panic.
pub(crate) struct UnmapGuard<'a> {
    buffer: &'a wgpu::Buffer,
    unmapped: bool,
}

impl<'a> UnmapGuard<'a> {
    pub(crate) fn new(buffer: &'a wgpu::Buffer) -> Self {
        Self {
            buffer,
            unmapped: false,
        }
    }

    pub(crate) fn disarm(mut self) {
        self.unmapped = true;
    }
}

impl<'a> Drop for UnmapGuard<'a> {
    fn drop(&mut self) {
        if !self.unmapped {
            self.buffer.unmap();
        }
    }
}

fn take_ready_frame(state: &mut SlotState) -> Result<Option<u64>> {
    match std::mem::replace(state, SlotState::Idle) {
        SlotState::Idle => Ok(None),
        SlotState::InFlight { frame, map_rx } => match map_rx.try_recv() {
            Ok(Ok(())) => Ok(Some(frame)),
            Ok(Err(e)) => Err(anyhow!("buffer map: {e:?}")),
            Err(TryRecvError::Empty) => {
                *state = SlotState::InFlight { frame, map_rx };
                Ok(None)
            }
            Err(TryRecvError::Disconnected) => Err(anyhow!("buffer map disconnected")),
        },
    }
}

/// Collect all slots whose async map has already completed.
pub(crate) fn collect_ready_slots(session: &mut PipelinedReadback) -> Result<()> {
    for i in 0..session.slots.len() {
        let Some(frame) = take_ready_frame(&mut session.slots[i].state)? else {
            continue;
        };

        {
            let slot = &session.slots[i];
            let guard = UnmapGuard::new(&slot.buffer);
            let mapped = slot.buffer.slice(..).get_mapped_range();
            let mut out = Vec::with_capacity(session.row_bytes * session.height as usize);
            for row in 0..session.height as usize {
                let start = row * slot.aligned_row_bytes;
                out.extend_from_slice(&mapped[start..start + session.row_bytes]);
            }
            drop(mapped);
            slot.buffer.unmap();
            guard.disarm();
            session.push_pending(frame, out);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn take_ready_frame_idle_returns_none() {
        let mut state = SlotState::Idle;
        assert!(take_ready_frame(&mut state).unwrap().is_none());
        assert!(matches!(state, SlotState::Idle));
    }

    #[test]
    fn take_ready_frame_inflight_with_pending_result_returns_frame() {
        let (tx, rx) = std::sync::mpsc::channel();
        tx.send(Ok(())).unwrap();
        let mut state = SlotState::InFlight {
            frame: 42,
            map_rx: rx,
        };
        assert_eq!(take_ready_frame(&mut state).unwrap(), Some(42));
        assert!(matches!(state, SlotState::Idle));
    }

    #[test]
    fn take_ready_frame_inflight_with_empty_channel_stays_inflight() {
        let (_tx, rx) = std::sync::mpsc::channel();
        let mut state = SlotState::InFlight {
            frame: 7,
            map_rx: rx,
        };
        assert!(take_ready_frame(&mut state).unwrap().is_none());
        assert!(matches!(state, SlotState::InFlight { frame: 7, .. }));
    }

    #[test]
    fn take_ready_frame_inflight_with_buffer_error_returns_error() {
        let (tx, rx) = std::sync::mpsc::channel();
        tx.send(Err(wgpu::BufferAsyncError)).unwrap();
        let mut state = SlotState::InFlight {
            frame: 1,
            map_rx: rx,
        };
        assert!(take_ready_frame(&mut state).is_err());
    }

    #[test]
    fn take_ready_frame_inflight_with_disconnected_channel_returns_error() {
        let (_tx, rx) = std::sync::mpsc::channel();
        drop(_tx);
        let mut state = SlotState::InFlight {
            frame: 99,
            map_rx: rx,
        };
        assert!(take_ready_frame(&mut state).is_err());
    }

    #[test]
    fn pop_next_ordered_waits_for_missing_older_frame() {
        let mut pending = BTreeMap::new();
        let mut emitted = 0;
        pending.insert(1, vec![1]);

        assert_eq!(pop_next_ordered(&mut pending, &mut emitted), None);
        assert_eq!(emitted, 0);
        assert!(pending.contains_key(&1));
    }

    #[test]
    fn pop_next_ordered_emits_contiguous_frames_only() {
        let mut pending = BTreeMap::new();
        let mut emitted = 0;
        pending.insert(2, vec![2]);
        pending.insert(0, vec![0]);
        pending.insert(1, vec![1]);

        assert_eq!(pop_next_ordered(&mut pending, &mut emitted), Some(vec![0]));
        assert_eq!(pop_next_ordered(&mut pending, &mut emitted), Some(vec![1]));
        assert_eq!(pop_next_ordered(&mut pending, &mut emitted), Some(vec![2]));
        assert_eq!(pop_next_ordered(&mut pending, &mut emitted), None);
        assert_eq!(emitted, 3);
    }
}
