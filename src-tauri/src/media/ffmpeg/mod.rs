//! FFmpeg integration, grouped: CLI argument builders, process runner, shared
//! utilities (codec/encoder mapping, sizing, binary verification) and the
//! hardware-acceleration configuration.

pub mod args;
pub mod hw;
pub mod runner;
pub mod utils;

pub use args::*;
pub use hw::{FfmpegHwOptions, FfmpegHwSettings};
pub use utils::*;
