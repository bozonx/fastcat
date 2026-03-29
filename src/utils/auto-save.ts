import PQueue from 'p-queue';

export interface AutoSaveOptions {
  /**
   * The actual save function.
   * Return `false` to indicate that the save was skipped (e.g. preconditions not met),
   * so the revision is not marked as saved.
   */
  doSave: () => Promise<boolean | void>;
  /**
   * Optional error handler.
   */
  onError?: (e: unknown) => void;
  /**
   * Debounce time in milliseconds. Default is 500.
   */
  debounceMs?: number;
}

export function createAutoSave(options: AutoSaveOptions) {
  let persistTimeout: number | null = null;
  let currentRevision = 0;
  let savedRevision = 0;
  const saveQueue = new PQueue({ concurrency: 1 });
  const debounceMs = options.debounceMs ?? 500;

  function clearPersistTimeout() {
    if (typeof window === 'undefined') return;
    if (persistTimeout === null) return;
    window.clearTimeout(persistTimeout);
    persistTimeout = null;
  }

  function markDirty() {
    currentRevision += 1;
  }

  function markCleanForCurrentRevision() {
    savedRevision = currentRevision;
  }

  function reset() {
    clearPersistTimeout();
    currentRevision = 0;
    savedRevision = 0;
  }

  function isDirty() {
    return savedRevision < currentRevision;
  }

  async function persistNow() {
    if (savedRevision >= currentRevision) return;

    const revisionToSave = currentRevision;
    try {
      const success = await options.doSave();

      if (success !== false) {
        if (savedRevision < revisionToSave) {
          savedRevision = revisionToSave;
        }
      }
    } catch (e) {
      if (options.onError) {
        options.onError(e);
      } else {
        console.warn('AutoSave failed', e);
      }
    }
  }

  async function enqueueSave() {
    await saveQueue.add(async () => {
      await persistNow();
    });
  }

  async function requestSave(opts?: { immediate?: boolean }) {
    if (opts?.immediate) {
      clearPersistTimeout();
      await enqueueSave();
      return;
    }

    if (typeof window === 'undefined') {
      await enqueueSave();
      return;
    }

    clearPersistTimeout();
    persistTimeout = window.setTimeout(() => {
      persistTimeout = null;
      void enqueueSave();
    }, debounceMs);
  }

  return {
    markDirty,
    markCleanForCurrentRevision,
    reset,
    isDirty,
    requestSave,
  };
}
