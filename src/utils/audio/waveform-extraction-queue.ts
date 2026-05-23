const peakExtractionsByPath = new Map<string, Promise<Float32Array[] | null>>();
let peakExtractionQueue = Promise.resolve();

export function runQueuedPeakExtraction(params: {
  path: string;
  shouldCancel?: () => boolean;
  task: () => Promise<Float32Array[] | null>;
}): Promise<Float32Array[] | null> {
  const existing = peakExtractionsByPath.get(params.path);
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

  peakExtractionsByPath.set(params.path, queued);
  void queued.then(
    () => {
      if (peakExtractionsByPath.get(params.path) === queued) {
        peakExtractionsByPath.delete(params.path);
      }
    },
    () => {
      if (peakExtractionsByPath.get(params.path) === queued) {
        peakExtractionsByPath.delete(params.path);
      }
    },
  );

  return queued;
}
