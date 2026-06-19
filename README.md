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
- Remote-to-local download by drag-and-drop from remote files into the local folder tree
- Local-to-remote upload action with remote folder picker and cancelable transfer progress modal
- External service health checks for FastCat, Files API and STT API
- OTIO (OpenTimelineIO) support for timeline serialization
- Automatic timeline backups with rotating versioning (default 5 versions) to prevent data loss
- Offloaded timeline serialization to Web Workers to ensure smooth UI during periodic auto-saves
- High-performance rendering with Web Workers

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

Workers receive the budget buffer via an `io-init` postMessage immediately after creation. Fallback `LocalBudget` is used when `SharedArrayBuffer` is unavailable.

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

The application will be available at `http://localhost:3000`.

## Desktop (Tauri)

- Desktop mode uses Tauri 2 with `@tauri-apps/plugin-fs` for file system access.
- File streaming in desktop mode uses `tauri-plugin-fs-stream` and `tauri-plugin-fs-stream-api`.
- Desktop workspace folders are restored from app settings and added to the runtime FS scope after startup without granting the whole home directory.
- The Rust desktop crate targets Rust `1.87.0` because the native video rendering engine foundation uses `wgpu` 29.
- The `webgpu_render_engine_status` Tauri command probes native `wgpu` adapter/device availability and is the entry point for the upcoming Rust WebGPU renderer.
- The native Tauri monitor renders media, SVG, background, text, and shape timeline layers through the Rust video core. Preview video frames use a YUV fast-path where supported: FFmpeg frames are kept as NV12-style Y/UV planes, uploaded as `R8Unorm`/`Rg8Unorm`, and converted to RGBA by a small GPU pass before entering the existing Vello texture path. SVG files are rasterized with `resvg` at the target preview/export resolution, while text/shapes/blend modes, dissolve fades, and adjacent two-clip shader transitions are composed in the Vello scene used by the monitor preview and native video export. Non-dissolve native shader transitions currently require an adjacent source clip; unsupported legacy transition modes are skipped with export/monitor warnings instead of silently rendering incorrectly. The web editor fonts loaded from Google Fonts are not bundled into Rust yet; to make them deterministic in native text rendering, bundle the matching `.ttf`/`.otf` files with the app and load them into the native font database before creating text layouts.
- Video effects use the shared WGSL compute shader in `shared/effects/effect.wgsl` for both web preview and Tauri native rendering/export. Effect manifests expose `paramRanges` with separate UI, animation, and renderer hard-cap ranges so future keyframe controls can allow larger artistic values without removing GPU safety limits.
- The web compositor now supports the same multi-pass effects as the native Tauri backend, including `blur-fill`, `bloom`, and `gaussian-blur`. Master effects, adjustment-layer effects, and effects on image, text, shape, and solid clips are all processed through the WebGPU compute pipeline.
- Desktop FFmpeg hardware acceleration settings are applied to native monitor decode, native timeline export source decode, thumbnails, proxy generation, and conversion. On Linux, VAAPI uses the configured render node, defaulting to `/dev/dri/renderD128`.
- Desktop audio extraction uses the native FFmpeg task pipeline and copies the primary audio stream into a sidecar audio file without re-encoding when the target container supports it.
- Set `FASTCAT_RENDER_TIMING=1` when running the Tauri app to log native compositor stage timings (`materialize`, `build_vello`, `render`, total) for preview and offscreen pixel renders. Initial cold-start GPU/Vello warmup frames are logged separately and excluded from the running average.
- The monitor supports `smooth`, `balanced`, and `strict` audio/video sync modes in both web and native Tauri preview paths. `balanced` is the default and gives the video decoder a wider catch-up window than strict frame dropping.
- The native monitor decoded-frame cache is configurable in video settings (`Auto`, `Low`, `Balanced`, `High`, `Custom`). `Auto` sizes the per-layer cache from preview resolution and FPS with a 512 MB cap; `Custom` accepts `0 MB` to disable the rotating cache window while retaining only the current display frame.
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
- Text clip style sizing (`width`, `fontSize`, `padding`, `letterSpacing`) is normalized before persistence and scaled from the same design-space baseline during rendering.
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

## Testing

The project uses a structured testing approach:

- **Unit Tests** (`test/unit/`): Logic and utilities. Run via `pnpm test:unit`.
- **Component Tests** (`test/components/`): Vue component rendering and behavior. Run via `pnpm test:unit`.
- **Integration Tests** (`test/integration/`): Complex interactions between modules. Run via `pnpm test:unit`.
- **E2E Tests** (`test/e2e/`): Full application flows in the browser. Run via `pnpm test:e2e`.

Before running E2E tests for the first time, install the Playwright browser:

```bash
pnpm test:e2e:install
```

E2E tests use port `3008` by default. Override it with `E2E_PORT=3010 pnpm test:e2e`.
Set `PLAYWRIGHT_REUSE_SERVER=1` only when you intentionally want to run against an existing local server.
In CI, Playwright runs against `pnpm build` + `vite preview` over `.output/public`.

## Embedded Editor SDK

Fastcat can be integrated into other web applications as a portable video editor component using Shadow DOM for style isolation and OPFS for high-performance sandboxed storage.

### Features

- **Automatic Isolation**: Each editor instance uses a unique, isolated workspace folder (unless `workspaceId` is provided).
- **Auto Cleanup**: Temporary files and folders are automatically deleted when the editor is unmounted.
- **Multilingual Support**: Built-in support for multiple languages (`en-US`, `ru-RU`).

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
  locale: 'en-US', // Optional: 'en-US' (default) or 'ru-RU'.
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
2. **Access the test page**: Open `http://localhost:3000/test/embedded`.
   - This page uses `FastcatEmbeddedLayout.vue` directly in a Nuxt context.
   - It preloads a sample asset to verify the loading logic.
3. **Core Component**: The main entry point for the embedded UI is `src/components/embedded/FastcatEmbeddedLayout.vue`.
4. **Library Build**: The library entry point is `src/index.lib.ts`.

## License

MIT
