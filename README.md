# Gran Video Editor

Standalone video editor project extracted from Gran Publicador.

## Features

- Timeline editing with multi-track composition
- SVG images are rasterized to PNG on import for reliable worker rendering
- Monitor playback with volume/mute controls for audio
- Focus-aware panel hotkeys with routing to the currently active editor panel
- File system access API integration for local file editing
- Gran Publicador integration settings with connect flow and manual API override support
- Remote file browser mode backed by Gran Publicador VFS in the middle file manager panel
- Remote-to-local download by drag-and-drop from remote files into the local folder tree
- Local-to-remote upload action with remote folder picker and cancelable transfer progress modal
- External service health checks for Gran Publicador, Files API and STT API
- OTIO (OpenTimelineIO) support for timeline serialization
- High-performance rendering with Web Workers

## Tech Stack

- [Nuxt 4](https://nuxt.com/)
- [Nuxt UI](https://ui.nuxt.com/)
- [PixiJS 8](https://pixijs.com/)
- [Mediabunny](https://github.com/lucasferreira/mediabunny)
- [Pinia](https://pinia.vuejs.org/)

## Setup

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build for production
pnpm build
```

## Architecture

- `src/components`: UI components of the editor.
- `src/stores`: Application state management (Pinia).
- `src/timeline`: Core timeline logic and OTIO serialization.
- `src/composables/monitor`: Monitor composables (timeline, playback, core orchestration).
- `src/utils/video-editor`: Video composition and worker client logic.
- Clip transforms use a shared layout helper in `src/utils/video-editor/clip-layout.ts` so monitor overlays and compositor rendering resolve the same anchor, fit and translation math.
- Clip transform `position` values are stored in 1920x1080 design-space units and are scaled to the active preview/export resolution during layout.
- Text clip style sizing (`width`, `fontSize`, `padding`, `letterSpacing`) is normalized before persistence and scaled from the same design-space baseline during rendering.
- `src/utils/dev-logger.ts`: Dev-only logger for verbose diagnostics (disabled in production).
- `src/workers`: Web Workers for heavy lifting (video decoding/encoding).

## Workspace data

The editor stores temporary/generated files inside the selected workspace folder under `vardata/`.

Each project has a stable `projectId` stored in `projects/<projectName>/.gran/project.meta.json`.
This ID is used as the folder key for project-scoped temporary data.

Layout:

- `vardata/projects/<projectId>/proxies` — generated proxy media for the project
- `vardata/projects/<projectId>/thumbnails` — generated thumbnails for the project
- `vardata/projects/<projectId>/cache` — cached metadata and other project-scoped data
- `vardata/projects/<projectId>/cache/transcriptions` — cached STT responses for audio files

You can clear temporary files from the UI:

- **Workspace settings → Storage → Clear temporary files** — deletes `vardata/`
- **Project settings → Storage → Clear temporary files** — deletes `vardata/projects/<projectId>`

## External integrations

Editor settings now include an **Integrations** section for external services.

Supported configuration modes:

- **Gran Publicador** via connect flow or manual bearer token
- **Manual Files API** with `baseUrl` and bearer token
- **Manual STT API** with `baseUrl` (bearer token is optional)

Current implementation scope:

- settings and provider resolution
- connect flow token capture via `?token=...`
- auto-connect URL generation from `GPAN_PUBLICADOR_BASE_URL`
- connect app name from a global constant
- connect flow `scopes` generation based on active Files/STT overrides
- provider override rules for `Files API` and `STT API`
- `GET /api/v1/external/health` checks for Gran Publicador and resolved manual services
- audio file transcription from the properties panel via `POST .../api/v1/transcribe/stream`
- shared STT request settings: `provider`, `models`, `restorePunctuation`, `formatText`, `includeWords`
- transcription cache in `vardata/projects/<projectId>/cache/transcriptions`

Provider priority rules:

- if Gran Publicador is enabled and has a token, it is the default source
- manual `Files API` or `STT API` can override Gran independently
- if Gran is not configured, manual services work standalone

Requested Gran scopes:

- `vfs:read`
- `stt:transcribe`

The editor requests only scopes that still need to be served by Gran Publicador.
If a manual Files or STT service explicitly overrides Gran, the related scope is omitted from the connect flow.

Notes:

- `GPAN_PUBLICADOR_BASE_URL` defines the Gran Publicador instance URL for connect flow and API resolution
- Gran connect app name is fixed globally and is not editable in user settings
- user integration settings are stored in `.gran/user.settings.json`
- manual STT `baseUrl` may point to the service root, `/api/v1`, `/api/v1/external/stt`, or the full `/api/v1/transcribe/stream` endpoint
- Gran STT streaming uses `POST /api/v1/external/api/v1/transcribe/stream`

### Audio transcription

Local audio files expose a **Transcribe audio** action in the file properties panel.

Behavior:

- the modal allows an optional language override per request
- requests use raw audio upload to the resolved STT stream endpoint
- the editor sends `X-STT-Provider`, `X-STT-Language`, `X-STT-Restore-Punctuation`, `X-STT-Format-Text`, `X-STT-Include-Words`, and `X-STT-Models` when configured
- `restorePunctuation` defaults to `true`
- `formatText` defaults to `false`
- `includeWords` defaults to `true`
- successful responses are cached per file/version/request settings in `vardata/projects/<projectId>/cache/transcriptions`

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

## License

MIT
