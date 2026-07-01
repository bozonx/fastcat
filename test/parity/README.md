# Web cross-engine parity tests (`test/parity/web`)

These tests verify that the **web video engine** (PixiJS + WebGPU + Web Workers)
produces the same perceptual output as the **native Tauri engine** (Vello + wgpu +
FFmpeg) for the same scene definitions.

Unlike `test/e2e/`, these tests do **not** drive the UI. They navigate to a
dedicated parity harness (`/test/parity`) inside the app, load scene fixtures
into OPFS, render frames, and compare perceptual hashes against golden
records in `shared/golden/frames.json`.

## Structure

```
test/parity/
  web/
    web-engine-parity.spec.ts  ← render scenes and compare with golden hashes
  README.md                    ← this file

test/parity-helpers/
  web-render.ts                ← frame rendering harness
  golden-compare.ts            ← hash comparison and golden registry
  scene-loader.ts              ← load shared/scenes fixtures
  frame-hash.ts                ← perceptual hash computation
  *.test.ts                    ← unit tests for the helpers
```

## Running

```bash
# All parity tests (web only)
pnpm test:parity:web

# All web parity + e2e tests
pnpm test:e2e

# Run only the parity spec file
pnpm exec playwright test test/parity/web
```

Web parity tests require Chromium with WebGPU. They are tagged with `@parity`
so `test:parity:web` can filter them from the rest of the Playwright suite.
