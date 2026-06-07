//! Pipelined async GPU→CPU readback for the compositor.
//!
//! `PipelinedReadback` holds `depth` slots (texture + buffer). Each frame renders
//! into the next free slot, `map_async` is launched immediately, and the CPU
//! collects the previous frame's result without blocking. This removes the
//! synchronous `device.poll(wait_indefinitely)` on every export frame.

use std::collections::VecDeque;
use std::sync::mpsc::{Receiver, TryRecvError};

use anyhow::{anyhow, Result};

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
    pub(crate) pending: VecDeque<(u64, Vec<u8>)>,
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
        let aligned_row_bytes = (row_bytes + 255) & !255;
        let buffer_size = (aligned_row_bytes * height as usize) as u64;
        let depth = depth.max(2);
        let mut slots = Vec::with_capacity(depth);
        for i in 0..depth {
            let texture = device.create_texture(&wgpu::TextureDescriptor {
                label: Some(&format!("pipelined-offscreen-{i}")),
                size: wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_SRC,
                view_formats: &[],
            });
            let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
            let buffer = device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(&format!("pipelined-readback-{i}")),
                size: buffer_size,
                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                mapped_at_creation: false,
            });
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
            pending: VecDeque::new(),
            emitted: 0,
        }
    }

    /// Insert a ready frame, keeping `pending` sorted by `frame_seq`.
    ///
    /// Slots may become ready out of order (especially when depth > 2), but
    /// output goes through `pop_front`, so sorted insertion guarantees frames
    /// leave to the encoder in strict render order.
    pub(crate) fn push_pending(&mut self, frame: u64, pixels: Vec<u8>) {
        let pos = self
            .pending
            .iter()
            .position(|(f, _)| *f > frame)
            .unwrap_or(self.pending.len());
        self.pending.insert(pos, (frame, pixels));
    }

    /// Block and collect all remaining in-flight frames.
    pub fn drain(&mut self, compositor: &mut Compositor) -> Result<Vec<Vec<u8>>> {
        let mut out = Vec::new();
        for i in 0..self.slots.len() {
            if !matches!(self.slots[i].state, SlotState::Idle) {
                compositor.drain_slot(self, i)?;
            }
        }
        while let Some((_, pixels)) = self.pending.pop_front() {
            out.push(pixels);
            self.emitted += 1;
        }
        Ok(out)
    }
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
