use std::path::{Path, PathBuf};

use tauri::Manager;
use tauri_plugin_fs::FsExt;

/// Best-effort resolution of the current user's home directory without pulling
/// in extra crates. Returns `None` if neither the platform-specific nor the
/// generic environment variables are set.
fn user_home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .filter(|p| !p.as_os_str().is_empty())
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .filter(|p| !p.as_os_str().is_empty())
    }
}

/// Rejects scope-extension targets that would hand the webview far more of the
/// filesystem than any single operation needs: filesystem roots and the bare
/// home directory. A compromised renderer must not be able to call
/// `allow_path_scope("/")` and read the whole disk.
fn reject_dangerous_scope_path(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err(format!("scope path must be absolute: {path:?}"));
    }

    // A path with no parent is a filesystem root (`/`, `C:\`).
    if path.parent().is_none() {
        return Err(format!(
            "refusing to extend scope to filesystem root: {path:?}"
        ));
    }

    if let Some(home) = canonical_user_home_dir() {
        if path == home {
            return Err(format!(
                "refusing to extend scope to the home directory: {path:?}"
            ));
        }
    }

    // Reject paths that contain sensitive directory components.
    for component in path.components() {
        if let std::path::Component::Normal(name) = component {
            let name = name.to_string_lossy();
            if matches!(
                name.as_ref(),
                ".git" | ".gitignore" | "node_modules" | ".env" | ".ssh"
            ) {
                return Err(format!(
                    "refusing to extend scope to a path containing sensitive component: {path:?}"
                ));
            }
        }
    }

    Ok(())
}

fn canonical_user_home_dir() -> Option<PathBuf> {
    user_home_dir().map(|home| home.canonicalize().unwrap_or(home))
}

fn canonicalize_scope_path(path: &str) -> Result<PathBuf, String> {
    Path::new(path)
        .canonicalize()
        .map_err(|e| format!("failed to resolve scope path {path:?}: {e}"))
}

/// Extends the fs scope to allow reading a file dropped from the OS.
/// Required for drag-and-drop imports from arbitrary filesystem locations.
#[tauri::command]
pub(crate) fn allow_dropped_file_scope(
    app: tauri::AppHandle,
    path: String,
) -> Result<(), String> {
    let path = canonicalize_scope_path(&path)?;
    reject_dangerous_scope_path(&path)?;

    if !path.is_file() {
        return Err(format!("scope path is not a regular file: {path:?}"));
    }

    log::info!(
        "[allow_dropped_file_scope] extending scope to: {}",
        path.display()
    );
    app.fs_scope()
        .allow_file(&path)
        .map_err(|e| e.to_string())?;
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|e| e.to_string())
}

fn allow_directory_scope(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    app.fs_scope()
        .allow_directory(path, true)
        .map_err(|e| e.to_string())?;
    app.asset_protocol_scope()
        .allow_directory(path, true)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn allow_path_scope(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let path = canonicalize_scope_path(&path)?;
    reject_dangerous_scope_path(&path)?;

    log::info!("[allow_path_scope] extending scope to: {}", path.display());
    allow_directory_scope(&app, &path)
}

#[tauri::command]
pub(crate) fn allow_dev_directory_scope(
    app: tauri::AppHandle,
    path: String,
) -> Result<(), String> {
    if !cfg!(debug_assertions) {
        return Err("dev directory scope can only be extended in debug builds".to_string());
    }

    let path = canonicalize_scope_path(&path)?;
    reject_dangerous_scope_path(&path)?;

    log::info!(
        "[allow_dev_directory_scope] extending scope to: {}",
        path.display()
    );
    allow_directory_scope(&app, &path)?;
    crate::media::temp::set_dev_temp_root(&path);
    log::info!("[allow_dev_directory_scope] scope extended successfully");
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{canonicalize_scope_path, reject_dangerous_scope_path};

    fn unique_temp_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("fastcat-{name}-{}-{unique}", std::process::id()))
    }

    #[test]
    fn canonicalize_scope_path_resolves_parent_segments_before_policy_check() {
        let root = unique_temp_dir("scope-canonical");
        let safe = root.join("safe");
        fs::create_dir_all(&safe).expect("create temp scope dir");

        let raw = safe.join("..").join("safe");
        let resolved = canonicalize_scope_path(&raw.to_string_lossy()).expect("canonical path");

        assert_eq!(resolved, safe.canonicalize().expect("canonical safe dir"));
        reject_dangerous_scope_path(&resolved).expect("safe canonical dir");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn scope_policy_rejects_sensitive_components_after_canonicalization() {
        let root = unique_temp_dir("scope-sensitive");
        let safe = root.join("safe");
        let sensitive = root.join(".git").join("objects");
        fs::create_dir_all(&safe).expect("create safe temp dir");
        fs::create_dir_all(&sensitive).expect("create sensitive temp dir");

        let raw = safe.join("..").join(".git").join("objects");
        let resolved = canonicalize_scope_path(&raw.to_string_lossy()).expect("canonical path");
        let error = reject_dangerous_scope_path(&resolved).expect_err("sensitive path rejected");

        assert!(error.contains("sensitive component"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn scope_policy_rejects_relative_paths() {
        let error = reject_dangerous_scope_path(std::path::Path::new("relative/path"))
            .expect_err("relative path rejected");

        assert!(error.contains("absolute"));
    }
}
