# Gran Video Editor

Standalone video editor project extracted from Gran Publicador.

## Features

- Browser-based video editing using WebCodecs and PixiJS
- Timeline with multiple tracks (video/audio)
- File system access API integration for local file editing
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
- `src/utils/video-editor`: Video composition and worker client logic.
- `src/workers`: Web Workers for heavy lifting (video decoding/encoding).

## License

MIT
