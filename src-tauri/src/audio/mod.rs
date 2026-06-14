//! Native audio engine for the monitor/preview and offline export.
//!
//! Pipeline: `producer` thread mixes the scene into 50 ms chunks (`mix` +
//! `decode` + `resample`) and pushes them into a lock-free `ring`; the cpal
//! `output` callback drains the ring into the device. `clock` is the lock-free
//! state shared with that callback; `shared` is the mutex-guarded mix state.
//!
//! Invariants worth preserving across refactors (each was a real bug once — see
//! the audio-monitor crackle/dropout history):
//!
//! 1. **Render at the device's true rate.** The mix is produced at the cpal
//!    stream's sample rate and the device must consume ~that many frames/sec.
//!    Opening a rate the audio graph doesn't run (e.g. 44100 on a 48000-only
//!    PipeWire graph), or forcing a `BufferSize::Fixed` that fights the graph's
//!    native period, makes the device over/under-consume → playback is sped
//!    up/slowed and pitch-shifted. `output::choose_output_config` prefers the
//!    graph rate; the producer's effective-rate guard warns on >2% drift.
//!
//! 2. **`audible_pts_sec` must NOT subtract the ring.** `clock.frames()` counts
//!    frames already CONSUMED by the device; the ring holds FUTURE audio. The
//!    audible position is `origin + (consumed − hw_latency)/sr`. Subtracting the
//!    ring makes the reported playhead lurch backward as the ring fills (video,
//!    slaved to this pts, jumps back).
//!
//! 3. **Never decode a whole streaming file on the producer thread.** A multi-
//!    -ms decode spike misses the realtime deadline AND starves the cpal callback
//!    (device xrun) → crackle. Streaming clips are decoded once on a BACKGROUND
//!    thread into `decoded_cache` (`decode::maybe_spawn_background_precache`); the
//!    producer streams only until that lands, then mixes from a cheap memcpy.
//!
//! 4. **Don't flush/reseek for a redundant in-place seek during playback.** The
//!    native engine is the master clock; the frontend echoes it back as seeks. A
//!    seek to ~the current position must be a no-op (`engine::seek`'s guard), or
//!    it wipes the prebuffer and resets decoders every tick → constant crackle.

pub mod engine;
mod ffmpeg_decode;
pub mod peaks;
pub mod plugins;

mod clock;
mod decode;
pub mod mix;
mod output;
mod producer;
mod resample;
mod ring;
mod shared;
