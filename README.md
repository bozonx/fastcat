# FastCat

Standalone video editor project extracted from FastCat.

## Features

- Timeline editing with multi-track composition
- Mobile drawers support toolbar snap mode, full-height expansion, gesture-aware drag/scroll interactions, dedicated clip delete/trim panels, and timeline multi-select via long press on clips
- Mobile timeline long press no longer opens context menus for clips, gaps, or tracks; long press on a clip enters multi-selection mode, and additional clips can be toggled in or out of the selection
- SVG images are rasterized to PNG on import for reliable worker rendering
- Monitor playback with volume/mute controls for audio
- Audio clip effects with live preview and export support (`Reverb`, `Distortion`)
- Focus-aware panel hotkeys with routing to the currently active editor panel
- File system access API integration for local file editing
- FastCat integration settings with connect flow and manual API override support
- Remote file browser mode backed by FastCat VFS in the middle file manager panel
- File-manager drag previews on the timeline follow the active frame and timeline snapping modes
- Mobile asset browser and timeline media picker share categorized project assets, sorting, selection UI, and pull-to-refresh
- Remote-to-local download by drag-and-drop from remote files into the local folder tree
- Local-to-remote upload action with remote folder picker and cancelable transfer progress modal
- External service health checks for FastCat, Files API and STT API
- OTIO (OpenTimelineIO) support for timeline serialization
- Automatic timeline backups with rotating versioning (default 5 versions) to prevent data loss
- Offloaded timeline serialization to Web Workers to ensure smooth UI during periodic auto-saves
- High-performance rendering with Web Workers

## Feature Flags

Some functionality is gated behind build/runtime flags read from the
environment (see `.env` / `.env.production.example`):

- `FASTCAT_ENABLE_IN_DEVELOPMENT_FEATURES` — experimental features that are not
  yet stable. Currently includes media conversion, audio extraction, and
  **copy/paste of clip parameters** (context-menu items, the properties-panel
  action buttons, the paste modal, and the `Ctrl/Cmd+C` / `Ctrl/Cmd+V` timeline
  hotkeys). All of these UI entry points are hidden when the flag is off.
- `FASTCAT_ENABLE_PREMIUM_FEATURES` — premium-only features (conversion, HUD,
  audio extraction).

## Tech Stack

- [Nuxt 4](https://nuxt.com/)
- [Nuxt UI](https://ui.nuxt.com/)
- [PixiJS 8](https://pixijs.com/)
- [Mediabunny](https://github.com/lucasferreira/mediabunny)
- [Tone.js](https://tonejs.github.io/)
- [Pinia](https://pinia.vuejs.org/)

## I/O Budget Architecture

FastCat coordinates file-system access across the main thread and multiple Web Workers through a shared `SharedArrayBuffer` semaphore. This prevents Chromium's renderer-process datapipe pool from exhausting when many concurrent `getFile()` / `createWritable()` calls happen simultaneously.

- **Interactive pool** — governs short-lived reads and small writes (`MAX_CONCURRENT_FILE_IO = 2` in browsers, `32` in Tauri).
- **Streaming pool** — governs long-lived writable streams during export/transcode (`MAX_CONCURRENT_FILE_IO_STREAMING = 1`).
- **Governed Blob wrapper** — `governedBlob()` / `governedBlobWorker()` intercept `arrayBuffer()`, `text()`, and `slice()` on Blobs so every random read performed by `BlobSource` (mediabunny) is budgeted.
- **Transient-error retry** — `runResilientWorkerFileIo` and `runResilientFileWrite` detect `InvalidStateError` / "datapipe" exhaustion and retry with exponential backoff.
- **Held-slot watchdog** — reports operations that retain a budget slot unusually long, but never force-releases a live slot because that would allow unsafe OPFS concurrency.
- **Metadata extraction queue** — browser metadata probes are limited to two concurrent tasks and reopen project files through a fresh OPFS handle before extraction and transient retries, preventing queued stale `File` snapshots from being reused after atomic replacement.

Workers receive the budget buffer via an `io-init` postMessage immediately after creation. Fallback `LocalBudget` is used when `SharedArrayBuffer` is unavailable; the metadata queue still limits the highest-volume probe path in this mode.

The browser-level contract is covered by `test/e2e/web/opfs-io-budget.spec.ts`, which runs real OPFS writes from the main thread and dedicated workers against the same shared semaphore. Tauri command names are guarded by `test/integration/ipc-contracts.test.ts`, which compares static frontend `invoke(...)` calls with the Rust `generate_handler!` registration.

Browser audio e2e uses `src/pages/test/audio-probe.vue` and `test/e2e/web/audio-playback.spec.ts`.
The probe reads synthetic audio fixtures from OPFS, decodes them with the real
Web Audio API, and measures RMS/peak levels before and after the master gain
node. It intentionally validates numeric signal flow instead of depending on
physical speaker output.

## Web Browser Workspace

The hosted web build does not request access to a user-selected local folder.
It opens an internal OPFS sandbox (`navigator.storage.getDirectory()`) and
stores uploaded media, projects, settings, temporary files, and exports there.
This keeps the web build available in browsers that do not implement the File
System Access picker APIs, including Firefox and Safari.

At startup the app checks the browser APIs required by the web editor before
opening a workspace: OPFS, IndexedDB, Web Workers, OffscreenCanvas,
`createImageBitmap`, video WebCodecs, and `SharedArrayBuffer` under
cross-origin isolation. Missing WebGPU or audio WebCodecs are treated as limited
feature warnings instead of blocking the basic editor shell.

### WebGPU Compatibility & Dev Testing

When WebGPU is missing or disabled in the browser, the web application (`!isTauriRuntime()`) automatically runs in WebGL fallback mode and presents a WebGPU Gate Modal detailing:
- Shader and transition limitations under WebGL.
- Browser-specific instructions for enabling WebGPU flags (e.g. `chrome://flags/#enable-unsafe-webgpu` or `about:config` `dom.webgpu.enabled`).
- A button to copy the flag URL directly to the clipboard.
- Recommendations to download the native desktop or mobile app for heavy 4K projects.

#### Dev Testing Query Parameters

You can simulate different browser environments and WebGPU support states during development by passing URL query parameters:

- `?mock_gpu=none` (or `?mock_gpu=0` / `?mock_gpu=webgl`): Simulates missing WebGPU and opens the WebGPU Gate Modal.
- `?mock_gpu=webgpu` (or `?mock_gpu=1`): Simulates supported WebGPU.
- `?mock_browser=chrome` | `edge` | `firefox` | `safari`: Overrides browser detection to test flag instructions for specific browsers.

Examples:
- `http://localhost:3000/?mock_gpu=none` (Test WebGPU modal in Chrome)
- `http://localhost:3000/?mock_gpu=none&mock_browser=firefox` (Test Firefox `about:config` instructions)

Media is imported into the OPFS sandbox via drag-and-drop from the OS or the
file-manager upload button (both flow through the same `handleFiles` ingest
path). The Storage settings panel reports OPFS quota usage and lets the user opt
into persistent storage (`navigator.storage.persist()`) so the browser does not
evict the workspace under disk pressure; the app also requests persistence
automatically when the web workspace opens.

### Deploying the web build

The web build is fully static (`pnpm generate` → `.output/public`) and requires
`Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy:
require-corp` on the document so `SharedArrayBuffer` (the I/O budget) is
available.

- **Cloudflare Pages / Netlify**: headers come from `public/_headers`.
- **Cloudflare Worker**: `public/_headers` is _not_ honoured, so `worker/index.ts`
  serves the static assets (via the `ASSETS` binding in `wrangler.toml`) and
  stamps the isolation + cache headers on every response. It also handles SPA
  fallback to `index.html`.

```bash
# Build + deploy to Cloudflare Workers (needs wrangler auth)
pnpm deploy:cf

# Build + run the Worker locally against the generated assets
pnpm preview:cf
```

## Setup

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build for production
pnpm build

# Run desktop app with Tauri
pnpm tauri:dev

# Build desktop app bundle
pnpm tauri:build
```

## Docker

You can run the application using Docker and Docker Compose:

```bash
# Build and start the container
docker compose up -d --build

# View logs
docker compose logs -f
```

The application will be available at `http://localhost:3008`.

## Desktop (Tauri)

- Desktop mode uses Tauri 2 with `@tauri-apps/plugin-fs` for file system access.
- File streaming in desktop mode uses `tauri-plugin-fs-stream` and `tauri-plugin-fs-stream-api`.
- Desktop workspace folders are restored from app settings and added to the runtime FS scope after startup without granting the whole home directory.
- The Rust desktop crate targets Rust `1.87.0` because the native video rendering engine foundation uses `wgpu` 29.
- The `webgpu_render_engine_status` Tauri command probes native `wgpu` adapter/device availability and is the entry point for the upcoming Rust WebGPU renderer.
- The native Tauri monitor renders media, SVG, background, text, and shape timeline layers through the Rust video core. Preview video frames use a YUV fast-path where supported: FFmpeg frames are kept as NV12-style Y/UV planes, uploaded as `R8Unorm`/`Rg8Unorm`, and converted to RGBA by a small GPU pass before entering the existing Vello texture path. SVG files are rasterized with `resvg` at the target preview/export resolution, while text/shapes/blend modes and shader transitions are composed in the Vello scene used by the monitor preview and native video export. Transition sources support an adjacent clip, the composite of lower layers, or transparency in both preview and export. The web editor fonts loaded from Google Fonts are not bundled into Rust yet; to make them deterministic in native text rendering, bundle the matching `.ttf`/`.otf` files with the app and load them into the native font database before creating text layouts.
- Preview effect quality can be set to Auto, Low, Medium, High, or Ultra in both web and native monitors. Manual levels are respected during playback and scrubbing; export always uses Ultra. Auto uses the project resolution, timeline FPS, and mobile mode to choose a sampling budget, and uses Ultra for paused frames. It never lowers preview resolution; that remains a separate monitor setting. The budget applies to blur-heavy transitions, Blur, Blur Fill, Bloom, and internal compositor blur passes. Disabling preview effects keeps transition timing but renders every transition as a simple dissolve.
- Video effects use the shared WGSL compute shader in `shared/effects/effect.wgsl` for both web preview and Tauri native rendering/export. Effect manifests expose `paramRanges` with separate UI, animation, and renderer hard-cap ranges so future keyframe controls can allow larger artistic values without removing GPU safety limits.
- The web compositor and native Tauri compositor support the same multi-pass effects, including `blur-fill`, `bloom`, and `gaussian-blur`. Clip, video-track, master, and adjustment-layer effects use the shared WebGPU/WGPU pipeline. Adjustment layers process the project-sized scene without effect padding, matching native rendering and preventing full-frame blur from shifting when edge bleed is enabled. Web adjustment capture also excludes the browser renderer's one-pixel boundary fringe so large blur radii do not turn it into a dark frame. Track opacity and blend are applied once to the composited track result rather than being duplicated onto every clip. Web track, adjustment, shape-effect, and shader-transition processing captures the renderer canvas directly instead of performing a Pixi `extract.pixels()` readback through `ImageData`. Stable monitor render textures reuse their WebGPU views and bind groups across frames, avoiding per-frame driver object churn during shader transitions and effect blits.
- Web export waits for WebGPU initialization and fails explicitly when a timeline requires video effects or shader transitions but WebGPU is unavailable. Its browser pipeline probes the exact WebCodecs encoder profile before the first full hardware attempt, writes audio and video sources concurrently after muxer start, coalesces progress callbacks so the worker render loop does not wait on the main thread, reports determinate progress from rendered video frames and mixed audio chunks, and uses short adaptive encoder-backpressure waits to reduce CPU/GPU idle gaps. Native export aborts on a source-frame decode failure instead of silently producing blank frames.
- Web preview and Tauri native rendering/export use the same transition manifests and normalized parameters from `src/transitions/manifests.ts`. Canonical transition shaders live in `shared/transitions/*.wgsl`; manifests pass those exact sources to Tauri through `custom-wgsl`, while the web compositor imports the same files. Hard 2D boundaries use one-pixel analytic coverage at pixel centers, including angled `blinds` strips, so antialiasing does not turn into a multi-pixel blur. The previous Pixi-only transition implementations have been removed.
- Desktop FFmpeg hardware acceleration settings are applied to native monitor decode, native timeline export source decode, thumbnails, proxy generation, and conversion. On Linux, VAAPI uses the configured render node, defaulting to `/dev/dri/renderD128`.
- Desktop audio extraction uses the native FFmpeg task pipeline and copies the primary audio stream into a sidecar audio file without re-encoding when the target container supports it.
- Set `FASTCAT_RENDER_TIMING=1` when running the Tauri app to log native compositor stage timings (`materialize`, `build_vello`, `render`, total) for preview and offscreen pixel renders. Initial cold-start GPU/Vello warmup frames are logged separately and excluded from the running average.
- Native Rust rendering is split by responsibility: `compositor/engine/device_context.rs` owns per-device GPU resources, `compositor/engine/materializer.rs` defines scene preparation order, and `monitor/runtime/policy.rs` contains preview sync, prewarm, eviction, transition-activity, and frame-cache policies. Stateful audio decoders and their rolling-window scheduler live together under `audio/decode/`.
- The monitor supports `smooth`, `balanced`, and `strict` audio/video sync modes in both web and native Tauri preview paths. `balanced` is the default and gives the video decoder a wider catch-up window than strict frame dropping.
- Web and native monitor audio share clip/track gain, additive balance, fade, adjacent-transition, solo/mute, and paused-meter semantics. Native master gain is updated through a live IPC path without rebuilding the scene.
- Native monitor audio prewarms active and nearby timeline layers before playback, extends the startup prime for multi-layer audio scenes, and logs ring-fill/underrun/catch-up diagnostics when realtime mixing falls behind.
- The native monitor decoded-frame cache is configurable in video settings (`Auto`, `Low`, `Balanced`, `High`, `Custom`). `Auto` sizes the per-layer cache from preview resolution and FPS with a 512 MB cap; `Custom` accepts `0 MB` to disable the rotating cache window while retaining only the current display frame.
- Replacing a native monitor scene while the timeline is paused stops the native transport before loading the new scene, so decoder cache warm-up remains hidden and cannot appear as playback after the playhead, including on two-source transitions.
- Nested timelines are flattened before preview playback. Parsed nested documents are reused within each build, web audio prefetch is bounded and non-blocking, and the web compositor maintains a decoded-frame lookahead for active and nearby video clips. Adjacent transitions also warm the outgoing and incoming source handles they consume, while the frame presented by the current render remains independent from LRU cache eviction.
- The desktop VFS adapter stores its local app-managed data in `BaseDirectory.AppData`.
- FastCat stores global `user.settings.json` and `app.settings.json` in the OS-recommended Tauri `BaseDirectory.AppConfig` location. Workspace settings stay in the selected workspace.
- Desktop startup automatically restores the saved workspace path, or creates and uses the default `Documents/FastCat` workspace when no path was saved yet.
- In Tauri dev mode, app config/cache/default documents resolve under `FASTCAT_DEV_DIR`, which defaults to the project-root `./.dev-files`. The directory mirrors the user's OS root layout: on Linux it creates `home/user/.config/fastcat`, `home/user/.local/share/fastcat`, `home/user/.cache/fastcat`, `tmp/fastcat`, and `home/user/Documents`; on Windows it uses `Users/user/AppData/Roaming/fastcat`, `Local/fastcat`, `Local/Temp/fastcat`, and `Documents`; on macOS it uses `Users/user/Library/Application Support/fastcat`, `Caches/fastcat`, `tmp/fastcat`, and `Documents`. The debug shell extends the runtime FS scope for that dev directory.
- Tauri capabilities are scoped to app-managed directories (`$APPDATA`, `$APPCONFIG`, `$APPCACHE`, `$TEMP`) and dev resource paths. User-selected folders and dropped files are canonicalized and added to the runtime scope only after Rust-side policy checks reject filesystem roots, the bare home directory, and sensitive components such as `.git`, `.ssh`, `.env`, and `node_modules`.
- Desktop production builds use `tauri build` with Linux `deb` and `rpm` bundle targets enabled. Add `appimage` back when the build environment provides a working `linuxdeploy`.

## Architecture

- `src/components`: UI components of the editor.
- `src/stores`: Application state management (Pinia).
- `src/timeline`: Core timeline logic and OTIO serialization.
- `src/composables/monitor`: Monitor composables (timeline, playback, core orchestration).
- `src/utils/video-editor`: Video composition and worker client logic.
- `test/unit`: Unit tests for business logic, stores, and utilities.
- `test/components`: Tests for Vue components using Vitest and @vue/test-utils.
- `test/integration`: Integration tests for cross-module interactions.
- `test/e2e`: End-to-end tests using Playwright.
- `test/fixtures`: Mock data and files for testing.
- Clip transforms use a shared layout helper in `src/utils/video-editor/clip-layout.ts` so monitor overlays and compositor rendering resolve the same anchor, fit and translation math.
- Clip transform `position` values are stored in 1920x1080 design-space units and are scaled to the active preview/export resolution during layout.
- Timeline resolution, FPS and audio sample rate are stored per `.otio` timeline in FastCat metadata; project settings provide defaults for newly created timelines.
- Timeline time conversions use `src/utils/time/ticks.ts` as their checkpoint. Persisted timeline positions and durations use `TICKS_PER_SECOND = 254_016_000_000`, which is divisible by the supported standard frame and audio sample rates. Legacy FastCat OTIO metadata is migrated from microseconds on import; JavaScript's exact-integer limit bounds a timeline position to about 9.85 hours.
- Timeline frame rates are persisted as exact `{ num, den }` rationals. Timeline settings offer standard rates only; changing FPS follows Premiere-style behavior and preserves clip coordinates while changing the snapping grid.
- Text clip style sizing (`width`, `height`, `fontSize`, `lineHeight`, `padding`, `letterSpacing`) is normalized before persistence and scaled from the project resolution during web preview and rendering. Fractional preview pixels are preserved until the final canvas allocation.
- `src/utils/math.ts`: Shared clamping helpers (`clamp`, `clampInt`, `clampFinite`, `clampPositive`, `clampNumber`).
- `src/utils/color.ts`: Shared hex color normalization and RGB conversion (`normalizeHexColor`, `hexToRgb01`, `hexToRgbUint`).
- `src/utils/time/`: Shared time conversion, normalization and formatting utilities.
- `src/utils/path/`: Shared project, cache and Tauri filesystem path operations.
- `src/utils/fs.ts`: Shared workspace handle and filesystem entry utilities.
- `src/utils/media-types.ts`: Shared media classification, MIME mapping and image detection.
- `src/utils/preview-effect-quality.ts`: Shared preview/effect quality resolution used by the compositor and transition manifests.
- `src/utils/dev-logger.ts`: Dev-only logger for verbose diagnostics (disabled in production).
- `src/workers/timeline-serializer.worker.ts`: Dedicated worker for background timeline serialization.
- `src/workers/`: Web Workers for heavy lifting (video decoding/encoding).

## Workspace data

FastCat uses a split storage model:

- `projectsRoot` and `commonRoot` are persistent user-owned content (inside `contentRootPath` if overridden)
- rebuildable project-scoped workspace data is stored in `tempRoot` (defaults to `vardata/`)
- proxy media can use a dedicated `proxiesRoot`; if not configured, proxies fall back to `tempRoot/projects/<projectId>/proxies`
- libraries and future global data are stored in `dataRoot` (defaults to `data/` under `dataRootPath` or `contentRootPath`)
- short-lived job files can use `ephemeralTmpRoot`; if empty, the runtime should use the system temporary directory
- logical paths can be configured through **Application settings → Storage**

In browser workspace mode and portable-style workspace mode, config files are stored in the workspace under `.fastcat-config/`.
Legacy `.fastcat-workspace/*` files are still read for migration.

Each project has a stable `projectId` stored in `projects/<projectName>/.fastcat/project.meta.json`.
This ID is used as the folder key for project-scoped temporary data.

Layout:

- `<commonRoot>` — shared workspace library available in every project
- `<dataRoot>` — future application global data and libraries
- `<tempRoot>/projects/<projectId>/proxies` — generated proxy media when no dedicated `proxiesRoot` override is configured
- `<tempRoot>/projects/<projectId>/thumbnails` — generated thumbnails for the project
- `<tempRoot>/projects/<projectId>/waveforms` — generated audio waveforms for the project
- `<tempRoot>/projects/<projectId>/frame-cache` — cached metadata, vector rasters and other project-scoped cache data
- `<tempRoot>/projects/<projectId>/jobs` — persistent job state and recoverable background task files
- `<tempRoot>/projects/<projectId>/imports` — future import staging files
- `<tempRoot>/projects/<projectId>/exports-tmp` — future export staging files
- `<proxiesRoot>/<projectId>` — generated proxy media for the project

Waveform cache entries are validated against the source file size and modification time before
reuse. Long timeline waveforms are rendered through an overscanned viewport window so scrolling
within the buffered region does not re-rasterize the canvas, while zooming temporarily scales the
existing bitmap until the settled redraw. The window is positioned directly in clip coordinates,
inside a small host that keeps the canvas at local x=0, avoiding browser element-size and canvas
culling limits for long audio sources at extreme timeline zoom.

Mode-specific behavior:

- **Desktop / system-default** — content/data/temp/proxies can use OS default locations or desktop path overrides
- **Desktop / portable** — content and rebuildable cache stay inside the selected workspace; only `ephemeralTmpRoot` is configurable separately
- **Browser workspace** — rebuildable cache stays inside the selected workspace folder; the UI exposes workspace folder selection and optional `ephemeralTmpRoot`

Shared library behavior:

- the file manager exposes `<commonRoot>` as a virtual top-level folder in browsers and trees
- files from `<commonRoot>` use the internal path prefix `@common/...`
- media and documents from `<commonRoot>` can be opened and reused from any project
- OTIO files from `<commonRoot>` can be opened for editing and inserted as nested timelines

You can clear temporary files from the UI:

- **Application settings → Storage → Clear temporary files** — deletes `<tempRoot>`
- **Project settings → Storage → Clear temporary files** — deletes `<tempRoot>/projects/<projectId>`

## External integrations

Editor settings now include an **Integrations** section for external services.

Supported configuration modes:

- **FastCat Publicador** via connect flow or manual bearer token
- **Manual Files API** with `baseUrl` and bearer token
- **Manual STT API** with `baseUrl` (bearer token is optional)

Current implementation scope:

- settings and provider resolution
- connect flow token capture via `?token=...`
- auto-connect URL generation from `BLOGGERDOG_BASE_URL`
- connect app name from a global constant
- connect flow `scopes` generation based on active Files/STT overrides
- provider override rules for `Files API` and `STT API`
- `GET /api/v1/health` checks for FastCat Publicador and resolved manual services
- audio file transcription from the properties panel via `POST .../api/v1/transcribe/stream`
- shared STT request settings: `provider`, `models`, `restorePunctuation`, `formatText`, `includeWords`
- transcription files are stored next to the source media file as `{filename}.stt.json` (Sidecar pattern)

Provider priority rules:

- if FastCat Publicador is enabled and has a token, it is the default source
- manual `Files API` or `STT API` can override FastCat independently
- if FastCat is not configured, manual services work standalone

Requested FastCat scopes:

- `vfs:read`
- `stt:transcribe`

The editor requests only scopes that still need to be served by FastCat Publicador.
If a manual Files or STT service explicitly overrides FastCat, the related scope is omitted from the connect flow.

Notes:

- `FASTCAT_PUBLICADOR_BASE_URL` defines the FastCat Publicador instance URL for connect flow and API resolution
- FastCat connect app name is fixed globally and is not editable in user settings
- desktop user/app settings are stored in the OS app config directory
- OPFS and portable workspace settings are stored in `.fastcat-config/user.settings.json` and `.fastcat-config/app.settings.json`
- manual STT `baseUrl` may point to the service root, `/api/v1`, `/api/v1/external/stt`, or the full `/api/v1/transcribe/stream` endpoint
- FastCat STT streaming uses `POST /api/v1/external/api/v1/transcribe/stream`

### Audio transcription

Local audio files expose a **Transcribe audio** action in the file properties panel.

Behavior:

- the modal allows an optional language override per request
- requests use raw audio upload to the resolved STT stream endpoint
- the editor sends `X-STT-Provider`, `X-STT-Language`, `X-STT-Restore-Punctuation`, `X-STT-Format-Text`, `X-STT-Include-Words`, and `X-STT-Models` when configured
- `restorePunctuation` defaults to `true`
- `formatText` defaults to `false`
- `includeWords` defaults to `true`
- transcription files are stored next to the source media file as `{filename}.stt.json` (Sidecar pattern)
- waveforms and thumbnails are cached in `vardata/cache` or `projects/<projectId>/cache` depending on settings

### Caption generation from STT cache

Video track properties now expose a **Generate captions** action.

Clip video properties can temporarily disable blending, opacity, transform, and mask groups
without discarding their configured values.

Behavior:

- caption generation never starts transcription by itself
- the user must first prepare transcription cache records through the existing transcription flow
- the generator scans all active audio and video media clips across the timeline and loads their existing cache automatically
- disabled clips are ignored
- clips on hidden video tracks or muted tracks are ignored
- clip trims are respected via `sourceRange` and `timelineRange`
- when multiple sources overlap in time, only the top visible video source is used for captions in the covered range
- captions are generated as regular timeline `text` clips on the selected video track
- the selected target track must be an empty video track reserved for captions
- chunking is configurable with `max words per clip`, `max clip duration`, `split on silence gap`, and `split on punctuation`

### File exchange modal

When the resolved `Files API` provider is available, the desktop file browser exposes a `Remote` button in the middle panel toolbar.

The current behavior is:

- the `Remote` button opens a dedicated large file exchange modal instead of switching the middle panel into a remote mode
- the modal is split into three columns: local project tree, remote content library, and preview/details
- the left column stays fully local and continues to represent the project file system
- the center column renders remote entries as content item cards and supports multiple media assets per item
- content item cards display the item title, a horizontal media gallery, and optional text tile
- dragging a media tile from the remote library into the local tree downloads that specific media file
- dragging a local file into the remote library creates a new remote content item with a single media asset
- local files still expose an `Upload to remote` action in the context menu and properties panel, but it now opens the same exchange modal
- upload and download transfers use cancelable progress modals

## Panel focus and keyboard routing

- Hotkeys are routed to the currently focused panel instead of being handled globally by every visible panel.
- In `Cut` and `Sound` views, `Tab` switches focus between the main editing panels and returns focus from side panels to the last active main panel.
- In `Files` and `Export` views, `Tab` is not used for panel switching, but the focused panel still controls which hotkeys are allowed.
- Fullscreen preview and modal dialogs block panel focus routing and `Tab` switching.
- `Backspace` closes the currently focused detached panel in `Cut` view and restores focus to the last active main panel.
- Text inputs and text editors keep their native keyboard behavior and do not receive editor hotkeys.
- Clicking on buttons via pointer (mouse/touch) automatically removes focus (`blur()`) to prevent focus trapping and accidental hotkey triggers, while preserving keyboard accessibility for Tab navigation.
- Shuttle direction presses use the latest requested playback speed even while media is still preparing. Holding the bare shuttle-stop key with either direction runs a one-third-speed frame cadence in both the timeline monitor and focused media previews; releasing either key stops that cadence.

## Testing

Tests are organised into explicit **tiers** so each can run in its own CI job and
the GPU-fragile ones stay out of the merge gate. Two things used to both be called
"parity" — they are now distinct:

- **parity** = pure cross-language _logic_ math pinned by `shared/parity/*.json`
  (CPU, deterministic). These live inside the unit/rust tiers, not a tier of
  their own — see the `*.parity.test.ts` files and the Rust `#[test]`s that read
  those fixtures.
- **golden** = cross-engine _rendered-frame_ comparison against
  `shared/golden/frames.json` (GPU-dependent).

| Tier                      | Location                                                    | Command                     | CI           |
| ------------------------- | ----------------------------------------------------------- | --------------------------- | ------------ |
| Unit                      | `test/unit/`, `test/components/` (incl. `*.parity.test.ts`) | `pnpm test:unit`            | gate         |
| Integration (web)         | `test/integration/`, `test/golden-helpers/`                 | `pnpm test:integration:web` | gate         |
| Integration/unit (native) | `src-tauri/tests/`, Rust `#[test]`s (incl. logic parity)    | `pnpm test:native`          | gate         |
| E2E — smoke               | `test/e2e/smoke/`                                           | `pnpm test:e2e:smoke`       | gate         |
| E2E — full                | `test/e2e/web/`                                             | `pnpm test:e2e`             | gate         |
| Golden (web)              | `test/golden/` + `test/golden-helpers/`                     | `pnpm test:golden:web`      | manual (GPU) |
| Golden (native)           | `src-tauri/tests/engine_parity.rs`                          | `pnpm test:golden:native`   | manual (GPU) |

`test/integration/golden-registry/` holds CPU vitest checks that validate the
golden registry integrity and scene coverage (no GPU), and runs with the web
integration tier. `test:integration:native` is a curated fast **subset** of
`test:native` (the latter runs the whole Rust suite: native unit + integration +
logic parity, with the GPU golden test skipping gracefully).

Handy aggregates:

- `pnpm test` — all Vitest tiers in one pass (unit + components + integration + golden-helpers); no browser, no cargo.
- `pnpm check:fast` — quick loop: static checks + unit + web integration.
- `pnpm check` — everything locally: static checks + all tiers incl. e2e and golden.
- `bash scripts/ci.sh <tier>` — the exact per-job command CI runs (`static`, `unit`, `integration-web`, `rust`, `e2e-smoke`, `e2e`, `golden-web`, `golden-native`).

For desktop-web Playwright scenarios, keep project creation as a dedicated UI flow
(`test/e2e/web/project-creation.spec.ts`). Scenario tests that need an open
project should use `e2eProject` from `test/e2e/fixtures/workspace.ts` so they
start from a prepared OPFS workspace instead of repeating the full creation path.
Base desktop-web coverage is split into focused specs for file manager, media
import, timeline add/trim/move, playback, export, and one connected editor smoke
workflow. These specs should cover only functionality available with premium and
in-development feature flags disabled.

Before running E2E tests for the first time, install the Playwright browser:

```bash
pnpm test:e2e:install
```

E2E tests use `127.0.0.1:3007` by default. Override it with
`E2E_HOST=127.0.0.1 E2E_PORT=3010 pnpm test:e2e`.
`test:e2e`, `test:e2e:smoke`, and `test:golden:web` run Playwright through
`scripts/run-playwright-with-preview.mjs`, which builds the app (skipped when
`.output/public` is already up to date — set `E2E_FORCE_BUILD=1` to force a
rebuild) and picks a free port. Playwright's own `webServer` (see
`playwright.config.ts`) then starts, readiness-polls and tears down
`scripts/static-preview-server.mjs` over `.output/public` with the required
cross-origin isolation headers — a single source of truth for the server
command lives in `scripts/lib/preview-server.mjs`. Locally, an already-running
server on the target port is reused (`reuseExistingServer`), so you can iterate
on a single spec against a warm server.

### Golden (rendered-frame) tests

Golden tests verify that the web video engine (PixiJS + WebGPU + Web Workers) and the native Tauri engine (Vello + wgpu + FFmpeg) render visually identical frames for the same scene definitions.

**Shared fixtures:**

- `shared/scenes/` — 13 timeline scenarios in `MonitorScene` JSON format (solid background, video clip, image overlay, text layer, multi-layer blend, shape layer, transformed image, multi-time video sampling, blur effect, color adjustment effect, dissolve transition, 2x speed change, cropped image)
- `shared/golden/frames.json` — golden perceptual hashes (8x8 average hash) for each scene + sample time, per engine

**Commands:**

```bash
# Run web golden tests (Playwright + WebGPU + real workers)
pnpm test:golden:web

# Run native golden tests (cargo + real ffmpeg + GPU compositor)
pnpm test:golden:native

# Run both
pnpm test:golden

# Generate/update golden hashes from the web engine
pnpm test:golden:gen

# Generate golden hashes for both engines (web + native via cargo)
pnpm test:golden:gen -- --both

# Import native golden hashes from the last cargo run
pnpm test:golden:import-native
```

**Workflow:**

1. Run `pnpm test:golden:gen` to produce web golden hashes
2. Run `pnpm test:golden:import-native` to run the native suite and import the printed `GOLDEN[native]` lines into `shared/golden/frames.json`
3. Run `pnpm test:golden` to verify both engines match their golden hashes and each other

By default these tests **skip gracefully** when WebGPU, ffmpeg, or a wgpu adapter
is unavailable (so `pnpm check` stays green on GPU-less machines). In CI they run
with `REQUIRE_WEBGPU=1` / `REQUIRE_TEST_DEPS=1`, which turns a missing adapter
into a hard failure — a green golden job must have actually rendered something.
Run them manually via `bash scripts/ci.sh golden-web` / `golden-native` when GPU is available.

### Export Testing

Export functionality is covered across three testing layers:

**Unit Tests (TS):**

- `test/unit/workers/core/export.test.ts` — `extractMetadata` (image, video, audio, error handling), `isPassthroughCompatibleClip` (gain, balance, fades, transitions, effects, speed)
- `test/unit/workers/core/export-pure.test.ts` — `selectOutputFormat` (all format mappings, MP3 rejection), `buildMetadataTags` (title/description/author/tags mapping, trimming, empty filtering), `isOpusCodec` (prefix matching, case insensitivity), extended `isPassthroughCompatibleClip` edge cases, web export progress coalescing, adaptive encoder backpressure, and WebCodecs preflight probing
- `test/integration/workers/web-export-pipeline.test.ts` — browser export orchestration for concurrent audio/video writer startup and completion progress gating
- `test/unit/workers/core/export-helpers.test.ts` — frame timing (including 29.97fps drift), clip ranges, audio duration computation
- `test/unit/composables/timeline/export/useExportProcess.test.ts` — playback guard, format resolution, platform routing (browser vs Tauri)
- `test/unit/composables/timeline/export/export-options-parity.test.ts` — `buildNativeExportOptions` web→native options mapping (range conversion, audio channels, video-enabled detection, metadata null handling, alpha/fastStart passthrough)
- `test/unit/composables/timeline/export/payloadBuilder.test.ts` — worker payload building, track filtering, clip trimming

**Rust Integration Tests:**

- `src-tauri/tests/timeline_export.rs` — end-to-end export via real ffmpeg + GPU compositor, verified with ffprobe:
  - Audio-only export (m4a) and video export (mp4, h264, solid background)
  - Image layer overlay, video layer decode→composite→encode
  - Dissolve transition between two image clips
  - Brightness effect on an image layer
  - Speed change (2x) on a video layer
  - Multi-track audio mixing (WAV + MP3)
  - WebM/VP9 export with container verification
  - Alpha export (VP9 yuva420p in WebM)
  - Video + audio combined export
  - Cancellation handling
  - Zero-duration and inverted range error handling
- `src-tauri/src/media/timeline_export/tests.rs` — FFmpeg args builder unit tests (WebM Opus forcing, VP9 alpha, MP4 metadata, CBR, CFR, audio-only, FLAC, hardware VAAPI, direct transcode path)

**Parity / Golden:**

- Cross-engine frame hash parity is covered by the parity test suite (see above)
- `buildNativeExportOptions` parity test ensures web export options map correctly to native `NativeExportOptions`

**CI:** the `.github/workflows/parity.yml` GitHub Actions workflow runs web parity in a Dockerized Playwright container and native parity on an Ubuntu runner with a software Vulkan adapter.

## Embedded Editor SDK

Fastcat can be integrated into other web applications as a portable video editor component using Shadow DOM for style isolation and OPFS for high-performance sandboxed storage.

### Features

- **Automatic Isolation**: Each editor instance uses a unique, isolated workspace folder (unless `workspaceId` is provided).
- **Auto Cleanup**: Temporary files and folders are automatically deleted when the editor is unmounted.
- **Multilingual Support**: Built-in support for multiple languages (`en-US`, `ru-RU`, `es-419`).

### Build the Library

To generate a standalone bundle, run:

```bash
pnpm build:lib
```

The output will be located in the `dist-lib/` directory:

- `fastcat-editor.es.js` — ESM module (recommended)
- `fastcat-editor.umd.js` — UMD bundle for global use
- `assets/` — Web Worker binaries and other assets

### Integration Example

1. **Include the SDK**:
   Import the ESM module and initialize the editor in a container.

```javascript
import FastcatEditor from './dist-lib/fastcat-editor.es.js';

const editor = new FastcatEditor('#editor-container');

// Assets to be preloaded into the editor's workspace.
const assets = [
  {
    url: 'https://example.com/assets/intro.mp4',
    id: 'intro-video', // Optional: Unique ID. Auto-generated if omitted.
    type: 'video', // Optional: 'video', 'audio', or 'image'.
    filename: 'intro.mp4', // Optional: Target filename.
  },
];

// Start the editor
const el = editor.init({
  assets,
  locale: 'en-US', // Optional: 'en-US' (default), 'ru-RU' or 'es-419'.
  workspaceId: 'unique-session-id', // Optional: isolate storage. Auto-generated if omitted.
});

// Handle events
el.addEventListener('fastcat:exported', (event) => {
  const { file, filename } = event.detail;
  console.log(`Exported file: ${filename}`, file);
  // ... Handle the file (download, upload, etc.)
});
```

2. **Web Component**:
   Alternatively, use the `<fastcat-editor>` custom element.

```html
<fastcat-editor id="my-editor" locale="ru-RU"></fastcat-editor>
<script type="module">
  import './dist-lib/fastcat-editor.es.js';
  const el = document.getElementById('my-editor');
  el.assets = [...]; // Assets should be set via property
</script>
```

### Security Requirements

The editor requires `SharedArrayBuffer` for high-performance video processing. For this to work, your host web server **must** provide the following security headers:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

### Developer Notes

To develop and test the embedded editor layout:

1. **Start the dev server**: `pnpm dev`
2. **Access the test page**: Open `http://localhost:3008/test/embedded`.
   - This page uses `FastcatEmbeddedLayout.vue` directly in a Nuxt context.
   - It preloads a sample asset to verify the loading logic.
3. **Core Component**: The main entry point for the embedded UI is `src/components/embedded/FastcatEmbeddedLayout.vue`.
4. **Library Build**: The library entry point is `src/index.lib.ts`.

## License

MIT
