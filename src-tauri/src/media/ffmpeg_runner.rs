use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, SystemTime};

use anyhow::{anyhow, Context, Result};

use crate::media::ffmpeg_utils::verify_ffmpeg_binary;
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

pub(crate) fn spawn_stderr_drain(
    child: &mut Child,
) -> (Option<JoinHandle<Vec<u8>>>, Arc<AtomicU64>) {
    let last_activity = Arc::new(AtomicU64::new(now_millis()));
    let activity = last_activity.clone();
    let handle = child.stderr.take().map(|mut stderr| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let mut chunk = [0u8; 4096];
            loop {
                match std::io::Read::read(&mut stderr, &mut chunk) {
                    Ok(0) => break,
                    Ok(n) => {
                        activity.store(now_millis(), Ordering::Release);
                        buf.extend_from_slice(&chunk[..n]);
                    }
                    Err(_) => break,
                }
            }
            buf
        })
    });
    (handle, last_activity)
}

pub(crate) fn run_ffmpeg_task(
    tasks: &NativeMediaTasks,
    task_id: &str,
    ffmpeg_path: &str,
    args: Vec<String>,
    on_warning: Option<&(dyn Fn(String) + Send + Sync)>,
) -> Result<()> {
    verify_ffmpeg_binary(ffmpeg_path).context("ffmpeg binary check failed")?;
    let mut child = Command::new(ffmpeg_path)
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .context("failed to spawn ffmpeg")?;

    let (stderr_handle, last_activity) = spawn_stderr_drain(&mut child);
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
                    emit_media_warning(on_warning, format!("ffmpeg warning: {stderr_text}"));
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
