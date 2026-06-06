use std::path::PathBuf;

/// Returns a temporary path for the audio mix WAV.
pub fn temp_audio_path() -> PathBuf {
    let name = format!(
        "fastcat-export-audio-{}-{}.wav",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    std::env::temp_dir().join(name)
}
