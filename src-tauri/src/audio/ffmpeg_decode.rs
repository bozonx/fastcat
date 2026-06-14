use std::io::Read;
use std::path::Path;
use std::process::{Child, ChildStdout, Command, Stdio};
use std::thread;

use anyhow::{anyhow, Context, Result};

pub(crate) struct FfmpegPcmReader {
    child: Child,
    stdout: ChildStdout,
    stderr_reader: thread::JoinHandle<std::io::Result<Vec<u8>>>,
}

impl FfmpegPcmReader {
    pub(crate) fn read_samples(mut self) -> Result<Vec<f32>> {
        let mut bytes = Vec::new();
        self.stdout
            .read_to_end(&mut bytes)
            .context("failed to read ffmpeg decoded PCM")?;
        self.wait()?;
        Ok(f32_samples_from_bytes(&bytes))
    }

    pub(crate) fn stdout_mut(&mut self) -> &mut ChildStdout {
        &mut self.stdout
    }

    pub(crate) fn wait(self) -> Result<()> {
        let FfmpegPcmReader {
            mut child,
            stdout,
            stderr_reader,
        } = self;
        drop(stdout);

        let status = child
            .wait()
            .context("failed to wait for ffmpeg audio decode")?;
        let stderr = stderr_reader
            .join()
            .map_err(|_| anyhow!("ffmpeg stderr reader panicked"))?
            .context("failed to read ffmpeg stderr")?;
        if !status.success() {
            let stderr = String::from_utf8_lossy(&stderr);
            return Err(anyhow!(
                "ffmpeg audio decode failed with status {}: {}",
                status,
                stderr.trim()
            ));
        }

        Ok(())
    }
}

pub(crate) struct FfmpegDecodeParams<'a> {
    pub path: &'a Path,
    pub start_sec: f64,
    pub duration_sec: Option<f64>,
    pub target_sample_rate: u32,
    pub output_channels: usize,
}

pub(crate) fn spawn_ffmpeg_f32le(params: FfmpegDecodeParams<'_>) -> Result<FfmpegPcmReader> {
    let channels = params.output_channels.max(1).to_string();
    let sample_rate = params.target_sample_rate.max(1).to_string();
    let ss = format!("{:.6}", params.start_sec.max(0.0));
    let path = params.path.to_string_lossy();

    let mut command = Command::new("ffmpeg");
    command.args(["-v", "error", "-ss", &ss, "-i", &path]);
    if let Some(duration_sec) = params.duration_sec {
        let duration = format!("{:.6}", duration_sec.max(0.0));
        command.args(["-t", &duration]);
    }
    command.args([
        "-vn",
        "-f",
        "f32le",
        "-ac",
        &channels,
        "-ar",
        &sample_rate,
        "pipe:1",
    ]);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .with_context(|| format!("failed to run ffmpeg for audio decode: {}", path))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("failed to capture ffmpeg stdout"))?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow!("failed to capture ffmpeg stderr"))?;
    let stderr_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        stderr.read_to_end(&mut bytes)?;
        Ok(bytes)
    });

    Ok(FfmpegPcmReader {
        child,
        stdout,
        stderr_reader,
    })
}

pub(crate) fn decode_range_ffmpeg(
    path: &Path,
    start_sec: f64,
    duration_sec: f64,
    target_sample_rate: u32,
    output_channels: usize,
) -> Result<Vec<f32>> {
    spawn_ffmpeg_f32le(FfmpegDecodeParams {
        path,
        start_sec,
        duration_sec: Some(duration_sec),
        target_sample_rate,
        output_channels,
    })?
    .read_samples()
}

fn f32_samples_from_bytes(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(std::mem::size_of::<f32>())
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f32_samples_from_bytes_ignores_incomplete_tail() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&0.5f32.to_le_bytes());
        bytes.extend_from_slice(&(-0.25f32).to_le_bytes());
        bytes.push(99);

        assert_eq!(f32_samples_from_bytes(&bytes), vec![0.5, -0.25]);
    }
}
