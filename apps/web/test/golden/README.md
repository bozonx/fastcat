# Web golden (rendered-frame) tests (`test/golden/web`)

These tests verify that the **web video engine** (PixiJS + WebGPU + Web Workers)
renders the same perceptual output as the **native Tauri engine** (Vello + wgpu +
FFmpeg) for the same scene definitions.

> Terminology: "golden" = cross-engine _rendered-frame_ comparison (GPU-dependent,
> against `shared/golden/frames.json`). It is distinct from "parity" = pure
> cross-language _logic_ math pinned by `shared/parity/*.json`, which lives in the
> unit/rust tiers (`*.parity.test.ts` and Rust `#[test]`s).

Unlike `test/e2e/`, these tests do **not** drive the UI. They navigate to a
dedicated render harness (`/test/golden`) inside the app, load scene fixtures
into OPFS, render frames, and compare perceptual hashes against golden
records in `shared/golden/frames.json`.

## Structure

```
test/golden/
  web/
    web-engine-parity.spec.ts  ← render scenes and compare with golden hashes
  README.md                    ← this file

test/golden-helpers/
  web-render.ts                ← frame rendering harness
  golden-compare.ts            ← hash comparison and golden registry
  scene-loader.ts              ← load shared/scenes fixtures
  frame-hash.ts                ← perceptual hash computation
  *.test.ts                    ← unit tests for the helpers (run in integration tier)
```

## Running

```bash
# Web golden tier (Playwright `golden` project only)
pnpm test:golden:web

# Full UI e2e tiers (smoke + e2e; does NOT include golden)
pnpm test:e2e

# Run only the golden spec file
pnpm exec playwright test test/golden/web
```

The golden tier is its own Playwright project (`--project=golden`), disjoint from
the `smoke`/`e2e` projects, so a spec is never pulled into two runs at once. It
requires Chromium with WebGPU. By default it skips when no adapter is available;
set `REQUIRE_WEBGPU=1` (as CI does) to make that a hard failure instead.
