//! Tauri-команды, связанные со шрифтами.

use crate::monitor::scene::build::system_font_families;

/// Возвращает список семейств шрифтов, установленных в системе. Используется
/// фронтом, чтобы в десктоп-версии показывать в свойствах текстового клипа ровно
/// те шрифты, которыми реально умеет рисовать нативный рендер (тот же fontdb,
/// что и при растеризации SVG / шейпинге текста).
#[tauri::command]
pub async fn native_system_fonts() -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(system_font_families)
        .await
        .map_err(|e| e.to_string())
}
