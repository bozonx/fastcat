//! Главный объект композитора. Один на приложение.
//!
//! TODO: реализация в следующем PR. Сейчас — каркас типов и API.

use anyhow::Result;

use super::gpu::GpuContext;
use super::scene::Scene;

pub struct Compositor {
    pub gpu: GpuContext,
    // vello renderer создаётся лениво при первом рендере в target определённого формата
    // (нужен Renderer per surface format).
    renderer: Option<vello::Renderer>,
}

impl Compositor {
    pub async fn new() -> Result<Self> {
        let gpu = GpuContext::new().await?;
        Ok(Self { gpu, renderer: None })
    }

    /// Рендер сцены в offscreen RGBA8 текстуру (для экспорта/превью кадра в файл).
    /// Возвращает буфер пикселей.
    pub fn render_to_buffer(&mut self, _scene: &Scene, _width: u32, _height: u32) -> Result<Vec<u8>> {
        // TODO: 1) собрать vello Scene из доменной Scene (layers -> vello primitives + images)
        //       2) применить per-layer wgpu post-process passes (effects)
        //       3) скомпозить через vello
        //       4) применить transition pass между двумя сценами если нужно
        //       5) copy texture -> buffer
        anyhow::bail!("not implemented")
    }

    /// Рендер в presentation surface (окно/canvas) — для live monitor.
    pub fn render_to_surface(
        &mut self,
        _scene: &Scene,
        _surface_target: &mut SurfaceTarget,
    ) -> Result<()> {
        anyhow::bail!("not implemented")
    }
}

/// Абстракция над целью рендера, чтобы можно было рендерить в окно Tauri или в offscreen.
pub struct SurfaceTarget {
    pub width: u32,
    pub height: u32,
    pub format: wgpu::TextureFormat,
    // pub surface: wgpu::Surface<'static>,  // заполнится при подключении окна
}
