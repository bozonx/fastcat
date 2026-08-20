import { getWorkerIoBudget, installWorkerIoBudgetListener } from '~/utils/io/io-budget-worker';
import { isTransientIoError } from '~/utils/io/transient-errors';
import { watchHeldSlot } from '~/utils/io/slot-watchdog';
import { FILE_IO_LIMITS } from '~/utils/constants';

function watchInteractive(release: () => void): () => void {
  return watchHeldSlot(release, {
    label: 'worker-interactive',
    warnMs: FILE_IO_LIMITS.SLOT_HOLD_WARN_MS_INTERACTIVE,
  });
}

function watchStreaming(release: () => void): () => void {
  return watchHeldSlot(release, {
    label: 'worker-streaming',
    warnMs: FILE_IO_LIMITS.SLOT_HOLD_WARN_MS_STREAMING,
  });
}

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
  const release = watchInteractive(await (await getBudget()).acquire('interactive'));
  try {
    return await task();
  } finally {
    release();
  }
}

/**
 * Acquire a streaming slot manually for long-lived writables (e.g. an export
 * `createWritable()` open for minutes). Caller **must** invoke the returned
 * release function after `close()`/`abort()`. Streaming slots are counted
 * separately from interactive ones so a handful of long-lived writables can't
 * starve fast metadata reads.
 */
export async function acquireStreamingWorkerFileIoSlot(): Promise<() => void> {
  return watchStreaming(await (await getBudget()).acquire('streaming'));
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
