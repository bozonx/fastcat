//! wgpu device/queue, ресурс-менеджер текстур, кэш сэмплеров.

use anyhow::{Context, Result};

pub struct GpuContext {
    pub instance: wgpu::Instance,
    pub adapter: wgpu::Adapter,
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
}

impl GpuContext {
    pub async fn new() -> Result<Self> {
        let instance = wgpu::Instance::default();
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                ..Default::default()
            })
            .await
            .context("no suitable GPU adapter")?;
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("fastcat-compositor"),
                ..Default::default()
            })
            .await
            .context("failed to request wgpu device")?;
        Ok(Self { instance, adapter, device, queue })
    }
}
