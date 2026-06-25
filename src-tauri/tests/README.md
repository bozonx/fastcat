# Native integration tests

End-to-end tests for the Rust video/audio engines. Unlike the inline
`#[cfg(test)]` unit tests (which test pure logic — ffmpeg arg building, codec
resolution, timing math), these drive the **real** engines: they run
`ffmpeg`/`ffprobe`, decode the synthetic fixtures in `test/fixtures/media`,
touch the filesystem, and — for the export video case — the GPU compositor.

## Running

```bash
# from repo root
pnpm test:native          # all native tests (unit + integration)
pnpm test:native:int      # just the integration suites

# or directly
cargo test --manifest-path src-tauri/Cargo.toml --features test-support
```

The `test-support` feature exposes in-crate test doubles to the external
`tests/` crates (`NativeAudioEngine::new_mock`, `audio::mix::render_scene_to_samples`).
The probe/decode/export suites don't need it, but it's harmless to always pass.

## Suites

| File | Needs | What it checks |
|------|-------|----------------|
| `media_probe.rs` | ffprobe / image crate | `probe_media` over the container matrix, `decode_image` (png/jpeg/webp), `extract_audio_stream` |
| `audio_offline.rs` | — (linked libav) | scene → PCM mix: length, 440 Hz energy, master-gain scaling, silence |
| `audio_engine_realtime.rs` | — (mock backend) | transport state machine (scene/seek/play/pause) without a `cpal` device |
| `timeline_export.rs` | ffmpeg + GPU | full `export_timeline`: audio-only file, and GPU video export verified with ffprobe |
| `engine_parity.rs` | ffmpeg + GPU | cross-engine parity: renders shared scenes from `shared/scenes/` through the real GPU compositor, computes perceptual hashes, and compares against golden hashes in `shared/golden/frames.json` |

## Graceful skips

Tests that need a tool the host lacks **skip** (early-return, counted as passed)
via the `skip_unless!` macro rather than fail — see `tests/common/mod.rs`:

- no `ffmpeg`/`ffprobe` → probe/extract/export skip
- no wgpu adapter (headless CI without software Vulkan) → the GPU video export
  skips; gate is `Compositor::is_gpu_available()`

So the suite stays green on a minimal host and exercises everything on a full
dev machine / CI with ffmpeg + a (hardware or lavapipe) GPU.

## Note

`media::decode_thread::tests::paused_seek_without_prebuffer_lands_on_target`
(an inline unit test) is timing-sensitive and occasionally flaky — unrelated to
this suite.
