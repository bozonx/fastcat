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

/// Abstraction over the GPU adapter probing logic so tests can inject a fake
/// backend without pulling in `wgpu`.
pub trait GpuAdapterProbe {
    fn probe(&self) -> impl std::future::Future<Output = WebGpuRenderEngineStatus> + Send;
}

/// Real implementation using `wgpu`.
pub struct WgpuAdapterProbe;

impl GpuAdapterProbe for WgpuAdapterProbe {
    async fn probe(&self) -> WebGpuRenderEngineStatus {
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

        let adapter_status = Some(WebGpuAdapterStatus {
            name: info.name,
            vendor: info.vendor,
            device: info.device,
            device_type: format!("{:?}", info.device_type),
            backend: format!("{:?}", info.backend),
            driver: info.driver,
            driver_info: info.driver_info,
            max_texture_dimension_2d: limits.max_texture_dimension_2d,
            max_buffer_size: limits.max_buffer_size,
        });

        // Report availability based on adapter presence alone. Creating a device
        // just to immediately drop it wastes GPU resources; the frontend creates
        // its own device when it actually needs one and handles failure there.
        WebGpuRenderEngineStatus {
            available: true,
            adapter: adapter_status,
            error: None,
        }
    }
}

#[tauri::command]
pub async fn webgpu_render_engine_status() -> WebGpuRenderEngineStatus {
    probe_webgpu_render_engine().await
}

async fn probe_webgpu_render_engine() -> WebGpuRenderEngineStatus {
    WgpuAdapterProbe.probe().await
}
