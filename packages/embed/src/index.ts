import {
  buildEmbedUrl,
  createEmbedNonce,
  createEnvelope,
  hasEmbedProtocolVersion,
  isEmbedEnvelope,
  isSafeEmbedFilename,
  validateEmbedMessage,
  EMBED_PROTOCOL_VERSION,
  type EditorToHostMessages,
  type EmbedAsset,
  type EmbedCapabilities,
  type EmbedExportMeta,
  type EmbedAssetTransportKind,
  type EmbedFeatureName,
  type EmbedLayoutPreference,
  type EmbedOutputMode,
  type EmbedProjectDefaults,
  type HostToEditorMessages,
  type HostToEditorType,
} from './protocol.js';

export * from './protocol.js';

export interface FastcatEmbedExportResult {
  file?: File;
  poster: Blob | null;
  otio: string;
  meta: EmbedExportMeta;
}

export type FastcatEmbedState =
  | 'creating'
  | 'ready'
  | 'initialized'
  | 'active'
  | 'exporting'
  | 'disposing'
  | 'disposed'
  | 'unavailable'
  | 'error';

export const DEFAULT_EMBED_ALLOW =
  'fullscreen; clipboard-read; clipboard-write; autoplay; cross-origin-isolated';

export interface FastcatEmbedOptions {
  container: HTMLElement;
  editorUrl: string;
  allow?: string;
  /** Sandboxing with an opaque origin is incompatible with OPFS. */
  sandbox?: string;
  assets?: EmbedAsset[];
  locale?: string;
  preferences?: unknown;
  layout?: EmbedLayoutPreference;
  features?: EmbedFeatureName[];
  projectDefaults?: EmbedProjectDefaults;
  initialProject?: { otio: string };
  assetTransport?: EmbedAssetTransportKind;
  output?: EmbedOutputMode;
  readyTimeoutMs?: number;
  initializedTimeoutMs?: number;
  rpcTimeoutMs?: number;
  exportAckTimeoutMs?: number;
  onReady?: (capabilities: EmbedCapabilities) => void;
  onInitialized?: (info: EditorToHostMessages['initialized']) => void;
  onExportProgress?: (progress: EditorToHostMessages['export:progress']) => void;
  onAssetProgress?: (progress: EditorToHostMessages['asset:progress']) => void;
  onAssetUrlExpired?: (assetId: string) => Promise<string> | string;
  onChange?: (change: EditorToHostMessages['change']) => void;
  onPreferencesChanged?: (preferences: unknown) => void;
  onSttRequest?: (payload: unknown) => Promise<unknown>;
  onLlmRequest?: (payload: unknown) => Promise<unknown>;
  onExportDone?: (result: FastcatEmbedExportResult) => void | Promise<void>;
  onError?: (error: { code: string; message: string }) => void;
  onRequestClose?: () => void;
  onResizeRequest?: (request: EditorToHostMessages['resize-request']) => void;
  onUnavailable?: (reason: string) => void;
  onDebug?: (direction: 'in' | 'out', type: string, payload: unknown) => void;
}

export interface FastcatEmbed {
  readonly iframe: HTMLIFrameElement;
  readonly state: FastcatEmbedState;
  readonly ready: Promise<EmbedCapabilities>;
  readonly initialized: Promise<EditorToHostMessages['initialized']>;
  startExport: (options?: { filename?: string; uploadUrl?: string }) => void;
  cancelExport: () => void;
  addAssets: (assets: EmbedAsset[]) => void;
  requestSave: () => void;
  dispose: () => Promise<void>;
}

const DEFAULT_READY_TIMEOUT_MS = 20_000;
const DEFAULT_INITIALIZED_TIMEOUT_MS = 60_000;
const DEFAULT_EXPORT_ACK_TIMEOUT_MS = 30_000;
const DISPOSE_TIMEOUT_MS = 5_000;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  // Consumers can still await/reject this promise; this internal observer only
  // prevents an optional lifecycle promise from becoming an unhandled rejection.
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}

export function createFastcatEmbed(options: FastcatEmbedOptions): FastcatEmbed {
  const nonce = createEmbedNonce();
  const editorOrigin = new URL(options.editorUrl, window.location.href).origin;
  const iframe = document.createElement('iframe');
  iframe.src = buildEmbedUrl(options.editorUrl, { nonce, hostOrigin: window.location.origin });
  iframe.allow = options.allow ?? DEFAULT_EMBED_ALLOW;
  if (options.sandbox) iframe.setAttribute('sandbox', options.sandbox);
  iframe.style.cssText = 'width:100%;height:100%;border:0';
  iframe.setAttribute('title', 'FastCat editor');

  let state: FastcatEmbedState = 'creating';
  let disposePromise: Promise<void> | null = null;
  let onDisposed: (() => void) | null = null;
  let exportAckTimer: number | null = null;
  const readyDeferred = deferred<EmbedCapabilities>();
  const initializedDeferred = deferred<EditorToHostMessages['initialized']>();
  const readyTimer = window.setTimeout(
    () => unavailable('Handshake timed out.'),
    options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
  );
  let initializedTimer: number | null = null;

  function report(code: string, message: string) {
    safeCallback('onError', () => options.onError?.({ code, message }));
  }

  function safeCallback(name: string, callback: () => unknown): void {
    try {
      const result = callback();
      if (result && typeof (result as Promise<unknown>).catch === 'function') {
        void (result as Promise<unknown>).catch((error: unknown) =>
          report('protocol-callback-failed', `${name}: ${String(error)}`),
        );
      }
    } catch (error) {
      // Do not allow host code to escape the message handler.
      if (name !== 'onError') report('protocol-callback-failed', `${name}: ${String(error)}`);
    }
  }

  function unavailable(reason: string) {
    if (state === 'disposed' || state === 'disposing' || state === 'unavailable') return;
    state = 'unavailable';
    window.clearTimeout(readyTimer);
    if (initializedTimer) window.clearTimeout(initializedTimer);
    readyDeferred.reject(new Error(reason));
    initializedDeferred.reject(new Error(reason));
    safeCallback('onUnavailable', () => options.onUnavailable?.(reason));
  }

  function ensureState(action: string, allowed: FastcatEmbedState[]) {
    if (!allowed.includes(state)) {
      throw new Error(`protocol-invalid-state: Cannot ${action} while SDK is ${state}.`);
    }
  }

  function send<T extends HostToEditorType>(type: T, payload: HostToEditorMessages[T]) {
    const validation = validateEmbedMessage('host', type, payload);
    if (!validation.ok) throw new Error(`${validation.code}: ${validation.message}`);
    safeCallback('onDebug', () => options.onDebug?.('out', type, payload));
    iframe.contentWindow?.postMessage(createEnvelope(nonce, type, payload), editorOrigin);
  }

  async function handle(type: string, payload: unknown) {
    const validation = validateEmbedMessage('editor', type, payload);
    if (!validation.ok) {
      report(validation.code!, validation.message!);
      return;
    }
    switch (type) {
      case 'ready': {
        const ready = payload as EditorToHostMessages['ready'];
        window.clearTimeout(readyTimer);
        state = 'ready';
        readyDeferred.resolve(ready.capabilities);
        safeCallback('onReady', () => options.onReady?.(ready.capabilities));
        initializedTimer = window.setTimeout(
          () => unavailable('Editor initialization timed out.'),
          options.initializedTimeoutMs ?? DEFAULT_INITIALIZED_TIMEOUT_MS,
        );
        try {
          send('init', {
            locale: options.locale,
            assets: options.assets,
            layout: options.layout,
            features: options.features,
            preferences: options.preferences,
            projectDefaults: options.projectDefaults,
            initialProject: options.initialProject,
            assetTransport: options.assetTransport,
            output: options.output,
          });
        } catch (error) {
          unavailable(error instanceof Error ? error.message : String(error));
        }
        return;
      }
      case 'initialized':
        if (initializedTimer) window.clearTimeout(initializedTimer);
        state = 'initialized';
        initializedDeferred.resolve(payload as EditorToHostMessages['initialized']);
        safeCallback('onInitialized', () =>
          options.onInitialized?.(payload as EditorToHostMessages['initialized']),
        );
        state = 'active';
        return;
      case 'asset:progress':
        return safeCallback('onAssetProgress', () =>
          options.onAssetProgress?.(payload as EditorToHostMessages['asset:progress']),
        );
      case 'export:progress':
        return safeCallback('onExportProgress', () =>
          options.onExportProgress?.(payload as EditorToHostMessages['export:progress']),
        );
      case 'change':
        return safeCallback('onChange', () =>
          options.onChange?.(payload as EditorToHostMessages['change']),
        );
      case 'preferences:changed':
        return safeCallback('onPreferencesChanged', () => options.onPreferencesChanged?.(payload));
      case 'requestClose':
        return safeCallback('onRequestClose', () => options.onRequestClose?.());
      case 'resize-request':
        return safeCallback('onResizeRequest', () =>
          options.onResizeRequest?.(payload as EditorToHostMessages['resize-request']),
        );
      case 'error':
        return report(
          (payload as EditorToHostMessages['error']).code,
          (payload as EditorToHostMessages['error']).message,
        );
      case 'export:error':
        state = 'active';
        return report('export-failed', (payload as EditorToHostMessages['export:error']).message);
      case 'asset:url-expired': {
        if (!options.onAssetUrlExpired)
          return report(
            'asset-url-expired',
            `No URL refresh handler for ${(payload as { assetId: string }).assetId}`,
          );
        try {
          const url = await options.onAssetUrlExpired((payload as { assetId: string }).assetId);
          send('asset:url', { assetId: (payload as { assetId: string }).assetId, url });
        } catch (error) {
          report('protocol-callback-failed', `onAssetUrlExpired: ${String(error)}`);
        }
        return;
      }
      case 'stt:request':
      case 'llm:request': {
        const request = payload as EditorToHostMessages['stt:request'];
        const handler = type === 'stt:request' ? options.onSttRequest : options.onLlmRequest;
        if (!handler)
          return send('rpc:result', {
            requestId: request.requestId,
            error: `The host does not handle ${type}`,
          });
        try {
          send('rpc:result', {
            requestId: request.requestId,
            result: await handler(request.payload),
          });
        } catch (error) {
          send('rpc:result', { requestId: request.requestId, error: String(error) });
        }
        return;
      }
      case 'export:done': {
        const result = payload as FastcatEmbedExportResult;
        state = 'exporting';
        try {
          await options.onExportDone?.(result);
        } catch (error) {
          report('protocol-callback-failed', `onExportDone: ${String(error)}`);
        }
        // Ack is independent from dispose: calling dispose from onExportDone cannot await itself.
        if (!(['disposing', 'disposed'] as FastcatEmbedState[]).includes(state)) {
          send('export:ack', undefined);
          exportAckTimer = window.setTimeout(
            () => report('protocol-timeout', 'Export acknowledgement timed out.'),
            options.exportAckTimeoutMs ?? DEFAULT_EXPORT_ACK_TIMEOUT_MS,
          );
          state = 'active';
        }
        return;
      }
      case 'disposed':
        onDisposed?.();
        return;
    }
  }

  function onMessage(event: MessageEvent) {
    if (
      event.source !== iframe.contentWindow ||
      event.origin !== editorOrigin ||
      !isEmbedEnvelope(event.data, nonce)
    )
      return;
    if (!hasEmbedProtocolVersion(event.data)) {
      unavailable(
        `This editor speaks protocol v${event.data.version}; this SDK speaks v${EMBED_PROTOCOL_VERSION}.`,
      );
      return;
    }
    safeCallback('onDebug', () => options.onDebug?.('in', event.data.type, event.data.payload));
    void handle(event.data.type, event.data.payload);
  }

  window.addEventListener('message', onMessage);
  options.container.appendChild(iframe);

  return {
    iframe,
    get state() {
      return state;
    },
    ready: readyDeferred.promise,
    initialized: initializedDeferred.promise,
    startExport(exportOptions) {
      ensureState('start an export', ['active']);
      if (exportOptions?.filename && !isSafeEmbedFilename(exportOptions.filename))
        throw new Error('protocol-invalid-payload: Invalid export filename.');
      send('export:start', exportOptions);
      state = 'exporting';
    },
    cancelExport() {
      ensureState('cancel an export', ['exporting']);
      send('export:cancel', undefined);
    },
    addAssets(assets) {
      ensureState('add assets', ['active']);
      send('asset:add', { assets });
    },
    requestSave() {
      ensureState('request a save', ['initialized', 'active', 'exporting']);
      send('save:request', undefined);
    },
    dispose() {
      if (disposePromise) return disposePromise;
      disposePromise = (async () => {
        state = 'disposing';
        window.clearTimeout(readyTimer);
        if (initializedTimer) window.clearTimeout(initializedTimer);
        if (exportAckTimer) window.clearTimeout(exportAckTimer);
        readyDeferred.reject(new Error('The embed was disposed before ready.'));
        initializedDeferred.reject(
          new Error('The embed was disposed before initialization completed.'),
        );
        const farewell = new Promise<void>((resolve) => {
          onDisposed = resolve;
          window.setTimeout(resolve, DISPOSE_TIMEOUT_MS);
        });
        try {
          send('dispose', undefined);
          await farewell;
        } finally {
          onDisposed = null;
          window.removeEventListener('message', onMessage);
          iframe.remove();
          state = 'disposed';
        }
      })();
      return disposePromise;
    },
  };
}
