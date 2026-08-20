import {
  buildEmbedUrl,
  createEmbedNonce,
  createEnvelope,
  isEmbedEnvelope,
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
  /** Absent in `upload` mode, where the editor sent the render itself. */
  file?: File;
  poster: Blob | null;
  /** The timeline behind this render, for a later "edit again". */
  otio: string;
  meta: EmbedExportMeta;
}

export const DEFAULT_EMBED_ALLOW =
  'fullscreen; clipboard-read; clipboard-write; autoplay; cross-origin-isolated';

export interface FastcatEmbedOptions {
  /** Element the iframe is appended to. */
  container: HTMLElement;
  /** Absolute URL of the editor's embed route, e.g. `https://embed.fastcat.video/v1/embed`. */
  editorUrl: string;
  /**
   * Permissions Policy `allow` attribute for the iframe.
   * Defaults to {@link DEFAULT_EMBED_ALLOW}.
   */
  allow?: string;
  /**
   * Optional custom HTML `sandbox` attribute for the iframe.
   *
   * By default, FastCat relies on standard cross-origin isolation (Same-Origin Policy)
   * rather than the `sandbox` attribute, because `sandbox` without `allow-same-origin`
   * assigns an opaque origin (`null`) that breaks OPFS (`navigator.storage.getDirectory()`).
   *
   * If you explicitly provide a sandbox string, it MUST at least include:
   * `'allow-scripts allow-same-origin allow-downloads allow-forms allow-popups allow-popups-to-escape-sandbox'`
   */
  sandbox?: string;
  assets?: EmbedAsset[];
  locale?: string;
  /** Preferences stored from this user's previous session, opaque to the host. */
  preferences?: unknown;
  layout?: EmbedLayoutPreference;
  features?: EmbedFeatureName[];
  projectDefaults?: EmbedProjectDefaults;
  assetTransport?: EmbedAssetTransportKind;
  output?: EmbedOutputMode;
  /** How long to wait for the editor's `ready` before declaring it unavailable. */
  readyTimeoutMs?: number;
  onReady?: (capabilities: EmbedCapabilities) => void;
  onInitialized?: (info: EditorToHostMessages['initialized']) => void;
  onExportProgress?: (progress: EditorToHostMessages['export:progress']) => void;
  onAssetProgress?: (progress: EditorToHostMessages['asset:progress']) => void;
  /**
   * Called when an asset's signed URL stops authorising mid-session. Resolve
   * with a fresh URL; reads resume from where they stopped. Without a handler
   * the asset simply fails, so provide one whenever URLs have a TTL.
   */
  onAssetUrlExpired?: (assetId: string) => Promise<string> | string;
  /**
   * The timeline changed. Persist `otio` to keep a recoverable draft; `dirty`
   * mirrors what an unsaved-changes guard should show.
   */
  onChange?: (change: EditorToHostMessages['change']) => void;
  /**
   * Preferences to store against the user's profile and hand back as
   * `preferences` next time. Opaque — do not inspect or edit it.
   */
  onPreferencesChanged?: (preferences: unknown) => void;
  /**
   * Runs speech-to-text on the host's own infrastructure. Required for any
   * transcription feature: the editor deliberately holds no credentials.
   */
  onSttRequest?: (payload: unknown) => Promise<unknown>;
  /** Runs a language-model request on the host's own infrastructure. */
  onLlmRequest?: (payload: unknown) => Promise<unknown>;
  /**
   * Receives the finished render. The exported `File` is backed by storage
   * inside the iframe, so the editor is told to release it only after this
   * callback settles — stream it to its destination before returning.
   */
  onExportDone?: (result: FastcatEmbedExportResult) => void | Promise<void>;
  onError?: (error: { code: string; message: string }) => void;
  onRequestClose?: () => void;
  /** The editor would like more vertical room. Advisory; the host decides. */
  onResizeRequest?: (request: EditorToHostMessages['resize-request']) => void;
  /** Called when the editor never completes the handshake. */
  onUnavailable?: (reason: string) => void;
  /** Every message crossing the boundary, for logging and integration tests. */
  onDebug?: (direction: 'in' | 'out', type: string, payload: unknown) => void;
}

export interface FastcatEmbed {
  readonly iframe: HTMLIFrameElement;
  startExport: (options?: { filename?: string; uploadUrl?: string }) => void;
  cancelExport: () => void;
  addAssets: (assets: EmbedAsset[]) => void;
  requestSave: () => void;
  dispose: () => Promise<void>;
}

const DEFAULT_READY_TIMEOUT_MS = 20_000;
/** How long `dispose()` waits for the editor's farewell before giving up. */
const DISPOSE_TIMEOUT_MS = 5_000;

export function createFastcatEmbed(options: FastcatEmbedOptions): FastcatEmbed {
  const nonce = createEmbedNonce();
  const editorOrigin = new URL(options.editorUrl, window.location.href).origin;

  const iframe = document.createElement('iframe');
  iframe.src = buildEmbedUrl(options.editorUrl, { nonce, hostOrigin: window.location.origin });
  iframe.allow = options.allow ?? DEFAULT_EMBED_ALLOW;
  if (options.sandbox) {
    iframe.setAttribute('sandbox', options.sandbox);
  }
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = '0';
  iframe.setAttribute('title', 'FastCat editor');

  let disposed = false;
  let pendingExport: Promise<void> = Promise.resolve();
  let onDisposed: (() => void) | null = null;

  const readyTimer = window.setTimeout(() => {
    if (!disposed) options.onUnavailable?.('The editor did not respond to the handshake.');
  }, options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS);

  function send<T extends HostToEditorType>(type: T, payload: HostToEditorMessages[T]) {
    options.onDebug?.('out', type, payload);
    iframe.contentWindow?.postMessage(createEnvelope(nonce, type, payload), editorOrigin);
  }

  async function handle(type: string, payload: unknown) {
    switch (type) {
      case 'ready': {
        window.clearTimeout(readyTimer);
        const { capabilities, version } = payload as EditorToHostMessages['ready'];
        if (version !== EMBED_PROTOCOL_VERSION) {
          // Talking anyway would mean guessing at message shapes on both sides.
          options.onUnavailable?.(
            `This editor speaks protocol v${version}; this SDK speaks v${EMBED_PROTOCOL_VERSION}.`,
          );
          return;
        }
        options.onReady?.(capabilities);
        send('init', {
          locale: options.locale,
          assets: options.assets,
          layout: options.layout,
          features: options.features,
          preferences: options.preferences,
          projectDefaults: options.projectDefaults,
          assetTransport: options.assetTransport,
          output: options.output,
        });
        return;
      }
      case 'initialized':
        options.onInitialized?.(payload as EditorToHostMessages['initialized']);
        return;
      case 'asset:progress':
        options.onAssetProgress?.(payload as EditorToHostMessages['asset:progress']);
        return;
      case 'asset:url-expired': {
        const { assetId } = payload as EditorToHostMessages['asset:url-expired'];
        if (!options.onAssetUrlExpired) return;
        const url = await options.onAssetUrlExpired(assetId);
        send('asset:url', { assetId, url });
        return;
      }
      case 'export:progress':
        options.onExportProgress?.(payload as EditorToHostMessages['export:progress']);
        return;
      case 'export:done': {
        const result = payload as FastcatEmbedExportResult;
        // Chain onto the previous handler so `dispose()` has a single promise to
        // await, and acknowledge only once the host is done with the file.
        pendingExport = pendingExport
          .then(() => options.onExportDone?.(result))
          .catch((e: unknown) => {
            options.onError?.({
              code: 'export-handler-failed',
              message: e instanceof Error ? e.message : String(e),
            });
          })
          .then(() => {
            if (!disposed) send('export:ack', undefined);
          });
        return;
      }
      case 'export:error':
        options.onError?.({
          code: 'export-failed',
          message: (payload as EditorToHostMessages['export:error']).message,
        });
        return;
      case 'error':
        options.onError?.(payload as EditorToHostMessages['error']);
        return;
      case 'change':
        options.onChange?.(payload as EditorToHostMessages['change']);
        return;
      case 'preferences:changed':
        options.onPreferencesChanged?.(payload);
        return;
      case 'stt:request':
      case 'llm:request': {
        const { requestId, payload: request } = payload as EditorToHostMessages['stt:request'];
        const handler = type === 'stt:request' ? options.onSttRequest : options.onLlmRequest;
        if (!handler) {
          send('rpc:result', { requestId, error: `The host does not handle ${type}` });
          return;
        }
        try {
          send('rpc:result', { requestId, result: await handler(request) });
        } catch (e) {
          send('rpc:result', {
            requestId,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        return;
      }
      case 'disposed':
        onDisposed?.();
        return;
      case 'requestClose':
        options.onRequestClose?.();
        return;
      case 'resize-request':
        options.onResizeRequest?.(payload as EditorToHostMessages['resize-request']);
        return;
    }
  }

  function onMessage(event: MessageEvent) {
    if (event.source !== iframe.contentWindow) return;
    if (event.origin !== editorOrigin) return;
    if (!isEmbedEnvelope(event.data, nonce)) return;
    if (event.data.version !== EMBED_PROTOCOL_VERSION) return;
    options.onDebug?.('in', event.data.type, event.data.payload);
    void handle(event.data.type, event.data.payload);
  }

  window.addEventListener('message', onMessage);
  options.container.appendChild(iframe);

  return {
    iframe,
    startExport(exportOptions) {
      send('export:start', exportOptions);
    },
    cancelExport() {
      send('export:cancel', undefined);
    },
    /** Adds assets to a session already in progress. */
    addAssets(assets) {
      send('asset:add', { assets });
    },
    /** Asks for the current timeline immediately, bypassing the change debounce. */
    requestSave() {
      send('save:request', undefined);
    },
    async dispose() {
      if (disposed) return;
      // Let an in-flight export handler finish reading the file before the
      // iframe — and with it the file's backing store — goes away.
      await pendingExport;
      disposed = true;
      window.clearTimeout(readyTimer);

      // The editor flushes its final `change` and `preferences:changed` while
      // shutting down, so the listener has to outlive the request. Tearing it
      // down here would silently drop the user's last edits.
      const farewell = new Promise<void>((resolve) => {
        onDisposed = resolve;
        window.setTimeout(resolve, DISPOSE_TIMEOUT_MS);
      });
      send('dispose', undefined);
      await farewell;

      onDisposed = null;
      window.removeEventListener('message', onMessage);
      iframe.remove();
    },
  };
}
