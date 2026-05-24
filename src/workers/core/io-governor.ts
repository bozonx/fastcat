import { getWorkerIoBudget, installWorkerIoBudgetListener } from '~/utils/io/io-budget-worker';
import { isTransientIoError } from '~/utils/io/transient-errors';

/**
 * Detects whether a handle is a native OPFS `FileSystemFileHandle`.
 * Tauri handles are plain serialisable objects (they lose their prototype
 * methods when crossing a `postMessage` boundary), so this returns `false`
 * for them and the write governor is bypassed.
 */
function isNativeOpfsHandle(handle: unknown): boolean {
  try {
    return handle instanceof FileSystemFileHandle;
  } catch {
    return false;
  }
}

// Wire up the worker to the main-thread broadcast before any other
// messages can arrive.
installWorkerIoBudgetListener();

async function getBudget() {
  return getWorkerIoBudget();
}

/**
 * Run a short interactive I/O task (e.g. `getFile()`, small writes).
 * Shared with every worker and the main thread through the SAB semaphore.
 */
export async function withWorkerFileIoSlot<T>(task: () => Promise<T>): Promise<T> {
  const release = await (await getBudget()).acquire('interactive');
  try {
    return await task();
  } finally {
    release();
  }
}

/**
 * Run a long-running streaming I/O task (e.g. `createWritable()` that stays
 * open for minutes during export). Streaming slots are counted separately from
 * interactive ones so a handful of long-lived writables can't starve fast
 * metadata reads.
 */
export async function withWorkerStreamingFileIoSlot<T>(task: () => Promise<T>): Promise<T> {
  const release = await (await getBudget()).acquire('streaming');
  try {
    return await task();
  } finally {
    release();
  }
}

/**
 * Acquire a streaming slot manually for long-lived writables. Caller **must**
 * invoke the returned release function after `close()`/`abort()`.
 */
export async function acquireStreamingWorkerFileIoSlot(): Promise<() => void> {
  return (await getBudget()).acquire('streaming');
}

/**
 * Acquire a streaming slot manually.
 * @deprecated Prefer {@link acquireStreamingWorkerFileIoSlot} explicitly.
 */
export async function acquireWorkerFileIoSlot(): Promise<() => void> {
  return acquireStreamingWorkerFileIoSlot();
}

export function withWorkerFileIoSlotForHandle<T>(
  handle: unknown,
  task: () => Promise<T>,
): Promise<T> {
  if (!isNativeOpfsHandle(handle)) {
    return task();
  }
  return withWorkerFileIoSlot(task);
}

/**
 * @deprecated Prefer {@link withWorkerFileIoSlot}; kept for compat.
 */
export function withWorkerFileWriteSlot<T>(task: () => Promise<T>): Promise<T> {
  return withWorkerFileIoSlot(task);
}

/**
 * @deprecated Prefer {@link withWorkerFileIoSlotForHandle}; kept for compat.
 */
export function withWorkerFileWriteSlotForHandle<T>(
  handle: unknown,
  task: () => Promise<T>,
): Promise<T> {
  return withWorkerFileIoSlotForHandle(handle, task);
}

export { isTransientIoError };

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    if (typeof self !== 'undefined' && 'setTimeout' in self) {
      self.setTimeout(resolve, ms);
    } else {
      setTimeout(resolve, ms);
    }
  });

/**
 * Run a resilient interactive I/O operation in a worker (reads, short writes).
 * Retries transient datapipe exhaustion with exponential backoff.
 */
export async function runResilientWorkerFileIo<T>(
  handle: unknown,
  task: () => Promise<T>,
  options?: { attempts?: number; baseDelayMs?: number },
): Promise<T> {
  const attempts = Math.max(1, Math.round(options?.attempts ?? 4));
  const baseDelayMs = Math.max(1, Math.round(options?.baseDelayMs ?? 150));

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await withWorkerFileIoSlotForHandle(handle, task);
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1 || !isTransientIoError(error)) {
        throw error;
      }
      await delay(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
}

/**
 * Run a resilient streaming write operation in a worker (long-lived
 * `createWritable()` calls, large copies). Uses the streaming pool so the
 * open writable is counted against the shared budget while it lives.
 */
export async function runResilientWorkerFileWrite<T>(
  handle: unknown,
  task: () => Promise<T>,
  options?: { attempts?: number; baseDelayMs?: number },
): Promise<T> {
  const attempts = Math.max(1, Math.round(options?.attempts ?? 4));
  const baseDelayMs = Math.max(1, Math.round(options?.baseDelayMs ?? 150));

  const isOpfs = isNativeOpfsHandle(handle);
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (!isOpfs) return await task();
      const release = await (await getBudget()).acquire('streaming');
      try {
        return await task();
      } finally {
        release();
      }
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1 || !isTransientIoError(error)) {
        throw error;
      }
      await delay(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
}
