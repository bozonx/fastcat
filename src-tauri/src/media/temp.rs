//! Ephemeral temp-file management for native media work.
//!
//! Every transient artifact FastCat writes to the OS temp dir (currently the
//! offline export audio mix) goes through here so that:
//!
//! 1. Files are deleted even when the call site is skipped — early `?` returns,
//!    panics mid-export, or a hard process kill (see [`TempFile`] + [`sweep_orphans`]).
//! 2. In dev the temp dir is redirected under the dev root so concurrent checkouts
//!    stay isolated and artifacts sit next to the emulated OS tree the frontend
//!    builds (see [`set_dev_temp_root`]).

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use parking_lot::RwLock;

/// Prefix shared by every ephemeral file FastCat writes, so [`sweep_orphans`]
/// can recognise and reclaim leftovers from crashed runs without touching
/// unrelated files in a shared temp dir.
pub const TEMP_PREFIX: &str = "fastcat-";

fn base_override() -> &'static RwLock<Option<PathBuf>> {
    static BASE: OnceLock<RwLock<Option<PathBuf>>> = OnceLock::new();
    BASE.get_or_init(|| RwLock::new(None))
}

/// Directory FastCat writes ephemeral artifacts to. Defaults to the OS temp dir;
/// in dev it is redirected by [`set_dev_temp_root`].
pub fn fastcat_temp_dir() -> PathBuf {
    if let Some(dir) = base_override().read().clone() {
        return dir;
    }
    std::env::temp_dir()
}

/// Redirect the native temp dir under the dev root (`<devRoot>/tmp/fastcat`),
/// mirroring the frontend's emulated `tempDir`. Idempotent; sweeps the new dir
/// once it is set. Intended for debug builds only.
pub fn set_dev_temp_root(dev_root: &Path) {
    let dir = dev_root.join("tmp").join("fastcat");
    if let Err(e) = std::fs::create_dir_all(&dir) {
        log::warn!(
            "[temp] failed to create dev temp dir {}: {e}",
            dir.display()
        );
        return;
    }
    *base_override().write() = Some(dir);
    sweep_orphans();
}

/// Build a unique ephemeral path: `<temp>/fastcat-<label>-<pid>-<nanos>.<ext>`.
/// The embedded pid lets [`sweep_orphans`] skip files this process still owns.
pub fn temp_path(label: &str, ext: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    fastcat_temp_dir().join(format!(
        "{TEMP_PREFIX}{label}-{}-{nanos}.{ext}",
        std::process::id()
    ))
}

/// RAII guard that deletes its file on drop — covers early returns, `?`
/// propagation, and panics that an explicit cleanup at the call site would miss.
/// The path is still readable while the guard is alive (e.g. to hand to ffmpeg).
pub struct TempFile {
    path: PathBuf,
}

impl TempFile {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// Reclaim ephemeral files left by crashed or hard-killed runs. Safe to call at
/// startup: the single-instance guard means any `fastcat-*` entry present before
/// this process writes its own is an orphan from a previous run. Files this
/// process owns (pid embedded by [`temp_path`]) are always skipped, so it is also
/// safe to call mid-session (e.g. after [`set_dev_temp_root`]).
pub fn sweep_orphans() {
    let dir = fastcat_temp_dir();
    let entries = match std::fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    let own_marker = format!("-{}-", std::process::id());
    let mut removed = 0u32;
    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();
        if !name.starts_with(TEMP_PREFIX) || name.contains(&own_marker) {
            continue;
        }
        let path = entry.path();
        let ok = match entry.file_type() {
            Ok(ft) if ft.is_dir() => std::fs::remove_dir_all(&path).is_ok(),
            _ => std::fs::remove_file(&path).is_ok(),
        };
        if ok {
            removed += 1;
        }
    }

    if removed > 0 {
        log::info!(
            "[temp] swept {removed} orphaned temp file(s) from {}",
            dir.display()
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn temp_file_removed_on_drop() {
        let path = temp_path("temp-guard-test", "tmp");
        std::fs::write(&path, b"x").unwrap();
        assert!(path.exists());
        {
            let _guard = TempFile::new(path.clone());
        }
        assert!(!path.exists());
    }

    #[test]
    fn sweep_skips_own_files_and_reclaims_orphans() {
        // Isolate this test from the shared OS temp dir so a parallel process
        // can't race the assertions.
        let root = std::env::temp_dir().join(format!(
            "fastcat-sweep-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        *base_override().write() = Some(root.clone());

        // An orphan from a "previous run" (a pid that is not ours).
        let other_pid = std::process::id().wrapping_add(1);
        let orphan = root.join(format!("{TEMP_PREFIX}export-audio-{other_pid}-123.w64"));
        std::fs::write(&orphan, b"stale").unwrap();
        // A file this process owns must survive.
        let own = temp_path("export-audio", "w64");
        std::fs::write(&own, b"live").unwrap();

        sweep_orphans();

        assert!(!orphan.exists(), "orphan should be reclaimed");
        assert!(own.exists(), "own file must be kept");

        *base_override().write() = None;
        let _ = std::fs::remove_dir_all(&root);
    }
}
