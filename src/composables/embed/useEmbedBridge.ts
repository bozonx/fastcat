import { createDevLogger } from '~/utils/dev-logger';
import {
  createEnvelope,
  isEmbedEnvelope,
  parseEmbedHandshakeParams,
  type EditorToHostMessages,
  type EditorToHostType,
  type HostToEditorMessages,
  type HostToEditorType,
} from '~embed';

const log = createDevLogger('embed-bridge');

export interface EmbedBridge {
  readonly hostOrigin: string;
  send: <T extends EditorToHostType>(type: T, payload: EditorToHostMessages[T]) => void;
  on: <T extends HostToEditorType>(
    type: T,
    handler: (payload: HostToEditorMessages[T]) => void,
  ) => void;
  stop: () => void;
}

/**
 * Transport half of the embed protocol. Every inbound message must come from
 * the parent window, from the exact origin declared in the handshake, and carry
 * the nonce minted by that host — anything else is dropped without a trace of
 * state change. Outbound messages are likewise pinned to that one origin, so
 * the editor can never broadcast a project or an exported file to a wildcard.
 *
 * Returns `null` when the document is not a properly parameterised embed, which
 * is also what a user hitting `/embed` directly in a browser gets.
 */
export function createEmbedBridge(): EmbedBridge | null {
  if (typeof window === 'undefined' || window.parent === window) return null;

  const params = parseEmbedHandshakeParams(window.location.hash);
  if (!params) {
    log.warn('Missing or malformed handshake parameters; refusing to open a channel');
    return null;
  }

  const handlers = new Map<string, (payload: never) => void>();

  function onMessage(event: MessageEvent) {
    if (event.source !== window.parent) return;
    if (event.origin !== params!.hostOrigin) return;
    if (!isEmbedEnvelope(event.data, params!.nonce)) return;

    const handler = handlers.get(event.data.type);
    if (!handler) {
      log.warn('No handler for host message', event.data.type);
      return;
    }
    (handler as (payload: unknown) => void)(event.data.payload);
  }

  window.addEventListener('message', onMessage);

  return {
    hostOrigin: params.hostOrigin,
    send(type, payload) {
      window.parent.postMessage(createEnvelope(params.nonce, type, payload), params.hostOrigin);
    },
    on(type, handler) {
      handlers.set(type, handler as (payload: never) => void);
    },
    stop() {
      window.removeEventListener('message', onMessage);
      handlers.clear();
    },
  };
}
