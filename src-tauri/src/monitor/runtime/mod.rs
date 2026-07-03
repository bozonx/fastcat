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
use super::scene::build::{build_compositor_scene, rasterize_svg};
use super::scene::{LayerKind, MonitorScene, NativeFrameCacheMode, PreviewSyncMode, SceneLayer};
use crate::compositor::scene::Scene;
use crate::media::decode::gate::decoder_load_gate;
use crate::media::decode::thread::DecodePump;
use crate::media::image_decode::decode_image;

mod policy;

use policy::{
    active_layer_indices, allows_stale_video_fallback, approx_eq_opt_scale,
    frame_cache_budget_bytes, has_loaded_runtime, is_refreshable_display_runtime,
    layer_in_prewarm_window, layer_near_playhead, max_concurrent_video_layers_within,
    sanitize_transport_speed, scaled_prewarm_lookahead_sec, svg_target_long_edge,
    transition_from_ids, video_sync_lag_sec,
};

pub use policy::sanitize_preview_fps;

#[cfg(test)]
use policy::{
    BALANCED_VIDEO_SYNC_LAG_SEC, RUNTIME_KEEP_AHEAD_SEC, RUNTIME_KEEP_BEHIND_SEC,
    STRICT_VIDEO_SYNC_LAG_SEC, VIDEO_PREWARM_LOOKAHEAD_SEC,
};

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
            source_start_bits: normalized_f64_bits(layer.source_start_sec),
            source_range_duration_bits: normalized_f64_bits(layer.source_range_duration_sec),
            speed_bits: normalized_f64_bits(layer.speed),
            freeze_frame_source_bits: layer.freeze_frame_source_sec.map(normalized_f64_bits),
            source_orientation: layer.source_orientation.clone(),
        }
    }
}

/// Bit-pattern of `v` normalized so `-0.0` and `0.0` compare equal. `f64::to_bits`
/// distinguishes them, so without this a decode key comparison built from raw bits
/// would see `-0.0` (e.g. a `source_start_sec` produced by a `0.0 * -1.0` somewhere
/// upstream) and `0.0` as different sources and needlessly respawn the decoder.
/// IEEE 754 addition of `-0.0 + 0.0` always yields `+0.0` (round-to-nearest), which
/// is why this normalizes without a manual branch.
fn normalized_f64_bits(v: f64) -> u64 {
    (v + 0.0).to_bits()
}

// ---------------------------------------------------------------------------
// LayerRuntimeManager
// ---------------------------------------------------------------------------

pub struct LayerRuntimeManager {
    app: AppHandle,
    /// The scene "as the frontend ordered it". Arc — cheap clone for split-borrow.
    pub scene: Arc<Vec<SceneLayer>>,
    /// Composite frame size (may arrive as MonitorScene.width/height).
    pub scene_size: (u32, u32),
    pub preview_scale: Option<f32>,
    /// Target FPS of the preview monitor; set from MonitorScene.preview_fps.
    pub preview_fps: f64,
    /// AV-sync policy for the preview.
    pub preview_sync_mode: PreviewSyncMode,
    pub preview_effect_quality: crate::compositor::effects::EffectQuality,
    /// Global transport speed, SIGNED (negative = reverse). Magnitude keeps
    /// future-layer warmup measured in wall time: at 4x a 1.5s timeline window
    /// leaves only 375ms to open/decode the next clip. Sign decides which direction
    /// `tick`/`evict_distant_runtimes` prewarm/keep-alive — on reverse the "future"
    /// clip lies *earlier* on the timeline.
    playback_speed: f64,
    frame_cache_mode: NativeFrameCacheMode,
    frame_cache_custom_mb: u32,
    pub playing: bool,
    /// The last timeline-PTS from `tick`/`seek`. Needed so a lazily-opened runtime
    /// seeks to the current playhead rather than the clip start.
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
    hw_settings: crate::FfmpegHwSettings,
    /// Video master effects applied to the final composited frame.
    pub master_effects: Vec<crate::compositor::effects::EffectSpec>,
    pub video_tracks: Vec<crate::monitor::scene::SceneVideoTrack>,
}

impl LayerRuntimeManager {
    pub fn new(
        app: AppHandle,
        bg_tx: Sender<BgLayerResult>,
        proxy: EventLoopProxy<MonitorCommand>,
        hw_settings: crate::FfmpegHwSettings,
    ) -> Self {
        Self {
            app,
            scene: Arc::new(Vec::new()),
            scene_size: (0, 0),
            preview_scale: None,
            preview_fps: 30.0,
            preview_sync_mode: PreviewSyncMode::Balanced,
            preview_effect_quality: crate::compositor::effects::EffectQuality::default(),
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
            video_tracks: Vec::new(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.scene.is_empty()
    }

    /// Enables/disables emitting `VideoFrameReady` from the decoder threads. During
    /// active playback the event is not needed (frames are pulled on the pacing timer)
    /// and only wakes the event loop for nothing — disable it. While paused/warming/
    /// micro-priming it drives display and the start-readiness check — enable it.
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
        self.playback_speed = sanitize_transport_speed(speed);
    }

    /// True when the transport plays backward — the "future" clip that needs
    /// prewarming/keep-alive lies *earlier* on the timeline than the playhead.
    fn is_reverse(&self) -> bool {
        self.playback_speed < 0.0
    }

    pub fn update_hw_settings(&mut self, hw_settings: crate::FfmpegHwSettings) -> bool {
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

    /// End of the last scene layer (timeline seconds). 0.0 if the scene is empty.
    pub fn scene_end(&self) -> f64 {
        self.scene
            .iter()
            .map(|l| l.timeline_end_sec)
            .fold(0.0_f64, f64::max)
    }

    // -----------------------------------------------------------------------
    // Scene application
    // -----------------------------------------------------------------------

    /// Updates the scene, drops runtimes that left, and resets video on a scale change.
    /// Returns `true` if the window needs a redraw.
    pub fn apply_scene(&mut self, scene: MonitorScene) -> bool {
        // Sanitize: the frontend may send 0/NaN/negative, and `preview_fps` feeds
        // `Duration::from_secs_f64(1.0 / fps)` in the event loop, which panics on non-finite.
        self.preview_fps = sanitize_preview_fps(scene.preview_fps);
        self.preview_sync_mode = scene.preview_sync_mode;
        let cache_policy_changed = self.frame_cache_mode != scene.frame_cache_mode
            || self.frame_cache_custom_mb != scene.frame_cache_custom_mb;
        let new_ids: HashSet<String> = scene.layers.iter().map(|l| l.id.clone()).collect();

        // Decode-key by id in the NEW scene — to notice a file or source-mapping change
        // for the same layer. The id stays the same, but the old decoder/cache no longer
        // matches the frames that need to be shown after trim/speed/freeze edits.
        let new_decode_keys: HashMap<&str, VideoRuntimeKey> = scene
            .layers
            .iter()
            .filter(|l| has_loaded_runtime(l.kind))
            .map(|l| (l.id.as_str(), VideoRuntimeKey::from_layer(l)))
            .collect();
        // Old decode-keys by id (the current scene is not yet overwritten) for comparison.
        let old_decode_keys: HashMap<String, VideoRuntimeKey> = self
            .scene
            .iter()
            .filter(|l| has_loaded_runtime(l.kind))
            .map(|l| (l.id.clone(), VideoRuntimeKey::from_layer(l)))
            .collect();
        // Whether the decode-key changed for any layer surviving into the new scene.
        let any_decode_key_changed = old_decode_keys.iter().any(|(id, old)| {
            new_decode_keys
                .get(id.as_str())
                .is_some_and(|new| new != old)
        });

        let scale_changed = !approx_eq_opt_scale(self.preview_scale, scene.preview_scale);
        // Both a preview_scale change and a source/source-mapping change require bumping
        // the epoch: otherwise a background decode started under the old parameters could
        // arrive later and replace a fresh runtime with a stale source.
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
        self.preview_effect_quality = scene.preview_effect_quality;
        self.frame_cache_mode = scene.frame_cache_mode;
        self.frame_cache_custom_mb = scene.frame_cache_custom_mb;

        // Runtime diff: keep the live ones, drop the rest in the background.
        // DecodePump::drop blocks until ffmpeg finishes + join — do it on a separate thread.
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
            // The layer's source/source-mapping changed: the old decoder/cache holds
            // different frames, so it must be dropped for `ensure_runtime_for` to bring up
            // the current runtime.
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
            // The departing layers' GPU textures are released by dropping their frames
            // (Arc) inside the runtime itself — no separate desync with an external cache.
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
        self.video_tracks = scene.video_tracks;
        true
    }

    fn cancel_all_loading(&mut self) {
        for (_, cancel) in self.loading_cancels.drain() {
            cancel.store(true, Ordering::Relaxed);
        }
    }

    // -----------------------------------------------------------------------
    // Background loading
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
        let epoch = self.load_epoch;

        match layer.kind {
            LayerKind::Adjustment => unreachable!("adjustment layers do not need runtime loading"),
            LayerKind::Video => self.spawn_video_loader(id, path, cancel, epoch, device, queue),
            LayerKind::Image => self.spawn_image_loader(id, path, cancel, epoch),
            LayerKind::Svg => self.spawn_svg_loader(id, path, cancel, epoch),
            LayerKind::Text | LayerKind::Shape | LayerKind::Background => {}
        }
    }

    /// Acquire a Live decoder-load permit inside a loader thread, reporting
    /// `Dropped` and returning `None` if the load was cancelled or the scene epoch
    /// advanced while waiting. The caller keeps the returned permit alive for the
    /// whole decode.
    fn acquire_live_load_permit(
        cancel: &AtomicBool,
        epoch: u64,
        live_epoch: &AtomicU64,
        bg_tx: &Sender<BgLayerResult>,
        id: &str,
    ) -> Option<crate::media::decode::gate::SemaphorePermit<'static>> {
        let cancel_fn =
            || cancel.load(Ordering::Relaxed) || epoch != live_epoch.load(Ordering::Relaxed);
        match decoder_load_gate()
            .acquire_with_priority(crate::media::decode::gate::LoadPriority::Live, &cancel_fn)
        {
            Some(permit) => Some(permit),
            None => {
                let _ = bg_tx.send(BgLayerResult::Dropped { id: id.to_string() });
                None
            }
        }
    }

    /// Spawn the background loader for a video layer (decoder open + first-frame
    /// callback). On spawn failure the runtime is marked `Failed` for retry.
    fn spawn_video_loader(
        &mut self,
        id: String,
        path: PathBuf,
        cancel: Arc<AtomicBool>,
        epoch: u64,
        device: Option<wgpu::Device>,
        queue: Option<wgpu::Queue>,
    ) {
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
        let bg_tx = self.bg_tx.clone();
        let proxy = self.proxy.clone();
        let live_epoch = self.live_epoch.clone();
        let frame_event_gate = self.frame_event_gate.clone();
        let spawn_id = id.clone();
        if let Err(e) = std::thread::Builder::new()
            .name(format!("fastcat-load-video:{}", path.display()))
            .spawn(move || {
                let _permit = match Self::acquire_live_load_permit(
                    &cancel,
                    epoch,
                    &live_epoch,
                    &bg_tx,
                    &spawn_id,
                ) {
                    Some(permit) => permit,
                    None => return,
                };
                let proxy_cb = proxy.clone();
                let gate = frame_event_gate.clone();
                let on_frame = Box::new(move || {
                    // During active playback frames are pulled on a timer and the
                    // VideoFrameReady handler is a no-op: the event only wakes the
                    // event loop. Emit it only when actually needed (pause/warm-up).
                    if gate.load(Ordering::Relaxed) {
                        let _ = proxy_cb.send_event(MonitorCommand::VideoFrameReady);
                    }
                });
                let result =
                    match DecodePump::open(crate::media::decode::thread::DecodeOpenParams {
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

    /// Spawn the background loader for a raster image layer.
    fn spawn_image_loader(
        &mut self,
        id: String,
        path: PathBuf,
        cancel: Arc<AtomicBool>,
        epoch: u64,
    ) {
        let bg_tx = self.bg_tx.clone();
        let proxy = self.proxy.clone();
        let live_epoch = self.live_epoch.clone();
        let spawn_id = id.clone();
        if let Err(e) = std::thread::Builder::new()
            .name(format!("fastcat-load-img:{}", path.display()))
            .spawn(move || {
                let _permit = match Self::acquire_live_load_permit(
                    &cancel,
                    epoch,
                    &live_epoch,
                    &bg_tx,
                    &spawn_id,
                ) {
                    Some(permit) => permit,
                    None => return,
                };
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

    /// Spawn the background loader for an SVG layer (rasterized at preview size).
    fn spawn_svg_loader(&mut self, id: String, path: PathBuf, cancel: Arc<AtomicBool>, epoch: u64) {
        // Target rasterization resolution = the resolution the layer is shown at on
        // the monitor (scene long edge × preview_scale). This keeps the SVG sharp
        // when zoomed in without burning memory at a small preview size.
        let target_long_edge = svg_target_long_edge(self.scene_size, self.preview_scale);
        let bg_tx = self.bg_tx.clone();
        let proxy = self.proxy.clone();
        let live_epoch = self.live_epoch.clone();
        let spawn_id = id.clone();
        if let Err(e) = std::thread::Builder::new()
            .name(format!("fastcat-load-svg:{}", path.display()))
            .spawn(move || {
                let _permit = match Self::acquire_live_load_permit(
                    &cancel,
                    epoch,
                    &live_epoch,
                    &bg_tx,
                    &spawn_id,
                ) {
                    Some(permit) => permit,
                    None => return,
                };
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

    pub fn apply_bg_result(&mut self, result: BgLayerResult) {
        match result {
            BgLayerResult::VideoOk {
                epoch,
                id,
                pump,
                media_size,
                source_rotation,
            } => {
                if !self.claim_completed_load(epoch, &id) {
                    return;
                }
                if !self.scene.iter().any(|l| l.id == id) {
                    self.runtimes.remove(&id);
                    return;
                }
                self.apply_video_ok(id, pump, media_size, source_rotation);
            }
            BgLayerResult::VideoErr { epoch, id, error } => {
                if !self.claim_completed_load(epoch, &id) {
                    return;
                }
                log::error!("[monitor] open pump {id}: {error}");
                // Keep an already-opened video runtime (a late error must not clobber it).
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
                if !self.claim_completed_load(epoch, &id) {
                    return;
                }
                if !self.scene.iter().any(|l| l.id == id) {
                    self.runtimes.remove(&id);
                    return;
                }
                log::info!("[monitor] decoded image {id}: {}x{}", size.0, size.1);
                self.insert_raster_runtime(id, image, size, false);
            }
            BgLayerResult::ImageErr { epoch, id, error } => {
                if !self.claim_completed_load(epoch, &id) {
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
                if !self.claim_completed_load(epoch, &id) {
                    return;
                }
                if !self.scene.iter().any(|l| l.id == id) {
                    self.runtimes.remove(&id);
                    return;
                }
                log::info!("[monitor] decoded svg {id}: {}x{}", size.0, size.1);
                self.insert_raster_runtime(id, image, size, true);
            }
            BgLayerResult::SvgErr { epoch, id, error } => {
                if !self.claim_completed_load(epoch, &id) {
                    return;
                }
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

    /// Common prologue for a completed background load: drop results from a
    /// superseded scene epoch or a load that is no longer tracked, then clear the
    /// load bookkeeping. Returns `false` when the result should be ignored.
    fn claim_completed_load(&mut self, epoch: u64, id: &str) -> bool {
        if epoch != self.load_epoch {
            return false;
        }
        if !self.loading_set.remove(id) {
            return false;
        }
        self.loading_cancels.remove(id);
        true
    }

    /// Install a freshly-decoded raster (image or rasterized SVG) runtime.
    fn insert_raster_runtime(
        &mut self,
        id: String,
        image: vello::peniko::ImageData,
        size: (u32, u32),
        is_svg: bool,
    ) {
        self.runtimes.insert(
            id,
            LayerRuntime::Image(ImageLayerRt {
                image,
                size,
                is_svg,
            }),
        );
    }

    /// Install a freshly-opened video runtime: seek it to the current playhead,
    /// size its frame cache, and arm its initial warm-up. The caller has already
    /// verified the layer is still in the scene.
    fn apply_video_ok(
        &mut self,
        id: String,
        pump: DecodePump,
        media_size: (u32, u32),
        source_rotation: i32,
    ) {
        log::info!(
            "[monitor] opened video {id}: {}x{} @ {:.3}fps codec={}",
            pump.info.width,
            pump.info.height,
            pump.info.fps,
            pump.info.codec,
        );
        // Seek to the CURRENT playhead, not the clip start: otherwise opening a clip
        // in the middle of the timeline would have the decoder run forward from
        // source_start and the playhead would show black / a frozen frame until the
        // decode caught up to the position.
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
        let mut rt = VideoLayerRt::new(pump, media_size, source_rotation, cache_budget_bytes);
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
        // Warm the first GOP ahead of the playhead, but don't let a future runtime
        // free-run past the seam. A future clip that is about to play (deferred
        // during playback) is warmed deeper — otherwise on a decode-bound 4K source
        // it starts with ~2 frames and stutters at the seam.
        if defer_play_until_active {
            rt.request_warm_ahead();
        } else if !self.playing {
            rt.request_prebuffer();
        }
        self.runtimes.insert(id, LayerRuntime::Video(Box::new(rt)));
    }

    // -----------------------------------------------------------------------
    // Tick (called every frame)
    // -----------------------------------------------------------------------

    /// Starts background loading for active layers and pumps video frames.
    pub fn tick(&mut self, t: f64, device: Option<wgpu::Device>, queue: Option<wgpu::Queue>) {
        self.last_tick_t = t;
        let scene = self.scene.clone();
        // Active layers are kept as indices into `scene`, not String id clones — otherwise
        // every frame (30–60 fps) would allocate strings for all visible layers.
        let active = active_layer_indices(&scene, t);
        let reverse = self.is_reverse();
        for (i, layer) in scene.iter().enumerate() {
            if active.contains(&i) {
                self.ensure_runtime_for(layer, device.clone(), queue.clone());
            } else if layer_in_prewarm_window(layer, t, self.prewarm_lookahead_sec(), reverse) {
                // Proactively warm the decoder of a future layer (the clip the
                // playhead is about to reach, forward OR reverse).
                self.ensure_runtime_for(layer, device.clone(), queue.clone());
            }
        }

        let playing = self.playing;
        // First pump all video runtimes (including warming inactive ones) to read ready
        // frames from the background channel and fill the cache.
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
                // An active layer that no longer `covers(t)` is here only as the FROM
                // side of a transition (added above). Keep it advancing through its
                // handle material — the trailing handle for an outgoing clip (`in`
                // transition source) or the leading handle for the incoming next clip
                // (`out` transition source) — instead of freezing on the trimmed
                // edge, mirroring the web compositor.
                let clip_local = if layer.covers(t) {
                    layer.source_pts_at(t)
                } else {
                    layer.transition_peer_source_pts_at(t)
                };
                // Reverse clips need a backward-aware re-seek policy: the decoder
                // runs forward, so the (decreasing) target slips below the cache.
                let reversed = layer.speed < 0.0;
                if playing && rt.play_deferred_until_active() {
                    rt.activate_deferred_playback(clip_local);
                }
                let max_lag_sec = video_sync_lag_sec(self.preview_sync_mode, rt.pump.info.fps);

                // First try a frame within the sync window (balanced/strict). Smooth has
                // no finite window and always shows the freshest available frame <= target.
                let shown_in_window = rt.update_display(clip_local, max_lag_sec, None);
                let shown_any = shown_in_window
                    || (allows_stale_video_fallback(self.preview_sync_mode)
                        && rt.update_display(clip_local, None, None));

                if playing {
                    if !shown_any {
                        // Don't blank the layer instantly — keep a freeze frame (last known
                        // good frame) so a warm-up timeout or a brief decoder lag doesn't
                        // turn into a black flash. Only if there was never a frame
                        // (current == None) is the layer genuinely black.
                        if rt.current.is_none() {
                            rt.clear_display();
                        }
                        if reversed {
                            // No frame ≤ a reversed target: re-seek backward (see
                            // `maybe_reseek_for_reverse`) instead of the symmetric
                            // miss/lag logic, which never fires on reverse.
                            rt.note_synced();
                            rt.maybe_reseek_for_reverse(clip_local);
                        } else if self.preview_sync_mode == PreviewSyncMode::Strict {
                            // Strict has no smooth fallback: a stale frame outside the sync
                            // window does not count as a valid preview frame. Force the
                            // decoder toward target, and until a correct frame arrives the
                            // layer does not show a stale picture.
                            rt.note_lagged();
                            if let Some(max_lag_sec) = max_lag_sec {
                                rt.maybe_reseek_on_sync_lag(clip_local, max_lag_sec);
                            }
                        } else {
                            // No frame ≤ target at all (reverse / before the clip start): reposition.
                            rt.note_synced();
                            rt.maybe_reseek_on_miss(clip_local);
                        }
                    } else if !shown_in_window {
                        // Fell behind the sync window. A reseek drops the backlog for the
                        // sake of sync — useful only if the decoder decodes GOP→target
                        // faster than realtime. On a decode-bound source (4K) it only
                        // flushes the buffer and re-decodes → freezes (the "1–2s freeze at
                        // start"). So reseek ONLY if the decoder is not moving forward
                        // (genuinely stuck / in the wrong place). If it decodes forward but
                        // slower than realtime — fall back to smooth-lag immediately,
                        // without waiting for the decode-bound threshold.
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

        // Evict runtimes of clips that drifted far from the playhead: free their
        // ffmpeg decoders, frame caches and GPU textures without waiting for a scene change.
        self.evict_distant_runtimes(t, &scene, &active);
    }

    /// Drops runtimes (video/image/svg/loading) whose layer is not in the active set and
    /// whose timeline interval doesn't intersect the keep window around the playhead.
    /// Otherwise, during long playback the runtime of every passed clip would live until
    /// the next `apply_scene` — decoder threads and decoded frames would pile up.
    fn evict_distant_runtimes(&mut self, t: f64, scene: &[SceneLayer], active: &HashSet<usize>) {
        if self.runtimes.is_empty() {
            return;
        }
        // Ids of layers we keep: active ones (covers t / warming / transition-from)
        // OR close to the playhead within the keep window.
        let reverse = self.is_reverse();
        let mut keep: HashSet<&str> = HashSet::new();
        for (i, layer) in scene.iter().enumerate() {
            if active.contains(&i)
                || layer_near_playhead(layer, t, self.prewarm_lookahead_sec(), reverse)
            {
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
        // The departing layers' GPU textures are released by dropping their frames (Arc)
        // inside the runtime. `DecodePump::drop` blocks until the ffmpeg thread joins — do
        // it on a separate thread so the monitor event loop isn't stalled.
        if let Err(e) = std::thread::Builder::new()
            .name("fastcat-rt-evict-drop".into())
            .spawn(move || drop(to_drop))
        {
            log::error!("[monitor] failed to spawn evict drop thread: {e:?}");
        }
    }

    /// Seek active video layers to `t`. While paused, on a cache hit it shows the frame
    /// without respawning ffmpeg (cheap scrub); otherwise it repositions the decoder.
    pub fn seek(&mut self, t: f64, playing: bool) {
        self.last_tick_t = t;
        let scene = self.scene.clone();
        // Ids of layers acting as the FROM side of an active transition at `t`. They
        // do not `covers(t)` but must still be repositioned into their tail material,
        // otherwise scrubbing into a transition leaves the outgoing clip on a stale
        // frame (it is composited by `build_compositor_scene`).
        let from_ids = transition_from_ids(&scene, t);
        for layer in scene.iter() {
            let is_covering = layer.covers(t);
            let is_from = !is_covering && from_ids.contains(&layer.id);
            if (!is_covering && !is_from) || layer.kind != LayerKind::Video {
                continue;
            }
            let clip_local = if is_covering {
                layer.source_pts_at(t)
            } else {
                layer.transition_peer_source_pts_at(t)
            };
            if let Some(LayerRuntime::Video(rt)) = self.runtimes.get_mut(&layer.id) {
                rt.pull_into_cache();
                // Paused + cache hit → show the frame without a blocking wait on decode
                // (instant scrub from cache).
                if !playing && rt.has_cached_near(clip_local, 1) {
                    let lead = Some(1.0 / rt.pump.info.effective_fps());
                    rt.update_display(clip_local, None, lead);
                    // Still warm ahead of the playhead for the subsequent Play. But the
                    // decoder may sit elsewhere (after a previous playback/scrub): warming
                    // WITHOUT repositioning would decode frames from the wrong position —
                    // the forward buffer around the playhead would stay empty and the cache
                    // would fill with irrelevant frames. So first reposition the decoder to
                    // the playhead (asynchronously; the frame is already shown from cache,
                    // so the scrub stays instant), then warm.
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
                // While paused, warm the first GOP ahead of the playhead immediately so a
                // subsequent Play doesn't freeze decoding 4K from a keyframe. During
                // playback the decoder streams forward anyway — no separate warm-up needed.
                if !playing {
                    rt.request_prebuffer();
                }
                let lead = if playing {
                    None
                } else {
                    Some(1.0 / rt.pump.info.effective_fps())
                };
                let shown = rt.update_display(
                    clip_local,
                    if playing {
                        video_sync_lag_sec(self.preview_sync_mode, rt.pump.info.fps)
                    } else {
                        None
                    },
                    lead,
                );
                // Paused scrub miss (no frame ≤ target in cache — typically a backward
                // scrub past the current GOP): jump to the nearest cached frame as a
                // stopgap so the picture doesn't hold the far-away previous frame until
                // the repositioned decoder lands the correct one via refresh_display.
                if !playing && !shown {
                    rt.show_nearest_cached(clip_local);
                }
            }
        }
    }

    /// Whether there is an active video layer at `t` — i.e. whether decoders need
    /// warming before playback starts (audio/images need no warm-up).
    pub fn has_active_video(&self, t: f64) -> bool {
        self.scene
            .iter()
            .any(|l| l.kind == LayerKind::Video && l.covers(t))
    }

    /// Whether all active video layers have decoded frames to a depth of
    /// `expected_preroll_duration()` seconds ahead of the playhead (accounting for each
    /// layer's memory limits) — meaning playback can start without a GOP-decode freeze.
    ///
    /// Two key improvements over the previous version:
    ///
    /// 1. **Dynamic threshold** — each layer's readiness threshold is computed from
    ///    `expected_preroll_duration()`, which reflects the real amount of requested
    ///    warm-up given the memory limit. For 4K video with a 2-frame budget the
    ///    threshold becomes ~2/fps instead of a static 0.12s, so the check passes right
    ///    after those two frames decode rather than hanging on a timeout.
    ///
    /// 2. **EOF protection** — if the playhead is closer than `lookahead` to the end of
    ///    the video, target is clamped to `duration_sec - half_frame`. This guarantees
    ///    the check passes immediately near the clip end without waiting for a timeout.
    ///
    /// A layer in the `Loading`/`Failed` state counts as "not ready yet" (resolved by
    /// the warm-up timeout in the calling code).
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
                    let fps = rt.pump.info.effective_fps();
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

    /// While paused: GUARANTEES creating runtimes for active raster layers
    /// (video/image/svg), pulls freshly-decoded video frames into the cache, and shows
    /// the frame at the playhead.
    ///
    /// Previously `ensure_runtime_for` was called ONLY from `tick` (and tick runs only
    /// during playback), so while paused decoders were never created: the monitor was
    /// black on project load, and the first Play started into nothing (the decoder only
    /// then spawned and chased the already-departed playhead) — only a second Play played
    /// normally. Now the runtime spawns while paused too: video positions to the playhead
    /// in `apply_bg_result` (+ preroll), and image/svg finish loading by the next
    /// `BgReady`. `device`/`queue` are needed for GPU upload of the frame inside the
    /// decoder thread (as in `tick`).
    pub fn refresh_display(
        &mut self,
        t: f64,
        device: Option<wgpu::Device>,
        queue: Option<wgpu::Queue>,
    ) {
        self.last_tick_t = t;
        let scene = self.scene.clone();
        // Outgoing (FROM) clips of transitions active at `t`: they no longer cover the
        // playhead but are still composited, so on a paused frame they must be created
        // and shown at their tail position — otherwise scrubbing into a transition
        // shows the outgoing side missing or stale.
        let from_ids = transition_from_ids(&scene, t);
        let reverse = self.is_reverse();
        for layer in scene.iter() {
            let is_covering = layer.covers(t);
            let is_from = !is_covering && from_ids.contains(&layer.id);
            if !is_covering && !is_from {
                // Warm the decoder of the nearest future video clip while paused too, not
                // only in `tick` (which runs only during playback). Otherwise a Play
                // pressed while the playhead sits/scrubs near a seam found the next clip
                // unopened — it started "cold" and stuttered. While paused there is no
                // active decode, so this creates no contention for CPU/permits.
                if layer.kind == LayerKind::Video
                    && layer_in_prewarm_window(layer, t, self.prewarm_lookahead_sec(), reverse)
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
            let clip_local = if is_covering {
                layer.source_pts_at(t)
            } else {
                layer.transition_peer_source_pts_at(t)
            };
            if let Some(LayerRuntime::Video(rt)) = self.runtimes.get_mut(&layer.id) {
                rt.pull_into_cache();
                // The from-layer's decoder may still sit at its trimmed out-point (its
                // initial seek used the clamped pts); reposition into the tail so the
                // paused frame matches the transition progress.
                if is_from {
                    let need_seek = match rt.last_pump_seek_pts {
                        Some(last_pts) => (last_pts - clip_local).abs() > 1e-5,
                        None => true,
                    };
                    if need_seek {
                        if let Err(e) = rt.pump.seek(clip_local) {
                            log::error!(
                                "[monitor] transition-from refresh seek {}: {e:?}",
                                layer.id
                            );
                        }
                        rt.last_pump_seek_pts = Some(clip_local);
                        rt.note_seek_requested();
                    }
                    rt.request_prebuffer();
                }
                let lead = Some(1.0 / rt.pump.info.effective_fps());
                rt.update_display(clip_local, None, lead);
            }
        }
    }

    /// Repositions the decoders of active video layers to `t`. Called at playback start
    /// so the forward stream is correct after a cache scrub.
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
    // Compositor scene assembly
    // -----------------------------------------------------------------------

    /// Builds a domain-scene snapshot at time `t` to hand to the `Compositor`.
    pub fn build_compositor_scene(&self, t: f64) -> Scene {
        build_compositor_scene(
            &self.scene,
            self.scene_size,
            &self.runtimes,
            t,
            &self.video_tracks,
            &self.master_effects,
            self.preview_effect_quality,
        )
    }

    fn prewarm_lookahead_sec(&self) -> f64 {
        scaled_prewarm_lookahead_sec(self.playback_speed)
    }
}

#[cfg(test)]
mod tests {
    use super::allows_stale_video_fallback;
    use super::approx_eq_opt_scale;
    use super::sanitize_preview_fps;
    use super::svg_target_long_edge;
    use super::video_sync_lag_sec;
    use super::VideoRuntimeKey;
    use super::{BALANCED_VIDEO_SYNC_LAG_SEC, STRICT_VIDEO_SYNC_LAG_SEC};
    use crate::monitor::scene::build::layer_with_auto_source_rotation;
    use crate::monitor::scene::{LayerKind, PreviewSyncMode, SceneLayer};

    #[test]
    fn layer_near_playhead_keeps_window_around_t() {
        use super::layer_near_playhead;
        use super::{RUNTIME_KEEP_AHEAD_SEC, RUNTIME_KEEP_BEHIND_SEC, VIDEO_PREWARM_LOOKAHEAD_SEC};

        let l = video_layer_span("a", 10.0, 12.0);
        // Inside the clip.
        assert!(layer_near_playhead(
            &l,
            11.0,
            VIDEO_PREWARM_LOOKAHEAD_SEC,
            false
        ));
        // Just past the end, within the behind grace → still kept.
        assert!(layer_near_playhead(
            &l,
            12.0 + RUNTIME_KEEP_BEHIND_SEC - 0.1,
            VIDEO_PREWARM_LOOKAHEAD_SEC,
            false
        ));
        // Far past the end → evicted.
        assert!(!layer_near_playhead(
            &l,
            12.0 + RUNTIME_KEEP_BEHIND_SEC + 0.1,
            VIDEO_PREWARM_LOOKAHEAD_SEC,
            false
        ));
        // Just before the start, within the ahead (prewarm) window → kept.
        assert!(layer_near_playhead(
            &l,
            10.0 - RUNTIME_KEEP_AHEAD_SEC + 0.1,
            VIDEO_PREWARM_LOOKAHEAD_SEC,
            false
        ));
        // Far before the start → not yet kept.
        assert!(!layer_near_playhead(
            &l,
            10.0 - RUNTIME_KEEP_AHEAD_SEC - 0.1,
            VIDEO_PREWARM_LOOKAHEAD_SEC,
            false
        ));
        // (`RUNTIME_KEEP_AHEAD_SEC >= VIDEO_PREWARM_LOOKAHEAD_SEC` is now enforced at
        // compile time next to the constants in `policy.rs`.)
    }

    // Reverse mirrors the forward case: the generous (prewarm-sized) margin swaps to
    // the FRONT of the clip (the side the playhead is backing toward), and the small
    // fixed grace swaps to the tail — the opposite of forward playback.
    #[test]
    fn layer_near_playhead_reverse_swaps_margins() {
        use super::layer_near_playhead;
        use super::{RUNTIME_KEEP_AHEAD_SEC, RUNTIME_KEEP_BEHIND_SEC, VIDEO_PREWARM_LOOKAHEAD_SEC};

        let l = video_layer_span("a", 10.0, 12.0);
        // Inside the clip.
        assert!(layer_near_playhead(
            &l,
            11.0,
            VIDEO_PREWARM_LOOKAHEAD_SEC,
            true
        ));
        // Just past the start (backing toward it), within the small grace → kept.
        assert!(layer_near_playhead(
            &l,
            10.0 - RUNTIME_KEEP_BEHIND_SEC + 0.1,
            VIDEO_PREWARM_LOOKAHEAD_SEC,
            true
        ));
        // Far before the start → evicted.
        assert!(!layer_near_playhead(
            &l,
            10.0 - RUNTIME_KEEP_BEHIND_SEC - 0.1,
            VIDEO_PREWARM_LOOKAHEAD_SEC,
            true
        ));
        // Just past the end, within the generous margin (the clip is ahead of the
        // reverse-playing playhead) → kept.
        assert!(layer_near_playhead(
            &l,
            12.0 + RUNTIME_KEEP_AHEAD_SEC - 0.1,
            VIDEO_PREWARM_LOOKAHEAD_SEC,
            true
        ));
        // Far past the end → not yet kept.
        assert!(!layer_near_playhead(
            &l,
            12.0 + RUNTIME_KEEP_AHEAD_SEC + 0.1,
            VIDEO_PREWARM_LOOKAHEAD_SEC,
            true
        ));
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
        // Valid values pass through as-is.
        assert_eq!(sanitize_preview_fps(30.0), 30.0);
        assert_eq!(sanitize_preview_fps(60.0), 60.0);
        // 0/negative/NaN/inf → default 30 (otherwise a panic in Duration::from_secs_f64).
        assert_eq!(sanitize_preview_fps(0.0), 30.0);
        assert_eq!(sanitize_preview_fps(-5.0), 30.0);
        assert_eq!(sanitize_preview_fps(f64::NAN), 30.0);
        assert_eq!(sanitize_preview_fps(f64::INFINITY), 30.0);
        // Clamp from above.
        assert_eq!(sanitize_preview_fps(100000.0), 240.0);
    }

    #[test]
    fn svg_target_tracks_scene_and_scale() {
        assert_eq!(svg_target_long_edge((1920, 1080), None), 1920);
        assert_eq!(svg_target_long_edge((1920, 1080), Some(0.5)), 960);
        assert_eq!(svg_target_long_edge((1080, 1920), Some(1.0)), 1920);
        // Unknown scene size → default 1920.
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
            VIDEO_PREWARM_LOOKAHEAD_SEC,
            false
        ));
        assert!(layer_near_playhead(
            &layer,
            0.0,
            VIDEO_PREWARM_LOOKAHEAD_SEC * 4.0,
            false
        ));
    }

    #[test]
    fn active_layer_indices_include_transition_source_once() {
        use super::active_layer_indices;
        use crate::monitor::scene::SceneTransition;

        let outgoing = video_layer_span("outgoing", 0.0, 5.0);
        let mut incoming = video_layer_span("incoming", 5.0, 10.0);
        incoming.transition_in = Some(SceneTransition {
            transition_type: "dissolve".into(),
            duration_sec: 1.0,
            curve: None,
            from_layer_id: Some(outgoing.id.clone()),
            mode: None,
            spec: None,
        });

        let active = active_layer_indices(&[outgoing, incoming], 5.5);

        assert_eq!(active.len(), 2);
        assert!(active.contains(&0));
        assert!(active.contains(&1));
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
            source_duration_sec: None,
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
            snap_to_pixel_grid: false,
            transform: None,
            transition_in: None,
            transition_out: None,
            effects: Vec::new(),
        }
    }

    // Regression: `-0.0` and `0.0` must decode-key equal, otherwise a layer whose
    // `source_start_sec`/`speed`/etc. round-trips through `-0.0` (e.g. `0.0 * -1.0`
    // somewhere upstream) would look "changed" every `apply_scene` and needlessly
    // drop + reopen its decoder.
    #[test]
    fn video_runtime_key_treats_negative_zero_as_zero() {
        let base = SceneLayer {
            source_start_sec: 0.0,
            source_range_duration_sec: 0.0,
            freeze_frame_source_sec: Some(0.0),
            ..test_video_layer(None)
        };
        let neg_zero = SceneLayer {
            source_start_sec: -0.0,
            source_range_duration_sec: -0.0,
            freeze_frame_source_sec: Some(-0.0),
            ..test_video_layer(None)
        };
        assert_eq!(
            VideoRuntimeKey::from_layer(&base),
            VideoRuntimeKey::from_layer(&neg_zero),
        );
    }
}
