import type { VideoSampleSink } from 'mediabunny';
import { VIDEO_CORE_LIMITS } from '../../constants';

export interface ResourceManagerContext {
  sampleRequestsInFlight: number;
  sampleRequestQueue: Array<{ resolve: () => void; signal?: AbortSignal }>;
}

export async function getVideoSampleWithZeroFallback(
  sink: Pick<VideoSampleSink, 'getSample'>,
  timeS: number,
  firstTimestampS?: number,
): Promise<unknown | null> {
  const primary = await sink.getSample(timeS).catch((e) => {
    const msg = String((e as any)?.message ?? e ?? '');
    const name = String((e as any)?.name ?? '');
    if (name === 'InputDisposedError' || msg.includes('Input has been disposed')) {
      return null;
    }
    throw e;
  });
  if (primary) return primary;

  if (Number.isFinite(firstTimestampS) && typeof firstTimestampS === 'number') {
    const safeFirst = Math.max(0, firstTimestampS);
    if (timeS <= safeFirst) {
      const first = await sink.getSample(safeFirst).catch((e) => {
        const msg = String((e as any)?.message ?? e ?? '');
        const name = String((e as any)?.name ?? '');
        if (name === 'InputDisposedError' || msg.includes('Input has been disposed')) {
          return null;
        }
        throw e;
      });
      if (first) return first;
    }
  }

  if (timeS !== 0) {
    return null;
  }

  // Some decoders return null for exact 0.0 but can provide the first frame for a tiny epsilon.
  return sink.getSample(1e-6).catch((e) => {
    const msg = String((e as any)?.message ?? e ?? '');
    const name = String((e as any)?.name ?? '');
    if (name === 'InputDisposedError' || msg.includes('Input has been disposed')) {
      return null;
    }
    throw e;
  });
}

export class ResourceManager {
  private sampleRequestsInFlight = 0;
  private readonly sampleRequestQueue: Array<{ resolve: () => void; signal?: AbortSignal }> = [];
  private sampleAbortControllers = new Map<string, AbortController>();

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
      return await task();
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
