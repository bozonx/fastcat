use std::path::PathBuf;

/// Returns a temporary path for the audio mix. The mix is written as Sony Wave64 (.w64)
/// so a long export isn't capped by RIFF/WAV's 32-bit (4 GB) size field; ffmpeg reads it
/// natively. See `crate::audio::mix::render_scene_to_wav`.
pub fn temp_audio_path() -> PathBuf {
    let name = format!(
        "fastcat-export-audio-{}-{}.w64",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    std::env::temp_dir().join(name)
}
