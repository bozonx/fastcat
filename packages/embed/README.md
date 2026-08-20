# @fastcat/embed

Official JavaScript / TypeScript SDK for embedding the **FastCat Video Editor** into any web application through a secure, sandboxed iframe.

[![npm version](https://img.shields.io/npm/v/@fastcat/embed.svg)](https://www.npmjs.com/package/@fastcat/embed)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Overview

`@fastcat/embed` is a zero-dependency, lightweight host-side library that manages the lifecycle of the FastCat editor iframe, handles cryptographic origin and nonce verification, and provides a strictly typed message boundary between your host application and the editor.

The editor itself runs in an isolated iframe (hosted on your domain or FastCat Cloud), while your host page controls initial configuration, media feeding, export triggers, and event listening.

---

## Installation

```bash
# npm
npm install @fastcat/embed

# pnpm
pnpm add @fastcat/embed

# yarn
yarn add @fastcat/embed
```

---

## Quick Start

```typescript
import { createFastcatEmbed, type FastcatEmbed } from '@fastcat/embed';

const container = document.getElementById('editor-container')!;

const embed: FastcatEmbed = createFastcatEmbed({
  container,
  editorUrl: 'https://embed.fastcat.video/embed',
  locale: 'en',
  layout: 'desktop', // 'auto' | 'desktop' | 'mobile'
  features: ['export', 'files', 'sound'],
  assets: [
    {
      id: 'clip-1',
      kind: 'video',
      url: 'https://cdn.example.com/videos/intro.mp4',
      filename: 'intro.mp4',
    },
  ],
  onReady: (capabilities) => {
    console.log('Editor ready with capabilities:', capabilities);
  },
  onChange: ({ dirty, otio }) => {
    console.log('Timeline changed (unsaved draft):', { dirty, otio });
  },
  onExportProgress: ({ phase, progress }) => {
    console.log(`Export progress (${phase}): ${Math.round(progress * 100)}%`);
  },
  onExportDone: async (result) => {
    console.log('Export finished:', result.meta);
    if (result.file) {
      // Stream or upload the resulting File
      const downloadUrl = URL.createObjectURL(result.file);
      window.open(downloadUrl);
    }
  },
  onError: (err) => {
    console.error('Editor error:', err);
  },
});

// Programmatic actions
// embed.startExport({ filename: 'my-video.mp4' });
// embed.addAssets([{ url: 'https://cdn.example.com/audio.mp3', kind: 'audio' }]);
// await embed.dispose();
```

---

## API Reference

### `createFastcatEmbed(options: FastcatEmbedOptions): FastcatEmbed`

Mounts the editor iframe into `options.container`, initiates the secure handshake, and returns a controller handle.

#### `FastcatEmbedOptions`

| Option            | Type                              | Default               | Description                                                                              |
| :---------------- | :-------------------------------- | :-------------------- | :--------------------------------------------------------------------------------------- |
| `container`       | `HTMLElement`                     | _required_            | The DOM element where the iframe is appended.                                            |
| `editorUrl`       | `string`                          | _required_            | Absolute URL of the editor embed route (e.g. `https://embed.fastcat.video/embed`).       |
| `assets`          | `EmbedAsset[]`                    | `[]`                  | Initial media assets loaded into the editor session.                                     |
| `locale`          | `string`                          | `'en'`                | Interface language code (e.g. `'en'`, `'ru'`).                                           |
| `layout`          | `'auto' \| 'desktop' \| 'mobile'` | `'auto'`              | Preferred editor layout. `'auto'` selects automatically on first render.                 |
| `features`        | `EmbedFeatureName[]`              | `['export']`          | Enabled feature panels: `'files'`, `'sound'`, `'export'`, `'settings'`.                  |
| `projectDefaults` | `EmbedProjectDefaults`            | `undefined`           | Composition dimensions, FPS, and sample rate overrides.                                  |
| `assetTransport`  | `'url' \| 'host'`                 | `'url'`               | `'url'` streams assets via HTTP range requests; `'host'` uses in-memory transfers.       |
| `output`          | `'blob' \| 'upload'`              | `'blob'`              | `'blob'` returns `File` in `onExportDone`; `'upload'` streams directly to presigned URL. |
| `preferences`     | `unknown`                         | `undefined`           | Opaque state from a previous session (`onPreferencesChanged`).                           |
| `readyTimeoutMs`  | `number`                          | `20000`               | Timeout in milliseconds before `onUnavailable` is called.                                |
| `sandbox`         | `string`                          | `undefined`           | Custom iframe `sandbox` attribute value if needed.                                       |
| `allow`           | `string`                          | `DEFAULT_EMBED_ALLOW` | Iframe feature policy (`fullscreen; clipboard-write; autoplay; ...`).                    |

#### Event Callbacks

| Callback               | Signature                                                                                  | Description                                                                    |
| :--------------------- | :----------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------- |
| `onReady`              | `(capabilities: EmbedCapabilities) => void`                                                | Called after handshake confirms hardware capabilities (WebGPU, OPFS, etc.).    |
| `onInitialized`        | `(info: EmbedInitializedInfo) => void`                                                     | Called once initial assets and timeline are loaded.                            |
| `onChange`             | `(change: { dirty: boolean; otio: string }) => void`                                       | Emitted when timeline edits occur. Save `otio` to preserve user draft.         |
| `onExportProgress`     | `(progress: { phase: string \| null; progress: number }) => void`                          | Real-time rendering progress updates.                                          |
| `onExportDone`         | `(result: FastcatEmbedExportResult) => void \| Promise<void>`                              | Export completed. Contains output `file`, `poster`, `otio`, and `meta`.        |
| `onAssetProgress`      | `(progress: { assetId: string; loadedBytes: number; totalBytes: number \| null }) => void` | Asset buffering and fetch progress.                                            |
| `onAssetUrlExpired`    | `(assetId: string) => Promise<string> \| string`                                           | Invoked when signed asset URL expires mid-session. Return fresh URL to resume. |
| `onPreferencesChanged` | `(preferences: unknown) => void`                                                           | Opaque user settings to store in host database.                                |
| `onSttRequest`         | `(payload: unknown) => Promise<unknown>`                                                   | Handle speech-to-text proxy requests using host credentials.                   |
| `onLlmRequest`         | `(payload: unknown) => Promise<unknown>`                                                   | Handle LLM/AI requests using host credentials.                                 |
| `onError`              | `(error: { code: string; message: string }) => void`                                       | Error notification from editor.                                                |
| `onRequestClose`       | `() => void`                                                                               | User clicked the close/exit button inside the editor.                          |
| `onResizeRequest`      | `(request: { minHeightPx: number }) => void`                                               | Advisory request for more vertical viewport space.                             |
| `onUnavailable`        | `(reason: string) => void`                                                                 | Handshake timed out or protocol version mismatch.                              |
| `onDebug`              | `(direction: 'in' \| 'out', type: string, payload: unknown) => void`                       | Low-level message logger for debugging.                                        |

---

### Instance Methods (`FastcatEmbed`)

```typescript
export interface FastcatEmbed {
  /** The created HTMLIFrameElement mounted in container. */
  readonly iframe: HTMLIFrameElement;
  /** Triggers video rendering. */
  startExport: (options?: { filename?: string; uploadUrl?: string }) => void;
  /** Cancels an ongoing render. */
  cancelExport: () => void;
  /** Adds new assets into an active session. */
  addAssets: (assets: EmbedAsset[]) => void;
  /** Requests the editor to emit current timeline immediately (bypassing debounce). */
  requestSave: () => void;
  /** Gracefully tears down iframe and cleans up storage. */
  dispose: () => Promise<void>;
}
```

---

## Direct Protocol Import

If you are building custom host adapters and only need types and message envelope utilities:

```typescript
import {
  EMBED_PROTOCOL_VERSION,
  buildEmbedUrl,
  createEmbedNonce,
  isEmbedEnvelope,
  type EmbedAsset,
  type EmbedCapabilities,
  type HostToEditorMessages,
  type EditorToHostMessages,
} from '@fastcat/embed/protocol';
```

---

## Security & Architecture

1. **Origin Verification & Cryptographic Nonce**:
   During initialization, `@fastcat/embed` generates a 128-bit cryptographic nonce and supplies the host origin via URL hash parameters. Both the host and the editor verify each other's origins and nonce on every `postMessage` envelope.
2. **Iframe Isolation**:
   The host application does not require cross-origin isolation (COOP/COEP headers), making integration safe for host sites that load third-party scripts.
3. **Hardware Acceleration**:
   The editor utilizes WebGPU, WebCodecs, and OPFS for real-time timeline compositing and zero-lag rendering.

---

## Browser Support

| Browser                      | Supported Versions | Notes                                               |
| :--------------------------- | :----------------- | :-------------------------------------------------- |
| **Google Chrome / Chromium** | 113+               | Full WebGPU + WebCodecs hardware acceleration       |
| **Microsoft Edge**           | 113+               | Full WebGPU + WebCodecs hardware acceleration       |
| **Apple Safari**             | 17+                | WebCodecs + WebGPU support                          |
| **Mozilla Firefox**          | 120+               | WebCodecs enabled; WebGPU subject to platform flags |

---

## License

[MIT](LICENSE) © FastCat Team
