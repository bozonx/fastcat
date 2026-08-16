/**
 * Wire contract between an embedding host page and the FastCat editor iframe.
 *
 * This module is published as part of `@fastcat/embed` and is imported by the
 * editor through the `~embed` alias, so both sides of the boundary always
 * compile against the same definitions and can never drift apart.
 */

export const EMBED_CHANNEL = 'fastcat-embed';
export const EMBED_PROTOCOL_VERSION = 1;

/** Hash keys carrying the handshake parameters into the iframe document. */
const NONCE_KEY = 'fcNonce';
const ORIGIN_KEY = 'fcOrigin';

export interface EmbedCapabilities {
  webgpu: boolean;
  webcodecs: boolean;
  opfs: boolean;
  sharedArrayBuffer: boolean;
}

export type EmbedAssetKind = 'video' | 'audio' | 'image';

export interface EmbedAsset {
  id?: string;
  /** Required for the `url` transport; ignored for `host`. */
  url?: string;
  /**
   * The asset's bytes, when the host already holds them — a file the user just
   * picked, or a source it cannot expose over CORS.
   */
  file?: File;
  kind?: EmbedAssetKind;
  filename?: string;
}

/** Optional capabilities a host switches on for the session. */
export type EmbedFeatureName = 'files' | 'sound' | 'export' | 'settings';

export type EmbedLayoutPreference = 'auto' | 'desktop' | 'mobile';

export interface EmbedInitPayload {
  locale?: string;
  assets?: EmbedAsset[];
  /**
   * `auto` (the default) decides once from the iframe's first measured size and
   * never re-decides on its own: a shell that flipped mid-session would discard
   * the user's arrangement every time the host resized its container.
   */
  layout?: EmbedLayoutPreference;
  /**
   * Anything beyond the timeline and an export must be asked for. Unknown names
   * are ignored rather than rejected, so a newer host still talks to an older
   * editor.
   */
  features?: EmbedFeatureName[];
  /**
   * Preferences this host stored from an earlier session, exactly as the editor
   * emitted them. Opaque to the host: it keeps the blob, it does not read it.
   */
  preferences?: unknown;
}

export interface EmbedExportMeta {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

/** Messages the host is allowed to send to the editor. */
export interface HostToEditorMessages {
  init: EmbedInitPayload;
  /** A replacement URL for an asset whose signed URL expired. */
  'asset:url': { assetId: string; url: string };
  /** Answer to a `stt:request` or `llm:request`, matched by `requestId`. */
  'rpc:result': { requestId: string; result?: unknown; error?: string };
  /** Asks the editor to emit the current timeline without waiting for a debounce. */
  'save:request': undefined;
  'export:start': { filename?: string } | undefined;
  'export:ack': undefined;
  dispose: undefined;
}

/** Messages the editor is allowed to send to the host. */
export interface EditorToHostMessages {
  ready: { version: number; capabilities: EmbedCapabilities };
  initialized: {
    assetCount: number;
    durationMs: number;
    layout: 'desktop' | 'mobile';
    /**
     * Storage belonging to earlier sessions that this one reclaimed on the way
     * in. Non-zero means previous sessions ended without a `dispose` — useful
     * for spotting hosts that tear the iframe down abruptly.
     */
    reclaimedSessions: number;
  };
  /**
   * The current URL for this asset stopped authorising. The host is expected to
   * answer with `asset:url`; reads resume from where they stopped.
   */
  'asset:url-expired': { assetId: string };
  'asset:progress': { assetId: string; loadedBytes: number; totalBytes: number | null };
  /**
   * Work the host must run on the editor's behalf, because the host owns the
   * credentials. Answer with `rpc:result` carrying the same `requestId`.
   */
  'stt:request': { requestId: string; payload: unknown };
  'llm:request': { requestId: string; payload: unknown };
  /**
   * The timeline changed. `otio` is the full document, so a host can keep a
   * draft and reopen it later; `dirty` says whether it differs from the last
   * state the host acknowledged.
   */
  change: { dirty: boolean; otio: string };
  /** Preferences worth storing against the user's profile. Treat as opaque. */
  'preferences:changed': unknown;
  'export:progress': { phase: string | null; progress: number };
  'export:done': { file: File; meta: EmbedExportMeta };
  'export:error': { message: string };
  /**
   * Cleanup finished. Sent last, after the final `change` and
   * `preferences:changed`, so a host that waits for it is guaranteed to have
   * heard everything worth keeping before the iframe goes away.
   */
  disposed: undefined;
  error: { code: string; message: string };
  requestClose: undefined;
}

export type HostToEditorType = keyof HostToEditorMessages;
export type EditorToHostType = keyof EditorToHostMessages;

export interface EmbedEnvelope<T extends string = string> {
  channel: typeof EMBED_CHANNEL;
  version: number;
  nonce: string;
  type: T;
  payload: unknown;
}

export interface EmbedHandshakeParams {
  nonce: string;
  hostOrigin: string;
}

/**
 * Both sides pin every `postMessage` to a single expected origin, so a page
 * that merely guesses the iframe URL still cannot talk to the editor. The nonce
 * additionally scopes the channel to one embed instance on pages hosting more
 * than one.
 */
export function createEmbedNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function buildEmbedUrl(editorUrl: string, params: EmbedHandshakeParams): string {
  const url = new URL(editorUrl, globalThis.location?.href);
  const hash = new URLSearchParams();
  hash.set(NONCE_KEY, params.nonce);
  hash.set(ORIGIN_KEY, params.hostOrigin);
  url.hash = hash.toString();
  return url.toString();
}

export function parseEmbedHandshakeParams(hash: string): EmbedHandshakeParams | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return null;

  const parsed = new URLSearchParams(raw);
  const nonce = parsed.get(NONCE_KEY);
  const hostOrigin = parsed.get(ORIGIN_KEY);
  if (!nonce || !hostOrigin) return null;

  // A malformed origin would otherwise become a `postMessage` target we cannot
  // reason about; reject it rather than falling back to a wildcard.
  try {
    if (new URL(hostOrigin).origin !== hostOrigin) return null;
  } catch {
    return null;
  }

  return { nonce, hostOrigin };
}

export function isEmbedEnvelope(data: unknown, nonce: string): data is EmbedEnvelope {
  if (typeof data !== 'object' || data === null) return false;
  const candidate = data as Partial<EmbedEnvelope>;
  return (
    candidate.channel === EMBED_CHANNEL &&
    candidate.version === EMBED_PROTOCOL_VERSION &&
    candidate.nonce === nonce &&
    typeof candidate.type === 'string'
  );
}

export function createEnvelope(nonce: string, type: string, payload: unknown): EmbedEnvelope {
  return { channel: EMBED_CHANNEL, version: EMBED_PROTOCOL_VERSION, nonce, type, payload };
}
