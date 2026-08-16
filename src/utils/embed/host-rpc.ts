import { createDevLogger } from '~/utils/dev-logger';
import { randomToken } from '~/utils/ids';

const log = createDevLogger('embed-host-rpc');

const DEFAULT_TIMEOUT_MS = 60_000;

export type HostRpcChannel = 'stt' | 'llm';

export interface HostRpcResult {
  result?: unknown;
  error?: string;
}

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type HostRpcSender = (channel: HostRpcChannel, requestId: string, payload: unknown) => void;

let sender: HostRpcSender | null = null;
const pending = new Map<string, PendingCall>();

/**
 * Points remote work at the host page.
 *
 * Speech-to-text and language models are the host's to run: it already holds
 * the credentials and the billing relationship, and an embedded editor that
 * carried an API key would be handing that key to every page that frames it.
 * The editor therefore describes the work and lets the host perform it.
 */
export function registerHostRpc(send: HostRpcSender | null): void {
  sender = send;
  if (send) return;

  for (const call of pending.values()) {
    clearTimeout(call.timer);
    call.reject(new Error('The host connection went away'));
  }
  pending.clear();
}

export function isHostRpcAvailable(): boolean {
  return sender !== null;
}

export function callHostRpc(
  channel: HostRpcChannel,
  payload: unknown,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<unknown> {
  const send = sender;
  if (!send) return Promise.reject(new Error(`No host available to service a ${channel} request`));

  const requestId = `${channel}-${randomToken(10)}`;

  return new Promise<unknown>((resolve, reject) => {
    const settle = (fn: () => void) => {
      const call = pending.get(requestId);
      if (!call) return;
      clearTimeout(call.timer);
      pending.delete(requestId);
      fn();
    };

    const timer = setTimeout(() => {
      settle(() => reject(new Error(`The host did not answer the ${channel} request in time`)));
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    pending.set(requestId, { resolve, reject, timer });

    options.signal?.addEventListener(
      'abort',
      () => settle(() => reject(new Error(`The ${channel} request was cancelled`))),
      { once: true },
    );

    send(channel, requestId, payload);
  });
}

/** Delivers a host reply to whoever is waiting on it. */
export function settleHostRpc(requestId: string, outcome: HostRpcResult): void {
  const call = pending.get(requestId);
  if (!call) {
    log.warn('Received a host reply for an unknown request', requestId);
    return;
  }

  clearTimeout(call.timer);
  pending.delete(requestId);

  if (outcome.error) call.reject(new Error(outcome.error));
  else call.resolve(outcome.result);
}
