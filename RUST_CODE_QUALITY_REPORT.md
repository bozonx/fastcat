# Rust Code Quality Review Report

## Executive Summary

The Rust codebase in `src-tauri/src/` is generally well-structured with good separation of concerns, comprehensive test coverage, and solid domain modeling. However, there are several areas where code quality and adherence to Rust best practices could be improved. This report categorizes findings by severity and provides specific file/line references.

---

## Critical Issues

### 1. Weak Path Security Validation

**File**: `src-tauri/src/lib.rs:83-96`

```rust
pub fn reject_dangerous_scope_path(path: &Path) -> bool {
    let s = path.to_string_lossy();
    s.contains("/.git/")
        || s.ends_with("/.git")
        || s.contains("/.gitignore")
        || s.contains("/node_modules/")
        || s.ends_with("/node_modules")
}
```

**Problem**: This is a naive security check. It does not protect against:
- Symlink traversal attacks
- Path normalization attacks (`../`, `.//`, etc.)
- Case-insensitive filesystem attacks (`NODE_MODULES`)
- Other sensitive paths (`.ssh`, `.env`, `Cargo.toml` with secrets)

**Recommendation**: Use `path.components()` for canonical path resolution, check against an allowlist, and resolve symlinks before validation.

### 2. Panic in Audio Callback Path

**File**: `src-tauri/src/audio/output.rs:229-235`

```rust
assert!(
    needed <= buf.len(),
    "audio callback buffer size {} exceeds preallocated temp capacity {}",
    needed,
    buf.len()
);
```

**Problem**: An `assert!` panic in an audio callback will crash the entire application. The callback is called by the OS audio subsystem with potentially variable buffer sizes.

**Recommendation**: Replace with dynamic buffer resizing or truncation, never panic in real-time callbacks.

### 3. Fragile FFmpeg Output Parsing

**File**: `src-tauri/src/ipc/media_cmd.rs:399-428`

```rust
fn parse_ffmpeg_components(output_str: &str) -> std::collections::HashSet<String> {
    // ... heuristic parsing of ffmpeg -encoders / -decoders output
}
```

**Problem**: This parses human-readable FFmpeg output with heuristics. FFmpeg output format is not a stable API and can change between versions, breaking the parser silently.

**Recommendation**: Use JSON output (`-encoders -v quiet -print_format json`) or the `ffprobe`/`ffmpeg` programmatic APIs where available.

---

## High Priority Issues

### 4. Excessive Function Arguments (Clippy Suppressions)

Multiple files suppress `clippy::too_many_arguments`, indicating API design issues:

- `src-tauri/src/audio/decode.rs:199` — `decode_symphonia_chunk` (9 args)
- `src-tauri/src/audio/mix.rs:246` — `mix_layer_into` (8 args)
- `src-tauri/src/audio/mix.rs:448` — `apply_layer_mix` (8 args)
- `src-tauri/src/monitor/runtime.rs` — `build_compositor_snapshot` (many args)

**Problem**: Functions with >5-6 arguments are hard to use, test, and refactor.

**Recommendation**: Introduce parameter structs:
```rust
struct DecodeChunkParams<'a> {
    layer_id: &'a str,
    path: &'a str,
    source_start_sec: f64,
    // ... etc
}
```

### 5. Global Mutable State (Singletons)

**File**: `src-tauri/src/media/timeline_render.rs:263-264`

```rust
static GLOBAL_RENDERER: std::sync::LazyLock<ThumbnailRenderer> =
    std::sync::LazyLock::new(ThumbnailRenderer::new);
```

**Problem**: Global state makes testing difficult and hides dependencies. `ThumbnailRenderer` contains a `Mutex<Option<Compositor>>` which is a GPU resource manager — not thread-safe in all contexts.

**Also**: `FFMPEG_INIT` in `src-tauri/src/media/decode.rs:66`.

**Recommendation**: Use dependency injection or explicit context objects passed down the call stack.

### 6. Massive Functions Violating Single Responsibility

| Function | File | Lines | Issue |
|----------|------|-------|-------|
| `to_vello` / `to_vello_with_image_processor` | `compositor/scene.rs` | ~300 | Converts scene + renders all layer types |
| `tick_and_render` | `monitor/app.rs` | ~150 | Window event + render + audio sync |
| `producer_loop` | `audio/producer.rs` | ~130 | Thread management + mixing + underrun handling |
| `apply_scene` | `monitor/runtime.rs` | ~200 | Scene diff + decoder lifecycle + cache management |
| `run_decoder_loop` | `media/decode_thread.rs` | ~200 | Command dispatch + frame decode + GPU upload |

**Recommendation**: Extract helper functions and use the "extract method" refactoring aggressively.

### 7. Stringly-Typed Configuration

**File**: `src-tauri/src/lib.rs:52-58`

```rust
pub struct FfmpegHardwareSettings {
    pub ffmpeg_path: String,
    pub ffprobe_path: String,
    pub hardware_acceleration_mode: String,  // Should be enum
    pub vaapi_device: String,
    pub enable_hardware_encoding: bool,
}
```

**Also**: `blend_mode: String` in `monitor/scene.rs:113`.

**Problem**: Using `String` for constrained values loses type safety and enables invalid states.

**Recommendation**: Use enums with `serde(rename_all = "lowercase")`:
```rust
pub enum HwAccelMode {
    None,
    Auto,
    Vaapi,
    Nvdec,
}
```

### 8. Code Duplication in Symphonia File Opening

**File**: `src-tauri/src/audio/decode.rs`

`probe_audio_source_metadata`, `decode_entire_file_symphonia`, and `decode_symphonia_chunk` all contain nearly identical code for:
1. Opening the file
2. Creating `MediaSourceStream`
3. Building `Hint` from extension
4. Calling `symphonia::default::get_probe().format(...)`
5. Finding the first active audio track

**Recommendation**: Extract a `open_symphonia_format(path: &str) -> Result<(...)>>` helper.

---

## Medium Priority Issues

### 9. Unnecessary Cloning in Hot Paths

**File**: `src-tauri/src/audio/engine.rs` (inferred from `set_scene`)

The audio engine clones the entire `Vec<SceneAudioLayer>` and `Vec<SceneAudioTrack>` on every scene update. For large timelines, this is `O(n)` allocation in the audio thread.

**Recommendation**: Use `Arc<[SceneAudioLayer]>` for immutable snapshots, or diff and update incrementally.

### 10. Manual LRU Implementation

**File**: `src-tauri/src/media/timeline_render.rs:109-173`

`VideoDecoderCache` implements its own LRU with `HashMap + VecDeque` instead of using the well-tested `lru` crate.

**Problem**: The `get_or_insert` logic has subtle edge cases with capacity management and replacement.

**Recommendation**: Use `lru::LruCache<PathBuf, CachedDecoder>`.

### 11. Missing Error Context in FFmpeg Utilities

**File**: `src-tauri/src/media/ffmpeg_utils.rs`

Many functions return `String` or bare `Result` without structured error types. For example, `resolve_hwaccel` returns `String` with magic values like `""` and `"-vaapi"`.

**Recommendation**: Return enums or structured types with explicit variants for each hwaccel mode.

### 12. Platform-Specific Code Duplication

**File**: `src-tauri/src/media/hwaccel.rs`

`try_vaapi`, `try_videotoolbox`, and `try_d3d11va` share ~80% identical code:
- Find hwdevice type by name
- Create device context
- Attach to codec context
- Return `HwAccelContext`

**Recommendation**: Extract a generic helper parameterized by device name and optional device path.

### 13. Inefficient GPU Readback Buffer Management

**File**: `src-tauri/src/compositor/readback.rs:175-197`

`collect_ready_slots` iterates all slots and calls `take_ready_frame` on each. `take_ready_frame` uses `std::mem::replace` which is fine, but the pattern could be simplified with a `SlotState::ready()` method.

Also, the `pending` queue in `PipelinedReadback` does sorted insertion (`O(n)` per frame). For high frame rates, this is unnecessary overhead.

**Recommendation**: Use a `BinaryHeap` or accept that frames are usually ready in order and use `Vec::push` with a reorder check.

### 14. Effect Pipeline Magic Numbers

**File**: `src-tauri/src/compositor/effects/mod.rs:80-95`

```rust
#[repr(C)]
#[derive(Clone, Copy, Default, Pod, Zeroable)]
struct EffectUniform {
    mode: u32,  // Magic numbers: 1=brightness, 2=contrast, etc.
    width: u32,
    height: u32,
    seed: u32,
    p0: f32, p1: f32, // ... generic parameters without semantic names
    // ...
}
```

**Problem**: `mode` is a u32 with no type safety. `p0-p7` are completely opaque.

**Recommendation**: Use a Rust enum for `mode` with `#[repr(u32)]`, and consider union types or separate uniform structs per effect.

### 15. Inconsistent Error Handling in IPC Commands

**File**: `src-tauri/src/ipc/monitor_cmd.rs`

Every command repeats the same pattern:
```rust
engine
    .ensure_monitor()
    .map_err(|e| e.to_string())?
    .send(MonitorCommand::X)
    .map_err(|e| e.to_string())
```

**Recommendation**: Extract a helper macro or function:
```rust
fn send_monitor_cmd(engine: &VideoEngine, cmd: MonitorCommand) -> Result<(), String> {
    engine.ensure_monitor().map_err(|e| e.to_string())?
        .send(cmd).map_err(|e| e.to_string())
}
```

### 16. Hardcoded Codec Lists in Diagnostics

**File**: `src-tauri/src/ipc/media_cmd.rs:507-759`

The `FfmpegDiagnostics` struct contains manually constructed lists of codecs (H.264, H.265, VP9, AV1, AAC, Opus). Adding a new codec requires editing this code.

**Recommendation**: Generate this from a configuration array or query FFmpeg dynamically.

---

## Low Priority / Style Issues

### 17. Inefficient WGPU Adapter Probing

**File**: `src-tauri/src/video_render.rs`

`WgpuAdapterProbe::probe()` creates a fresh `Instance`, requests an `Adapter`, then a `Device` every time it's called. This is expensive (~100-500ms).

**Recommendation**: Cache the adapter probe result in a `OnceLock` for the lifetime of the application.

### 18. Missing `power_preference` in GPU Selection

**File**: `src-tauri/src/video_render.rs`

`instance.request_adapter(&wgpu::RequestAdapterOptions::default())` does not specify `power_preference`, potentially selecting integrated graphics over discrete on laptops.

**Recommendation**: Add `power_preference: wgpu::PowerPreference::HighPerformance`.

### 19. Unbounded Growth in Texture Pool Cleanup

**File**: `src-tauri/src/compositor/effects/mod.rs:160-161`

```rust
self.entries
    .retain(|e| Arc::strong_count(&e.texture) > 1 || (e.width == width && e.height == height));
```

This is `O(n)` on every `acquire` call where no exact match exists. For pools with many entries, this becomes a hot path.

**Recommendation**: Use a `HashMap<(u32, u32), Vec<PooledTexture>>` for O(1) size-based lookup.

### 20. `#[cfg(dev)]` is Non-Standard

**File**: `src-tauri/src/lib.rs:169`

```rust
#[cfg(dev)]
fn allow_dev_directory_scope(...) { ... }
```

`cfg(dev)` is not a built-in Rust configuration flag. It may only work if explicitly set in the build configuration.

**Recommendation**: Use `#[cfg(debug_assertions)]` which is the standard way to detect debug builds.

### 21. Test Fixture Paths Are Relative

**File**: `src-tauri/src/audio/decode.rs:686-701`

```rust
let path = "../test/fixtures/media/sample-1s-audio.mp3";
```

**Problem**: Relative paths from `src-tauri/src/` to `test/` assume a specific directory structure. Tests will fail if run from a different working directory.

**Recommendation**: Use `env!("CARGO_MANIFEST_DIR")` as done in `media/decode.rs:664`:
```rust
let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
    .parent()
    .unwrap()
    .join("test/fixtures/media/...");
```

### 22. Comment Language Mixing

While the project appears to be Russian-language, some files (`compositor/effects/mod.rs`, `compositor/transitions/mod.rs`, `monitor/frame_cache.rs`) have comments in Russian while others (`audio/output.rs`, `media/hwaccel.rs`) are in English.

**Note**: Per `AGENTS.md`, code comments should be in English. The Russian comments in `frame_cache.rs` and other files violate this rule.

### 23. `anyhow` Overuse in Internal APIs

Many internal functions use `anyhow::Result` for error propagation. While fine for application boundaries, internal APIs would benefit from custom error enums for better `match` handling and testability.

For example, `decode_symphonia_chunk` could return:
```rust
enum DecodeError {
    FileNotFound,
    NoAudioTrack,
    SeekFailed { target: f64 },
    DecoderError(symphonia::core::errors::Error),
}
```

### 24. `VideoFrame` Holds Both CPU and GPU Data

**File**: `src-tauri/src/media/decode.rs:32-40`

```rust
pub struct VideoFrame {
    pub pixels: Vec<u8>,      // CPU data
    pub texture: Option<wgpu::Texture>,  // GPU data
    pub texture_pool: Option<Arc<Mutex<...>>>,
}
```

**Problem**: A frame should ideally be either CPU-resident or GPU-resident, not both simultaneously (except during upload). The current design keeps both, doubling memory usage for cached frames.

**Recommendation**: Use an enum:
```rust
enum FrameData {
    Cpu(Vec<u8>),
    Gpu(wgpu::Texture),
    Uploading { cpu: Vec<u8>, gpu: wgpu::Texture },
}
```

---

## Positive Observations

1. **Good test coverage** — Most modules have `#[cfg(test)]` blocks with meaningful unit tests.
2. **Panic recovery** — Audio producer thread uses `catch_unwind` and logs instead of crashing.
3. **Proper `unsafe` documentation** — `hwaccel.rs` and `producer.rs` have detailed SAFETY comments.
4. **Resource management** — `VideoFrame::Drop` returns textures to pool; `UnmapGuard` prevents buffer leaks.
5. **Clear module boundaries** — `monitor/scene_build/mod.rs` explicitly documents the separation between IPC DTOs and domain models.
6. **Performance consciousness** — Comments explicitly mention avoiding allocations in hot paths (e.g., effect uniform buffer reuse).

---

## Summary Statistics

| Category | Count |
|----------|-------|
| Critical | 3 |
| High Priority | 8 |
| Medium Priority | 8 |
| Low Priority / Style | 6 |
| Positive Observations | 6 |

## Recommended Actions

1. **Immediate**: Fix the audio callback panic (`assert!` → dynamic resize).
2. **Short-term**: Extract parameter structs for functions with >5 args; replace string-typed enums.
3. **Medium-term**: Refactor mega-functions (`to_vello`, `tick_and_render`, `apply_scene`) into smaller, testable units.
4. **Long-term**: Remove global singletons in favor of dependency injection; introduce custom error types for internal APIs.
