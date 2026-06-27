//! Shared helpers for the native integration tests.
//!
//! These tests exercise the real engines end-to-end: they run `ffmpeg`/`ffprobe`,
//! decode the synthetic media fixtures in `test/fixtures/media`, touch the
//! filesystem (temp dirs), and — for the export suite — drive the GPU
//! compositor. Anything the host can't provide (ffmpeg, a GPU adapter) is
//! detected here so the affected tests skip with a message instead of failing.

#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::process::Command;

/// Absolute path to `test/fixtures/media` (sibling of `src-tauri`).
pub fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../test/fixtures/media")
        .canonicalize()
        .expect("fixtures dir should exist (run scripts/generate-test-fixtures.sh)")
}

/// Resolve a fixture by its path relative to `test/fixtures/media`.
pub fn fixture(relative: &str) -> PathBuf {
    fixtures_dir().join(relative)
}

fn tool_available(tool: &str) -> bool {
    Command::new(tool)
        .arg("-version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Whether `ffprobe` is callable on this host.
pub fn has_ffprobe() -> bool {
    tool_available("ffprobe")
}

/// Whether `ffmpeg` is callable on this host.
pub fn has_ffmpeg() -> bool {
    tool_available("ffmpeg")
}

/// Whether the local ffmpeg binary advertises a specific encoder.
pub fn has_ffmpeg_encoder(encoder: &str) -> bool {
    Command::new("ffmpeg")
        .args(["-hide_banner", "-encoders"])
        .output()
        .map(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).contains(encoder))
        .unwrap_or(false)
}

/// Run ffprobe and return the value of a single stream/format entry, e.g.
/// `ffprobe_entry(path, "stream=codec_name", Some("a:0"))`.
pub fn ffprobe_entry(path: &Path, entry: &str, select: Option<&str>) -> String {
    let mut cmd = Command::new("ffprobe");
    cmd.args(["-v", "error"]);
    if let Some(sel) = select {
        cmd.args(["-select_streams", sel]);
    }
    cmd.args(["-show_entries", entry])
        .args(["-of", "default=noprint_wrappers=1:nokey=1"])
        .arg(path);
    let output = cmd.output().expect("ffprobe should run");
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

/// Skip the current test (early-return) with an explanatory note when a
/// precondition isn't met. Rust has no built-in test skip, so we print and
/// return — the test still counts as passed, which keeps CI green on hosts that
/// lack ffmpeg or a GPU.
#[macro_export]
macro_rules! skip_unless {
    ($cond:expr, $reason:expr) => {
        if !($cond) {
            eprintln!("SKIP {}: {}", module_path!(), $reason);
            return;
        }
    };
}
