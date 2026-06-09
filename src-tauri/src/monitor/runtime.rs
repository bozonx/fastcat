//! Layer runtime lifecycle and runtime manager.
//!
//! `LayerRuntimeManager` owns all decoders and caches, diffs the scene
//! (keeping alive runtimes), starts background loading, and builds the compositor snapshot.
//!
//! Layer lifecycle:
//!   `tick` → `ensure_runtime_for` → `LayerRuntime::Loading` + background thread
//!   → `BgLayerResult` → `apply_bg_result` → `Video | Image | Failed`
//!   `apply_scene` (new scene) → `Failed` is removed → retry
//!
//! Intentionally unaware of winit, wgpu, or Tauri IPC.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::mpsc::Sender;

use std::sync::Arc;

use tauri::AppHandle;
use winit::event_loop::EventLoopProxy;

use super::handle::MonitorCommand;
use super::layer_runtime::*;
use super::scene::{LayerKind, MonitorScene, PreviewSyncMode, SceneLayer};
use super::scene_build::{build_compositor_scene, rasterize_svg};
use crate::compositor::scene::Scene;
use crate::media::decode_gate::decoder_load_gate;
use crate::media::decode_thread::DecodePump;
use crate::media::image_decode::decode_image;

/// Сколько секунд видео прогревать вперёд playhead'а на паузе (после seek/смены
/// сцены), чтобы Play стартовал с уже декодированным первым GOP без фриза. Чуть
/// больше окна готовности `app::PREBUFFER_LOOKAHEAD_SEC`, чтобы к моменту Play кадры
/// уже были в кеше. Реальное число кадров ограничено бюджетом памяти на слой.
pub(super) const PREROLL_LOOKAHEAD_SEC: f64 = 0.2;

const STRICT_VIDEO_SYNC_LAG_FRAMES: f64 = 2.0;
const STRICT_VIDEO_SYNC_LAG_SEC: f64 = 0.08;
const BALANCED_VIDEO_SYNC_LAG_FRAMES: f64 = 6.0;
const BALANCED_VIDEO_SYNC_LAG_SEC: f64 = 0.22;

// ---------------------------------------------------------------------------
// LayerRuntimeManager
// ---------------------------------------------------------------------------

pub struct LayerRuntimeManager {
    app: AppHandle,
    /// Сцена «как заказал фронт». Arc — cheap clone для split-borrow.
    pub scene: Arc<Vec<SceneLayer>>,
    /// Размер композитного кадра (может прийти как MonitorScene.width/height).
    pub scene_size: (u32, u32),
    pub preview_scale: Option<f32>,
    /// Целевой FPS preview-монитора; устанавливается из MonitorScene.preview_fps.
    pub preview_fps: f64,
    /// Политика AV-sync для preview.
    pub preview_sync_mode: PreviewSyncMode,
    pub playing: bool,
    /// Последний timeline-PTS из `tick`/`seek`. Нужен, чтобы лениво открытый рантайм
    /// сикался на текущий playhead, а не на начало клипа.
    last_tick_t: f64,
    runtimes: HashMap<String, LayerRuntime>,
    loading_set: HashSet<String>,
    load_epoch: u64,
    bg_tx: Sender<BgLayerResult>,
    proxy: EventLoopProxy<MonitorCommand>,
    hw_settings: crate::FfmpegHardwareSettings,
}

impl LayerRuntimeManager {
    pub fn new(
        app: AppHandle,
        bg_tx: Sender<BgLayerResult>,
        proxy: EventLoopProxy<MonitorCommand>,
        hw_settings: crate::FfmpegHardwareSettings,
    ) -> Self {
        Self {
            app,
            scene: Arc::new(Vec::new()),
            scene_size: (0, 0),
            preview_scale: None,
            preview_fps: 30.0,
            preview_sync_mode: PreviewSyncMode::Balanced,
            playing: false,
            last_tick_t: 0.0,
            runtimes: HashMap::new(),
            loading_set: HashSet::new(),
            load_epoch: 0,
            bg_tx,
            proxy,
            hw_settings,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.scene.is_empty()
    }

    pub fn set_playing(&mut self, playing: bool) {
        if self.playing == playing {
            return;
        }
        self.playing = playing;
        for rt in self.runtimes.values_mut() {
            if let LayerRuntime::Video(v) = rt {
                if playing {
                    let _ = v.pump.play();
                } else {
                    let _ = v.pump.pause();
                }
            }
        }
    }

    pub fn update_hw_settings(&mut self, hw_settings: crate::FfmpegHardwareSettings) -> bool {
        if self.hw_settings == hw_settings {
            return false;
        }
        log::info!(
            "[monitor] hwaccel settings changed: {} -> {}",
            self.hw_settings.hardware_acceleration_mode.as_str(),
            hw_settings.hardware_acceleration_mode.as_str(),
        );
        self.hw_settings = hw_settings;
        self.load_epoch = self.load_epoch.wrapping_add(1);
        self.loading_set.clear();

        let prev = std::mem::take(&mut self.runtimes);
        let mut to_drop: Vec<LayerRuntime> = Vec::new();
        for (id, rt) in prev {
            match rt {
                LayerRuntime::Video(_) | LayerRuntime::Loading | LayerRuntime::Failed => {
                    to_drop.push(rt);
                }
                other => {
                    self.runtimes.insert(id, other);
                }
            }
        }
        if !to_drop.is_empty() {
            if let Err(e) = std::thread::Builder::new()
                .name("fastcat-rt-hw-drop".into())
                .spawn(move || drop(to_drop))
            {
                log::error!("[monitor] failed to spawn hw settings drop thread: {e:?}");
            }
        }
        true
    }

    /// Конец последнего слоя сцены (секунды timeline). 0.0 если сцена пуста.
    pub fn scene_end(&self) -> f64 {
        self.scene
            .iter()
            .map(|l| l.timeline_end_sec)
            .fold(0.0_f64, f64::max)
    }

    // -----------------------------------------------------------------------
    // Применение сцены
    // -----------------------------------------------------------------------

    /// Обновляет сцену, дропает вышедшие рантаймы, сбрасывает видео при смене scale.
    /// Возвращает `true`, если нужно перерисовать окно.
    pub fn apply_scene(&mut self, scene: MonitorScene) -> bool {
        // Санитайз: фронт может прислать 0/NaN/отрицательное, а `preview_fps` идёт в
        // `Duration::from_secs_f64(1.0 / fps)` в event-loop, который паникует на не-finite.
        self.preview_fps = sanitize_preview_fps(scene.preview_fps);
        self.preview_sync_mode = scene.preview_sync_mode;
        let new_ids: HashSet<String> = scene.layers.iter().map(|l| l.id.clone()).collect();

        // Путь источника по id в НОВОЙ сцене — чтобы заметить смену файла у того же
        // слоя (напр. переключение proxy ↔ оригинал в мониторе). id остаётся прежним,
        // меняется только `path`, поэтому диф по одному id оставил бы старый декодер.
        let new_paths: HashMap<&str, &str> = scene
            .layers
            .iter()
            .map(|l| (l.id.as_str(), l.path.as_str()))
            .collect();
        // Старые пути по id (текущая сцена ещё не перезаписана) для сравнения.
        let old_paths: HashMap<String, String> = self
            .scene
            .iter()
            .map(|l| (l.id.clone(), l.path.clone()))
            .collect();
        // Сменился ли путь хоть у одного слоя, доживающего до новой сцены.
        let any_path_changed = old_paths.iter().any(|(id, old)| {
            new_paths
                .get(id.as_str())
                .is_some_and(|new| *new != old.as_str())
        });

        let scale_changed = !approx_eq_opt_scale(self.preview_scale, scene.preview_scale);
        // И смена preview_scale, и смена источника требуют сбросить эпоху: иначе
        // фоновый декод, стартовавший под старый путь/масштаб, мог бы прилететь
        // позже и подменить свежий рантайм устаревшим источником.
        if scale_changed || any_path_changed {
            if scale_changed {
                log::info!(
                    "[monitor] preview_scale {:?} → {:?}: dropping video runtimes",
                    self.preview_scale,
                    scene.preview_scale,
                );
            }
            self.load_epoch = self.load_epoch.wrapping_add(1);
            self.loading_set.clear();
        }
        self.preview_scale = scene.preview_scale;

        // Diff рантаймов: сохраняем живые, остальные дропаем в фоне.
        // DecodePump::drop блокирует до завершения ffmpeg + join — делаем в отдельном потоке.
        let prev = std::mem::take(&mut self.runtimes);
        let mut to_drop: Vec<LayerRuntime> = Vec::new();
        for (id, rt) in prev {
            let drop_for_scale = scale_changed
                && match &rt {
                    LayerRuntime::Video(_) | LayerRuntime::Loading => true,
                    LayerRuntime::Image(im) => im.is_svg,
                    _ => false,
                };
            let gone = !new_ids.contains(&id);
            let failed_retry = matches!(rt, LayerRuntime::Failed);
            // Источник слоя сменился: старый декодер/растр держит другой файл, его
            // нужно дропнуть, чтобы `ensure_runtime_for` поднял новый путь заново.
            let path_changed = match (old_paths.get(&id), new_paths.get(id.as_str())) {
                (Some(old), Some(new)) => old.as_str() != *new,
                _ => false,
            };
            if drop_for_scale || gone || failed_retry || path_changed {
                to_drop.push(rt);
                self.loading_set.remove(&id);
            } else {
                self.runtimes.insert(id, rt);
            }
        }
        if !to_drop.is_empty() {
            // GPU-текстуры выбывших слоёв освобождаются дропом их кадров (Arc) внутри
            // самого рантайма — отдельной разсинхронизации с внешним кешем не требуется.
            if let Err(e) = std::thread::Builder::new()
                .name("fastcat-rt-drop".into())
                .spawn(move || drop(to_drop))
            {
                log::error!("[monitor] failed to spawn drop thread: {e:?}");
                // The closure is dropped by spawn on failure, which drops to_drop.
            }
        }

        self.loading_set.retain(|id| new_ids.contains(id));
        self.scene_size = (scene.width, scene.height);
        self.scene = Arc::new(scene.layers);
        true
    }

    // -----------------------------------------------------------------------
    // Фоновая загрузка
    // -----------------------------------------------------------------------

    fn ensure_runtime_for(
        &mut self,
        layer: &SceneLayer,
        device: Option<wgpu::Device>,
        queue: Option<wgpu::Queue>,
    ) {
        if matches!(
            layer.kind,
            LayerKind::Text | LayerKind::Shape | LayerKind::Background
        ) {
            return;
        }
        if self.runtimes.contains_key(&layer.id) {
            return;
        }
        self.runtimes
            .insert(layer.id.clone(), LayerRuntime::Loading);
        self.loading_set.insert(layer.id.clone());

        let id = layer.id.clone();
        let path = PathBuf::from(&layer.path);
        let bg_tx = self.bg_tx.clone();
        let proxy = self.proxy.clone();
        let epoch = self.load_epoch;

        match layer.kind {
            LayerKind::Video => {
                let max_long_edge = match (self.scene_size, self.preview_scale) {
                    ((w, h), Some(scale)) if w > 0 && h > 0 && scale > 0.0 => {
                        let long = w.max(h) as f32 * scale;
                        Some(long.round().max(2.0) as u32)
                    }
                    _ => None,
                };
                let hw_mode = self.hw_settings.hardware_acceleration_mode;
                let vaapi_dev = self.hw_settings.vaapi_device.clone();
                log::info!("[monitor] spawn video decoder {id} (max_long_edge={max_long_edge:?})");
                let spawn_id = id.clone();
                if let Err(e) = std::thread::Builder::new()
                    .name(format!("fastcat-load-video:{}", path.display()))
                    .spawn(move || {
                        let _permit = decoder_load_gate().acquire();
                        let proxy_cb = proxy.clone();
                        let on_frame = Box::new(move || {
                            let _ = proxy_cb.send_event(MonitorCommand::VideoFrameReady);
                        });
                        let result =
                            match DecodePump::open(crate::media::decode_thread::DecodeOpenParams {
                                path: &path,
                                max_output_long_edge: max_long_edge,
                                on_frame_decoded: Some(on_frame),
                                device,
                                queue,
                                hw_mode,
                                vaapi_device: Some(vaapi_dev.as_str()),
                            }) {
                                Ok(pump) => {
                                    let media_size = (pump.info.width, pump.info.height);
                                    let source_rotation = pump.info.rotation;
                                    BgLayerResult::VideoOk {
                                        epoch,
                                        id: spawn_id,
                                        pump,
                                        media_size,
                                        source_rotation,
                                    }
                                }
                                Err(e) => BgLayerResult::VideoErr {
                                    epoch,
                                    id: spawn_id,
                                    error: format!("{e:?}"),
                                },
                            };
                        let _ = bg_tx.send(result);
                        let _ = proxy.send_event(MonitorCommand::BgReady);
                    })
                {
                    log::error!("[monitor] failed to spawn video loader for {id}: {e:?}");
                    self.loading_set.remove(&id);
                    self.runtimes.insert(id, LayerRuntime::Failed);
                }
            }
            LayerKind::Image => {
                let spawn_id = id.clone();
                if let Err(e) = std::thread::Builder::new()
                    .name(format!("fastcat-load-img:{}", path.display()))
                    .spawn(move || {
                        let _permit = decoder_load_gate().acquire();
                        let result = match decode_image(&path) {
                            Ok(img) => BgLayerResult::ImageOk {
                                epoch,
                                id: spawn_id,
                                image: img.image,
                                size: (img.width, img.height),
                            },
                            Err(e) => BgLayerResult::ImageErr {
                                epoch,
                                id: spawn_id,
                                error: format!("{e:?}"),
                            },
                        };
                        let _ = bg_tx.send(result);
                        let _ = proxy.send_event(MonitorCommand::BgReady);
                    })
                {
                    log::error!("[monitor] failed to spawn image loader for {id}: {e:?}");
                    self.loading_set.remove(&id);
                    self.runtimes.insert(id, LayerRuntime::Failed);
                }
            }
            LayerKind::Svg => {
                // Целевое разрешение растеризации = разрешение, в котором слой будет
                // показан на мониторе (scene long edge × preview_scale). Так SVG не
                // мылится при увеличении и не жжёт память при маленьком preview.
                let target_long_edge = svg_target_long_edge(self.scene_size, self.preview_scale);
                let spawn_id = id.clone();
                if let Err(e) = std::thread::Builder::new()
                    .name(format!("fastcat-load-svg:{}", path.display()))
                    .spawn(move || {
                        let _permit = decoder_load_gate().acquire();
                        let result = match rasterize_svg(&path, target_long_edge) {
                            Ok((image, size)) => BgLayerResult::SvgOk {
                                epoch,
                                id: spawn_id,
                                image,
                                size,
                            },
                            Err(e) => BgLayerResult::SvgErr {
                                epoch,
                                id: spawn_id,
                                error: format!("{e:?}"),
                            },
                        };
                        let _ = bg_tx.send(result);
                        let _ = proxy.send_event(MonitorCommand::BgReady);
                    })
                {
                    log::error!("[monitor] failed to spawn svg loader for {id}: {e:?}");
                    self.loading_set.remove(&id);
                    self.runtimes.insert(id, LayerRuntime::Failed);
                }
            }
            LayerKind::Text | LayerKind::Shape | LayerKind::Background => {}
        }
    }

    pub fn apply_bg_result(&mut self, result: BgLayerResult) {
        match result {
            BgLayerResult::VideoOk {
                epoch,
                id,
                pump,
                media_size,
                source_rotation,
            } => {
                if epoch != self.load_epoch {
                    return;
                }
                if !self.loading_set.remove(&id) {
                    return;
                }
                if !self.scene.iter().any(|l| l.id == id) {
                    self.runtimes.remove(&id);
                    return;
                }
                log::info!(
                    "[monitor] opened video {id}: {}x{} @ {:.3}fps codec={}",
                    pump.info.width,
                    pump.info.height,
                    pump.info.fps,
                    pump.info.codec,
                );
                // Сикаем на ТЕКУЩИЙ playhead, а не на начало клипа: иначе при открытии
                // клипа на середине таймлайна декодер начал бы форвардом от source_start
                // и playhead показывал бы чёрное/стопкадр, пока декод не догонит позицию.
                let clip_local = self
                    .scene
                    .iter()
                    .find(|l| l.id == id)
                    .map(|l| l.source_pts_at(self.last_tick_t))
                    .unwrap_or(0.0);
                let rt = VideoLayerRt::new(pump, media_size, source_rotation);
                if self.playing {
                    let _ = rt.pump.play();
                } else {
                    let _ = rt.pump.pause();
                }
                if let Err(e) = rt.pump.seek(clip_local) {
                    log::error!("[monitor] initial seek {id}: {e:?}");
                }
                self.runtimes.insert(id, LayerRuntime::Video(rt));
            }
            BgLayerResult::VideoErr { epoch, id, error } => {
                if epoch != self.load_epoch {
                    return;
                }
                if !self.loading_set.remove(&id) {
                    return;
                }
                log::error!("[monitor] open pump {id}: {error}");
                if !matches!(self.runtimes.get(&id), Some(LayerRuntime::Video(_))) {
                    self.runtimes.insert(id.clone(), LayerRuntime::Failed);
                }
                emit_layer_failed(&self.app, &id, "video", &error);
            }
            BgLayerResult::ImageOk {
                epoch,
                id,
                image,
                size,
            } => {
                if epoch != self.load_epoch {
                    return;
                }
                if !self.loading_set.remove(&id) {
                    return;
                }
                if !self.scene.iter().any(|l| l.id == id) {
                    self.runtimes.remove(&id);
                    return;
                }
                log::info!("[monitor] decoded image {id}: {}x{}", size.0, size.1);
                self.runtimes.insert(
                    id,
                    LayerRuntime::Image(ImageLayerRt {
                        image,
                        size,
                        is_svg: false,
                    }),
                );
            }
            BgLayerResult::ImageErr { epoch, id, error } => {
                if epoch != self.load_epoch {
                    return;
                }
                if !self.loading_set.remove(&id) {
                    return;
                }
                log::error!("[monitor] decode image {id}: {error}");
                self.runtimes.insert(id.clone(), LayerRuntime::Failed);
                emit_layer_failed(&self.app, &id, "image", &error);
            }
            BgLayerResult::SvgOk {
                epoch,
                id,
                image,
                size,
            } => {
                if epoch != self.load_epoch {
                    return;
                }
                if !self.loading_set.remove(&id) {
                    return;
                }
                if !self.scene.iter().any(|l| l.id == id) {
                    self.runtimes.remove(&id);
                    return;
                }
                log::info!("[monitor] decoded svg {id}: {}x{}", size.0, size.1);
                self.runtimes.insert(
                    id,
                    LayerRuntime::Image(ImageLayerRt {
                        image,
                        size,
                        is_svg: true,
                    }),
                );
            }
            BgLayerResult::SvgErr { epoch, id, error } => {
                if epoch != self.load_epoch {
                    return;
                }
                if !self.loading_set.remove(&id) {
                    return;
                }
                log::error!("[monitor] decode svg {id}: {error}");
                self.runtimes.insert(id.clone(), LayerRuntime::Failed);
                emit_layer_failed(&self.app, &id, "svg", &error);
            }
        }
    }

    // -----------------------------------------------------------------------
    // Тик (вызывается каждый кадр)
    // -----------------------------------------------------------------------

    /// Запускает фоновую загрузку для активных слоёв и прокачивает видеокадры.
    pub fn tick(&mut self, t: f64, device: Option<wgpu::Device>, queue: Option<wgpu::Queue>) {
        self.last_tick_t = t;
        let scene = self.scene.clone();
        // Активные слои храним индексами в `scene`, а не клонами String id — иначе на
        // каждый кадр (30–60 fps) аллоцировались бы строки для всех видимых слоёв.
        let mut active: HashSet<usize> = HashSet::new();

        for (i, layer) in scene.iter().enumerate() {
            if layer.covers(t) {
                active.insert(i);
                self.ensure_runtime_for(layer, device.clone(), queue.clone());

                if let Some(t_in) = &layer.transition_in {
                    let local_t = t - layer.timeline_start_sec;
                    // Любой шейдерный переход (включая dissolve) блендит пиксели
                    // from-слоя — держим его рантайм живым в окне перехода.
                    if local_t < t_in.duration_sec && local_t >= 0.0 {
                        if let Some(from_id) = &t_in.from_layer_id {
                            if let Some(from_idx) = scene.iter().position(|l| &l.id == from_id) {
                                active.insert(from_idx);
                                self.ensure_runtime_for(
                                    &scene[from_idx],
                                    device.clone(),
                                    queue.clone(),
                                );
                            }
                        }
                    }
                }
            }
        }

        let playing = self.playing;
        for (i, layer) in scene.iter().enumerate() {
            if !active.contains(&i) || layer.kind != LayerKind::Video {
                continue;
            }
            if let Some(LayerRuntime::Video(rt)) = self.runtimes.get_mut(&layer.id) {
                rt.pull_into_cache();
                // Once per tick: is the decoder producing newer frames (moving forward)?
                // Used below to suppress the reseek-on-lag thrash on decode-bound sources.
                let advancing = rt.decoder_advancing();
                let clip_local = layer.source_pts_at(t);
                let max_lag_sec = video_sync_lag_sec(self.preview_sync_mode, rt.pump.info.fps);

                // Сначала пробуем кадр в окне синка (balanced/strict). Smooth не имеет
                // конечного окна и всегда показывает свежайший доступный кадр <= target.
                let shown_in_window = rt.update_display(clip_local, max_lag_sec);
                let shown_any = shown_in_window
                    || (allows_stale_video_fallback(self.preview_sync_mode)
                        && rt.update_display(clip_local, None));

                if playing {
                    if !shown_any {
                        rt.clear_display();
                        if self.preview_sync_mode == PreviewSyncMode::Strict {
                            // Strict/точно не имеет smooth fallback: stale-кадр за пределами
                            // окна синка не считается валидным preview-кадром. Принудительно
                            // двигаем декодер к target, а до прихода корректного кадра слой
                            // не показывает устаревшую картинку.
                            rt.note_lagged();
                            if let Some(max_lag_sec) = max_lag_sec {
                                rt.maybe_reseek_on_sync_lag(clip_local, max_lag_sec);
                            }
                        } else {
                            // Вообще нет кадра ≤ target (reverse / до начала клипа): репозиция.
                            rt.note_synced();
                            rt.maybe_reseek_on_miss(clip_local);
                        }
                    } else if !shown_in_window {
                        // Отстали за окно синка. Reseek скидывает бэклог ради синка — полезно,
                        // только если декодер декодит GOP→target быстрее реалтайма. На
                        // decode-bound источнике (4K) он лишь флашит буфер и пере-декодит →
                        // фризы (тот самый «фриз на 1–2 сек на старте»). Поэтому reseek-им,
                        // ТОЛЬКО если декодер не двигается вперёд (реально застрял/в чужом
                        // месте). Если он декодит вперёд, но медленнее реалтайма — сразу
                        // отступаем в плавный smooth-lag, не дожидаясь decode-bound порога.
                        rt.note_lagged();
                        if !advancing && !rt.is_decode_bound() {
                            if let Some(max_lag_sec) = max_lag_sec {
                                rt.maybe_reseek_on_sync_lag(clip_local, max_lag_sec);
                            }
                        }
                    } else {
                        rt.note_synced();
                    }
                }
            }
        }
    }

    /// Seek активных видеослоёв на `t`. На паузе при попадании в кеш показывает кадр без
    /// респауна ffmpeg (дешёвый скраб); иначе перепозиционирует декодер.
    pub fn seek(&mut self, t: f64, playing: bool) {
        self.last_tick_t = t;
        let scene = self.scene.clone();
        for layer in scene.iter() {
            if !layer.covers(t) || layer.kind != LayerKind::Video {
                continue;
            }
            let clip_local = layer.source_pts_at(t);
            if let Some(LayerRuntime::Video(rt)) = self.runtimes.get_mut(&layer.id) {
                rt.pull_into_cache();
                // Пауза + попадание в кеш → показываем кадр без перезапуска ffmpeg.
                if !playing && rt.has_cached_near(clip_local, 1) {
                    rt.update_display(clip_local, None);
                    continue;
                }
                if let Err(e) = rt.pump.seek(clip_local) {
                    log::error!("[monitor] seek pump {}: {e:?}", layer.id);
                }
                // На паузе сразу прогреваем первый GOP вперёд playhead'а, чтобы
                // последующий Play не фризил на декоде 4К от ключевого кадра. На
                // воспроизведении декодер и так стримит вперёд — отдельный прогрев не нужен.
                if !playing {
                    rt.request_prebuffer(PREROLL_LOOKAHEAD_SEC);
                }
                rt.update_display(
                    clip_local,
                    if playing {
                        video_sync_lag_sec(self.preview_sync_mode, rt.pump.info.fps)
                    } else {
                        None
                    },
                );
            }
        }
    }

    /// Есть ли активный видеослой в момент `t` — нужно ли прогревать декодеры перед
    /// стартом воспроизведения (для аудио/картинок прогрев не требуется).
    pub fn has_active_video(&self, t: f64) -> bool {
        self.scene
            .iter()
            .any(|l| l.kind == LayerKind::Video && l.covers(t))
    }

    /// Все активные видеослои декодировали кадр на `lookahead_sec` секунд впереди
    /// playhead'а — значит можно стартовать воспроизведение без фриза на GOP-декоде.
    /// Слой в состоянии `Loading`/`Failed` считается «ещё не готов» (рассосётся по
    /// таймауту прогрева в вызывающем коде).
    pub fn active_videos_ready(&mut self, t: f64, lookahead_sec: f64) -> bool {
        let scene = self.scene.clone();
        for layer in scene.iter() {
            if !layer.covers(t) || layer.kind != LayerKind::Video {
                continue;
            }
            let target = layer.source_pts_at(t) + lookahead_sec.max(0.0);
            match self.runtimes.get_mut(&layer.id) {
                Some(LayerRuntime::Video(rt)) => {
                    rt.pull_into_cache();
                    if !rt.has_buffered_through(target) {
                        return false;
                    }
                }
                _ => return false,
            }
        }
        true
    }

    /// На паузе: подтягивает свежедекодированные кадры активных видеослоёв в кеш и
    /// обновляет показанный кадр на текущем playhead'е, БЕЗ репозиции декодера.
    /// Нужно, чтобы кадр, догнавший playhead уже ПОСЛЕ seek/открытия декодера (когда
    /// `seek` нашёл кеш пустым), появился на экране — иначе монитор остаётся чёрным до
    /// первого Play. В отличие от `seek`, не дёргает `pump.seek` (никакого thrash на
    /// каждый VideoFrameReady).
    pub fn refresh_display(&mut self, t: f64) {
        self.last_tick_t = t;
        let scene = self.scene.clone();
        for layer in scene.iter() {
            if !layer.covers(t) || layer.kind != LayerKind::Video {
                continue;
            }
            let clip_local = layer.source_pts_at(t);
            if let Some(LayerRuntime::Video(rt)) = self.runtimes.get_mut(&layer.id) {
                rt.pull_into_cache();
                rt.update_display(clip_local, None);
            }
        }
    }

    /// Перепозиционирует декодеры активных видеослоёв к `t`. Вызывается при старте
    /// воспроизведения, чтобы после скраба по кешу forward-стрим был корректным.
    pub fn resync_active_videos(&mut self, t: f64) {
        self.last_tick_t = t;
        let scene = self.scene.clone();
        for layer in scene.iter() {
            if !layer.covers(t) || layer.kind != LayerKind::Video {
                continue;
            }
            let clip_local = layer.source_pts_at(t);
            if let Some(LayerRuntime::Video(rt)) = self.runtimes.get_mut(&layer.id) {
                if let Err(e) = rt.pump.seek(clip_local) {
                    log::error!("[monitor] resync pump {}: {e:?}", layer.id);
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Сборка compositor-сцены
    // -----------------------------------------------------------------------

    /// Строит снимок доменной сцены в момент `t` для передачи в `Compositor`.
    pub fn build_compositor_scene(&self, t: f64) -> Scene {
        build_compositor_scene(&self.scene, self.scene_size, &self.runtimes, t)
    }
}

/// Защищает preview-FPS: только конечные положительные значения, зажатые в разумный
/// диапазон. Невалидный вход → 30 fps (как `default_fps`).
pub fn sanitize_preview_fps(fps: f64) -> f64 {
    if fps.is_finite() && fps > 0.0 {
        fps.clamp(1.0, 240.0)
    } else {
        30.0
    }
}

fn video_sync_lag_sec(mode: PreviewSyncMode, fps: f64) -> Option<f64> {
    let fps = if fps.is_finite() && fps > 0.0 {
        fps
    } else {
        30.0
    };
    match mode {
        PreviewSyncMode::Smooth => None,
        PreviewSyncMode::Balanced => {
            Some((BALANCED_VIDEO_SYNC_LAG_FRAMES / fps).min(BALANCED_VIDEO_SYNC_LAG_SEC))
        }
        PreviewSyncMode::Strict => {
            Some((STRICT_VIDEO_SYNC_LAG_FRAMES / fps).min(STRICT_VIDEO_SYNC_LAG_SEC))
        }
    }
}

fn allows_stale_video_fallback(mode: PreviewSyncMode) -> bool {
    matches!(mode, PreviewSyncMode::Smooth | PreviewSyncMode::Balanced)
}

/// Целевое разрешение растеризации SVG: длинная сторона сцены × preview_scale.
/// `None`/невалидный scale → длинная сторона сцены без даунскейла. Если размер
/// сцены ещё неизвестен — дефолт 1920 (перерастеризация произойдёт при пересборке
/// рантайма после прихода реального scene_size).
fn svg_target_long_edge(scene_size: (u32, u32), preview_scale: Option<f32>) -> u32 {
    let long = scene_size.0.max(scene_size.1);
    let long = if long == 0 { 1920 } else { long };
    let scale = preview_scale.filter(|s| *s > 0.0).unwrap_or(1.0);
    ((long as f32 * scale).round() as u32).max(1)
}

// ---------------------------------------------------------------------------
// Вспомогательные функции
// ---------------------------------------------------------------------------

/// Сравнение scale с трактовкой `None == Some(1.0)` (нет даунскейла).
/// Без этого первый приход `Some(1.0)` после `None` сбрасывал бы живые декодеры.
fn approx_eq_opt_scale(a: Option<f32>, b: Option<f32>) -> bool {
    let a = a.unwrap_or(1.0);
    let b = b.unwrap_or(1.0);
    (a - b).abs() < 1e-4
}

#[cfg(test)]
mod tests {
    use super::allows_stale_video_fallback;
    use super::approx_eq_opt_scale;
    use super::sanitize_preview_fps;
    use super::svg_target_long_edge;
    use super::video_sync_lag_sec;
    use super::{BALANCED_VIDEO_SYNC_LAG_SEC, STRICT_VIDEO_SYNC_LAG_SEC};
    use crate::monitor::scene::{LayerKind, PreviewSyncMode, SceneLayer};
    use crate::monitor::scene_build::layer_with_auto_source_rotation;

    #[test]
    fn none_equals_some_one() {
        assert!(approx_eq_opt_scale(None, Some(1.0)));
        assert!(approx_eq_opt_scale(Some(1.0), None));
        assert!(approx_eq_opt_scale(None, None));
    }

    #[test]
    fn detects_meaningful_scale_change() {
        assert!(!approx_eq_opt_scale(None, Some(0.5)));
        assert!(!approx_eq_opt_scale(Some(1.0), Some(0.5)));
        assert!(!approx_eq_opt_scale(Some(0.25), Some(0.5)));
    }

    #[test]
    fn tolerates_float_noise() {
        assert!(approx_eq_opt_scale(Some(0.5), Some(0.5 + 1e-6)));
    }

    #[test]
    fn sanitize_preview_fps_guards_against_non_finite_and_nonpositive() {
        // Валидные значения проходят как есть.
        assert_eq!(sanitize_preview_fps(30.0), 30.0);
        assert_eq!(sanitize_preview_fps(60.0), 60.0);
        // 0/отрицательное/NaN/inf → дефолт 30 (иначе паника в Duration::from_secs_f64).
        assert_eq!(sanitize_preview_fps(0.0), 30.0);
        assert_eq!(sanitize_preview_fps(-5.0), 30.0);
        assert_eq!(sanitize_preview_fps(f64::NAN), 30.0);
        assert_eq!(sanitize_preview_fps(f64::INFINITY), 30.0);
        // Кламп сверху.
        assert_eq!(sanitize_preview_fps(100000.0), 240.0);
    }

    #[test]
    fn svg_target_tracks_scene_and_scale() {
        assert_eq!(svg_target_long_edge((1920, 1080), None), 1920);
        assert_eq!(svg_target_long_edge((1920, 1080), Some(0.5)), 960);
        assert_eq!(svg_target_long_edge((1080, 1920), Some(1.0)), 1920);
        // Неизвестный размер сцены → дефолт 1920.
        assert_eq!(svg_target_long_edge((0, 0), Some(1.0)), 1920);
    }

    #[test]
    fn video_sync_lag_uses_mode_policy() {
        assert_eq!(video_sync_lag_sec(PreviewSyncMode::Smooth, 60.0), None);

        let balanced = video_sync_lag_sec(PreviewSyncMode::Balanced, 60.0).unwrap();
        assert!((balanced - 0.1).abs() < 1e-9);

        let balanced_capped = video_sync_lag_sec(PreviewSyncMode::Balanced, 24.0).unwrap();
        assert!((balanced_capped - BALANCED_VIDEO_SYNC_LAG_SEC).abs() < 1e-9);

        let strict = video_sync_lag_sec(PreviewSyncMode::Strict, 60.0).unwrap();
        assert!((strict - (2.0 / 60.0)).abs() < 1e-9);

        let strict_capped = video_sync_lag_sec(PreviewSyncMode::Strict, 24.0).unwrap();
        assert!((strict_capped - STRICT_VIDEO_SYNC_LAG_SEC).abs() < 1e-9);
    }

    #[test]
    fn stale_video_fallback_is_disabled_for_strict_mode() {
        assert!(allows_stale_video_fallback(PreviewSyncMode::Smooth));
        assert!(allows_stale_video_fallback(PreviewSyncMode::Balanced));
        assert!(!allows_stale_video_fallback(PreviewSyncMode::Strict));
    }

    #[test]
    fn auto_source_orientation_uses_decoder_rotation() {
        let layer = test_video_layer(Some("auto"));
        let resolved = layer_with_auto_source_rotation(&layer, -90);

        assert_eq!(resolved.source_orientation.as_deref(), Some("270"));
    }

    #[test]
    fn explicit_source_orientation_overrides_decoder_rotation() {
        let layer = test_video_layer(Some("0"));
        let resolved = layer_with_auto_source_rotation(&layer, 90);

        assert_eq!(resolved.source_orientation.as_deref(), Some("0"));
    }

    fn test_video_layer(source_orientation: Option<&str>) -> SceneLayer {
        SceneLayer {
            id: "v1".into(),
            kind: LayerKind::Video,
            path: "/tmp/video.mp4".into(),
            timeline_start_sec: 0.0,
            timeline_end_sec: 1.0,
            source_start_sec: 0.0,
            source_range_duration_sec: 1.0,
            speed: 1.0,
            freeze_frame_source_sec: None,
            source_orientation: source_orientation.map(str::to_string),
            z: 0,
            opacity: 1.0,
            blend_mode: crate::compositor::scene::BlendMode::Normal,
            background_color: None,
            text: None,
            style: None,
            shape_type: None,
            fill_color: None,
            stroke_color: None,
            stroke_width: None,
            shape_config: None,
            transform: None,
            transition_in: None,
            transition_out: None,
            effects: Vec::new(),
        }
    }
}
