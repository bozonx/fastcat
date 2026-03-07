# Gran Video Editor

Standalone video editor project extracted from Gran Publicador.

## Features

- Browser-based video editing using WebCodecs and PixiJS
- Timeline with multiple tracks (video/audio)
- SVG images are rasterized to PNG on import for reliable worker rendering
- Monitor playback with volume/mute controls for audio
- Focus-aware panel hotkeys with routing to the currently active editor panel
- File system access API integration for local file editing
- Gran Publicador integration settings with connect flow and manual API override support
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

You can clear temporary files from the UI:

- **Workspace settings → Storage → Clear temporary files** — deletes `vardata/`
- **Project settings → Storage → Clear temporary files** — deletes `vardata/projects/<projectId>`

## External integrations

Editor settings now include an **Integrations** section for external services.

Supported configuration modes:

- **Gran Publicador** via connect flow or manual bearer token
- **Manual Files API** with `baseUrl` and bearer token
- **Manual STT API** with `baseUrl` and bearer token

Current implementation scope:

- settings and provider resolution
- connect flow token capture via `?token=...`
- connect flow `scopes` generation based on active Files/STT overrides
- provider override rules for `Files API` and `STT API`
- `GET /api/v1/external/health` checks for Gran Publicador and resolved manual services

Provider priority rules:

- if Gran Publicador is enabled and has `baseUrl` + token, it is the default source
- manual `Files API` or `STT API` can override Gran independently
- if Gran is not configured, manual services work standalone

Requested Gran scopes:

- `vfs:read`
- `vfs:write`
- `stt:transcribe`

The editor requests only scopes that still need to be served by Gran Publicador.
If a manual Files or STT service explicitly overrides Gran, the related scope is omitted from the connect flow.

Notes:

- user integration settings are stored in `.gran/user.settings.json`
- current implementation does **not** yet embed these integrations into the file manager, export upload flow, or STT UI actions

## Panel focus and keyboard routing

- Hotkeys are routed to the currently focused panel instead of being handled globally by every visible panel.
- In `Cut` and `Sound` views, `Tab` switches focus between the main editing panels and returns focus from side panels to the last active main panel.
- In `Files` and `Export` views, `Tab` is not used for panel switching, but the focused panel still controls which hotkeys are allowed.
- Fullscreen preview and modal dialogs block panel focus routing and `Tab` switching.
- `Backspace` closes the currently focused detached panel in `Cut` view and restores focus to the last active main panel.
- Text inputs and text editors keep their native keyboard behavior and do not receive editor hotkeys.

## License

MIT
