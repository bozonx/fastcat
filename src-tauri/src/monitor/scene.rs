//! Описание мульти-слойной сцены, которую играет нативный монитор.
//!
//! Фронт шлёт «снимок» всех клипов на таймлайне (video + image) разом — монитор сам
//! решает, какие слои сейчас «активны» по timeline-PTS, лениво открывает декодеры
//! и композитит результат через Vello.
//!
//! Граница: этот модуль — IPC-DTO (сериализуемые данные от фронта).
//! Рендер-снимок в момент `t` живёт в [`crate::compositor::scene::Scene`].

use serde::Deserialize;
use serde_json::Value;
use ts_rs::TS;

use crate::compositor::effects::EffectSpec;
use crate::compositor::transitions::TransitionSpec;

// ts-rs generates the TypeScript mirror of these IPC DTOs into
// `src/types/generated/native-monitor/` (see `export_to` below). The frontend
// scene builder imports them so the contract has a single source of truth.

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
#[ts(
    export,
    export_to = "../../src/types/generated/native-monitor/",
    rename_all = "lowercase"
)]
pub enum LayerKind {
    Video,
    Image,
    Svg,
    Text,
    Shape,
    Background,
}

/// 2D-трансформ слоя в координатах сцены (пиксели scene-space).
///
/// Семантика `anchor`: точка привязки внутри натуральной bbox слоя в долях [0..1].
/// Она «прикрепляется» к позиции `(x, y)` после rotate+scale.
///
/// Если `transform` не задан в JSON (None), слой вписывается в сцену методом
/// letterbox/center-fit через `Transform::center_fit` (поведение по умолчанию).
#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/native-monitor/")]
pub struct SceneLayerTransform {
    /// Позиция anchor-точки в scene-space (пиксели; (0,0) = left-top сцены).
    pub x: f64,
    pub y: f64,
    #[serde(default = "one")]
    pub scale_x: f64,
    #[serde(default = "one")]
    pub scale_y: f64,
    #[serde(default)]
    pub rotation_deg: f64,
    /// Горизонтальная anchor-точка в долях натуральной ширины слоя. 0.5 = центр.
    #[serde(default = "half")]
    pub anchor_x: f64,
    /// Вертикальная anchor-точка в долях натуральной высоты слоя. 0.5 = центр.
    #[serde(default = "half")]
    pub anchor_y: f64,
    #[serde(default)]
    pub crop_top: f64,
    #[serde(default)]
    pub crop_bottom: f64,
    #[serde(default)]
    pub crop_left: f64,
    #[serde(default)]
    pub crop_right: f64,
}

fn one() -> f64 {
    1.0
}
fn half() -> f64 {
    0.5
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/native-monitor/")]
pub struct SceneLayer {
    /// Стабильный идентификатор клипа — ключ для diff'а scene и кеша рантаймов.
    pub id: String,
    pub kind: LayerKind,
    /// Абсолютный путь к файлу-источнику. Нужен только для video/image/svg.
    #[serde(default)]
    pub path: String,
    /// `[timeline_start_sec; timeline_end_sec)` — окно видимости на таймлайне.
    pub timeline_start_sec: f64,
    pub timeline_end_sec: f64,
    /// PTS внутри исходника в момент `timeline_start_sec`.
    pub source_start_sec: f64,
    /// Длина доступного source-range в исходнике. Нужна для speed/reverse clamp.
    #[serde(default)]
    pub source_range_duration_sec: f64,
    /// Скорость воспроизведения video source. Отрицательные значения — reverse.
    #[serde(default = "one")]
    pub speed: f64,
    /// Стоп-кадр: абсолютный PTS внутри исходника.
    #[serde(default)]
    #[ts(optional)]
    pub freeze_frame_source_sec: Option<f64>,
    /// Явная ориентация источника (`auto`, `0`, `90`, `180`, `270`).
    #[serde(default)]
    #[ts(optional)]
    pub source_orientation: Option<String>,
    /// Чем выше — тем поверх. Сортируем по возрастанию.
    pub z: i32,
    /// `[0; 1]`, домножается на альфа-канал слоя.
    pub opacity: f64,
    /// Blend mode из таймлайна. Поддерживаем текущий frontend-набор.
    #[serde(default = "default_blend")]
    pub blend_mode: String,
    #[serde(default)]
    #[ts(optional)]
    pub background_color: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub text: Option<String>,
    // Open-ended text style bag — mapped to the existing frontend type.
    #[serde(default)]
    #[ts(optional, type = "import('~/timeline/types').TextClipStyle")]
    pub style: Option<Value>,
    #[serde(default)]
    #[ts(optional)]
    pub shape_type: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub fill_color: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub stroke_color: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub stroke_width: Option<f64>,
    #[serde(default)]
    #[ts(optional, type = "import('~/timeline/types').ShapeConfig")]
    pub shape_config: Option<Value>,
    /// Явный трансформ слоя в scene-space.
    /// `None` → letterbox center-fit (поведение по умолчанию, совместимость с предыдущими версиями).
    #[serde(default)]
    #[ts(optional)]
    pub transform: Option<SceneLayerTransform>,
    #[serde(default)]
    #[ts(optional)]
    pub transition_in: Option<SceneTransition>,
    #[serde(default)]
    #[ts(optional)]
    pub transition_out: Option<SceneTransition>,
    // Video effect specs — produced by the frontend effect manifests.
    #[serde(default)]
    #[ts(type = "import('~/effects').TauriEffectSpec[]")]
    pub effects: Vec<EffectSpec>,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/native-monitor/")]
pub struct SceneTransition {
    #[serde(rename = "type")]
    pub transition_type: String,
    pub duration_sec: f64,
    #[ts(optional)]
    pub curve: Option<String>,
    #[ts(optional)]
    pub from_layer_id: Option<String>,
    // Transition spec — produced by the frontend transition manifests.
    #[ts(
        optional,
        type = "import('~/transitions/core/registry').TauriTransitionSpec"
    )]
    pub spec: Option<TransitionSpec>,
}

#[derive(Debug, Clone, Copy, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(
    export,
    export_to = "../../src/types/generated/native-monitor/",
    rename_all = "lowercase"
)]
#[derive(Default)]
pub enum AudioFadeCurve {
    #[default]
    Linear,
    Logarithmic,
}


#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
#[ts(
    export,
    export_to = "../../src/types/generated/native-monitor/",
    rename_all = "lowercase"
)]
#[derive(Default)]
pub enum PreviewSyncMode {
    Smooth,
    #[default]
    Balanced,
    Strict,
}


#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/native-monitor/")]
pub struct SceneAudioLayer {
    pub id: String,
    #[serde(default)]
    #[ts(optional)]
    pub track_id: Option<String>,
    pub path: String,
    pub timeline_start_sec: f64,
    pub timeline_end_sec: f64,
    pub source_start_sec: f64,
    /// Длина доступного source-range в исходнике. Нужна для speed/reverse clamp.
    #[serde(default)]
    pub source_range_duration_sec: f64,
    #[serde(default = "one")]
    pub speed: f64,
    #[serde(default = "one")]
    pub audio_gain: f64,
    #[serde(default)]
    pub audio_balance: f64,
    #[serde(default)]
    pub audio_fade_in_sec: f64,
    #[serde(default)]
    pub audio_fade_out_sec: f64,
    #[serde(default)]
    pub audio_fade_in_curve: AudioFadeCurve,
    #[serde(default)]
    pub audio_fade_out_curve: AudioFadeCurve,
}

impl SceneAudioLayer {
    pub fn source_pts_at(&self, timeline_sec: f64) -> f64 {
        compute_source_pts_at(
            timeline_sec,
            self.timeline_start_sec,
            self.timeline_end_sec,
            self.source_start_sec,
            self.source_range_duration_sec,
            self.speed,
            None,
        )
    }
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/native-monitor/")]
pub struct SceneAudioTrack {
    pub id: String,
    #[serde(default = "one")]
    pub audio_gain: f64,
    #[serde(default)]
    pub audio_balance: f64,
    #[serde(default)]
    pub audio_muted: bool,
    #[serde(default)]
    pub audio_solo: bool,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../src/types/generated/native-monitor/")]
pub struct MonitorScene {
    pub layers: Vec<SceneLayer>,
    #[serde(default)]
    pub audio_layers: Vec<SceneAudioLayer>,
    #[serde(default)]
    pub audio_tracks: Vec<SceneAudioTrack>,
    /// Master audio bus gain. Effects/track buses подключатся поверх этой модели позже.
    #[serde(default = "one")]
    pub audio_master_gain: f64,
    #[serde(default)]
    pub audio_master_muted: bool,
    /// Размер композитного кадра. Если 0/отсутствует — берём bounding box из рантаймов.
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
    /// Preview-scale: 1.0 = 1/1, 0.5 = 1/2 и т.д. Прокидывается в ffmpeg `-vf scale`.
    /// Даёт значительную экономию CPU/GPU на 4K source'ах в маленьком preview.
    /// `None` или отсутствие → декод в нативном разрешении.
    #[serde(default)]
    #[ts(optional)]
    pub preview_scale: Option<f32>,
    /// Целевой FPS preview-рендера. По умолчанию 30. Большинство source — 24/25/30,
    /// поэтому 30 достаточно; для 60fps source укажите 60.
    #[serde(default = "default_fps")]
    pub preview_fps: f64,
    /// Политика синхронизации видео с аудио для preview.
    #[serde(default)]
    pub preview_sync_mode: PreviewSyncMode,
}

fn default_fps() -> f64 {
    30.0
}

/// Защита от выхода за конец доступного source-range: последний «читаемый» PTS = конец
/// диапазона минус этот зазор (1 мс), иначе seek/decoder могли бы запросить кадр за EOF.
const SOURCE_END_GUARD_SEC: f64 = 0.001;
fn default_blend() -> String {
    "normal".into()
}

impl SceneLayer {
    pub fn covers(&self, timeline_sec: f64) -> bool {
        timeline_sec >= self.timeline_start_sec && timeline_sec < self.timeline_end_sec
    }

    pub fn source_pts_at(&self, timeline_sec: f64) -> f64 {
        compute_source_pts_at(
            timeline_sec,
            self.timeline_start_sec,
            self.timeline_end_sec,
            self.source_start_sec,
            self.source_range_duration_sec,
            self.speed,
            self.freeze_frame_source_sec,
        )
    }
}

/// Shared implementation of source PTS computation for both video and audio layers.
fn compute_source_pts_at(
    timeline_sec: f64,
    timeline_start_sec: f64,
    timeline_end_sec: f64,
    source_start_sec: f64,
    source_range_duration_sec: f64,
    speed: f64,
    freeze_frame_source_sec: Option<f64>,
) -> f64 {
    if let Some(freeze) = freeze_frame_source_sec {
        return freeze.max(0.0);
    }

    let local = (timeline_sec - timeline_start_sec).max(0.0);
    let speed = sanitize_clip_speed(speed);
    let abs_speed = speed.abs();
    let source_range =
        if source_range_duration_sec.is_finite() && source_range_duration_sec > 0.0 {
            source_range_duration_sec
        } else {
            (timeline_end_sec - timeline_start_sec).max(0.0) * abs_speed
        };
    let last_readable = (source_range - SOURCE_END_GUARD_SEC).max(0.0);
    let source_delta = local * abs_speed;
    let source_offset = if speed < 0.0 {
        (last_readable - source_delta).clamp(0.0, last_readable)
    } else {
        source_delta.clamp(0.0, last_readable)
    };

    (source_start_sec + source_offset).max(0.0)
}

fn sanitize_clip_speed(speed: f64) -> f64 {
    if speed.is_finite() && speed != 0.0 {
        speed.clamp(-10.0, 10.0)
    } else {
        1.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layer(start: f64, end: f64, source_start: f64) -> SceneLayer {
        SceneLayer {
            id: "x".into(),
            kind: LayerKind::Video,
            path: "/tmp/x".into(),
            timeline_start_sec: start,
            timeline_end_sec: end,
            source_start_sec: source_start,
            source_range_duration_sec: (end - start).max(0.0),
            speed: 1.0,
            freeze_frame_source_sec: None,
            source_orientation: None,
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

    #[test]
    fn covers_is_half_open_interval() {
        let l = layer(2.0, 5.0, 0.0);
        assert!(!l.covers(1.999));
        assert!(l.covers(2.0));
        assert!(l.covers(4.999));
        assert!(!l.covers(5.0));
    }

    #[test]
    fn source_pts_at_offsets_by_timeline_start() {
        let l = layer(10.0, 20.0, 3.5);
        assert!((l.source_pts_at(10.0) - 3.5).abs() < 1e-9);
        assert!((l.source_pts_at(12.0) - 5.5).abs() < 1e-9);
    }

    #[test]
    fn source_pts_at_applies_speed_and_reverse() {
        let mut l = layer(10.0, 20.0, 3.5);
        l.source_range_duration_sec = 20.0;
        l.speed = 2.0;
        assert!((l.source_pts_at(12.0) - 7.5).abs() < 1e-9);

        l.speed = -2.0;
        assert!((l.source_pts_at(10.0) - 23.499).abs() < 1e-9);
        assert!((l.source_pts_at(12.0) - 19.499).abs() < 1e-9);
    }

    #[test]
    fn source_pts_at_uses_freeze_frame() {
        let mut l = layer(10.0, 20.0, 3.5);
        l.speed = 2.0;
        l.freeze_frame_source_sec = Some(8.25);
        assert_eq!(l.source_pts_at(15.0), 8.25);
    }

    #[test]
    fn source_pts_clamps_to_zero_before_timeline_start() {
        let l = layer(10.0, 20.0, 0.0);
        assert_eq!(l.source_pts_at(5.0), 0.0);
    }

    #[test]
    fn deserializes_virtual_layer_fields() {
        let json = r##"{
            "id": "text-1",
            "kind": "text",
            "timeline_start_sec": 0.0,
            "timeline_end_sec": 5.0,
            "source_start_sec": 0.0,
            "source_range_duration_sec": 5.0,
            "speed": 1.0,
            "z": 10,
            "opacity": 0.75,
            "blend_mode": "screen",
            "text": "Hello",
            "style": { "fontSize": 72, "color": "#ff00aa" }
        }"##;
        let layer: SceneLayer = serde_json::from_str(json).unwrap();
        assert_eq!(layer.kind, LayerKind::Text);
        assert_eq!(layer.path, "");
        assert_eq!(layer.blend_mode, "screen");
        assert_eq!(layer.text.as_deref(), Some("Hello"));
        assert_eq!(layer.style.unwrap()["fontSize"], 72);
    }

    fn audio_layer(start: f64, end: f64, source_start: f64) -> SceneAudioLayer {
        SceneAudioLayer {
            id: "a".into(),
            track_id: None,
            path: "/tmp/a.wav".into(),
            timeline_start_sec: start,
            timeline_end_sec: end,
            source_start_sec: source_start,
            source_range_duration_sec: (end - start).max(0.0),
            speed: 1.0,
            audio_gain: 1.0,
            audio_balance: 0.0,
            audio_fade_in_sec: 0.0,
            audio_fade_out_sec: 0.0,
            audio_fade_in_curve: AudioFadeCurve::Linear,
            audio_fade_out_curve: AudioFadeCurve::Linear,
        }
    }

    #[test]
    fn audio_source_pts_at_offsets_by_timeline_start() {
        let l = audio_layer(10.0, 20.0, 3.5);
        assert!((l.source_pts_at(10.0) - 3.5).abs() < 1e-9);
        assert!((l.source_pts_at(12.0) - 5.5).abs() < 1e-9);
    }

    #[test]
    fn audio_source_pts_at_applies_speed_and_reverse() {
        let mut l = audio_layer(10.0, 20.0, 3.5);
        l.source_range_duration_sec = 20.0;
        l.speed = 2.0;
        assert!((l.source_pts_at(12.0) - 7.5).abs() < 1e-9);

        l.speed = -2.0;
        assert!((l.source_pts_at(10.0) - 23.499).abs() < 1e-9);
        assert!((l.source_pts_at(12.0) - 19.499).abs() < 1e-9);
    }

    #[test]
    fn audio_source_pts_clamps_to_zero_before_timeline_start() {
        let l = audio_layer(10.0, 20.0, 0.0);
        assert_eq!(l.source_pts_at(5.0), 0.0);
    }
}
