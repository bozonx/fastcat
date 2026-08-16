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
  type HostToEditorMessages,
  type HostToEditorType,
} from './protocol';

export * from './protocol';

export interface FastcatEmbedExportResult {
  file: File;
  meta: EmbedExportMeta;
}

export interface FastcatEmbedOptions {
  /** Element the iframe is appended to. */
  container: HTMLElement;
  /** Absolute URL of the editor's embed route, e.g. `https://embed.fastcat.video/v1/embed`. */
  editorUrl: string;
  assets?: EmbedAsset[];
  locale?: string;
  /** How long to wait for the editor's `ready` before declaring it unavailable. */
  readyTimeoutMs?: number;
  onReady?: (capabilities: EmbedCapabilities) => void;
  onInitialized?: (info: EditorToHostMessages['initialized']) => void;
  onExportProgress?: (progress: EditorToHostMessages['export:progress']) => void;
  /**
   * Receives the finished render. The exported `File` is backed by storage
   * inside the iframe, so the editor is told to release it only after this
   * callback settles — stream it to its destination before returning.
   */
  onExportDone?: (result: FastcatEmbedExportResult) => void | Promise<void>;
  onError?: (error: { code: string; message: string }) => void;
  onRequestClose?: () => void;
  /** Called when the editor never completes the handshake. */
  onUnavailable?: (reason: string) => void;
  /** Every message crossing the boundary, for logging and integration tests. */
  onDebug?: (direction: 'in' | 'out', type: string, payload: unknown) => void;
}

export interface FastcatEmbed {
  readonly iframe: HTMLIFrameElement;
  startExport: (options?: { filename?: string }) => void;
  dispose: () => Promise<void>;
}

const DEFAULT_READY_TIMEOUT_MS = 20_000;

export function createFastcatEmbed(options: FastcatEmbedOptions): FastcatEmbed {
  const nonce = createEmbedNonce();
  const editorOrigin = new URL(options.editorUrl, window.location.href).origin;

  const iframe = document.createElement('iframe');
  iframe.src = buildEmbedUrl(options.editorUrl, { nonce, hostOrigin: window.location.origin });
  iframe.allow = 'fullscreen; clipboard-write; autoplay';
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = '0';
  iframe.setAttribute('title', 'FastCat editor');

  let disposed = false;
  let pendingExport: Promise<void> = Promise.resolve();

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
        const { capabilities } = payload as EditorToHostMessages['ready'];
        options.onReady?.(capabilities);
        send('init', { locale: options.locale, assets: options.assets });
        return;
      }
      case 'initialized':
        options.onInitialized?.(payload as EditorToHostMessages['initialized']);
        return;
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
      case 'requestClose':
        options.onRequestClose?.();
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
    async dispose() {
      if (disposed) return;
      // Let an in-flight export handler finish reading the file before the
      // iframe — and with it the file's backing store — goes away.
      await pendingExport;
      disposed = true;
      window.clearTimeout(readyTimer);
      send('dispose', undefined);
      window.removeEventListener('message', onMessage);
      iframe.remove();
    },
  };
}
