# Web e2e tests (`test/e2e/web`, `test/e2e/smoke`)

End-to-end coverage of the **desktop web** editor for **base functionality only**
— nothing behind premium or in-development feature flags. These are true e2e
tests: they run the real app in a real browser and verify the **persisted OTIO
document** the user would reopen (or, for export/render, the actual decoded
output/pixels), not Vue store internals. If a check can be made without the
browser, it belongs in a unit test (`*.test.ts`), not here.

Import, delete, and multi-select are driven through real pointer/file-input
interactions. Timeline editing (move/trim/split/select-by-id/add-to-track) and
file-manager rename/move/create-folder-as-precondition go through test-only
`__fastcatE2e*` hooks that call the same command/store path a pointer drag or
inline-edit would — real drags on small clips and trim handles are unreliable,
and inline-rename/DnD-tree-move are timing-sensitive enough that driving them
via pointer buys little extra confidence for a lot of flakiness. What makes
these e2e rather than unit tests is that they assert on the persisted OTIO/OPFS
state after a real save, not the input method. See `test/utils/e2e/timeline.ts`
and `test/utils/e2e/file-manager.ts` for the exact split.

Cross-engine rendering parity tests live in `test/golden/` because they test the
video engine output, not user workflows.

## What is e2e here vs. what is not

| Concern | Where it lives |
| --- | --- |
| DSP math, pan-law, fades, geometry | unit / parity fixtures (`shared/parity`, `*.parity.test.ts`) |
| Codec/container ingest matrix | `web/media-format-import.spec.ts` (probe route) |
| Audio graph numbers (RMS/peak) | `web/audio-playback.spec.ts` (probe route) |
| I/O budget / OPFS decode lifecycle | `web/opfs-io-budget.spec.ts` |
| **User workflows through the real UI** | the specs described below |

## Structure

```
test/e2e/
  README.md                 ← this file
  fixtures/
    workspace.ts            ← `test`/`expect` fixtures: e2eWorkspace, e2eProject
  smoke/
    loading.spec.ts         ← page loads, title, uncaught errors
    desktop.spec.ts         ← mocked Tauri desktop environment
    webgpu.spec.ts          ← WebGPU availability
    workspace.spec.ts       ← OPFS workspace creation
  web/
    editor-smoke-workflow.spec.ts   ← the single long happy-path
    project-creation.spec.ts        ← create project → FS + timeline doc
    media-import.spec.ts            ← real import pipeline (file input)
    timeline-add-clip.spec.ts       ← file manager → track
    timeline-trim.spec.ts           ← trim handles → duration/source
    timeline-move.spec.ts           ← reposition on/between tracks
    editor-playback.spec.ts         ← transport + playhead
    file-manager.spec.ts            ← folders, rename, move, delete, view, select
    file-manager-bulk.spec.ts       ← bulk select, delete, copy, cut, paste
    export.spec.ts                  ← short export → output/success
test/utils/e2e/
    otio.ts            ← read + parse persisted timeline from OPFS (assertion backbone)
    timeline.ts        ← clip/track locators, drag/trim/move, DnD add-to-track
    file-manager.ts    ← seed media, real upload, folder/entry ops
    transport.ts       ← play/pause/seek/playhead + export flow
    virtual-fs.ts      ← OPFS read/write/list helpers
    audio.ts, webgpu.ts, render-helpers.ts, tauri-mocks.ts
```

## Conventions

- **Start from `e2eProject`** (fixture) — every test gets an open project with an
  isolated OPFS workspace that is cleaned up afterwards.
- **Precondition media with `seedProjectMedia`** (writes bytes + reloads). Only
  `media-import.spec.ts` drives the import *UI* via `importViaUpload`; other
  specs must not re-run import just to get a clip.
- **Assert on the persisted doc** via `readTimelineDoc` / `waitForTimelineDoc`.
  UI locators confirm the action happened; the `.otio` file confirms it stuck.
- **Prefer deterministic input over pixel drag** where the app allows it.
  Timeline move/trim/split go through the `__fastcatE2e*` hooks in
  `timeline.ts` rather than mouse-based dragging, which is unreliable for
  small clips and trim handles at default zoom.
- **Base scope only** — do not add specs for premium presets, native/Tauri
  fallbacks, conversion, transcription, captions, proxies, transitions, remote
  browser, or anything gated by feature flags.

## Test ids added for e2e

Most of the app is already addressable via existing data attributes
(`data-clip-id`, `data-gap-id`, `data-track-id`, `data-entry-path`,
`data-monitor-play`). The following `data-testid`s were added for nodes that had
no stable hook:

| test id | node |
| --- | --- |
| `clip-trim-start` / `clip-trim-end` | timeline clip trim handles |
| `timeline-playhead` | playhead line |
| `timeline-ruler` | ruler seek surface |
| `file-create-folder` | file toolbar create-folder button |
| `file-view-grid` / `file-view-list` | file toolbar view toggles |
| `file-upload-input` | hidden file input for import |
| `nav-export` | editor header export-view tab |
| `export-start` | export start button |
| `export-progress` / `export-success` | export status regions |

## Running

```
# Full UI e2e (smoke + e2e projects; golden is a separate tier):
pnpm test:e2e
# Smoke tier only:
pnpm test:e2e:smoke
# A single spec (needs a built .output/public; Playwright's webServer starts the
# static preview server itself and reuses one already running on the port):
pnpm build && pnpm exec playwright test --project=e2e test/e2e/web/timeline-trim.spec.ts
```

Chromium only (web decode + WebGPU flags). Export and playback specs are the
slowest — keep their assertions minimal.
