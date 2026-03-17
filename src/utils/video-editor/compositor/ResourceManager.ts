import type { VideoSampleSink } from 'mediabunny';
import { VIDEO_CORE_LIMITS } from '../../constants';
import { isInputDisposed } from '../utils';

export interface ResourceManagerContext {
  sampleRequestsInFlight: number;
  sampleRequestQueue: Array<{ resolve: () => void; signal?: AbortSignal }>;
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

  public async withVideoSampleSlot<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const max = Math.max(1, Math.round(VIDEO_CORE_LIMITS.MAX_CONCURRENT_VIDEO_SAMPLE_REQUESTS));
    if (this.sampleRequestsInFlight >= max) {
      await new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error('Aborted before acquiring slot'));
          return;
        }

        const queueItem = { resolve, signal };

        if (signal) {
          const onAbort = () => {
            signal.removeEventListener('abort', onAbort);
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
    try {
      return await this.raceTaskWithAbortAndTimeout(task, signal);
    } finally {
      this.sampleRequestsInFlight -= 1;
      this.processRequestQueue();
    }
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

  public clear() {
    this.abortInFlight();
    this.sampleRequestQueue.length = 0;
  }
}
