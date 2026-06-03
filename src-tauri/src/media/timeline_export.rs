//! Нативный экспорт таймлайна: vello-рендер каждого кадра → raw RGBA в stdin ffmpeg → энкод.
//!
//! Архитектура (почему так):
//!   - ВИДЕО рендерит нативное ядро (тот же `compositor`/`scene_build`, что и preview/thumbnail),
//!     поэтому экспорт пиксель-в-пиксель совпадает с монитором.
//!   - АУДИО намеренно вне нативного ядра (см. `media/mod.rs`): микс таймлайна делает JS-воркер
//!     (mediabunny/OfflineAudioContext) и кладёт готовый файл во временный путь, который мы тут
//!     просто муксим вторым `-i`. Так мы не дублируем сложную аудио-логику в Rust.
//!
//! ffmpeg вызывается одним процессом: `-f rawvideo -pix_fmt rgba -s WxH -r fps -i -` (видео из stdin)
//! плюс опционально `-i <audio>` и кодек-флаги. Прогресс — колбэк на каждый записанный кадр.
//! Отмена — процесс регистрируется в `NativeMediaTasks`, та же `native_media_cancel` его убивает.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;

use crate::audio::engine::render_scene_to_wav;
use crate::compositor::Compositor;
use crate::monitor::scene::MonitorScene;

use super::ffmpeg_utils::*;
use super::processing::NativeMediaTasks;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeExportOptions {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    /// Диапазон экспорта по timeline-времени (секунды). `end` эксклюзивный.
    pub start_sec: f64,
    pub end_sec: f64,
    /// Браузерная codec-строка (avc1.* / vp09.* / av01.*) — маппится на ffmpeg-энкодер.
    pub video_codec: String,
    pub video_bitrate_bps: u32,
    pub format: String,
    /// Путь к заранее смикшированному JS аудио-файлу (wav/m4a/...). `None` → без звука.
    #[serde(default)]
    pub audio_enabled: bool,
    pub audio_path: Option<String>,
    pub audio_codec: Option<String>,
    pub audio_bitrate_bps: Option<u32>,

    // Hardware Acceleration Settings
    #[serde(default)]
    pub ffmpeg_path: Option<String>,
    #[serde(default)]
    pub hardware_acceleration_mode: Option<String>,
    #[serde(default)]
    pub vaapi_device: Option<String>,
    #[serde(default)]
    pub enable_hardware_encoding: Option<bool>,
    #[serde(default)]
    pub ffprobe_path: Option<String>,
    #[serde(default)]
    pub export_alpha: Option<bool>,
}

/// Полный прогон экспорта. `on_progress(0..1)` зовётся после каждого записанного кадра.
pub fn export_timeline(
    tasks: &NativeMediaTasks,
    task_id: &str,
    scene: MonitorScene,
    options: NativeExportOptions,
    target_path: &Path,
    on_progress: &(dyn Fn(f64) + Send + Sync),
) -> Result<()> {
    let width = even(options.width.max(2));
    let height = even(options.height.max(2));
    let fps = if options.fps.is_finite() && options.fps > 0.0 {
        options.fps
    } else {
        30.0
    };
    let start = options.start_sec.max(0.0);
    let end = options.end_sec.max(start);
    // Кол-во кадров: длительность × fps. Минимум 1 кадр (стоп-кадр для нулевого диапазона).
    let frame_count = (((end - start) * fps).round() as u64).max(1);

    let hw_mode = options.hardware_acceleration_mode.as_deref().unwrap_or("none");
    let hw_enabled = options.enable_hardware_encoding.unwrap_or(false);

    let result = (|| -> Result<()> {
        let mut temp_audio: Option<PathBuf> = None;
        let audio_input = if options.audio_enabled {
            match options.audio_path.as_deref().filter(|p| !p.is_empty()) {
                Some(path) => Some(PathBuf::from(path)),
                None if !scene.audio_layers.is_empty() => {
                    let path = temp_audio_path();
                    let master_gain = if scene.audio_master_muted {
                        0.0
                    } else {
                        scene.audio_master_gain
                    };
                    render_scene_to_wav(&scene.audio_layers, &scene.audio_tracks, master_gain, start, end, 48_000, &path)
                        .context("failed to render native audio mix")?;
                    temp_audio = Some(path.clone());
                    Some(path)
                }
                None => None,
            }
        } else {
            None
        };

        let args = build_ffmpeg_args(
            &options,
            audio_input.as_deref(),
            width,
            height,
            fps,
            target_path,
        );
        let ffmpeg_cmd = options.ffmpeg_path.as_deref().unwrap_or("ffmpeg");
        verify_ffmpeg_binary(ffmpeg_cmd).context("ffmpeg binary check failed")?;
        let mut child = Command::new(ffmpeg_cmd)
            .args(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .context("failed to spawn ffmpeg for timeline export")?;
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow!("ffmpeg stdin unavailable"))?;

        // Drain stderr in background to avoid pipe deadlock.
        let stderr_handle = child.stderr.take().map(|mut stderr| {
            std::thread::spawn(move || {
                let mut buf = Vec::new();
                let _ = std::io::Read::read_to_end(&mut stderr, &mut buf);
                buf
            })
        });

        // Регистрируем процесс, чтобы `native_media_cancel(task_id)` мог его убить.
        let child = tasks.insert(task_id, child);

        // Рендерим кадры последовательно через выделенный compositor (отдельный от thumbnail-пула,
        // чтобы экспорт и генерация миниатюр не дрались за один GPU-таргет).
        let mut compositor = Compositor::new();
        let dev_id = compositor
            .ensure_offscreen_device()
            .context("export: no GPU device")?;

        let mut cache = super::timeline_render::VideoDecoderCache::new();
        let hw_settings = crate::FfmpegHardwareSettings {
            ffmpeg_path: options.ffmpeg_path.clone().unwrap_or_else(|| "ffmpeg".to_string()),
            ffprobe_path: options.ffprobe_path.clone().unwrap_or_else(|| "ffprobe".to_string()),
            hardware_acceleration_mode: options.hardware_acceleration_mode.clone().unwrap_or_else(|| "none".to_string()),
            vaapi_device: options.vaapi_device.clone().unwrap_or_else(|| "/dev/dri/renderD128".to_string()),
            enable_hardware_encoding: options.enable_hardware_encoding.unwrap_or(false),
        };

        let empty_cache = crate::compositor::texture_cache::TextureCache::new();
        let render_result = (|| -> Result<()> {
            for i in 0..frame_count {
                let time = start + i as f64 / fps;
                let frame_scene = super::timeline_render::build_export_scene(
                    &scene,
                    time,
                    (width, height),
                    &mut cache,
                    hw_settings.clone(),
                )?;
                let pixels = compositor.render_scene_to_pixels(dev_id, &frame_scene, width, height, &empty_cache)?;
                if let Err(e) = stdin.write_all(&pixels) {
                    return Err(anyhow!("ffmpeg stdin closed prematurely: {e}"));
                }
                on_progress((i + 1) as f64 / frame_count as f64);
            }
            Ok(())
        })();

        // Закрываем stdin → ffmpeg финализирует контейнер.
        drop(stdin);

        if let Err(error) = render_result {
            let mut guard = child.lock();
            let _ = guard.kill();
            drop(guard);
            tasks.remove(task_id);
            if let Some(path) = temp_audio.as_deref() {
                let _ = std::fs::remove_file(path);
            }
            return Err(error);
        }

        let poll_start = std::time::Instant::now();
        const TIMEOUT: Duration = Duration::from_secs(3600);

        loop {
            let mut guard = child.lock();
            if let Some(status) = guard.try_wait().context("failed to poll ffmpeg export")? {
                let stderr_text = match stderr_handle {
                    Some(handle) => {
                        String::from_utf8_lossy(&handle.join().unwrap_or_default()).to_string()
                    }
                    None => String::new(),
                };
                drop(guard);
                tasks.remove(task_id);
                if status.success() {
                    if !target_path.exists() {
                        if let Some(path) = temp_audio.as_deref() {
                            let _ = std::fs::remove_file(path);
                        }
                        return Err(anyhow!(
                            "ffmpeg export succeeded but output file is missing: {}",
                            target_path.display()
                        ));
                    }
                    if let Some(path) = temp_audio.as_deref() {
                        let _ = std::fs::remove_file(path);
                    }
                    return Ok(());
                }
                if let Some(path) = temp_audio.as_deref() {
                    let _ = std::fs::remove_file(path);
                }
                return Err(anyhow!("ffmpeg export failed: {}", stderr_text.trim()));
            }
            drop(guard);
            std::thread::sleep(Duration::from_millis(100));
            if poll_start.elapsed() > TIMEOUT {
                let mut guard = child.lock();
                let _ = guard.kill();
                let _ = guard.wait();
                drop(guard);
                tasks.remove(task_id);
                if let Some(path) = temp_audio.as_deref() {
                    let _ = std::fs::remove_file(path);
                }
                return Err(anyhow!("ffmpeg export timed out after {} seconds", TIMEOUT.as_secs()));
            }
        }
    })();

    match result {
        Ok(()) => Ok(()),
        Err(e) if hw_enabled && hw_mode != "none" => {
            log::warn!("[native-media] HW export failed ({e}), falling back to software encoding");
            let mut sw_options = options.clone();
            sw_options.enable_hardware_encoding = Some(false);
            export_timeline(tasks, task_id, scene, sw_options, target_path, on_progress)
        }
        Err(e) => Err(e),
    }
}

fn build_ffmpeg_args(
    options: &NativeExportOptions,
    audio_input: Option<&Path>,
    width: u32,
    height: u32,
    fps: f64,
    target_path: &Path,
) -> Vec<String> {
    let export_alpha = options.export_alpha.unwrap_or(false)
        && (options.format == "webm" || options.format == "mkv");

    let hw_mode = if options.enable_hardware_encoding.unwrap_or(false) && !export_alpha {
        let mode = options.hardware_acceleration_mode.as_deref().unwrap_or("none");
        if mode == "auto" {
            let vaapi_dev = options.vaapi_device.as_deref().unwrap_or("/dev/dri/renderD128");
            if std::path::Path::new(vaapi_dev).exists() {
                "vaapi"
            } else {
                "none"
            }
        } else {
            mode
        }
    } else {
        "none"
    };

    let mut args = Vec::new();

    if hw_mode == "vaapi" {
        let vaapi_dev = options.vaapi_device.as_deref().unwrap_or("/dev/dri/renderD128");
        args.extend([
            "-init_hw_device".to_string(),
            format!("vaapi=gpu:{vaapi_dev}"),
            "-filter_hw_device".to_string(),
            "gpu".to_string(),
        ]);
    }

    args.extend([
        "-y".to_string(),
        "-loglevel".to_string(),
        "error".to_string(),
        // Видео из stdin (raw RGBA).
        "-f".to_string(),
        "rawvideo".to_string(),
        "-pix_fmt".to_string(),
        "rgba".to_string(),
        "-s".to_string(),
        format!("{width}x{height}"),
        "-r".to_string(),
        format!("{fps:.6}"),
        "-i".to_string(),
        "-".to_string(),
    ]);

    let has_audio = audio_input.is_some();
    if let Some(audio) = audio_input {
        args.extend(["-i".to_string(), audio.display().to_string()]);
    }

    let video_codec = ffmpeg_video_codec_hw(&options.video_codec, hw_mode);
    args.extend([
        "-c:v".to_string(),
        video_codec.to_string(),
        "-b:v".to_string(),
        options.video_bitrate_bps.max(1).to_string(),
    ]);

    if export_alpha && video_codec == "libvpx-vp9" {
        args.extend([
            "-auto-alt-ref".to_string(),
            "0".to_string(),
        ]);
    }

    if hw_mode == "vaapi" {
        args.extend([
            "-vf".to_string(),
            "format=nv12|vaapi,hwupload".to_string(),
            "-pix_fmt".to_string(),
            "vaapi".to_string(),
        ]);
    } else if hw_mode == "nvdec" {
        args.extend([
            "-vf".to_string(),
            "format=yuv420p".to_string(),
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
        ]);
    } else {
        if export_alpha {
            args.extend([
                "-pix_fmt".to_string(),
                "yuva420p".to_string(),
            ]);
        } else {
            args.extend([
                "-pix_fmt".to_string(),
                "yuv420p".to_string(),
            ]);
        }
    }

    if has_audio {
        let codec = match options.audio_codec.as_deref() {
            Some("opus") => "libopus",
            Some("aac") | None => {
                if options.format == "webm" {
                    "libopus"
                } else {
                    "aac"
                }
            }
            Some(other) => {
                if options.format == "webm" && other == "aac" {
                    "libopus"
                } else {
                    other
                }
            }
        };
        args.extend(["-c:a".to_string(), codec.to_string()]);
        if let Some(bitrate) = options.audio_bitrate_bps {
            args.extend(["-b:a".to_string(), bitrate.max(1).to_string()]);
        }
        // Обрезаем по более короткому из потоков (видео-длина — эталон).
        args.push("-shortest".to_string());
    } else {
        args.push("-an".to_string());
    }

    if options.format == "mp4" || options.format == "mov" {
        args.extend(["-movflags".to_string(), "+faststart".to_string()]);
    }

    args.push(target_path.display().to_string());
    args
}

/// Сохраняет временный путь для аудио-микса (JS пишет сюда WAV перед экспортом).
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_build_ffmpeg_args_webm_forces_opus() {
        let options = NativeExportOptions {
            width: 1920,
            height: 1080,
            fps: 30.0,
            start_sec: 0.0,
            end_sec: 10.0,
            video_codec: "vp9".to_string(),
            video_bitrate_bps: 5_000_000,
            format: "webm".to_string(),
            audio_enabled: true,
            audio_path: None,
            audio_codec: Some("aac".to_string()),
            audio_bitrate_bps: Some(128_000),
            ffmpeg_path: None,
            ffprobe_path: None,
            hardware_acceleration_mode: None,
            vaapi_device: None,
            enable_hardware_encoding: None,
            export_alpha: None,
        };
        let args = build_ffmpeg_args(
            &options,
            Some(Path::new("dummy.wav")),
            1920,
            1080,
            30.0,
            Path::new("output.webm"),
        );
        let mut idx = 0;
        let mut found_opus = false;
        while idx < args.len() {
            if args[idx] == "-c:a" {
                assert_eq!(args[idx + 1], "libopus");
                found_opus = true;
                break;
            }
            idx += 1;
        }
        assert!(found_opus, "Audio codec argument not found");
    }

    #[test]
    fn test_build_ffmpeg_args_vp9_alpha_adds_auto_alt_ref() {
        let options = NativeExportOptions {
            width: 1920,
            height: 1080,
            fps: 30.0,
            start_sec: 0.0,
            end_sec: 10.0,
            video_codec: "vp9".to_string(),
            video_bitrate_bps: 5_000_000,
            format: "webm".to_string(),
            audio_enabled: false,
            audio_path: None,
            audio_codec: None,
            audio_bitrate_bps: None,
            ffmpeg_path: None,
            ffprobe_path: None,
            hardware_acceleration_mode: None,
            vaapi_device: None,
            enable_hardware_encoding: None,
            export_alpha: Some(true),
        };
        let args = build_ffmpeg_args(
            &options,
            None,
            1920,
            1080,
            30.0,
            Path::new("output.webm"),
        );
        let mut found_yuva = false;
        let mut found_auto_alt_ref = false;
        let mut idx = 0;
        while idx < args.len() {
            if args[idx] == "-pix_fmt" && args.get(idx + 1) == Some(&"yuva420p".to_string()) {
                found_yuva = true;
            }
            if args[idx] == "-auto-alt-ref" && args.get(idx + 1) == Some(&"0".to_string()) {
                found_auto_alt_ref = true;
            }
            idx += 1;
        }
        assert!(found_yuva, "Expected yuva420p pixel format");
        assert!(found_auto_alt_ref, "Expected -auto-alt-ref 0 for VP9 alpha");
    }

    #[test]
    fn test_build_ffmpeg_args_mp4_ignores_alpha() {
        let options = NativeExportOptions {
            width: 1920,
            height: 1080,
            fps: 30.0,
            start_sec: 0.0,
            end_sec: 10.0,
            video_codec: "avc1.64001f".to_string(),
            video_bitrate_bps: 5_000_000,
            format: "mp4".to_string(),
            audio_enabled: false,
            audio_path: None,
            audio_codec: None,
            audio_bitrate_bps: None,
            ffmpeg_path: None,
            ffprobe_path: None,
            hardware_acceleration_mode: None,
            vaapi_device: None,
            enable_hardware_encoding: None,
            export_alpha: Some(true),
        };
        let args = build_ffmpeg_args(
            &options,
            None,
            1920,
            1080,
            30.0,
            Path::new("output.mp4"),
        );
        assert!(
            !args.contains(&"yuva420p".to_string()),
            "mp4 should ignore alpha flag"
        );
        assert!(
            !args.contains(&"-auto-alt-ref".to_string()),
            "mp4 should not add VP9 alpha flags"
        );
    }
}

