use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebGpuRenderEngineStatus {
    pub available: bool,
    pub adapter: Option<WebGpuAdapterStatus>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebGpuAdapterStatus {
    pub name: String,
    pub vendor: u32,
    pub device: u32,
    pub device_type: String,
    pub backend: String,
    pub driver: String,
    pub driver_info: String,
    pub max_texture_dimension_2d: u32,
    pub max_buffer_size: u64,
}

#[tauri::command]
pub fn webgpu_render_engine_status() -> WebGpuRenderEngineStatus {
    pollster::block_on(probe_webgpu_render_engine())
}

async fn probe_webgpu_render_engine() -> WebGpuRenderEngineStatus {
    let instance = wgpu::Instance::default();
    let adapter = match instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            ..Default::default()
        })
        .await
    {
        Ok(adapter) => adapter,
        Err(error) => {
            return WebGpuRenderEngineStatus {
                available: false,
                adapter: None,
                error: Some(error.to_string()),
            };
        }
    };

    let info = adapter.get_info();
    let limits = adapter.limits();

    match adapter
        .request_device(&wgpu::DeviceDescriptor::default())
        .await
    {
        Ok((_device, _queue)) => WebGpuRenderEngineStatus {
            available: true,
            adapter: Some(WebGpuAdapterStatus {
                name: info.name,
                vendor: info.vendor,
                device: info.device,
                device_type: format!("{:?}", info.device_type),
                backend: format!("{:?}", info.backend),
                driver: info.driver,
                driver_info: info.driver_info,
                max_texture_dimension_2d: limits.max_texture_dimension_2d,
                max_buffer_size: limits.max_buffer_size,
            }),
            error: None,
        },
        Err(error) => WebGpuRenderEngineStatus {
            available: false,
            adapter: Some(WebGpuAdapterStatus {
                name: info.name,
                vendor: info.vendor,
                device: info.device,
                device_type: format!("{:?}", info.device_type),
                backend: format!("{:?}", info.backend),
                driver: info.driver,
                driver_info: info.driver_info,
                max_texture_dimension_2d: limits.max_texture_dimension_2d,
                max_buffer_size: limits.max_buffer_size,
            }),
            error: Some(error.to_string()),
        },
    }
}
