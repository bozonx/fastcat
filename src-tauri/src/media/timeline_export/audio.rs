use std::path::PathBuf;

/// Returns a temporary path for the audio mix. The mix is written as Sony Wave64 (.w64)
/// so a long export isn't capped by RIFF/WAV's 32-bit (4 GB) size field; ffmpeg reads it
/// natively. See `crate::audio::mix::render_scene_to_wav`.
pub fn temp_audio_path() -> PathBuf {
    crate::media::temp::temp_path("export-audio", "w64")
}
