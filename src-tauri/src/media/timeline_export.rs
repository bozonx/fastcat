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

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;

use crate::audio::engine::render_scene_to_wav;
use crate::compositor::Compositor;
use crate::monitor::scene::MonitorScene;

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
        ffprobe_path: "ffprobe".to_string(),
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
            if stdin.write_all(&pixels).is_err() {
                // ffmpeg закрыл stdin (ошибка энкода или отмена-kill) — выходим, статус заберём ниже.
                break;
            }
            on_progress((i + 1) as f64 / frame_count as f64);
        }
        Ok(())
    })();

    // Закрываем stdin → ffmpeg финализирует контейнер.
    drop(stdin);

    if let Err(error) = render_result {
        let mut guard = child.lock().expect("native media task child poisoned");
        let _ = guard.kill();
        drop(guard);
        tasks.remove(task_id);
        if let Some(path) = temp_audio.as_deref() {
            let _ = std::fs::remove_file(path);
        }
        return Err(error);
    }

    loop {
        let mut guard = child.lock().expect("native media task child poisoned");
        if let Some(status) = guard.try_wait().context("failed to poll ffmpeg export")? {
            let stderr = guard
                .stderr
                .take()
                .map(|mut s| {
                    let mut text = String::new();
                    let _ = s.read_to_string(&mut text);
                    text
                })
                .unwrap_or_default();
            drop(guard);
            tasks.remove(task_id);
            if status.success() {
                if let Some(path) = temp_audio.as_deref() {
                    let _ = std::fs::remove_file(path);
                }
                return Ok(());
            }
            if let Some(path) = temp_audio.as_deref() {
                let _ = std::fs::remove_file(path);
            }
            return Err(anyhow!("ffmpeg export failed: {}", stderr.trim()));
        }
        drop(guard);
        std::thread::sleep(Duration::from_millis(100));
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
    let hw_mode = if options.enable_hardware_encoding.unwrap_or(false) {
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
        args.extend([
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
        ]);
    }

    if has_audio {
        let codec = match options.audio_codec.as_deref() {
            Some("opus") => "libopus",
            Some("aac") | None => "aac",
            Some(other) => other,
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

/// Маппинг браузерной codec-строки на ffmpeg-энкодер (то же, что в `processing.rs`).
fn ffmpeg_video_codec(codec: &str) -> &'static str {
    if codec.contains("av01") || codec.eq_ignore_ascii_case("av1") {
        "libsvtav1"
    } else if codec.contains("vp09") || codec.eq_ignore_ascii_case("vp9") {
        "libvpx-vp9"
    } else {
        "libx264"
    }
}

fn ffmpeg_video_codec_hw(codec: &str, hw_mode: &str) -> &'static str {
    if hw_mode == "vaapi" {
        if codec.contains("av01") || codec.eq_ignore_ascii_case("av1") {
            "av1_vaapi"
        } else if codec.contains("vp09") || codec.eq_ignore_ascii_case("vp9") {
            "vp9_vaapi"
        } else if codec.contains("hevc") || codec.eq_ignore_ascii_case("hevc") || codec.eq_ignore_ascii_case("h265") {
            "hevc_vaapi"
        } else {
            "h264_vaapi"
        }
    } else if hw_mode == "nvdec" { // NVENC
        if codec.contains("av01") || codec.eq_ignore_ascii_case("av1") {
            "av1_nvenc"
        } else if codec.contains("hevc") || codec.eq_ignore_ascii_case("hevc") || codec.eq_ignore_ascii_case("h265") {
            "hevc_nvenc"
        } else {
            "h264_nvenc"
        }
    } else {
        ffmpeg_video_codec(codec)
    }
}

fn even(value: u32) -> u32 {
    value & !1
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
