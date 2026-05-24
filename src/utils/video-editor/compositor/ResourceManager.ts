import type { VideoSampleSink } from 'mediabunny';
import { VIDEO_CORE_LIMITS } from '../../constants';
import { isInputDisposed } from '../utils';

export interface ResourceManagerContext {
  sampleRequestsInFlight: number;
  sampleRequestQueue: Array<{ resolve: () => void; signal?: AbortSignal }>;
}

/**
 * Closes a decoded sample that the caller abandoned (aborted/timed out). Mirrors
 * the disposal the consumer would otherwise do, so an orphaned decode does not
 * leak a decoder frame.
 */
function disposeAbandonedSample(value: unknown): void {
  const closer = value as { close?: () => void } | null;
  if (value && typeof closer?.close === 'function') {
    try {
      closer.close();
    } catch {
      // ignore
    }
  }
}

export async function getVideoSampleWithZeroFallback(
  sink: Pick<VideoSampleSink, 'getSample'>,
  timeS: number,
  firstTimestampS?: number,
): Promise<unknown | null> {
  const safeSample = (t: number) =>
    sink.getSample(t).catch((e) => {
      if (isInputDisposed(e)) return null;
      throw e;
    });

  const primary = await safeSample(timeS);
  if (primary) return primary;

  if (Number.isFinite(firstTimestampS) && typeof firstTimestampS === 'number') {
    const safeFirst = Math.max(0, firstTimestampS);
    if (timeS <= safeFirst) {
      const first = await safeSample(safeFirst);
      if (first) return first;
    }
  }

  if (timeS !== 0) {
    return null;
  }

  // Some decoders return null for exact 0.0 but can provide the first frame for a tiny epsilon.
  return safeSample(1e-6);
}

function isTransientVideoSampleError(error: unknown): boolean {
  const candidate = error as { name?: unknown; message?: unknown } | null | undefined;
  const name = typeof candidate?.name === 'string' ? candidate.name : '';
  const message = typeof candidate?.message === 'string' ? candidate.message : '';
  return name === 'InvalidStateError' || /datapipe|failed to create/i.test(message);
}

export class ResourceManager {
  private sampleRequestsInFlight = 0;
  private readonly sampleRequestQueue: Array<{ resolve: () => void; signal?: AbortSignal }> = [];
  private sampleAbortControllers = new Map<string, AbortController>();

  private async raceTaskWithAbortAndTimeout<T>(
    task: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const timeoutMs = Math.max(
      1,
      Math.round(VIDEO_CORE_LIMITS.MAX_VIDEO_SAMPLE_REQUEST_TIMEOUT_MS),
    );

    return await new Promise<T>((resolve, reject) => {
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
      };

      const finishResolve = (value: T) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        resolve(value);
      };

      const finishReject = (error: unknown) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        reject(error);
      };

      const onAbort = () => {
        finishReject(new Error('Aborted while reading video sample'));
      };

      if (signal?.aborted) {
        finishReject(new Error('Aborted while reading video sample'));
        return;
      }

      if (signal) {
        signal.addEventListener('abort', onAbort);
      }

      timeoutId = setTimeout(() => {
        finishReject(new Error('Timed out while reading video sample'));
      }, timeoutMs);

      void task().then(finishResolve, finishReject);
    });
  }

  public async withVideoSampleSlot<T>(
    task: () => Promise<T>,
    signal?: AbortSignal,
    options?: { attempts?: number; baseDelayMs?: number },
  ): Promise<T> {
    const attempts = Math.max(1, Math.round(options?.attempts ?? 3));
    const baseDelayMs = Math.max(1, Math.round(options?.baseDelayMs ?? 50));

    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (signal?.aborted) {
        throw new Error('Aborted before acquiring slot');
      }

      // Wait for slot if busy
      const max = Math.max(1, Math.round(VIDEO_CORE_LIMITS.MAX_CONCURRENT_VIDEO_SAMPLE_REQUESTS));
      if (this.sampleRequestsInFlight >= max) {
        await new Promise<void>((resolve, reject) => {
          if (signal?.aborted) {
            reject(new Error('Aborted before acquiring slot'));
            return;
          }

          let onAbort: (() => void) | undefined;
          const queueItem = {
            resolve: () => {
              if (onAbort && signal) signal.removeEventListener('abort', onAbort);
              resolve();
            },
            signal,
          };

          if (signal) {
            onAbort = () => {
              if (onAbort) signal.removeEventListener('abort', onAbort);
              const index = this.sampleRequestQueue.indexOf(queueItem);
              if (index !== -1) {
                this.sampleRequestQueue.splice(index, 1);
              }
              reject(new Error('Aborted while waiting for slot'));
            };
            signal.addEventListener('abort', onAbort);
          }

          this.sampleRequestQueue.push(queueItem);
        });
      }

      this.sampleRequestsInFlight += 1;

      // Start the decode exactly once and hold the slot until it *actually*
      // settles — not until the caller stops waiting. mediabunny's getSample is
      // not cancellable, so an aborted/timed-out decode keeps running and keeps
      // its file-read datapipe open. Releasing the slot the moment the abort race
      // wins would let fresh decodes pile on top of orphaned ones, so the real
      // number of concurrent reads (and open datapipes) could climb far past the
      // limit and exhaust the renderer pool. Tying the slot to the real decode
      // keeps concurrency honest; we also dispose the orphaned sample once it
      // lands so it does not leak a decoder frame.
      const taskPromise = task();
      const release = () => {
        this.sampleRequestsInFlight -= 1;
        this.processRequestQueue();
      };
      taskPromise.then(release, release);

      try {
        return await this.raceTaskWithAbortAndTimeout(() => taskPromise, signal);
      } catch (error) {
        lastError = error;
        void taskPromise.then(disposeAbandonedSample, () => undefined);

        if (attempt === attempts - 1 || signal?.aborted || !isTransientVideoSampleError(error)) {
          throw error;
        }

        // Backoff before next attempt
        await new Promise<void>((resolve) => {
          const delayMs = baseDelayMs * 2 ** attempt;
          setTimeout(resolve, delayMs);
        });
      }
    }

    throw lastError;
  }

  private processRequestQueue() {
    while (this.sampleRequestQueue.length > 0) {
      const max = Math.max(1, Math.round(VIDEO_CORE_LIMITS.MAX_CONCURRENT_VIDEO_SAMPLE_REQUESTS));
      if (this.sampleRequestsInFlight >= max) break;

      const next = this.sampleRequestQueue.shift();
      if (next) {
        if (next.signal?.aborted) continue;
        next.resolve();
      }
    }
  }

  /**
   * Creates a new AbortController for the given id, aborting any existing one.
   * This is the preferred way to manage sample abort controllers from outside.
   */
  public createAbortController(id: string): AbortController {
    const existing = this.sampleAbortControllers.get(id);
    if (existing) {
      existing.abort();
    }
    const controller = new AbortController();
    this.sampleAbortControllers.set(id, controller);
    return controller;
  }

  public getAbortController(id: string): AbortController {
    let controller = this.sampleAbortControllers.get(id);
    if (!controller) {
      controller = new AbortController();
      this.sampleAbortControllers.set(id, controller);
    }
    return controller;
  }

  public abortInFlight(idPrefix?: string) {
    for (const [id, controller] of this.sampleAbortControllers.entries()) {
      if (!idPrefix || id.startsWith(idPrefix)) {
        controller.abort();
        this.sampleAbortControllers.delete(id);
      }
    }
  }

  /**
   * Remove an abort controller after its task completed successfully.
   * Prevents unbounded growth of the controllers map during long sessions.
   */
  public removeAbortController(id: string): void {
    this.sampleAbortControllers.delete(id);
  }

  public clear() {
    this.abortInFlight();
    this.sampleRequestQueue.length = 0;
  }
}
