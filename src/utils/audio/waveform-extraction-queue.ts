const peakExtractionsByPath = new Map<string, Promise<Float32Array[] | null>>();
let peakExtractionQueue = Promise.resolve();

export function runQueuedPeakExtraction(params: {
  path: string;
  cacheKey?: string;
  shouldCancel?: () => boolean;
  task: () => Promise<Float32Array[] | null>;
}): Promise<Float32Array[] | null> {
  const key = params.cacheKey ?? params.path;
  const existing = peakExtractionsByPath.get(key);
  if (existing) return existing;

  const queued = peakExtractionQueue
    .catch(() => {
      // Keep the queue alive after a failed extraction.
    })
    .then(async () => {
      if (params.shouldCancel?.()) return null;
      return await params.task();
    });

  peakExtractionQueue = queued.then(
    () => undefined,
    () => undefined,
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
export function __resetWaveformExtractionQueueForTesting(): void {
  peakExtractionsByPath.clear();
  peakExtractionQueue = Promise.resolve();
}
