use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, SystemTime};

use anyhow::{anyhow, Context, Result};
use parking_lot::Mutex;

use crate::media::ffmpeg::utils::verify_ffmpeg_binary;
use crate::media::tasks::NativeMediaTasks;

/// Kill a job if ffmpeg makes no progress (no stderr output) for this long. A
/// stall guard rather than a wall-clock cap, so a legitimately long encode that
/// keeps emitting progress is never killed mid-run.
const FFMPEG_STALL_TIMEOUT: Duration = Duration::from_secs(300);

pub(crate) fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Background drain of an ffmpeg child's stderr.
pub(crate) struct StderrDrain {
    /// Join handle yielding the full captured stderr bytes once the pipe closes.
    pub handle: Option<JoinHandle<Vec<u8>>>,
    /// Millis of the last stderr activity, used by the stall guard.
    pub last_activity: Arc<AtomicU64>,
    /// Live partial stderr buffer, readable while the process is still running.
    pub shared_buf: Arc<Mutex<Vec<u8>>>,
}

pub(crate) fn spawn_stderr_drain(child: &mut Child) -> StderrDrain {
    let last_activity = Arc::new(AtomicU64::new(now_millis()));
    let activity = last_activity.clone();
    let shared_buf = Arc::new(Mutex::new(Vec::new()));
    let shared = shared_buf.clone();
    let handle = child.stderr.take().map(|mut stderr| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let mut chunk = [0u8; 4096];
            loop {
                match Read::read(&mut stderr, &mut chunk) {
                    Ok(0) => break,
                    Ok(n) => {
                        activity.store(now_millis(), Ordering::Release);
                        buf.extend_from_slice(&chunk[..n]);
                        shared.lock().extend_from_slice(&chunk[..n]);
                    }
                    Err(_) => break,
                }
            }
            buf
        })
    });
    StderrDrain {
        handle,
        last_activity,
        shared_buf,
    }
}

fn parse_ffmpeg_time(stderr_text: &str) -> Option<f64> {
    let idx = stderr_text.rfind("time=")?;
    let rest = &stderr_text[idx + 5..];
    let end = rest
        .find(|c: char| !c.is_ascii_digit() && c != ':' && c != '.')
        .unwrap_or(rest.len());
    let time_str = &rest[..end];
    let parts: Vec<&str> = time_str.split(':').collect();
    if parts.len() == 3 {
        let hours: f64 = parts[0].parse().ok()?;
        let minutes: f64 = parts[1].parse().ok()?;
        let seconds: f64 = parts[2].parse().ok()?;
        Some(hours * 3600.0 + minutes * 60.0 + seconds)
    } else if parts.len() == 1 {
        time_str.parse().ok()
    } else {
        None
    }
}

pub(crate) fn run_ffmpeg_task(
    tasks: &NativeMediaTasks,
    task_id: &str,
    ffmpeg_path: &str,
    args: Vec<String>,
    _on_warning: Option<&(dyn Fn(String) + Send + Sync)>,
    on_progress: Option<&(dyn Fn(f64) + Send + Sync)>,
    duration_sec: Option<f64>,
) -> Result<()> {
    verify_ffmpeg_binary(ffmpeg_path).context("ffmpeg binary check failed")?;
    let mut child = Command::new(ffmpeg_path)
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .context("failed to spawn ffmpeg")?;

    let StderrDrain {
        handle: stderr_handle,
        last_activity,
        shared_buf,
    } = spawn_stderr_drain(&mut child);
    let child = tasks.insert(task_id, child);

    loop {
        let mut guard = child.lock();
        if let Some(status) = guard.try_wait().context("failed to poll ffmpeg")? {
            let stderr_text = match stderr_handle {
                Some(handle) => {
                    String::from_utf8_lossy(&handle.join().unwrap_or_default()).to_string()
                }
                None => String::new(),
            };
            drop(guard);
            let cancelled = tasks.was_cancelled(task_id);
            tasks.remove(task_id);
            if status.success() {
                let stderr_text = stderr_text.trim();
                if !stderr_text.is_empty() {
                    log::info!(
                        "[ffmpeg] task {} succeeded with stderr output:\n{}",
                        task_id,
                        stderr_text
                    );
                }
                return Ok(());
            }
            if cancelled {
                return Err(anyhow!("cancelled"));
            }
            return Err(anyhow!("ffmpeg failed: {}", stderr_text.trim()));
        }
        drop(guard);
        std::thread::sleep(Duration::from_millis(100));

        if let (Some(on_progress), Some(duration)) = (on_progress, duration_sec) {
            let buf = shared_buf.lock();
            if let Some(time) = parse_ffmpeg_time(&String::from_utf8_lossy(&buf)) {
                let progress = (time / duration).clamp(0.0, 1.0);
                on_progress(progress);
            }
        }

        let idle_ms = now_millis().saturating_sub(last_activity.load(Ordering::Acquire));
        if idle_ms > FFMPEG_STALL_TIMEOUT.as_millis() as u64 {
            let mut guard = child.lock();
            let _ = guard.kill();
            let _ = guard.wait();
            drop(guard);
            tasks.remove(task_id);
            return Err(anyhow!(
                "ffmpeg stalled: no progress for {} seconds",
                FFMPEG_STALL_TIMEOUT.as_secs()
            ));
        }
    }
}

pub(crate) fn emit_media_warning(
    on_warning: Option<&(dyn Fn(String) + Send + Sync)>,
    message: String,
) {
    if let Some(callback) = on_warning {
        callback(message);
    }
}

#[cfg(test)]
mod tests {
    use super::parse_ffmpeg_time;

    #[test]
    fn parse_time_from_full_stderr_line() {
        let stderr = "frame=  120 fps= 30 q=-1.0 Lsize= 1200kB time=00:00:04.00 bitrate=2457.6kbits/s speed=1.00x";
        assert_eq!(parse_ffmpeg_time(stderr), Some(4.0));
    }

    #[test]
    fn parse_time_picks_last_occurrence() {
        let stderr = "time=00:00:01.00\ntime=00:00:02.50";
        assert_eq!(parse_ffmpeg_time(stderr), Some(2.5));
    }

    #[test]
    fn parse_time_with_hours() {
        let stderr = "time=01:23:45.67";
        assert_eq!(
            parse_ffmpeg_time(stderr),
            Some(3600.0 + 23.0 * 60.0 + 45.67)
        );
    }

    #[test]
    fn parse_time_missing_returns_none() {
        assert_eq!(parse_ffmpeg_time("no time here"), None);
    }

    #[test]
    fn parse_time_plain_seconds() {
        assert_eq!(parse_ffmpeg_time("time=123.45"), Some(123.45));
    }
}
