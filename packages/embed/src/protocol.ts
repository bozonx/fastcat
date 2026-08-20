/**
 * Wire contract between an embedding host page and the FastCat editor iframe.
 *
 * This module is published as part of `@fastcat/embed` and is imported by the
 * editor through the `~embed` alias, so both sides of the boundary always
 * compile against the same definitions and can never drift apart.
 */

export const EMBED_CHANNEL = 'fastcat-embed';
export const EMBED_PROTOCOL_VERSION = 1;
export const MAX_EMBED_ASSETS = 100;
export const MAX_EMBED_ASSET_BYTES = 10 * 1024 * 1024 * 1024;
export const MAX_EMBED_EXPORT_BYTES = 10 * 1024 * 1024 * 1024;

/** Stable errors that may cross the host/editor boundary. */
export type EmbedProtocolErrorCode =
  | 'protocol-invalid-envelope'
  | 'protocol-version-mismatch'
  | 'protocol-unknown-message'
  | 'protocol-invalid-payload'
  | 'protocol-invalid-state'
  | 'protocol-timeout'
  | 'protocol-cancelled'
  | 'protocol-callback-failed';

/** Hash keys carrying the handshake parameters into the iframe document. */
const NONCE_KEY = 'fcNonce';
const ORIGIN_KEY = 'fcOrigin';

export interface EmbedCapabilities {
  webgpu: boolean;
  webcodecs: boolean;
  opfs: boolean;
  sharedArrayBuffer: boolean;
  /** Storage the browser is willing to grant, when it will say. */
  storageQuotaBytes: number | null;
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
  /** Existing timeline track id to place the asset on. */
  track?: string;
  /** Explicit insertion time in seconds. */
  startAt?: number;
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
  /**
   * Composition to start from — a host that knows it is producing a 9:16 story
   * should say so, rather than letting the first clip decide.
   */
  projectDefaults?: EmbedProjectDefaults;
  assetTransport?: EmbedAssetTransportKind;
  output?: EmbedOutputMode;
  /** A previously emitted OTIO document, restored before any new assets land. */
  initialProject?: { otio: string };
}

export interface EmbedExportMeta {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** Read back off the finished file, so it always matches the actual bytes. */
  width: number | null;
  height: number | null;
  durationMs: number | null;
  fps: number | null;
}

/** Composition settings the host wants the session to start from. */
export interface EmbedProjectDefaults {
  width?: number;
  height?: number;
  fps?: number;
  sampleRate?: number;
}

/**
 * How the editor gets at an asset's bytes. `url` reads directly over range
 * requests and is what you want; `host` is for sources that cannot be exposed
 * over CORS, or files the host already holds.
 */
export type EmbedAssetTransportKind = 'url' | 'host';

/**
 * Where a finished render goes. `blob` hands the file back over the channel;
 * `upload` streams it to a presigned URL the host supplies, which keeps very
 * large renders out of the message path entirely.
 */
export type EmbedOutputMode = 'blob' | 'upload';

/** Messages the host is allowed to send to the editor. */
export interface HostToEditorMessages {
  init: EmbedInitPayload;
  /** Adds an asset to a session that is already running. */
  'asset:add': { assets: EmbedAsset[] };
  /** A replacement URL for an asset whose signed URL expired. */
  'asset:url': { assetId: string; url: string };
  /** Answer to a `stt:request` or `llm:request`, matched by `requestId`. */
  'rpc:result': { requestId: string; result?: unknown; error?: string };
  /** Asks the editor to emit the current timeline without waiting for a debounce. */
  'save:request': undefined;
  'export:start': { filename?: string; uploadUrl?: string } | undefined;
  'export:cancel': undefined;
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
  /**
   * `file` is omitted in `upload` mode, where the editor streamed the render to
   * the host's presigned URL instead. `otio` is the timeline that produced it,
   * so the host can offer "edit again" rather than starting over.
   */
  'export:done': { file?: File; poster: Blob | null; otio: string; meta: EmbedExportMeta };
  'export:error': { message: string };
  /**
   * Cleanup finished. Sent last, after the final `change` and
   * `preferences:changed`, so a host that waits for it is guaranteed to have
   * heard everything worth keeping before the iframe goes away.
   */
  disposed: undefined;
  error: { code: string; message: string };
  /** The user asked to close the editor from inside it. */
  requestClose: undefined;
  /**
   * The editor would like a different height — the touch shell in particular
   * needs vertical room for a monitor, a timeline and its drawers. Advisory:
   * the host owns its own layout and may ignore it.
   */
  'resize-request': { minHeightPx: number };
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

export interface EmbedProtocolValidationResult {
  ok: boolean;
  code?: EmbedProtocolErrorCode;
  message?: string;
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
    typeof candidate.version === 'number' &&
    candidate.nonce === nonce &&
    typeof candidate.type === 'string'
  );
}

/** Envelope identity and protocol-version checks are deliberately separate. */
export function hasEmbedProtocolVersion(envelope: EmbedEnvelope): boolean {
  return envelope.version === EMBED_PROTOCOL_VERSION;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown, min = -Number.MAX_VALUE, max = Number.MAX_VALUE): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4_096) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function isSafeEmbedFilename(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 255 &&
    !value.includes('/') &&
    !value.includes('\\') &&
    !value.includes('..') &&
    /^[a-zA-Z0-9][a-zA-Z0-9._ -]*$/.test(value)
  );
}

function isAsset(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.id !== undefined && (typeof value.id !== 'string' || value.id.length > 128)) return false;
  if (value.url !== undefined && !isSafeHttpUrl(value.url)) return false;
  if (value.filename !== undefined && !isSafeEmbedFilename(value.filename)) return false;
  if (value.kind !== undefined && !['video', 'audio', 'image'].includes(value.kind as string)) return false;
  if (value.track !== undefined && (typeof value.track !== 'string' || value.track.length > 128)) return false;
  if (value.startAt !== undefined && !isFiniteNumber(value.startAt, 0, 86_400)) return false;
  if (value.file !== undefined && (!(value.file instanceof Blob) || value.file.size > MAX_EMBED_ASSET_BYTES)) return false;
  return (value.url !== undefined) !== (value.file !== undefined);
}

function isProjectDefaults(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  return (
    (value.width === undefined || isFiniteNumber(value.width, 16, 16_384)) &&
    (value.height === undefined || isFiniteNumber(value.height, 16, 16_384)) &&
    (value.fps === undefined || isFiniteNumber(value.fps, 1, 240)) &&
    (value.sampleRate === undefined || isFiniteNumber(value.sampleRate, 8_000, 192_000))
  );
}

function isInitPayload(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const assets = value.assets;
  return (
    (value.locale === undefined || (typeof value.locale === 'string' && value.locale.length <= 32)) &&
    (assets === undefined || (Array.isArray(assets) && assets.length <= MAX_EMBED_ASSETS && assets.every(isAsset))) &&
    (value.layout === undefined || ['auto', 'desktop', 'mobile'].includes(value.layout as string)) &&
    (value.features === undefined || (Array.isArray(value.features) && value.features.every((item) => ['files', 'sound', 'export', 'settings'].includes(item as string)))) &&
    isProjectDefaults(value.projectDefaults) &&
    (value.assetTransport === undefined || value.assetTransport === 'url' || value.assetTransport === 'host') &&
    (value.output === undefined || value.output === 'blob' || value.output === 'upload') &&
    (value.initialProject === undefined || (isRecord(value.initialProject) && isInitialOtio(value.initialProject.otio)))
  );
}

function isInitialOtio(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 10_000_000) return false;
  try {
    const document = JSON.parse(value) as { OTIO_SCHEMA?: unknown; tracks?: unknown };
    return document.OTIO_SCHEMA === 'Timeline.1' && isRecord(document.tracks);
  } catch {
    return false;
  }
}

const HOST_TYPES = new Set<HostToEditorType>([
  'init', 'asset:add', 'asset:url', 'rpc:result', 'save:request', 'export:start', 'export:cancel', 'export:ack', 'dispose',
]);
const EDITOR_TYPES = new Set<EditorToHostType>([
  'ready', 'initialized', 'asset:url-expired', 'asset:progress', 'stt:request', 'llm:request', 'change', 'preferences:changed', 'export:progress', 'export:done', 'export:error', 'disposed', 'error', 'requestClose', 'resize-request',
]);

function validPayload(type: string, payload: unknown, direction: 'host' | 'editor'): boolean {
  if (payload === undefined) return ['save:request', 'export:cancel', 'export:ack', 'dispose', 'disposed', 'requestClose'].includes(type);
  if (type === 'init') return isInitPayload(payload);
  if (type === 'asset:add') return isRecord(payload) && Array.isArray(payload.assets) && payload.assets.length <= MAX_EMBED_ASSETS && payload.assets.every(isAsset);
  if (type === 'asset:url') return isRecord(payload) && typeof payload.assetId === 'string' && isSafeHttpUrl(payload.url);
  if (type === 'export:start') return isRecord(payload) && (payload.filename === undefined || isSafeEmbedFilename(payload.filename)) && (payload.uploadUrl === undefined || isSafeHttpUrl(payload.uploadUrl));
  if (type === 'rpc:result') return isRecord(payload) && typeof payload.requestId === 'string' && payload.requestId.length <= 128 && (payload.error === undefined || typeof payload.error === 'string');
  if (type === 'ready') return isRecord(payload) && typeof payload.version === 'number' && isRecord(payload.capabilities) &&
    typeof payload.capabilities.webgpu === 'boolean' && typeof payload.capabilities.webcodecs === 'boolean' &&
    typeof payload.capabilities.opfs === 'boolean' && typeof payload.capabilities.sharedArrayBuffer === 'boolean' &&
    (payload.capabilities.storageQuotaBytes === null || isFiniteNumber(payload.capabilities.storageQuotaBytes, 0));
  if (type === 'initialized') return isRecord(payload) && isFiniteNumber(payload.assetCount, 0, MAX_EMBED_ASSETS) && isFiniteNumber(payload.durationMs, 0) && ['desktop', 'mobile'].includes(payload.layout as string) && isFiniteNumber(payload.reclaimedSessions, 0);
  if (type === 'asset:url-expired') return isRecord(payload) && typeof payload.assetId === 'string';
  if (type === 'asset:progress') return isRecord(payload) && typeof payload.assetId === 'string' && isFiniteNumber(payload.loadedBytes, 0) && (payload.totalBytes === null || isFiniteNumber(payload.totalBytes, 0));
  if (type === 'stt:request' || type === 'llm:request') return isRecord(payload) && typeof payload.requestId === 'string';
  if (type === 'change') return isRecord(payload) && typeof payload.dirty === 'boolean' && typeof payload.otio === 'string' && payload.otio.length <= 10_000_000;
  if (type === 'export:progress') return isRecord(payload) && (payload.phase === null || typeof payload.phase === 'string') && isFiniteNumber(payload.progress, 0, 1);
  if (type === 'export:error') return isRecord(payload) && typeof payload.message === 'string';
  if (type === 'error') return isRecord(payload) && typeof payload.code === 'string' && typeof payload.message === 'string';
  if (type === 'resize-request') return isRecord(payload) && isFiniteNumber(payload.minHeightPx, 100, 10_000);
  if (type === 'export:done') return isRecord(payload) && typeof payload.otio === 'string' && payload.otio.length <= 10_000_000 &&
    (payload.file === undefined || payload.file instanceof Blob) && (payload.poster === null || payload.poster instanceof Blob) &&
    isRecord(payload.meta) && isSafeEmbedFilename(payload.meta.filename) && typeof payload.meta.mimeType === 'string' &&
    isFiniteNumber(payload.meta.sizeBytes, 0, MAX_EMBED_EXPORT_BYTES) &&
    (payload.meta.width === null || isFiniteNumber(payload.meta.width, 1, 16_384)) &&
    (payload.meta.height === null || isFiniteNumber(payload.meta.height, 1, 16_384)) &&
    (payload.meta.durationMs === null || isFiniteNumber(payload.meta.durationMs, 0)) &&
    (payload.meta.fps === null || isFiniteNumber(payload.meta.fps, 1, 240));
  return direction === 'editor' && type === 'preferences:changed';
}

export function validateEmbedMessage(
  direction: 'host' | 'editor',
  type: string,
  payload: unknown,
): EmbedProtocolValidationResult {
  const known = direction === 'host' ? HOST_TYPES.has(type as HostToEditorType) : EDITOR_TYPES.has(type as EditorToHostType);
  if (!known) return { ok: false, code: 'protocol-unknown-message', message: `Unknown ${direction} message: ${type}` };
  if (!validPayload(type, payload, direction)) return { ok: false, code: 'protocol-invalid-payload', message: `Invalid payload for ${type}` };
  return { ok: true };
}

export function createEnvelope(nonce: string, type: string, payload: unknown): EmbedEnvelope {
  return { channel: EMBED_CHANNEL, version: EMBED_PROTOCOL_VERSION, nonce, type, payload };
}
