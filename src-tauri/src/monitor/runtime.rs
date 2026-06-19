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

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use tauri::AppHandle;
use winit::event_loop::EventLoopProxy;

use super::handle::MonitorCommand;
use super::layer_runtime::*;
use super::scene::{LayerKind, MonitorScene, NativeFrameCacheMode, PreviewSyncMode, SceneLayer};
use super::scene_build::{build_compositor_scene, rasterize_svg};
use crate::compositor::scene::Scene;
use crate::media::decode_gate::decoder_load_gate;
use crate::media::decode_thread::DecodePump;
use crate::media::image_decode::decode_image;

/// Сколько секунд до начала будущего клипа на таймлайне должно оставаться,
/// чтобы мы превентивно запустили фоновую инициализацию его декодера. Должно
/// перекрывать худшее время «открыть декодер + декодировать первый GOP» —
/// для 4K/long-GOP открытие ffmpeg + первый GOP заметно дольше прежних 1.5с,
/// поэтому при слишком коротком окне следующий клип на стыке всё равно стартовал
/// «вхолодную» и заикался. Запас в секунду компенсирует ожидание пермита
/// `decoder_load_gate`, когда активный слой ещё держит свой open.
const VIDEO_PREWARM_LOOKAHEAD_SEC: f64 = 2.5;

/// Окно удержания рантайма слоя вокруг playhead'а. Рантаймы клипов, чей timeline-интервал
/// не пересекает `[t - KEEP_BEHIND, t + KEEP_AHEAD]`, вытесняются прямо во время
/// воспроизведения (а не только при `apply_scene`). Без этого при длинном таймлайне
/// накапливались бы живые ffmpeg-декодеры + кадровые кэши на КАЖДЫЙ пройденный клип
/// (память и число потоков росли бы с числом проигранных клипов, а не с рабочим
/// множеством у playhead). `KEEP_AHEAD` ≥ `VIDEO_PREWARM_LOOKAHEAD_SEC`, иначе только что
/// прогретый будущий клип вытеснялся бы тем же тиком (thrash «прогрел → выкинул → прогрел»).
const RUNTIME_KEEP_BEHIND_SEC: f64 = 3.0;
const RUNTIME_KEEP_AHEAD_SEC: f64 = VIDEO_PREWARM_LOOKAHEAD_SEC + 1.0;

const MB: usize = 1024 * 1024;
const LOW_CACHE_BUDGET_BYTES: usize = 96 * MB;
const BALANCED_CACHE_BUDGET_BYTES: usize = 192 * MB;
const HIGH_CACHE_BUDGET_BYTES: usize = 512 * MB;
const AUTO_CACHE_MIN_FRAMES: usize = 6;
const AUTO_CACHE_MAX_BYTES: usize = 512 * MB;
const AUTO_CACHE_TARGET_WINDOW_SEC: f64 = 0.5;

const STRICT_VIDEO_SYNC_LAG_FRAMES: f64 = 2.0;
const STRICT_VIDEO_SYNC_LAG_SEC: f64 = 0.08;
const BALANCED_VIDEO_SYNC_LAG_FRAMES: f64 = 6.0;
const BALANCED_VIDEO_SYNC_LAG_SEC: f64 = 0.22;

/// Identifies which decoded SOURCE frames a layer's runtime must hold. Deliberately
/// excludes the clip's `timeline_start/end`: moving a clip along the timeline (or
/// right-trimming it, which only shortens `timeline_end`) does not change which source
/// pixels the decoder must produce — `source_start_sec`, `source_range_duration_sec`,
/// `speed` and `freeze_frame_source_sec` fully capture the source mapping. Including the
/// timeline position here previously respawned the ffmpeg decoder + frame cache on every
/// drag/trim, freezing the layer while it re-opened. The live `SceneLayer` still carries
/// the up-to-date `timeline_start_sec` used by `source_pts_at`, so playback maps correctly.
#[derive(Debug, Clone, PartialEq)]
struct VideoRuntimeKey {
    kind: LayerKind,
    path: String,
    source_start_bits: u64,
    source_range_duration_bits: u64,
    speed_bits: u64,
    freeze_frame_source_bits: Option<u64>,
    source_orientation: Option<String>,
}

impl VideoRuntimeKey {
    fn from_layer(layer: &SceneLayer) -> Self {
        Self {
            kind: layer.kind,
            path: layer.path.clone(),
            source_start_bits: layer.source_start_sec.to_bits(),
            source_range_duration_bits: layer.source_range_duration_sec.to_bits(),
            speed_bits: layer.speed.to_bits(),
            freeze_frame_source_bits: layer.freeze_frame_source_sec.map(f64::to_bits),
            source_orientation: layer.source_orientation.clone(),
        }
    }
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
    /// Global transport speed. Used to keep future-layer warmup measured in wall time:
    /// at 4x a 1.5s timeline window leaves only 375ms to open/decode the next clip.
    playback_speed: f64,
    frame_cache_mode: NativeFrameCacheMode,
    frame_cache_custom_mb: u32,
    pub playing: bool,
    /// Последний timeline-PTS из `tick`/`seek`. Нужен, чтобы лениво открытый рантайм
    /// сикался на текущий playhead, а не на начало клипа.
    last_tick_t: f64,
    runtimes: HashMap<String, LayerRuntime>,
    loading_set: HashSet<String>,
    loading_cancels: HashMap<String, Arc<AtomicBool>>,
    load_epoch: u64,
    /// Atomic mirror of `load_epoch` so spawned threads can read it without locking.
    live_epoch: Arc<AtomicU64>,
    /// Gate controlling whether decoder threads emit `VideoFrameReady`. Disabled during
    /// active paced playback, where the event is a no-op that only wakes the event loop
    /// (frames are pulled on the pacing tick). Enabled while paused / warming up, where the
    /// event drives the paused display refresh and the play-prebuffer readiness check.
    frame_event_gate: Arc<AtomicBool>,
    bg_tx: Sender<BgLayerResult>,
    proxy: EventLoopProxy<MonitorCommand>,
    hw_settings: crate::FfmpegHardwareSettings,
    /// Video master effects applied to the final composited frame.
    pub master_effects: Vec<crate::compositor::effects::EffectSpec>,
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
            playback_speed: 1.0,
            frame_cache_mode: NativeFrameCacheMode::Auto,
            frame_cache_custom_mb: 0,
            playing: false,
            last_tick_t: 0.0,
            runtimes: HashMap::new(),
            loading_set: HashSet::new(),
            loading_cancels: HashMap::new(),
            load_epoch: 0,
            live_epoch: Arc::new(AtomicU64::new(0)),
            frame_event_gate: Arc::new(AtomicBool::new(true)),
            bg_tx,
            proxy,
            hw_settings,
            master_effects: Vec::new(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.scene.is_empty()
    }

    /// Включает/выключает эмит `VideoFrameReady` из декодер-потоков. Во время активного
    /// воспроизведения событие не нужно (кадры забираются по таймеру пейсинга) и лишь
    /// будит event-loop вхолостую — выключаем. На паузе/прогреве/микро-прайме оно двигает
    /// отображение и проверку готовности старта — включаем.
    pub fn set_frame_events_enabled(&self, enabled: bool) {
        self.frame_event_gate.store(enabled, Ordering::Relaxed);
    }

    pub fn set_playing(&mut self, playing: bool) {
        if self.playing == playing {
            return;
        }
        self.playing = playing;
        for rt in self.runtimes.values_mut() {
            if let LayerRuntime::Video(v) = rt {
                v.set_transport_playing(playing);
            }
        }
    }

    pub fn set_playback_speed(&mut self, speed: f64) {
        self.playback_speed = sanitize_transport_speed(speed).abs();
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
        self.live_epoch.store(self.load_epoch, Ordering::Relaxed);
        self.cancel_all_loading();
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
        let cache_policy_changed = self.frame_cache_mode != scene.frame_cache_mode
            || self.frame_cache_custom_mb != scene.frame_cache_custom_mb;
        let new_ids: HashSet<String> = scene.layers.iter().map(|l| l.id.clone()).collect();

        // Decode-key по id в НОВОЙ сцене — чтобы заметить смену файла или source mapping
        // у того же слоя. id остаётся прежним, но старый декодер/кэш уже не соответствует
        // кадрам, которые нужно показывать после trim/speed/freeze edits.
        let new_decode_keys: HashMap<&str, VideoRuntimeKey> = scene
            .layers
            .iter()
            .filter(|l| has_loaded_runtime(l.kind))
            .map(|l| (l.id.as_str(), VideoRuntimeKey::from_layer(l)))
            .collect();
        // Старые decode-key по id (текущая сцена ещё не перезаписана) для сравнения.
        let old_decode_keys: HashMap<String, VideoRuntimeKey> = self
            .scene
            .iter()
            .filter(|l| has_loaded_runtime(l.kind))
            .map(|l| (l.id.clone(), VideoRuntimeKey::from_layer(l)))
            .collect();
        // Сменился ли decode-key хоть у одного слоя, доживающего до новой сцены.
        let any_decode_key_changed = old_decode_keys.iter().any(|(id, old)| {
            new_decode_keys
                .get(id.as_str())
                .is_some_and(|new| new != old)
        });

        let scale_changed = !approx_eq_opt_scale(self.preview_scale, scene.preview_scale);
        // И смена preview_scale, и смена источника/source mapping требуют сбросить эпоху:
        // иначе фоновый декод, стартовавший под старые параметры, мог бы прилететь позже
        // и подменить свежий рантайм устаревшим источником.
        if scale_changed || any_decode_key_changed || cache_policy_changed {
            if scale_changed {
                log::info!(
                    "[monitor] preview_scale {:?} → {:?}: dropping video runtimes",
                    self.preview_scale,
                    scene.preview_scale,
                );
            }
            if cache_policy_changed {
                log::info!(
                    "[monitor] frame cache policy {:?}/{}MB → {:?}/{}MB: dropping video runtimes",
                    self.frame_cache_mode,
                    self.frame_cache_custom_mb,
                    scene.frame_cache_mode,
                    scene.frame_cache_custom_mb,
                );
            }
            self.load_epoch = self.load_epoch.wrapping_add(1);
            self.live_epoch.store(self.load_epoch, Ordering::Relaxed);
            self.cancel_all_loading();
            self.loading_set.clear();
        }
        self.preview_scale = scene.preview_scale;
        self.frame_cache_mode = scene.frame_cache_mode;
        self.frame_cache_custom_mb = scene.frame_cache_custom_mb;

        // Diff рантаймов: сохраняем живые, остальные дропаем в фоне.
        // DecodePump::drop блокирует до завершения ffmpeg + join — делаем в отдельном потоке.
        let prev = std::mem::take(&mut self.runtimes);
        let mut to_drop: Vec<LayerRuntime> = Vec::new();
        for (id, rt) in prev {
            let drop_for_policy = (scale_changed || cache_policy_changed)
                && match &rt {
                    LayerRuntime::Video(_) | LayerRuntime::Loading => true,
                    LayerRuntime::Image(im) => im.is_svg,
                    _ => false,
                };
            let gone = !new_ids.contains(&id);
            let failed_retry = matches!(rt, LayerRuntime::Failed);
            // Источник/source mapping слоя сменился: старый декодер/кэш держит другие кадры,
            // его нужно дропнуть, чтобы `ensure_runtime_for` поднял актуальный runtime.
            let decode_key_changed =
                match (old_decode_keys.get(&id), new_decode_keys.get(id.as_str())) {
                    (Some(old), Some(new)) => old != new,
                    _ => false,
                };
            if drop_for_policy || gone || failed_retry || decode_key_changed {
                to_drop.push(rt);
                self.loading_set.remove(&id);
                if let Some(cancel) = self.loading_cancels.remove(&id) {
                    cancel.store(true, Ordering::Relaxed);
                }
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
        self.master_effects = scene.master_effects;
        true
    }

    fn cancel_all_loading(&mut self) {
        for (_, cancel) in self.loading_cancels.drain() {
            cancel.store(true, Ordering::Relaxed);
        }
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
            LayerKind::Text | LayerKind::Shape | LayerKind::Background | LayerKind::Adjustment
        ) {
            return;
        }
        if let Some(rt) = self.runtimes.get(&layer.id) {
            if !matches!(rt, LayerRuntime::Loading) {
                return;
            }
            // A previous load was cancelled (Dropped); remove stale Loading and respawn.
            if !self.loading_set.contains(&layer.id) {
                self.runtimes.remove(&layer.id);
            } else {
                return;
            }
        }
        self.runtimes
            .insert(layer.id.clone(), LayerRuntime::Loading);
        self.loading_set.insert(layer.id.clone());
        let cancel = Arc::new(AtomicBool::new(false));
        self.loading_cancels
            .insert(layer.id.clone(), cancel.clone());

        let id = layer.id.clone();
        let path = PathBuf::from(&layer.path);
        let bg_tx = self.bg_tx.clone();
        let proxy = self.proxy.clone();
        let epoch = self.load_epoch;

        match layer.kind {
            LayerKind::Adjustment => unreachable!("adjustment layers do not need runtime loading"),
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
                let live_epoch = self.live_epoch.clone();
                let frame_event_gate = self.frame_event_gate.clone();
                if let Err(e) = std::thread::Builder::new()
                    .name(format!("fastcat-load-video:{}", path.display()))
                    .spawn(move || {
                        let cancel_fn = || {
                            cancel.load(Ordering::Relaxed)
                                || epoch != live_epoch.load(Ordering::Relaxed)
                        };
                        let permit = match decoder_load_gate().acquire_with_priority(
                            crate::media::decode_gate::LoadPriority::Live,
                            &cancel_fn,
                        ) {
                            Some(p) => p,
                            None => {
                                let _ = bg_tx.send(BgLayerResult::Dropped {
                                    id: spawn_id.clone(),
                                });
                                return;
                            }
                        };
                        let _permit = permit;
                        let proxy_cb = proxy.clone();
                        let gate = frame_event_gate.clone();
                        let on_frame = Box::new(move || {
                            // На активном воспроизведении кадры забираются по таймеру, а
                            // обработчик VideoFrameReady — no-op: событие лишь будит
                            // event-loop. Эмитим только когда оно реально нужно (пауза/прогрев).
                            if gate.load(Ordering::Relaxed) {
                                let _ = proxy_cb.send_event(MonitorCommand::VideoFrameReady);
                            }
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
                let live_epoch = self.live_epoch.clone();
                if let Err(e) = std::thread::Builder::new()
                    .name(format!("fastcat-load-img:{}", path.display()))
                    .spawn(move || {
                        let cancel_fn = || {
                            cancel.load(Ordering::Relaxed)
                                || epoch != live_epoch.load(Ordering::Relaxed)
                        };
                        let permit = match decoder_load_gate().acquire_with_priority(
                            crate::media::decode_gate::LoadPriority::Live,
                            &cancel_fn,
                        ) {
                            Some(p) => p,
                            None => {
                                let _ = bg_tx.send(BgLayerResult::Dropped {
                                    id: spawn_id.clone(),
                                });
                                return;
                            }
                        };
                        let _permit = permit;
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
                let live_epoch = self.live_epoch.clone();
                if let Err(e) = std::thread::Builder::new()
                    .name(format!("fastcat-load-svg:{}", path.display()))
                    .spawn(move || {
                        let cancel_fn = || {
                            cancel.load(Ordering::Relaxed)
                                || epoch != live_epoch.load(Ordering::Relaxed)
                        };
                        let permit = match decoder_load_gate().acquire_with_priority(
                            crate::media::decode_gate::LoadPriority::Live,
                            &cancel_fn,
                        ) {
                            Some(p) => p,
                            None => {
                                let _ = bg_tx.send(BgLayerResult::Dropped {
                                    id: spawn_id.clone(),
                                });
                                return;
                            }
                        };
                        let _permit = permit;
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
                self.loading_cancels.remove(&id);
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
                // Split the budget only across clips that can actually be on-screen
                // together with THIS one (overlap its own timeline interval), not the
                // global timeline maximum — otherwise a single transition/multicam
                // anywhere in the project would shrink the cache of every isolated clip.
                let concurrent = self
                    .scene
                    .iter()
                    .find(|l| l.id == id)
                    .map(|l| {
                        max_concurrent_video_layers_within(
                            &self.scene,
                            l.timeline_start_sec,
                            l.timeline_end_sec,
                        )
                    })
                    .unwrap_or(1);
                let cache_budget_bytes = frame_cache_budget_bytes(
                    self.frame_cache_mode,
                    self.frame_cache_custom_mb,
                    media_size,
                    pump.info.fps,
                    concurrent,
                );
                let mut rt =
                    VideoLayerRt::new(pump, media_size, source_rotation, cache_budget_bytes);
                let is_active_at_playhead = self
                    .scene
                    .iter()
                    .find(|l| l.id == id)
                    .is_some_and(|l| l.covers(self.last_tick_t));
                let defer_play_until_active = self.playing && !is_active_at_playhead;
                rt.set_play_deferred_until_active(defer_play_until_active);
                rt.set_transport_playing(self.playing);
                if let Err(e) = rt.pump.seek(clip_local) {
                    log::error!("[monitor] initial seek {id}: {e:?}");
                }
                rt.last_pump_seek_pts = Some(clip_local);
                rt.note_seek_requested();
                // Прогреваем первый GOP вперёд playhead'а, но не даём future-runtime
                // free-run'ить за стык. Будущий клип, который вот-вот заиграет
                // (defer во время воспроизведения), прогреваем глубже — иначе на
                // decode-bound 4K он стартует с ~2 кадров и заикается на стыке.
                if defer_play_until_active {
                    rt.request_warm_ahead();
                } else if !self.playing {
                    rt.request_prebuffer();
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
                self.loading_cancels.remove(&id);
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
                self.loading_cancels.remove(&id);
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
                self.loading_cancels.remove(&id);
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
                self.loading_cancels.remove(&id);
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
                self.loading_cancels.remove(&id);
                log::error!("[monitor] decode svg {id}: {error}");
                self.runtimes.insert(id.clone(), LayerRuntime::Failed);
                emit_layer_failed(&self.app, &id, "svg", &error);
            }
            BgLayerResult::Dropped { id } => {
                self.loading_set.remove(&id);
                self.loading_cancels.remove(&id);
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
            } else if layer.covers(t + self.prewarm_lookahead_sec()) {
                // Превентивно прогреваем декодер будущего слоя
                self.ensure_runtime_for(layer, device.clone(), queue.clone());
            }
        }

        let playing = self.playing;
        // Сначала прокачиваем все видео-рантаймы (включая прогревающиеся неактивные),
        // чтобы вычитать готовые кадры из фонового канала и заполнить кэш.
        for rt in self.runtimes.values_mut() {
            if let LayerRuntime::Video(v) = rt {
                v.pull_into_cache();
            }
        }

        for (i, layer) in scene.iter().enumerate() {
            if !active.contains(&i) || layer.kind != LayerKind::Video {
                continue;
            }
            if let Some(LayerRuntime::Video(rt)) = self.runtimes.get_mut(&layer.id) {
                // Once per tick: is the decoder producing newer frames (moving forward)?
                // Used below to suppress the reseek-on-lag thrash on decode-bound sources.
                let advancing = rt.decoder_advancing();
                let clip_local = layer.source_pts_at(t);
                if playing && rt.play_deferred_until_active() {
                    rt.activate_deferred_playback(clip_local);
                }
                let max_lag_sec = video_sync_lag_sec(self.preview_sync_mode, rt.pump.info.fps);

                // Сначала пробуем кадр в окне синка (balanced/strict). Smooth не имеет
                // конечного окна и всегда показывает свежайший доступный кадр <= target.
                let shown_in_window = rt.update_display(clip_local, max_lag_sec, None);
                let shown_any = shown_in_window
                    || (allows_stale_video_fallback(self.preview_sync_mode)
                        && rt.update_display(clip_local, None, None));

                if playing {
                    if !shown_any {
                        // Не гасим слой мгновенно — оставляем freeze frame (last known good
                        // frame), чтобы таймаут прогрева или кратковременный лаг декодера
                        // не превращались в черную вспышку. Только если кадра никогда не
                        // было (current == None), тогда слой действительно чёрный.
                        if rt.current.is_none() {
                            rt.clear_display();
                        }
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

        // Вытесняем рантаймы клипов, ушедших далеко от playhead'а: освобождаем их
        // ffmpeg-декодеры, кадровые кэши и GPU-текстуры, не дожидаясь смены сцены.
        self.evict_distant_runtimes(t, &scene, &active);
    }

    /// Дропает рантаймы (видео/изображение/svg/loading), чей слой не входит в активный
    /// набор и чей timeline-интервал не пересекает окно удержания вокруг playhead'а.
    /// Иначе при длинном воспроизведении рантайм каждого пройденного клипа жил бы до
    /// следующего `apply_scene` — копились бы потоки декодеров и декодированные кадры.
    fn evict_distant_runtimes(&mut self, t: f64, scene: &[SceneLayer], active: &HashSet<usize>) {
        if self.runtimes.is_empty() {
            return;
        }
        // id'ы слоёв, которые держим: активные (covers t / прогрев / transition-from)
        // ИЛИ близкие к playhead'у в пределах окна удержания.
        let mut keep: HashSet<&str> = HashSet::new();
        for (i, layer) in scene.iter().enumerate() {
            if active.contains(&i) || layer_near_playhead(layer, t, self.prewarm_lookahead_sec()) {
                keep.insert(layer.id.as_str());
            }
        }
        let to_remove: Vec<String> = self
            .runtimes
            .keys()
            .filter(|id| !keep.contains(id.as_str()))
            .cloned()
            .collect();
        if to_remove.is_empty() {
            return;
        }
        let mut to_drop: Vec<LayerRuntime> = Vec::with_capacity(to_remove.len());
        for id in to_remove {
            if let Some(rt) = self.runtimes.remove(&id) {
                to_drop.push(rt);
            }
            self.loading_set.remove(&id);
            if let Some(cancel) = self.loading_cancels.remove(&id) {
                cancel.store(true, Ordering::Relaxed);
            }
        }
        // GPU-текстуры выбывших слоёв освобождаются дропом их кадров (Arc) внутри
        // рантайма. `DecodePump::drop` блокирует до join'а ffmpeg-потока — дропаем в
        // отдельном потоке, чтобы не подвесить event-loop монитора.
        if let Err(e) = std::thread::Builder::new()
            .name("fastcat-rt-evict-drop".into())
            .spawn(move || drop(to_drop))
        {
            log::error!("[monitor] failed to spawn evict drop thread: {e:?}");
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
                // Пауза + попадание в кеш → показываем кадр без блокирующего ожидания
                // декода (мгновенный скраб из кеша).
                if !playing && rt.has_cached_near(clip_local, 1) {
                    let lead = Some(1.0 / rt.pump.info.fps.max(1.0));
                    rt.update_display(clip_local, None, lead);
                    // Всё равно прогреваем вперёд playhead'а для последующего Play. Но
                    // декодер мог стоять на другом месте (после прошлого воспроизведения/
                    // скраба): прогрев БЕЗ репозиции декодил бы кадры от чужой позиции —
                    // форвард-буфер вокруг playhead'а так и остался бы пустым, а кеш
                    // засорялся бы нерелевантными кадрами. Поэтому сначала перепозиционируем
                    // декодер на playhead (асинхронно, кадр уже показан из кеша — скраб
                    // остаётся мгновенным), затем прогреваем.
                    let need_seek = match rt.last_pump_seek_pts {
                        Some(last_pts) => (last_pts - clip_local).abs() > 1e-5,
                        None => true,
                    };
                    if need_seek {
                        if let Err(e) = rt.pump.seek(clip_local) {
                            log::error!("[monitor] cache-hit warm seek {}: {e:?}", layer.id);
                        }
                        rt.last_pump_seek_pts = Some(clip_local);
                        rt.note_seek_requested();
                    }
                    rt.request_prebuffer();
                    continue;
                }
                let need_seek = match rt.last_pump_seek_pts {
                    Some(last_pts) => (last_pts - clip_local).abs() > 1e-5,
                    None => true,
                };
                if need_seek {
                    if let Err(e) = rt.pump.seek(clip_local) {
                        log::error!("[monitor] seek pump {}: {e:?}", layer.id);
                    }
                    rt.last_pump_seek_pts = Some(clip_local);
                    rt.note_seek_requested();
                }
                // На паузе сразу прогреваем первый GOP вперёд playhead'а, чтобы
                // последующий Play не фризил на декоде 4К от ключевого кадра. На
                // воспроизведении декодер и так стримит вперёд — отдельный прогрев не нужен.
                if !playing {
                    rt.request_prebuffer();
                }
                let lead = if playing {
                    None
                } else {
                    Some(1.0 / rt.pump.info.fps.max(1.0))
                };
                rt.update_display(
                    clip_local,
                    if playing {
                        video_sync_lag_sec(self.preview_sync_mode, rt.pump.info.fps)
                    } else {
                        None
                    },
                    lead,
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

    /// Все активные видеослои декодировали кадр на глубину `expected_preroll_duration()`
    /// секунд впереди playhead'а (с учётом лимитов памяти на каждый слой) — значит можно
    /// стартовать воспроизведение без фриза на GOP-декоде.
    ///
    /// Два ключевых улучшения по сравнению с предыдущей версией:
    ///
    /// 1. **Динамический порог** — порог готовности для каждого слоя вычисляется из
    ///    `expected_preroll_duration()`, которая отражает реальный объём запрошенного
    ///    прогрева с учётом лимита памяти. Для 4K-видео с бюджетом на 2 кадра порог
    ///    составит ~2/fps вместо статических 0.12 сек, поэтому проверка проходит
    ///    сразу после декода этих двух кадров, а не зависает в таймауте.
    ///
    /// 2. **EOF-защита** — если playhead находится ближе чем на `lookahead` к концу
    ///    видео, target прижимается к `duration_sec - half_frame`. Это гарантирует
    ///    немедленное прохождение проверки у конца клипа без ожидания таймаута.
    ///
    /// Слой в состоянии `Loading`/`Failed` считается «ещё не готов» (рассосётся по
    /// таймауту прогрева в вызывающем коде).
    pub fn active_videos_ready(&mut self, t: f64) -> bool {
        let scene = self.scene.clone();
        for layer in scene.iter() {
            if !layer.covers(t) || layer.kind != LayerKind::Video {
                continue;
            }
            let clip_local = layer.source_pts_at(t);
            match self.runtimes.get_mut(&layer.id) {
                Some(LayerRuntime::Video(rt)) => {
                    rt.pull_into_cache();
                    // Dynamic readiness threshold: reflects the actual number of frames
                    // the decoder was asked to produce, not a static constant. For 4K
                    // sources capped at MIN_PREROLL_FRAMES the threshold shrinks to
                    // ~(MIN_PREROLL_FRAMES - 0.5) / fps so the check passes as soon as
                    // those frames are in the cache.
                    let lookahead = rt.expected_preroll_duration();
                    let fps = rt.pump.info.fps.max(1.0);
                    let half_frame = 0.5 / fps;
                    let video_duration = rt.pump.info.duration_sec;
                    // Clamp target to just before EOF so a playhead near the end of the
                    // clip passes the readiness check immediately instead of hanging
                    // until the prebuffer timeout fires.
                    let target = (clip_local + lookahead)
                        .min(video_duration - half_frame)
                        .max(clip_local);
                    if !rt.has_buffered_through(target) {
                        // Tail guard: `clip_local` clamps to `source_range`, which can sit
                        // ~a frame past the real last-frame PTS, so when the playhead is at
                        // the extreme end of a clip the `.max(clip_local)` above defeats the
                        // EOF clamp and no frame `>= target` can ever be decoded. Without
                        // this, Play near the clip tail would wait the full PREBUFFER_TIMEOUT.
                        // Accept readiness once the newest decoded frame is within half a
                        // frame of target (the decoder has produced everything it can).
                        let near_eof = rt
                            .newest_buffered_pts()
                            .is_some_and(|p| p >= target - half_frame);
                        if !near_eof {
                            return false;
                        }
                    }
                }
                _ => return false,
            }
        }
        true
    }

    /// На паузе: ГАРАНТИРУЕТ создание рантаймов активных raster-слоёв (video/image/svg),
    /// подтягивает свежедекодированные видеокадры в кеш и показывает кадр на playhead'е.
    ///
    /// Раньше `ensure_runtime_for` звался ТОЛЬКО из `tick` (а tick идёт лишь во время
    /// воспроизведения), поэтому на паузе декодеры вообще не создавались: монитор был
    /// чёрным на загрузке проекта, а первый Play стартовал в пустоту (декодер только
    /// тогда спавнился и догонял уже ушедший playhead) — и лишь повторный Play играл
    /// нормально. Теперь runtime спавнится и на паузе: video позиционируется на playhead в
    /// `apply_bg_result` (+ preroll), а image/svg догружаются до следующего `BgReady`.
    /// `device`/`queue` нужны для GPU-аплоада кадра внутри декодер-потока (как в `tick`).
    pub fn refresh_display(
        &mut self,
        t: f64,
        device: Option<wgpu::Device>,
        queue: Option<wgpu::Queue>,
    ) {
        self.last_tick_t = t;
        let scene = self.scene.clone();
        for layer in scene.iter() {
            if !layer.covers(t) {
                // Прогреваем декодер ближайшего будущего видеоклипа и на паузе, а не
                // только в `tick` (который идёт лишь при воспроизведении). Иначе Play,
                // нажатый когда playhead стоит/скрабит у стыка, заставал следующий клип
                // неоткрытым — он стартовал «вхолодную» и заикался. На паузе активного
                // декода нет, поэтому конкуренции за CPU/пермиты это не создаёт.
                if layer.kind == LayerKind::Video
                    && layer.covers(t + self.prewarm_lookahead_sec())
                {
                    self.ensure_runtime_for(layer, device.clone(), queue.clone());
                }
                continue;
            }
            if !is_refreshable_display_runtime(layer.kind) {
                continue;
            }
            self.ensure_runtime_for(layer, device.clone(), queue.clone());
            if layer.kind != LayerKind::Video {
                continue;
            }
            let clip_local = layer.source_pts_at(t);
            if let Some(LayerRuntime::Video(rt)) = self.runtimes.get_mut(&layer.id) {
                rt.pull_into_cache();
                let lead = Some(1.0 / rt.pump.info.fps.max(1.0));
                rt.update_display(clip_local, None, lead);
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
                let need_seek = match rt.last_pump_seek_pts {
                    Some(last_pts) => (last_pts - clip_local).abs() > 1e-5,
                    None => true,
                };
                if need_seek {
                    if let Err(e) = rt.pump.seek(clip_local) {
                        log::error!("[monitor] resync pump {}: {e:?}", layer.id);
                    }
                    rt.last_pump_seek_pts = Some(clip_local);
                    rt.note_seek_requested();
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Сборка compositor-сцены
    // -----------------------------------------------------------------------

    /// Строит снимок доменной сцены в момент `t` для передачи в `Compositor`.
    pub fn build_compositor_scene(&self, t: f64) -> Scene {
        build_compositor_scene(
            &self.scene,
            self.scene_size,
            &self.runtimes,
            t,
            &self.master_effects,
        )
    }

    fn prewarm_lookahead_sec(&self) -> f64 {
        scaled_prewarm_lookahead_sec(self.playback_speed)
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

fn has_loaded_runtime(kind: LayerKind) -> bool {
    matches!(kind, LayerKind::Video | LayerKind::Image | LayerKind::Svg)
}

fn is_refreshable_display_runtime(kind: LayerKind) -> bool {
    matches!(kind, LayerKind::Video | LayerKind::Image | LayerKind::Svg)
}

/// Пересекает ли timeline-интервал слоя окно удержания `[t - BEHIND, t + AHEAD]`.
/// Используется для вытеснения далёких рантаймов во время воспроизведения.
fn layer_near_playhead(layer: &SceneLayer, t: f64, prewarm_lookahead_sec: f64) -> bool {
    let keep_ahead = RUNTIME_KEEP_AHEAD_SEC.max(prewarm_lookahead_sec + 1.0);
    layer.timeline_start_sec < t + keep_ahead
        && layer.timeline_end_sec > t - RUNTIME_KEEP_BEHIND_SEC
}

fn sanitize_transport_speed(speed: f64) -> f64 {
    if speed.is_finite() && speed != 0.0 {
        speed.clamp(-100.0, 100.0)
    } else {
        1.0
    }
}

fn scaled_prewarm_lookahead_sec(playback_speed: f64) -> f64 {
    VIDEO_PREWARM_LOOKAHEAD_SEC * sanitize_transport_speed(playback_speed).abs().max(1.0)
}

fn allows_stale_video_fallback(mode: PreviewSyncMode) -> bool {
    matches!(mode, PreviewSyncMode::Smooth | PreviewSyncMode::Balanced)
}

fn frame_cache_budget_bytes(
    mode: NativeFrameCacheMode,
    custom_mb: u32,
    media_size: (u32, u32),
    fps: f64,
    concurrent_video_layers: usize,
) -> usize {
    let base = match mode {
        NativeFrameCacheMode::Low => LOW_CACHE_BUDGET_BYTES,
        NativeFrameCacheMode::Balanced => BALANCED_CACHE_BUDGET_BYTES,
        NativeFrameCacheMode::High => HIGH_CACHE_BUDGET_BYTES,
        NativeFrameCacheMode::Custom => (custom_mb as usize).saturating_mul(MB),
        NativeFrameCacheMode::Auto => {
            let frame_bytes = (media_size.0 as usize)
                .saturating_mul(media_size.1 as usize)
                .saturating_mul(4)
                .max(1);
            let fps = if fps.is_finite() && fps > 0.0 {
                fps
            } else {
                30.0
            };
            let target_frames =
                ((fps * AUTO_CACHE_TARGET_WINDOW_SEC).ceil() as usize).max(AUTO_CACHE_MIN_FRAMES);
            frame_bytes
                .saturating_mul(target_frames)
                .clamp(BALANCED_CACHE_BUDGET_BYTES, AUTO_CACHE_MAX_BYTES)
        }
    };
    // Treat the configured budget as a GLOBAL pool split across video layers that
    // are on screen at the same time, so total decoded-frame memory stays bounded
    // on multicam timelines (without it, N simultaneous 4K layers could each hold
    // the full budget → multiple GB). Sequential clips on a track never overlap, so
    // the divisor is 1 for the common single-clip-at-a-time case (no reduction).
    // The per-layer `VideoFrameCache` still floors at its own MIN_FRAMES, so each
    // layer keeps a usable scrub/lookahead window regardless of the split.
    base / concurrent_video_layers.max(1)
}

/// Maximum number of video layers simultaneously active at any instant *within the
/// `[lo, hi)` window* (typically one clip's own timeline interval). This is the right
/// divisor for splitting that clip's frame-cache budget: it is 1 for clips laid out
/// sequentially (only one decodes while it is on-screen) and rises only for genuine
/// multicam / transition overlaps that actually coincide with the clip — an unrelated
/// overlap elsewhere on the timeline no longer penalises it. Computed with an interval
/// sweep over each layer's interval clipped to `[lo, hi)`.
fn max_concurrent_video_layers_within(scene: &[SceneLayer], lo: f64, hi: f64) -> usize {
    let mut events: Vec<(f64, i32)> = Vec::new();
    for layer in scene.iter().filter(|l| l.kind == LayerKind::Video) {
        let s = layer.timeline_start_sec.max(lo);
        let e = layer.timeline_end_sec.min(hi);
        if e <= s {
            continue;
        }
        events.push((s, 1));
        events.push((e, -1));
    }
    // At an equal timestamp, process ends (-1) before starts (+1): a clip ending
    // exactly where the next begins does not count as an overlap.
    events.sort_by(|a, b| {
        a.0.partial_cmp(&b.0)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.1.cmp(&b.1))
    });
    let mut current = 0i32;
    let mut max = 0i32;
    for (_, delta) in events {
        current += delta;
        max = max.max(current);
    }
    (max.max(1)) as usize
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
    fn layer_near_playhead_keeps_window_around_t() {
        use super::layer_near_playhead;
        use super::{RUNTIME_KEEP_AHEAD_SEC, RUNTIME_KEEP_BEHIND_SEC, VIDEO_PREWARM_LOOKAHEAD_SEC};

        let l = video_layer_span("a", 10.0, 12.0);
        // Inside the clip.
        assert!(layer_near_playhead(&l, 11.0, VIDEO_PREWARM_LOOKAHEAD_SEC));
        // Just past the end, within the behind grace → still kept.
        assert!(layer_near_playhead(
            &l,
            12.0 + RUNTIME_KEEP_BEHIND_SEC - 0.1,
            VIDEO_PREWARM_LOOKAHEAD_SEC
        ));
        // Far past the end → evicted.
        assert!(!layer_near_playhead(
            &l,
            12.0 + RUNTIME_KEEP_BEHIND_SEC + 0.1,
            VIDEO_PREWARM_LOOKAHEAD_SEC
        ));
        // Just before the start, within the ahead (prewarm) window → kept.
        assert!(layer_near_playhead(
            &l,
            10.0 - RUNTIME_KEEP_AHEAD_SEC + 0.1,
            VIDEO_PREWARM_LOOKAHEAD_SEC
        ));
        // Far before the start → not yet kept.
        assert!(!layer_near_playhead(
            &l,
            10.0 - RUNTIME_KEEP_AHEAD_SEC - 0.1,
            VIDEO_PREWARM_LOOKAHEAD_SEC
        ));
        // The ahead window must cover the prewarm lookahead so a just-prewarmed clip
        // is never evicted the same tick it was warmed.
        assert!(RUNTIME_KEEP_AHEAD_SEC >= VIDEO_PREWARM_LOOKAHEAD_SEC);
    }

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
    fn paused_refresh_loads_static_raster_layers() {
        use super::is_refreshable_display_runtime;

        assert!(is_refreshable_display_runtime(LayerKind::Video));
        assert!(is_refreshable_display_runtime(LayerKind::Image));
        assert!(is_refreshable_display_runtime(LayerKind::Svg));
        assert!(!is_refreshable_display_runtime(LayerKind::Text));
        assert!(!is_refreshable_display_runtime(LayerKind::Shape));
        assert!(!is_refreshable_display_runtime(LayerKind::Background));
        assert!(!is_refreshable_display_runtime(LayerKind::Adjustment));
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

    #[test]
    fn video_runtime_key_tracks_source_mapping_changes() {
        use super::VideoRuntimeKey;

        let base = test_video_layer(None);
        let base_key = VideoRuntimeKey::from_layer(&base);

        let mut trimmed = base.clone();
        trimmed.source_start_sec = 2.0;
        assert_ne!(VideoRuntimeKey::from_layer(&trimmed), base_key);

        let mut sped = base.clone();
        sped.speed = 2.0;
        assert_ne!(VideoRuntimeKey::from_layer(&sped), base_key);

        let mut frozen = base.clone();
        frozen.freeze_frame_source_sec = Some(1.0);
        assert_ne!(VideoRuntimeKey::from_layer(&frozen), base_key);

        // Moving the clip along the timeline (or right-trimming, which only changes
        // timeline_end) must NOT change the key: the source mapping is identical, so the
        // decoder/cache should be kept alive rather than respawned mid-drag.
        let mut moved = base.clone();
        moved.timeline_start_sec += 5.0;
        moved.timeline_end_sec += 5.0;
        assert_eq!(VideoRuntimeKey::from_layer(&moved), base_key);

        let mut right_trimmed = base.clone();
        right_trimmed.timeline_end_sec -= 0.3;
        assert_eq!(VideoRuntimeKey::from_layer(&right_trimmed), base_key);
    }

    #[test]
    fn max_concurrent_video_layers_counts_temporal_overlap() {
        use super::max_concurrent_video_layers_within;

        // Sequential clips on a track never overlap → divisor 1 within any clip's interval.
        let sequential = vec![
            video_layer_span("a", 0.0, 5.0),
            video_layer_span("b", 5.0, 10.0),
            video_layer_span("c", 10.0, 15.0),
        ];
        assert_eq!(max_concurrent_video_layers_within(&sequential, 0.0, 5.0), 1);

        // Three genuinely overlapping (multicam) clips → divisor 3 within their span.
        let multicam = vec![
            video_layer_span("a", 0.0, 10.0),
            video_layer_span("b", 2.0, 12.0),
            video_layer_span("c", 4.0, 8.0),
        ];
        assert_eq!(max_concurrent_video_layers_within(&multicam, 0.0, 10.0), 3);

        // An overlap elsewhere on the timeline must NOT penalise an isolated clip:
        // within the lone clip `solo`'s own interval only it is active → 1.
        let mixed = vec![
            video_layer_span("solo", 0.0, 5.0),
            video_layer_span("m1", 20.0, 30.0),
            video_layer_span("m2", 22.0, 28.0),
        ];
        assert_eq!(max_concurrent_video_layers_within(&mixed, 0.0, 5.0), 1);
        assert_eq!(max_concurrent_video_layers_within(&mixed, 20.0, 30.0), 2);

        // Empty / no-video scene still yields at least 1 (never divides by zero).
        assert_eq!(max_concurrent_video_layers_within(&[], 0.0, 10.0), 1);
    }

    #[test]
    fn frame_cache_budget_splits_across_concurrent_layers() {
        use super::frame_cache_budget_bytes;
        use crate::monitor::scene::NativeFrameCacheMode;

        let one =
            frame_cache_budget_bytes(NativeFrameCacheMode::Balanced, 0, (1920, 1080), 30.0, 1);
        let three =
            frame_cache_budget_bytes(NativeFrameCacheMode::Balanced, 0, (1920, 1080), 30.0, 3);
        assert_eq!(
            three,
            one / 3,
            "budget must be split across concurrent layers"
        );
        // A zero count must not divide by zero.
        let zero =
            frame_cache_budget_bytes(NativeFrameCacheMode::Balanced, 0, (1920, 1080), 30.0, 0);
        assert_eq!(zero, one);
    }

    #[test]
    fn prewarm_lookahead_scales_with_transport_speed() {
        use super::{scaled_prewarm_lookahead_sec, VIDEO_PREWARM_LOOKAHEAD_SEC};

        assert_eq!(
            scaled_prewarm_lookahead_sec(1.0),
            VIDEO_PREWARM_LOOKAHEAD_SEC
        );
        assert_eq!(
            scaled_prewarm_lookahead_sec(4.0),
            VIDEO_PREWARM_LOOKAHEAD_SEC * 4.0
        );
        assert_eq!(
            scaled_prewarm_lookahead_sec(-2.0),
            VIDEO_PREWARM_LOOKAHEAD_SEC * 2.0
        );
        assert_eq!(
            scaled_prewarm_lookahead_sec(0.0),
            VIDEO_PREWARM_LOOKAHEAD_SEC
        );
    }

    #[test]
    fn layer_near_playhead_keeps_scaled_future_prewarm_window() {
        use super::{layer_near_playhead, VIDEO_PREWARM_LOOKAHEAD_SEC};

        let layer = video_layer_span("future", 5.8, 8.0);

        assert!(!layer_near_playhead(
            &layer,
            0.0,
            VIDEO_PREWARM_LOOKAHEAD_SEC
        ));
        assert!(layer_near_playhead(
            &layer,
            0.0,
            VIDEO_PREWARM_LOOKAHEAD_SEC * 4.0
        ));
    }

    fn video_layer_span(id: &str, start: f64, end: f64) -> SceneLayer {
        SceneLayer {
            timeline_start_sec: start,
            timeline_end_sec: end,
            ..test_video_layer_with_id(id)
        }
    }

    fn test_video_layer_with_id(id: &str) -> SceneLayer {
        SceneLayer {
            id: id.into(),
            ..test_video_layer(None)
        }
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
