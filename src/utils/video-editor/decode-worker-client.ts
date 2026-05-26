import { createDevLogger } from '~/utils/dev-logger';
import type { DecodeRequest, DecodeResponse } from '~/utils/audio/types';
import { postIoInitMessage } from '~/utils/io/io-budget-main';
const log = createDevLogger('decode-worker-client');

/**
 * Rejection message used when a decode is abandoned because the client was
 * destroyed. Callers (AudioEngine.extractPeaks) match on it to swallow the
 * cancellation silently instead of logging a spurious warning.
 */
export const DECODE_CANCELLED_MESSAGE = 'AudioEngine destroyed';

type DecodeResult = DecodeResponse['result'];
type PendingCall = {
  resolve: (value: DecodeResult) => void;
  reject: (reason?: unknown) => void;
};

type QueuedSlot = {
  resolve: () => void;
  reject: (reason?: unknown) => void;
};

/**
 * Thin RPC client around the audio-decode web worker. Owns the worker lifecycle,
 * the request/response correlation by id, and a small concurrency gate so only a
 * bounded number of decodes run at once. Holds no audio-graph or cache state —
 * it just turns method calls into worker messages and back into promises.
 */
export class DecodeWorkerClient {
  private worker: Worker | null = null;
  private callId = 0;
  private pending = new Map<number, PendingCall>();
  private queue: QueuedSlot[] = [];
  private inFlightCount = 0;
  private readonly maxConcurrency = 2;
  private destroyed = false;

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    const worker = new Worker(new URL('../../workers/audio-decode.worker.ts', import.meta.url), {
      type: 'module',
      name: 'audio-decode',
    });
    // Wire the worker to the shared I/O budget *before* any other message can be
    // posted to it — the worker applies the first io-init it sees. A dynamic
    // import here would defer this to a later microtask and risk losing the
    // race, so it's imported statically and called synchronously.
    postIoInitMessage(worker as unknown as Worker);

    worker.addEventListener('message', (event: MessageEvent<DecodeResponse>) => {
      const data = event.data;
      if (!data || data.type !== 'decode-result') return;
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id);

      if (!data.ok) {
        const err = new Error(data.error?.message || 'Audio decode failed');
        if (data.error?.name) err.name = data.error.name;
        if (data.error?.stack) err.stack = data.error.stack;
        pending.reject(err);
        return;
      }

      pending.resolve(data.result);
    });

    worker.addEventListener('error', (event) => {
      log.error('[AudioEngine] Decode worker error', event);
      for (const [, pending] of this.pending.entries()) {
        pending.reject(new Error('Audio decode worker crashed'));
      }
      this.pending.clear();
      this.worker = null;
    });

    this.worker = worker;
    return worker;
  }

  extractPeaks(
    blob: Blob,
    sourceKey: string,
    options?: { maxLength?: number; precision?: number },
  ): Promise<DecodeResult> {
    if (this.destroyed) {
      return Promise.reject(new Error(DECODE_CANCELLED_MESSAGE));
    }
    const worker = this.ensureWorker();
    return new Promise<DecodeResult>((resolve, reject) => {
      const id = ++this.callId;
      this.pending.set(id, { resolve, reject });
      const req: DecodeRequest = { type: 'extract-peaks', id, sourceKey, blob, options };
      worker.postMessage(req);
    });
  }

  decodeRange(
    source: Blob | ArrayBuffer,
    sourceKey: string,
    startTimeS: number,
    durationS: number,
  ): Promise<DecodeResult> {
    if (this.destroyed) {
      return Promise.reject(new Error(DECODE_CANCELLED_MESSAGE));
    }
    const worker = this.ensureWorker();
    return new Promise<DecodeResult>((resolve, reject) => {
      const id = ++this.callId;
      this.pending.set(id, { resolve, reject });
      const req: DecodeRequest = {
        type: 'decode-range',
        id,
        sourceKey,
        startTimeS,
        durationS,
      };
      if (source instanceof ArrayBuffer) {
        req.arrayBuffer = source;
        worker.postMessage(req, [source]);
      } else {
        req.blob = source;
        worker.postMessage(req);
      }
    });
  }

  /** Runs `task` once a concurrency slot is free, bounding parallel decodes. */
  async withSlot<T>(task: () => Promise<T>): Promise<T> {
    if (this.destroyed) {
      throw new Error(DECODE_CANCELLED_MESSAGE);
    }

    if (this.inFlightCount >= this.maxConcurrency) {
      await new Promise<void>((resolve, reject) => this.queue.push({ resolve, reject }));
      if (this.destroyed) {
        throw new Error(DECODE_CANCELLED_MESSAGE);
      }
    }
    this.inFlightCount += 1;
    try {
      return await task();
    } finally {
      this.inFlightCount = Math.max(0, this.inFlightCount - 1);
      const next = this.queue.shift();
      if (next) next.resolve();
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    for (const [, pending] of this.pending.entries()) {
      pending.reject(new Error(DECODE_CANCELLED_MESSAGE));
    }
    this.pending.clear();

    for (const queued of this.queue.splice(0)) {
      queued.reject(new Error(DECODE_CANCELLED_MESSAGE));
    }
  }
}
