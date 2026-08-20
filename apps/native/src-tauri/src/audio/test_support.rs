//! Shared test doubles for the audio engine.
//!
//! Available to in-crate unit tests (`cfg(test)`) and to external integration
//! tests under `tests/` when the crate is built with the `test-support`
//! feature. This lets a [`crate::audio::engine::NativeAudioEngine`] be driven on
//! headless CI without opening a real `cpal` output device.

use std::sync::Arc;

use anyhow::Result;

use crate::audio::clock::RealtimeClock;
use crate::audio::output::{AudioBackend, AudioStream};
use crate::audio::ring::SpscRingBuffer;

/// An [`AudioStream`] that does nothing — no real device is started.
pub struct MockAudioStream;

impl AudioStream for MockAudioStream {
    fn play(&self) -> Result<()> {
        Ok(())
    }
}

/// An [`AudioBackend`] that reports a fixed format and never touches hardware,
/// so the mixing / clock / ring machinery can be exercised offline.
pub struct MockAudioBackend {
    pub sample_rate: u32,
    pub channels: u16,
}

impl MockAudioBackend {
    /// The common 48 kHz stereo configuration.
    pub fn stereo_48k() -> Self {
        Self {
            sample_rate: 48_000,
            channels: 2,
        }
    }
}

impl AudioBackend for MockAudioBackend {
    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn channels(&self) -> u16 {
        self.channels
    }

    fn build_output_stream(
        &self,
        _ring: Arc<SpscRingBuffer>,
        _clock: Arc<RealtimeClock>,
    ) -> Result<Box<dyn AudioStream>> {
        Ok(Box::new(MockAudioStream))
    }
}
