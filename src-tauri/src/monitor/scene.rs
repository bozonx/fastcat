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

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
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
#[derive(Debug, Clone, Deserialize)]
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
}

fn one() -> f64 {
    1.0
}
fn half() -> f64 {
    0.5
}

#[derive(Debug, Clone, Deserialize)]
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
    /// Чем выше — тем поверх. Сортируем по возрастанию.
    pub z: i32,
    /// `[0; 1]`, домножается на альфа-канал слоя.
    pub opacity: f64,
    /// Blend mode из таймлайна. Поддерживаем текущий frontend-набор.
    #[serde(default = "default_blend")]
    pub blend_mode: String,
    #[serde(default)]
    pub background_color: Option<String>,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub style: Option<Value>,
    #[serde(default)]
    pub shape_type: Option<String>,
    #[serde(default)]
    pub fill_color: Option<String>,
    #[serde(default)]
    pub stroke_color: Option<String>,
    #[serde(default)]
    pub stroke_width: Option<f64>,
    #[serde(default)]
    pub shape_config: Option<Value>,
    /// Явный трансформ слоя в scene-space.
    /// `None` → letterbox center-fit (поведение по умолчанию, совместимость с предыдущими версиями).
    #[serde(default)]
    pub transform: Option<SceneLayerTransform>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MonitorScene {
    pub layers: Vec<SceneLayer>,
    /// Размер композитного кадра. Если 0/отсутствует — берём bounding box из рантаймов.
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
    /// Preview-scale: 1.0 = 1/1, 0.5 = 1/2 и т.д. Прокидывается в ffmpeg `-vf scale`.
    /// Даёт значительную экономию CPU/GPU на 4K source'ах в маленьком preview.
    /// `None` или отсутствие → декод в нативном разрешении.
    #[serde(default)]
    pub preview_scale: Option<f32>,
    /// Целевой FPS preview-рендера. По умолчанию 30. Большинство source — 24/25/30,
    /// поэтому 30 достаточно; для 60fps source укажите 60.
    #[serde(default = "default_fps")]
    pub preview_fps: f64,
}

fn default_fps() -> f64 {
    30.0
}
fn default_blend() -> String {
    "normal".into()
}

impl SceneLayer {
    pub fn covers(&self, timeline_sec: f64) -> bool {
        timeline_sec >= self.timeline_start_sec && timeline_sec < self.timeline_end_sec
    }

    pub fn source_pts_at(&self, timeline_sec: f64) -> f64 {
        let local = self.source_start_sec + (timeline_sec - self.timeline_start_sec);
        local.max(0.0)
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
}
