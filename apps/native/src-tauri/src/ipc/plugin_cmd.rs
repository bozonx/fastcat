use crate::audio::plugins::catalog::{
    scan_audio_plugins, AudioPluginScanRequest, AudioPluginScanResult,
};

#[tauri::command]
pub async fn native_audio_plugins_scan(
    request: AudioPluginScanRequest,
) -> Result<AudioPluginScanResult, String> {
    tokio::task::spawn_blocking(move || scan_audio_plugins(request))
        .await
        .map_err(|error| format!("audio plugin scan failed: {error}"))
}

#[tauri::command]
pub async fn native_audio_plugins_list() -> Result<AudioPluginScanResult, String> {
    tokio::task::spawn_blocking(|| {
        scan_audio_plugins(AudioPluginScanRequest {
            formats: Vec::new(),
            custom_paths: Vec::new(),
            include_standard_paths: false,
        })
    })
    .await
    .map_err(|error| format!("audio plugin list failed: {error}"))
}
