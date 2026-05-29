//! Описание мульти-слойной сцены, которую играет нативный монитор.
//!
//! Фронт шлёт «снимок» всех клипов на таймлайне (video + image) разом — монитор сам
//! решает, какие слои сейчас «активны» по timeline-PTS, лениво открывает декодеры
//! и композитит результат через Vello.

use serde::Deserialize;

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LayerKind {
    Video,
    Image,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SceneLayer {
    /// Стабильный идентификатор клипа — ключ для diff'а scene и кеша рантаймов.
    pub id: String,
    pub kind: LayerKind,
    /// Абсолютный путь к файлу-источнику.
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
}

#[derive(Debug, Clone, Deserialize)]
pub struct MonitorScene {
    pub layers: Vec<SceneLayer>,
    /// Размер композитного кадра. Если 0/None — берём bounding box ниже видеослоёв.
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
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
