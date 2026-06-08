use std::path::Path;

use anyhow::{anyhow, Result};

use crate::media::ffmpeg_runner::run_ffmpeg_task;
use crate::media::tasks::NativeMediaTasks;

use super::processing::probe_media;

pub fn extract_audio_stream(
    tasks: &NativeMediaTasks,
    task_id: &str,
    source_path: &Path,
    target_path: &Path,
    ffmpeg_path: &str,
    ffprobe_path: &str,
) -> Result<()> {
    let metadata = probe_media(source_path, ffprobe_path)?;
    metadata
        .audio
        .as_ref()
        .ok_or_else(|| anyhow!("source has no audio stream"))?;

    let args = build_extract_audio_args(source_path, target_path);
    run_ffmpeg_task(tasks, task_id, ffmpeg_path, args, None, None, None)?;
    if !target_path.exists() {
        return Err(anyhow!(
            "ffmpeg audio extraction did not produce output file: {}",
            target_path.display()
        ));
    }
    Ok(())
}

fn build_extract_audio_args(source_path: &Path, target_path: &Path) -> Vec<String> {
    vec![
        "-nostdin".into(),
        "-y".into(),
        "-loglevel".into(),
        "warning".into(),
        "-i".into(),
        source_path.display().to_string(),
        "-map".into(),
        "0:a:0".into(),
        "-vn".into(),
        "-sn".into(),
        "-dn".into(),
        "-c:a".into(),
        "copy".into(),
        target_path.display().to_string(),
    ]
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    #[test]
    fn extract_audio_args_copy_primary_audio_only() {
        let args = build_extract_audio_args(Path::new("in.mp4"), Path::new("out.m4a"));

        assert!(args.windows(2).any(|pair| pair == ["-map", "0:a:0"]));
        assert!(args.windows(2).any(|pair| pair == ["-c:a", "copy"]));
        assert!(args.contains(&"-vn".to_string()));
        assert!(args.contains(&"-sn".to_string()));
        assert!(args.contains(&"-dn".to_string()));
    }
}
