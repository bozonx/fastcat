//! Tauri commands related to fonts.

use crate::monitor::scene::build::system_font_families;

/// Returns the list of font families installed on the system. Used by the
/// frontend so the desktop build shows, in the text clip's properties, exactly
/// the fonts the native renderer can actually draw with (the same fontdb used
/// for SVG rasterization / text shaping).
#[tauri::command]
pub async fn native_system_fonts() -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(system_font_families)
        .await
        .map_err(|e| e.to_string())
}
