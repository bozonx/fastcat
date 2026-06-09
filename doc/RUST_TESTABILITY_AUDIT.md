# Audit of Rust Code Testability

## Executive Summary

The Rust part of the codebase (`src-tauri/src/`) has **polarized testability**:

- **Good**: Pure math/audio modules (`audio/mix`, `audio/resample`, `audio/ring`, `media/ffmpeg_utils`, `monitor/scene`, `monitor/frame_cache`) have unit tests and are easy to test.
- **Bad**: Any module that touches **hardware, OS windowing, GPU, real processes, or Tauri IPC** is practically untestable in isolation. They lack abstraction layers (traits), rely on global mutable state, and directly call external APIs (`cpal`, `wgpu`, `winit`, `ffmpeg-next`, `ffmpeg` CLI).

**Primary root cause**: Absence of dependency injection and trait-based abstractions for I/O and system boundaries. Business logic is mixed with infrastructure code.

---

## Detailed Findings

### 1. No Abstraction Layers for Hardware / OS / External Processes

Business logic directly calls concrete external APIs, making unit testing impossible without the real hardware/software.

| Module | Problem | File |
|--------|---------|------|
| **Audio Engine** | `NativeAudioEngine::new()` directly calls `cpal::default_host().default_output_device()`, `build_output_stream()`, and spawns a real producer thread. No trait to inject a fake audio backend. | `src-tauri/src/audio/engine.rs` |
| **Audio Output** | `build_stream()` directly builds a `cpal::Stream`. The real-time callback `write_output()` is testable, but the stream builder is not. | `src-tauri/src/audio/output.rs` |
| **Video Render** | `probe_webgpu_render_engine()` directly creates `wgpu::Instance`, `request_adapter()`, `request_device()`. Cannot test without a GPU / wgpu backend. | `src-tauri/src/video_render.rs` |
| **Compositor** | `Compositor::new()` creates `vello::RenderContext` (wgpu). `create_window_surface()` needs a real `winit::Window`. No `Compositor` trait exists to mock for tests. | `src-tauri/src/compositor/compositor.rs` |
| **Monitor** | `WindowState` owns `Arc<Window>`, `Compositor`, `RenderSurface`, `NativeAudioEngine`, and `AppHandle`. `init_window()` creates a real `winit` window/surface and cannot be tested without windowing/GPU integration. | `src-tauri/src/monitor/app.rs` |
| **Monitor Handle** | `MonitorHandle::spawn()` launches a real `winit` event-loop thread. | `src-tauri/src/monitor/handle.rs` |
| **FFmpeg Decode** | `FfmpegNextDecoder::open()` directly opens files via `ffmpeg-next`. `DecodePump::open()` spawns a real thread with a real decoder. | `src-tauri/src/media/decode.rs`, `src-tauri/src/media/decode_thread.rs` |
| **FFmpeg HW Accel** | `init_hwaccel()` directly calls `ffmpeg_sys_next` unsafe functions (`av_hwdevice_ctx_create`, etc.). Platform-gated code (`#[cfg(target_os = "linux")]`). No way to mock. | `src-tauri/src/media/hwaccel.rs` |
| **Media Processing** | `probe_media()`, `generate_proxy()`, `convert_media()`, `extract_video_frame_webp()` all spawn real `ffmpeg`/`ffprobe` child processes. | `src-tauri/src/media/processing.rs` |
| **Layer Runtime** | `LayerRuntimeManager` spawns threads that call `DecodePump::open()`, `decode_image()`, `rasterize_svg()`. Needs `AppHandle`, `EventLoopProxy`, and `wgpu::Device`. | `src-tauri/src/monitor/runtime.rs` |

#### Recommendation

Introduce **trait boundaries** at every I/O edge:

```rust
// Example for audio output
pub trait AudioOutput: Send + Sync {
    fn build_stream(
        &self,
        config: StreamConfig,
        data_callback: Box<dyn FnMut(&mut [f32]) + Send>,
        error_callback: Box<dyn Fn(cpal::StreamError) + Send>,
    ) -> Result<Box<dyn AudioStream>>;
}

pub trait AudioStream {
    fn play(&self)?;
    fn pause(&self)?;
}

// In tests:
struct FakeAudioOutput { ... }
impl AudioOutput for FakeAudioOutput { ... }
```

Do the same for `VideoDecoder`, `Compositor`, `MonitorWindow`, `HwAccelContext`, `FfmpegRunner`.

---

### 2. Global Mutable State (`static` caches and semaphores)

Multiple modules use `static` variables for caching or concurrency control. This creates shared mutable state between tests, leading to flaky tests and order-dependent behavior.

| Variable | Module | Purpose |
|----------|--------|---------|
| `CACHED_DECODERS: Mutex<HashMap<...>>` | `audio/decode.rs` | Cache of streaming audio decoders |
| `CACHED_FILE_SIZES: Mutex<HashMap<...>>` | `audio/decode.rs` | Cache of file sizes |
| `FFMPEG_INIT: OnceCell<()>` | `media/decode.rs` | One-time ffmpeg-next init |
| `DECODER_LOAD_GATE: OnceLock<Semaphore>` | `media/decode_gate.rs` | Global concurrency limiter |
| `VERIFIED: OnceLock<Mutex<HashSet<String>>>` | `media/ffmpeg_utils.rs` | Memoized binary verification |
| `THUMBNAIL_COMPOSITOR: Lazy<Mutex<Option<Compositor>>>` | `media/timeline_render.rs` | Global compositor instance |

#### Recommendation

Replace `static` globals with **explicit context objects** passed down the call stack:

```rust
// Instead of global
pub struct AudioDecodeContext {
    decoders: Mutex<HashMap<...>>,
    file_sizes: Mutex<HashMap<...>>,
}

// Instead of global
pub struct MediaPipelineContext {
    decoder_gate: Semaphore,
    verified_binaries: Mutex<HashSet<String>>,
    compositor: Mutex<Option<Compositor>>,
}
```

In production, instantiate one context and share it via `Arc`. In tests, create a fresh context per test.

---

### 3. Tauri Commands Are Thick Controllers

All `#[tauri::command]` functions in `ipc/` mix HTTP-like request handling with business logic. They depend on `tauri::State<'_, ...>`, `AppHandle`, and `Channel`.

Examples:
- `native_media_metadata` calls `probe_media` inline.
- `native_timeline_export` constructs a closure that captures `app` and emits events.
- `monitor_set_scene` sends a command to the monitor event loop.

These cannot be unit-tested without a running Tauri application.

#### Recommendation

Apply **Command-Query Separation** or a **Service Layer**:

```rust
// ipc/monitor_cmd.rs (thin adapter)
#[tauri::command]
pub async fn monitor_set_scene(
    scene: MonitorScene,
    engine: State<'_, VideoEngine>,
) -> Result<(), String> {
    engine.ensure_monitor()?.send(MonitorCommand::SetScene(scene)).map_err(|e| e.to_string())
}

// The above is acceptable as a thin adapter.
// For heavier logic (e.g., media processing), extract a service:

// src/media/media_service.rs
pub struct MediaService { ... }
impl MediaService {
    pub fn probe_metadata(&self, path: &Path) -> Result<NativeMediaMetadata> { ... }
}
```

Tauri commands should only deserialize input, call a service method, and serialize output.

---

### 4. Impossible to Mock Time, GPU, and Real-Time Audio

Several components depend on system resources that are hard to fake:

- **`PlaybackClock`** (`monitor/clock.rs`) uses `Instant::now()`. Tests use `std::thread::sleep()`, making them slow and non-deterministic.
- **`RealtimeClock`** (`audio/clock.rs`) uses `AtomicU64` for frames. Testable, but only because it's a passive data structure.
- **Any wgpu/vello code** requires a real GPU or a software adapter. There is no `#[cfg(test)]` stub.
- **Any cpal code** requires a real audio device or a null backend. `cpal` does have a `null` host, but it is not used in tests.

#### Recommendation

- For time: inject a `Clock` trait:
  ```rust
  pub trait Clock {
      fn now(&self) -> Instant;
  }
  struct SystemClock;
  struct FakeClock { current: Cell<Instant> }
  ```
- For GPU/wgpu: create a `#[cfg(test)]` stub that implements `Compositor` trait and returns dummy pixels.
- For cpal: use the `cpal::platform::NullHost` or inject a fake `AudioOutput` trait (see point 1).

---

### 5. Lack of `#[cfg(test)]` Stubs / Test Utilities

There is no dedicated `test/` or `testing/` module with stub implementations. Every test that needs a decoder, compositor, or audio engine must use the real thing.

#### Recommendation

Create a `src-tauri/src/testing/` module (only compiled under `#[cfg(test)]`) containing:
- `FakeVideoDecoder` (returns pre-canned frames)
- `FakeCompositor` (returns solid-color RGBA buffers)
- `FakeAudioOutput` (records written samples into a `Vec`)
- `FakeClock` / `FakeAppHandle`

---

### 6. No Feature Flags to Disable Heavy Dependencies in Tests

The entire workspace compiles `ffmpeg-next`, `wgpu`, `vello`, `cpal`, `winit` even for simple unit tests. This makes `cargo test` slow and sometimes fails in headless CI.

#### Recommendation

Gate heavy backends behind Cargo features:

```toml
# Cargo.toml
[features]
default = ["wgpu-backend", "cpal-backend", "ffmpeg-backend"]
test-stubs = []
```

Then in code:
```rust
#[cfg(all(test, feature = "test-stubs"))]
mod stub { ... }

#[cfg(not(feature = "test-stubs"))]
mod real { ... }
```

Alternatively, use conditional compilation in the test target only.

---

### 7. Layer Runtime Manager Is a God Object

`LayerRuntimeManager` (`monitor/runtime.rs`) has too many responsibilities:
- Diffing scenes
- Spawning background threads for video/image/SVG loading
- Managing decode pumps and frame caches
- Building compositor scenes
- Emitting Tauri events on failure

It takes 6+ dependencies in its constructor (`AppHandle`, `Sender<BgLayerResult>`, `EventLoopProxy`, `FfmpegHardwareSettings`).

#### Recommendation

Split it into smaller, single-responsibility units:
- `SceneDiffEngine` — computes which layers to add/remove/keep.
- `LayerLoader` — owns the background thread pool / loading logic.
- `FrameCacheManager` — owns per-layer `VideoFrameCache`.
- `CompositorSceneBuilder` — converts runtime state to `compositor::Scene`.

---

### 8. Unsafe and Platform-Specific Code Is Untested

Several modules contain `unsafe` blocks and `#[cfg(target_os = ...)]` that have no test coverage:

- `media/hwaccel.rs` — `av_hwdevice_ctx_create`, `av_buffer_ref`, raw pointer manipulation.
- `monitor/app.rs` — platform-specific event-loop setup such as Windows `with_any_thread`.
- `audio/output.rs` — `write_output` generic over sample format (tests exist but only for f32).

#### Recommendation

- Isolate `unsafe` into the smallest possible modules and write Rust-safe wrappers around them.
- For platform-specific code, use a `Platform` trait with per-OS implementations.
- Run platform-specific tests in CI matrix (GitHub Actions already has `e2e-smoke.yml`, extend it for Rust unit tests on Linux/macOS/Windows).

---

## Modules with Good Testability (Keep It Up)

These modules are well-structured, mostly pure functions, and have good coverage:

- `audio/mix.rs` — pure audio mixing, extensive tests.
- `audio/resample.rs` — pure resampling, tests.
- `audio/ring.rs` — lock-free SPSC buffer, tests.
- `audio/shared.rs` — cache eviction, timing signatures, tests.
- `audio/peaks.rs` — peak extraction, tests (requires fixture files, but deterministic).
- `media/ffmpeg_utils.rs` — pure helper functions (`even`, `is_quarter_turn`, `resolve_audio_encoder`), tests.
- `media/ffmpeg_args.rs` — pure argument builders.
- `monitor/scene.rs` — DTO + `compute_source_pts_at`, tests.
- `monitor/frame_cache.rs` — cache policy, tests.
- `monitor/clock.rs` — playback arithmetic, tests (would benefit from fake clock).

---

## Priority Action Items

| Priority | Action | Impact |
|----------|--------|--------|
| **P0** | Extract traits for `AudioOutput`, `VideoDecoder`, `Compositor`, `HwAccelContext` | Unlocks unit testing of engine, monitor, and timeline render |
| **P0** | Eliminate `static` global caches/semaphores; pass context structs | Removes flaky tests and hidden dependencies |
| **P1** | Create `src/testing/` with fake implementations | Provides reusable test doubles |
| **P1** | Split Tauri commands into thin adapters + service layer | Makes commands testable without Tauri runtime |
| **P2** | Introduce `Clock` trait for `PlaybackClock` | Faster, deterministic time-based tests |
| **P2** | Add `#[cfg(test)]` null/stub backends for wgpu/cpal | Enables headless CI testing |
| **P2** | Split `LayerRuntimeManager` into smaller structs | Improves readability and test isolation |

---

## Example Refactor: `NativeAudioEngine`

**Before (untestable)**:
```rust
pub struct NativeAudioEngine {
    _stream: Stream, // cpal stream
    // ...
}
impl NativeAudioEngine {
    pub fn new(settings: &AudioEngineSettings) -> Result<Self> {
        let host = cpal::default_host();
        let device = host.default_output_device().ok_or(...)?;
        let config = device.default_output_config()?;
        let stream = build_stream(...)?; // direct cpal call
        // ...
    }
}
```

**After (testable)**:
```rust
pub trait AudioBackend: Send + Sync {
    fn build_output_stream(
        &self,
        config: StreamConfig,
        data_callback: Box<dyn FnMut(&mut [f32]) + Send>,
        error_callback: Box<dyn Fn(cpal::StreamError) + Send>,
    ) -> Result<Box<dyn AudioStream>>;
}

pub struct CpalBackend { ... }
impl AudioBackend for CpalBackend { ... }

pub struct NativeAudioEngine {
    backend: Box<dyn AudioBackend>,
    stream: Box<dyn AudioStream>,
    // ...
}

impl NativeAudioEngine {
    pub fn new(settings: &AudioEngineSettings, backend: Box<dyn AudioBackend>) -> Result<Self> {
        let stream = backend.build_output_stream(...)?;
        // ...
    }
}

#[cfg(test)]
struct FakeAudioBackend {
    received_samples: Arc<Mutex<Vec<f32>>>,
}
```

---

## Example Refactor: `probe_webgpu_render_engine`

**Before**:
```rust
async fn probe_webgpu_render_engine() -> WebGpuRenderEngineStatus {
    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::default());
    let adapter = instance.request_adapter(&wgpu::RequestAdapterOptions::default()).await;
    // ...
}
```

**After**:
```rust
#[cfg_attr(test, mockall::automock)]
#[async_trait::async_trait]
pub trait GpuAdapterProbe {
    async fn probe(&self) -> WebGpuRenderEngineStatus;
}

pub struct WgpuAdapterProbe;
#[async_trait::async_trait]
impl GpuAdapterProbe for WgpuAdapterProbe {
    async fn probe(&self) -> WebGpuRenderEngineStatus {
        // real wgpu code
    }
}
```

---

## Conclusion

The codebase is **well-organized at the module level** but **lacks architectural boundaries** for testability. The fix is not about writing more tests; it is about **refactoring to introduce traits and dependency injection** at every boundary where Rust touches hardware, OS, or external processes. Once those boundaries exist, the existing clean math/audio logic can be tested in isolation, and the heavy integration points can be covered by a smaller set of focused integration tests.
