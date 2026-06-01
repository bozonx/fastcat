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

use tauri::{AppHandle, Emitter};
use vello::peniko::{Blob, Color, ImageData, ImageAlphaType, ImageFormat};
use winit::event_loop::EventLoopProxy;

use crate::compositor::scene::{
    LayerKind as CompLayerKind, RasterSource, Scene,
};
use crate::media::decode::VideoFrame;
use crate::media::decode_gate::decoder_load_gate;
use crate::media::decode_thread::DecodePump;
use crate::media::image_decode::decode_image;

use super::frame_cache::{DecodedVideoFrame, VideoFrameCache};
use super::handle::MonitorCommand;
use super::scene::{LayerKind, MonitorScene, SceneLayer};
use super::scene_build::{build_virtual_kind, finalize_layer, rasterize_svg};

const EVT_LAYER_FAILED: &str = "monitor:layer_failed";

// ---------------------------------------------------------------------------
// Результаты фоновой загрузки
// ---------------------------------------------------------------------------

pub enum BgLayerResult {
    VideoOk {
        id: String,
        pump: DecodePump,
        media_size: (u32, u32),
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
    /// Текущий отображаемый кадр (последний с PTS ≤ target из кеша).
    pub current: Option<DecodedVideoFrame>,
    /// Кеш декодированных кадров для дешёвого скраба назад без респауна ffmpeg.
    cache: VideoFrameCache,
}

impl VideoLayerRt {
    fn new(pump: DecodePump, media_size: (u32, u32)) -> Self {
        let fps = pump.info.fps;
        let frame_bytes = (media_size.0 as usize)
            .saturating_mul(media_size.1 as usize)
            .saturating_mul(4);
        Self {
            cache: VideoFrameCache::new(fps, frame_bytes),
            pump,
            media_size,
            current: None,
        }
    }

    /// Сливает все доступные кадры из декодера в кеш (неблокирующе).
    fn pull_into_cache(&mut self) {
        let live_gen = self.pump.current_generation();
        while let Some(msg) = self.pump.try_recv_frame() {
            if msg.generation != live_gen {
                continue;
            }
            self.cache.insert(video_frame_to_image(msg.frame));
        }
    }

    /// Выбирает отображаемый кадр: ближайший с PTS ≤ target из кеша (если есть).
    fn update_display(&mut self, target_clip_local: f64) {
        if let Some(frame) = self.cache.frame_le(target_clip_local) {
            self.current = Some(frame);
        }
    }
}

pub struct ImageLayerRt {
    pub image: ImageData,
    pub size: (u32, u32),
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
    runtimes: HashMap<String, LayerRuntime>,
    loading_set: HashSet<String>,
    bg_tx: Sender<BgLayerResult>,
    proxy: EventLoopProxy<MonitorCommand>,
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
            runtimes: HashMap::new(),
            loading_set: HashSet::new(),
            bg_tx,
            proxy,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.scene.is_empty()
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
        self.preview_fps = scene.preview_fps;
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
            let drop_for_scale =
                scale_changed && matches!(rt, LayerRuntime::Video(_) | LayerRuntime::Loading);
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

    fn ensure_runtime_for(&mut self, layer: &SceneLayer) {
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
                        let result = match DecodePump::open(&path, max_long_edge) {
                            Ok(pump) => {
                                let media_size = (pump.info.width, pump.info.height);
                                BgLayerResult::VideoOk {
                                    id,
                                    pump,
                                    media_size,
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
                let clip_local = self
                    .scene
                    .iter()
                    .find(|l| l.id == id)
                    .map(|l| l.source_pts_at(0.0))
                    .unwrap_or(0.0);
                let rt = VideoLayerRt::new(pump, media_size);
                if clip_local > 0.0 {
                    if let Err(e) = rt.pump.seek(clip_local) {
                        log::error!("[monitor] initial seek {id}: {e:?}");
                    }
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
                self.runtimes
                    .insert(id, LayerRuntime::Image(ImageLayerRt { image, size }));
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
                self.runtimes
                    .insert(id, LayerRuntime::Image(ImageLayerRt { image, size }));
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
    pub fn tick(&mut self, t: f64) {
        let scene = self.scene.clone();
        for layer in scene.iter() {
            if layer.covers(t) {
                self.ensure_runtime_for(layer);
            }
        }
        for layer in scene.iter() {
            if !layer.covers(t) || layer.kind != LayerKind::Video {
                continue;
            }
            if let Some(LayerRuntime::Video(rt)) = self.runtimes.get_mut(&layer.id) {
                rt.pull_into_cache();
                rt.update_display(layer.source_pts_at(t));
            }
        }
    }

    /// Seek активных видеослоёв на `t`. На паузе при попадании в кеш показывает кадр без
    /// респауна ffmpeg (дешёвый скраб); иначе перепозиционирует декодер.
    pub fn seek(&mut self, t: f64, playing: bool) {
        let scene = self.scene.clone();
        for layer in scene.iter() {
            if !layer.covers(t) || layer.kind != LayerKind::Video {
                continue;
            }
            let clip_local = layer.source_pts_at(t);
            if let Some(LayerRuntime::Video(rt)) = self.runtimes.get_mut(&layer.id) {
                rt.pull_into_cache();
                // Пауза + попадание в кеш → показываем кадр без перезапуска ffmpeg.
                if !playing && rt.cache.has_near(clip_local, 1) {
                    rt.update_display(clip_local);
                    continue;
                }
                if let Err(e) = rt.pump.seek(clip_local) {
                    log::error!("[monitor] seek pump {}: {e:?}", layer.id);
                }
                rt.update_display(clip_local);
            }
        }
    }

    /// Перепозиционирует декодеры активных видеослоёв к `t`. Вызывается при старте
    /// воспроизведения, чтобы после скраба по кешу forward-стрим был корректным.
    pub fn resync_active_videos(&mut self, t: f64) {
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

        let mut indices: Vec<usize> = (0..self.scene.len())
            .filter(|&i| self.scene[i].covers(t))
            .collect();
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
                                source: RasterSource::Image(f.image.clone()),
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

            layers.push(finalize_layer(sl, layer_kind, (scene_w, scene_h)));
        }

        Scene {
            width: scene_w,
            height: scene_h,
            time: t,
            background: Color::BLACK,
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

fn video_frame_to_image(frame: VideoFrame) -> DecodedVideoFrame {
    let VideoFrame {
        width,
        height,
        pixels,
        pts_sec,
    } = frame;
    let blob = Blob::new(Arc::new(pixels));
    DecodedVideoFrame {
        pts_sec,
        image: ImageData {
            data: blob,
            format: ImageFormat::Rgba8,
            alpha_type: ImageAlphaType::Alpha,
            width,
            height,
        },
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
    use super::svg_target_long_edge;
    use super::approx_eq_opt_scale;

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
    fn svg_target_tracks_scene_and_scale() {
        assert_eq!(svg_target_long_edge((1920, 1080), None), 1920);
        assert_eq!(svg_target_long_edge((1920, 1080), Some(0.5)), 960);
        assert_eq!(svg_target_long_edge((1080, 1920), Some(1.0)), 1920);
        // Неизвестный размер сцены → дефолт 1920.
        assert_eq!(svg_target_long_edge((0, 0), Some(1.0)), 1920);
    }
}
