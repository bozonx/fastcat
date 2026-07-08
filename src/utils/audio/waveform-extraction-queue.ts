import PQueue from 'p-queue';
import { isTauriRuntime } from '~/utils/runtime';

const BROWSER_WAVEFORM_EXTRACTION_CONCURRENCY = 1;
const TAURI_WAVEFORM_EXTRACTION_CONCURRENCY = 2;

export const WAVEFORM_EXTRACTION_PRIORITIES = {
  prefetch: 0,
  nestedTimeline: 1,
  visibleClip: 2,
  selectedClip: 3,
} as const;

const peakExtractionsByPath = new Map<string, Promise<Float32Array[] | null>>();
let peakExtractionQueue = createPeakExtractionQueue();

function resolveWaveformExtractionConcurrency(): number {
  return isTauriRuntime()
    ? TAURI_WAVEFORM_EXTRACTION_CONCURRENCY
    : BROWSER_WAVEFORM_EXTRACTION_CONCURRENCY;
}

function createPeakExtractionQueue(concurrency = resolveWaveformExtractionConcurrency()): PQueue {
  return new PQueue({ concurrency });
}

export function runQueuedPeakExtraction(params: {
  path: string;
  cacheKey?: string;
  priority?: number;
  shouldCancel?: () => boolean;
  task: () => Promise<Float32Array[] | null>;
}): Promise<Float32Array[] | null> {
  const key = params.cacheKey ?? params.path;
  const existing = peakExtractionsByPath.get(key);
  if (existing) return existing;

  const queued = peakExtractionQueue.add(
    async () => {
      if (params.shouldCancel?.()) return null;
      return await params.task();
    },
    {
      priority: params.priority ?? WAVEFORM_EXTRACTION_PRIORITIES.visibleClip,
    },
  );

  peakExtractionsByPath.set(key, queued);
  void queued.then(
    () => {
      if (peakExtractionsByPath.get(key) === queued) {
        peakExtractionsByPath.delete(key);
      }
    },
    () => {
      if (peakExtractionsByPath.get(key) === queued) {
        peakExtractionsByPath.delete(key);
      }
    },
  );

  return queued;
}

/**
 * Test-only helper: drop the in-flight dedup map and reset the serial queue so
 * each spec starts from a clean state without re-importing the module.
 */
export function __resetWaveformExtractionQueueForTesting(
  concurrency = resolveWaveformExtractionConcurrency(),
): void {
  peakExtractionQueue.clear();
  peakExtractionsByPath.clear();
  peakExtractionQueue = createPeakExtractionQueue(concurrency);
}
