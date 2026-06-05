//! Жизненный цикл слоёв рантайма и менеджер рантаймов.
//!
//! `LayerRuntimeManager` владеет всеми декодерами и кешами, производит diff сцены
//! (сохраняя живые рантаймы), запускает фоновую загрузку и строит compositor-снимок.
//!
//! Жизненный цикл слоя:
//!   `tick` → `ensure_runtime_for` → `LayerRuntime::Loading` + фоновый поток
//!   → `BgLayerResult` → `apply_bg_result` → `Video | Image | Failed`
//!   `apply_scene` (новая сцена) → `Failed` удаляется → retry
//!
//! Намеренно не знает о winit, wgpu или Tauri IPC.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::mpsc::Sender;
use std::sync::Arc;
use std::time::Instant;

use tauri::{AppHandle, Emitter};
use vello::peniko::{Blob, Color, ImageAlphaType, ImageData, ImageFormat};
use winit::event_loop::EventLoopProxy;

use crate::compositor::scene::{LayerKind as CompLayerKind, RasterSource, Scene};
use crate::media::decode::VideoFrame;
use crate::media::decode_gate::decoder_load_gate;
use crate::media::decode_thread::DecodePump;
use crate::media::image_decode::decode_image;

use super::frame_cache::{DecodedVideoFrame, VideoFrameCache};
use super::handle::MonitorCommand;
use super::scene::{LayerKind, MonitorScene, PreviewSyncMode, SceneLayer};
use super::scene_build::{
    build_virtual_kind, finalize_layer, layer_with_auto_source_rotation, rasterize_svg,
};

const EVT_LAYER_FAILED: &str = "monitor:layer_failed";
const STRICT_VIDEO_SYNC_LAG_FRAMES: f64 = 2.0;
const STRICT_VIDEO_SYNC_LAG_SEC: f64 = 0.08;
const BALANCED_VIDEO_SYNC_LAG_FRAMES: f64 = 6.0;
const BALANCED_VIDEO_SYNC_LAG_SEC: f64 = 0.22;

/// Если ближайший кешированный кадр дальше этого от цели — декодер стоит не там
/// (reverse / fast-forward / большой скачок) и нужна репозиция. Меньшие промахи —
/// транзиентный стол декодера на 1×, их не трогаем.
const RESEEK_MISS_DISTANCE_SEC: f64 = 0.5;
/// Минимальный интервал между репозициями одного слоя, чтобы in-flight seek успел
/// долететь и не было storm'а команд декодеру.
const RESEEK_COOLDOWN_SEC: f64 = 0.15;

// ---------------------------------------------------------------------------
// Результаты фоновой загрузки
// ---------------------------------------------------------------------------

pub enum BgLayerResult {
    VideoOk {
        id: String,
        pump: DecodePump,
        media_size: (u32, u32),
        source_rotation: i32,
    },
    VideoErr {
        id: String,
        error: String,
    },
    ImageOk {
        id: String,
        image: ImageData,
        size: (u32, u32),
    },
    ImageErr {
        id: String,
        error: String,
    },
    SvgOk {
        id: String,
        image: ImageData,
        size: (u32, u32),
    },
    SvgErr {
        id: String,
        error: String,
    },
}

// ---------------------------------------------------------------------------
// Рантаймы слоёв
// ---------------------------------------------------------------------------

pub enum LayerRuntime {
    Video(VideoLayerRt),
    Image(ImageLayerRt),
    /// Фоновый поток загрузки запущен — результат ещё не пришёл.
    Loading,
    /// Открытие не удалось. Удаляется следующим `apply_scene` для retry.
    Failed,
}

pub struct VideoLayerRt {
    pub pump: DecodePump,
    pub media_size: (u32, u32),
    pub source_rotation: i32,
    /// Текущий отображаемый кадр (последний с PTS ≤ target из кеша).
    pub current: Option<DecodedVideoFrame>,
    /// Кеш декодированных кадров для дешёвого скраба назад без респауна ffmpeg.
    cache: VideoFrameCache,
    /// Время последней репозиции декодера по cache-miss (троттлинг reseek).
    last_reseek: Option<Instant>,
}

impl VideoLayerRt {
    fn new(pump: DecodePump, media_size: (u32, u32), source_rotation: i32) -> Self {
        let fps = pump.info.fps;
        let frame_bytes = (media_size.0 as usize)
            .saturating_mul(media_size.1 as usize)
            .saturating_mul(4);
        Self {
            cache: VideoFrameCache::new(fps, frame_bytes),
            pump,
            media_size,
            source_rotation,
            current: None,
            last_reseek: None,
        }
    }

    /// Декодер не там, где нужно (reverse / fast-forward / промах кеша): репозиционируем
    /// его на `target` и сразу показываем ближайший доступный кадр, чтобы экран не застывал.
    /// Троттлится `RESEEK_COOLDOWN_SEC`; реагирует только на «дальние» промахи.
    fn maybe_reseek_on_miss(&mut self, target_clip_local: f64) {
        let far_miss = match self.cache.nearest_distance_sec(target_clip_local) {
            Some(dist) => dist > RESEEK_MISS_DISTANCE_SEC,
            None => true,
        };
        if !far_miss {
            return;
        }
        let now = Instant::now();
        if let Some(last) = self.last_reseek {
            if now.duration_since(last).as_secs_f64() < RESEEK_COOLDOWN_SEC {
                return;
            }
        }
        self.last_reseek = Some(now);
        if let Err(e) = self.pump.seek(target_clip_local) {
            log::error!("[monitor] reseek-on-miss seek: {e:?}");
        }
        if let Some(frame) = self.cache.frame_nearest(target_clip_local) {
            self.current = Some(frame);
        }
    }

    /// Сливает все доступные кадры из декодера в кеш (неблокирующе).
    fn pull_into_cache(&mut self, cache: &mut crate::compositor::texture_cache::TextureCache) {
        let live_gen = self.pump.current_generation();
        while let Some(msg) = self.pump.try_recv_frame() {
            if msg.generation != live_gen {
                continue;
            }
            self.cache.insert(video_frame_to_image(msg.frame, cache));
        }
    }

    /// Выбирает отображаемый кадр: ближайший с PTS ≤ target из кеша (если есть).
    fn update_display(&mut self, target_clip_local: f64, max_lag_sec: Option<f64>) -> bool {
        let frame = match max_lag_sec {
            Some(max_lag) => self.cache.frame_le_with_max_lag(target_clip_local, max_lag),
            None => self.cache.frame_le(target_clip_local),
        };
        match frame {
            Some(frame) => {
                self.current = Some(frame);
                true
            }
            None => false,
        }
    }
}

pub struct ImageLayerRt {
    pub image: ImageData,
    pub size: (u32, u32),
    pub is_svg: bool,
}

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
    bg_tx: Sender<BgLayerResult>,
    proxy: EventLoopProxy<MonitorCommand>,
    pub texture_cache: crate::compositor::texture_cache::TextureCache,
}

impl LayerRuntimeManager {
    pub fn new(
        app: AppHandle,
        bg_tx: Sender<BgLayerResult>,
        proxy: EventLoopProxy<MonitorCommand>,
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
            bg_tx,
            proxy,
            texture_cache: crate::compositor::texture_cache::TextureCache::new(),
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

        let scale_changed = !approx_eq_opt_scale(self.preview_scale, scene.preview_scale);
        if scale_changed {
            log::info!(
                "[monitor] preview_scale {:?} → {:?}: dropping video runtimes",
                self.preview_scale,
                scene.preview_scale,
            );
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
            if drop_for_scale || gone || failed_retry {
                to_drop.push(rt);
            } else {
                self.runtimes.insert(id, rt);
            }
        }
        if !to_drop.is_empty() {
            std::thread::Builder::new()
                .name("fastcat-rt-drop".into())
                .spawn(move || drop(to_drop))
                .ok();
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

        match layer.kind {
            LayerKind::Video => {
                let max_long_edge = match (self.scene_size, self.preview_scale) {
                    ((w, h), Some(scale)) if w > 0 && h > 0 && scale > 0.0 => {
                        let long = w.max(h) as f32 * scale;
                        Some(long.round().max(2.0) as u32)
                    }
                    _ => None,
                };
                log::info!("[monitor] spawn video decoder {id} (max_long_edge={max_long_edge:?})");
                std::thread::Builder::new()
                    .name(format!("fastcat-load-video:{}", path.display()))
                    .spawn(move || {
                        let _permit = decoder_load_gate().acquire();
                        let proxy_cb = proxy.clone();
                        let on_frame = Box::new(move || {
                            let _ = proxy_cb.send_event(MonitorCommand::VideoFrameReady);
                        });
                        let result = match DecodePump::open(
                            &path,
                            max_long_edge,
                            Some(on_frame),
                            device,
                            queue,
                        ) {
                            Ok(pump) => {
                                let media_size = (pump.info.width, pump.info.height);
                                let source_rotation = pump.info.rotation;
                                BgLayerResult::VideoOk {
                                    id,
                                    pump,
                                    media_size,
                                    source_rotation,
                                }
                            }
                            Err(e) => BgLayerResult::VideoErr {
                                id,
                                error: e.to_string(),
                            },
                        };
                        let _ = bg_tx.send(result);
                        let _ = proxy.send_event(MonitorCommand::BgReady);
                    })
                    .ok();
            }
            LayerKind::Image => {
                std::thread::Builder::new()
                    .name(format!("fastcat-load-img:{}", path.display()))
                    .spawn(move || {
                        let _permit = decoder_load_gate().acquire();
                        let result = match decode_image(&path) {
                            Ok(img) => BgLayerResult::ImageOk {
                                id,
                                image: img.image,
                                size: (img.width, img.height),
                            },
                            Err(e) => BgLayerResult::ImageErr {
                                id,
                                error: e.to_string(),
                            },
                        };
                        let _ = bg_tx.send(result);
                        let _ = proxy.send_event(MonitorCommand::BgReady);
                    })
                    .ok();
            }
            LayerKind::Svg => {
                // Целевое разрешение растеризации = разрешение, в котором слой будет
                // показан на мониторе (scene long edge × preview_scale). Так SVG не
                // мылится при увеличении и не жжёт память при маленьком preview.
                let target_long_edge = svg_target_long_edge(self.scene_size, self.preview_scale);
                std::thread::Builder::new()
                    .name(format!("fastcat-load-svg:{}", path.display()))
                    .spawn(move || {
                        let _permit = decoder_load_gate().acquire();
                        let result = match rasterize_svg(&path, target_long_edge) {
                            Ok((image, size)) => BgLayerResult::SvgOk { id, image, size },
                            Err(e) => BgLayerResult::SvgErr {
                                id,
                                error: e.to_string(),
                            },
                        };
                        let _ = bg_tx.send(result);
                        let _ = proxy.send_event(MonitorCommand::BgReady);
                    })
                    .ok();
            }
            LayerKind::Text | LayerKind::Shape | LayerKind::Background => {}
        }
    }

    pub fn apply_bg_result(&mut self, result: BgLayerResult) {
        match result {
            BgLayerResult::VideoOk {
                id,
                pump,
                media_size,
                source_rotation,
            } => {
                self.loading_set.remove(&id);
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
            BgLayerResult::VideoErr { id, error } => {
                self.loading_set.remove(&id);
                log::error!("[monitor] open pump {id}: {error}");
                if !matches!(self.runtimes.get(&id), Some(LayerRuntime::Video(_))) {
                    self.runtimes.insert(id.clone(), LayerRuntime::Failed);
                }
                emit_layer_failed(&self.app, &id, "video", &error);
            }
            BgLayerResult::ImageOk { id, image, size } => {
                self.loading_set.remove(&id);
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
            BgLayerResult::ImageErr { id, error } => {
                self.loading_set.remove(&id);
                log::error!("[monitor] decode image {id}: {error}");
                self.runtimes.insert(id.clone(), LayerRuntime::Failed);
                emit_layer_failed(&self.app, &id, "image", &error);
            }
            BgLayerResult::SvgOk { id, image, size } => {
                self.loading_set.remove(&id);
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
            BgLayerResult::SvgErr { id, error } => {
                self.loading_set.remove(&id);
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
                    if t_in.transition_type != "dissolve" && local_t < t_in.duration_sec && local_t >= 0.0 {
                        if let Some(from_id) = &t_in.from_layer_id {
                            if let Some(from_idx) = scene.iter().position(|l| &l.id == from_id) {
                                active.insert(from_idx);
                                self.ensure_runtime_for(&scene[from_idx], device.clone(), queue.clone());
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
                rt.pull_into_cache(&mut self.texture_cache);
                let clip_local = layer.source_pts_at(t);
                let max_lag_sec = video_sync_lag_sec(self.preview_sync_mode, rt.pump.info.fps);
                let shown = rt.update_display(clip_local, max_lag_sec);
                // Промах при воспроизведении = декодер стоит не туда (reverse / fast /
                // большой скачок): репозиционируем его и показываем ближайший кадр.
                if playing && !shown {
                    rt.maybe_reseek_on_miss(clip_local);
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
                rt.pull_into_cache(&mut self.texture_cache);
                // Пауза + попадание в кеш → показываем кадр без перезапуска ffmpeg.
                if !playing && rt.cache.has_near(clip_local, 1) {
                    rt.update_display(clip_local, None);
                    continue;
                }
                if let Err(e) = rt.pump.seek(clip_local) {
                    log::error!("[monitor] seek pump {}: {e:?}", layer.id);
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
        let (scene_w, scene_h) = self.resolved_scene_size();

        let mut active_indices = std::collections::HashSet::new();
        for i in 0..self.scene.len() {
            if self.scene[i].covers(t) {
                active_indices.insert(i);

                if let Some(t_in) = &self.scene[i].transition_in {
                    let local_t = t - self.scene[i].timeline_start_sec;
                    if t_in.transition_type != "dissolve" && local_t < t_in.duration_sec && local_t >= 0.0 {
                        if let Some(from_id) = &t_in.from_layer_id {
                            if let Some(from_idx) = (0..self.scene.len()).find(|&idx| &self.scene[idx].id == from_id) {
                                active_indices.insert(from_idx);
                            }
                        }
                    }
                }
            }
        }

        let mut indices: Vec<usize> = active_indices.into_iter().collect();
        indices.sort_by_key(|&i| self.scene[i].z);

        let mut layers = Vec::with_capacity(indices.len());
        for i in indices {
            let sl = &self.scene[i];
            if sl.opacity.clamp(0.0, 1.0) <= 0.0 {
                continue;
            }
            // Растровые kind'ы резолвим из кеша рантаймов; виртуальные (bg/shape/text)
            // строит общий `scene_build`.
            let layer_kind = match sl.kind {
                LayerKind::Video | LayerKind::Image | LayerKind::Svg => {
                    let Some(rt) = self.runtimes.get(&sl.id) else {
                        continue;
                    };
                    match rt {
                        LayerRuntime::Video(v) => match v.current.as_ref() {
                            Some(f) => CompLayerKind::Raster {
                                source: if let Some(key) = f.texture_key {
                                    RasterSource::GpuHandle(key)
                                } else {
                                    RasterSource::Image(f.image.clone())
                                },
                                natural_size: v.media_size,
                            },
                            None => continue,
                        },
                        LayerRuntime::Image(im) => CompLayerKind::Raster {
                            source: RasterSource::Image(im.image.clone()),
                            natural_size: im.size,
                        },
                        LayerRuntime::Loading | LayerRuntime::Failed => continue,
                    }
                }
                LayerKind::Background | LayerKind::Shape | LayerKind::Text => {
                    match build_virtual_kind(sl, (scene_w, scene_h)) {
                        Some(kind) => kind,
                        None => continue,
                    }
                }
            };

            let layer = match self.runtimes.get(&sl.id) {
                Some(LayerRuntime::Video(v)) => {
                    layer_with_auto_source_rotation(sl, v.source_rotation)
                }
                _ => sl.clone(),
            };
            layers.push(finalize_layer(&layer, layer_kind, (scene_w, scene_h), t));
        }

        Scene {
            width: scene_w,
            height: scene_h,
            time: t,
            background: Color::TRANSPARENT,
            layers,
        }
    }

    /// Размер сцены: из MonitorScene.width/height или bounding box рантаймов.
    fn resolved_scene_size(&self) -> (u32, u32) {
        if self.scene_size.0 > 0 && self.scene_size.1 > 0 {
            return self.scene_size;
        }
        let mut w = 0u32;
        let mut h = 0u32;
        for layer in self.scene.iter() {
            let Some(rt) = self.runtimes.get(&layer.id) else {
                continue;
            };
            let (mw, mh) = match rt {
                LayerRuntime::Video(v) => v.media_size,
                LayerRuntime::Image(im) => im.size,
                LayerRuntime::Loading | LayerRuntime::Failed => continue,
            };
            w = w.max(mw);
            h = h.max(mh);
        }
        if w == 0 || h == 0 {
            (1920, 1080)
        } else {
            (w, h)
        }
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

fn video_frame_to_image(
    mut frame: VideoFrame,
    cache: &mut crate::compositor::texture_cache::TextureCache,
) -> DecodedVideoFrame {
    let width = frame.width;
    let height = frame.height;
    let pts_sec = frame.pts_sec;
    let texture_key = std::mem::take(&mut frame.texture).map(|t| cache.insert(t));
    let blob = Blob::new(Arc::new(std::mem::take(&mut frame.pixels)));
    DecodedVideoFrame {
        pts_sec,
        image: ImageData {
            data: blob,
            format: ImageFormat::Rgba8,
            alpha_type: ImageAlphaType::Alpha,
            width,
            height,
        },
        texture_key,
    }
}

pub fn emit_layer_failed(app: &AppHandle, id: &str, kind: &str, error: &str) {
    #[derive(serde::Serialize, Clone)]
    struct Payload<'a> {
        id: &'a str,
        kind: &'a str,
        error: &'a str,
    }
    let _ = app.emit(EVT_LAYER_FAILED, Payload { id, kind, error });
}

/// Сравнение scale с трактовкой `None == Some(1.0)` (нет даунскейла).
/// Без этого первый приход `Some(1.0)` после `None` сбрасывал бы живые декодеры.
fn approx_eq_opt_scale(a: Option<f32>, b: Option<f32>) -> bool {
    let a = a.unwrap_or(1.0);
    let b = b.unwrap_or(1.0);
    (a - b).abs() < 1e-4
}

#[cfg(test)]
mod tests {
    use super::approx_eq_opt_scale;
    use super::sanitize_preview_fps;
    use crate::monitor::scene_build::layer_with_auto_source_rotation;
    use super::svg_target_long_edge;
    use super::video_sync_lag_sec;
    use super::{BALANCED_VIDEO_SYNC_LAG_SEC, STRICT_VIDEO_SYNC_LAG_SEC};
    use crate::monitor::scene::{LayerKind, PreviewSyncMode, SceneLayer};

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
            blend_mode: "normal".into(),
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
