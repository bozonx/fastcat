import PQueue from 'p-queue';
import { FILE_IO_LIMITS } from '~/utils/constants';

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

const workerIoQueue = new PQueue({ concurrency: FILE_IO_LIMITS.MAX_CONCURRENT_FILE_IO });

export function withWorkerFileIoSlot<T>(task: () => Promise<T>): Promise<T> {
  return workerIoQueue.add(task) as Promise<T>;
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
 * @deprecated Prefer {@link withWorkerFileIoSlot}; kept for compat and routes
 *   through the unified worker I/O queue.
 */
export function withWorkerFileWriteSlot<T>(task: () => Promise<T>): Promise<T> {
  return workerIoQueue.add(task) as Promise<T>;
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

export function isTransientIoError(error: unknown): boolean {
  const candidate = error as { name?: unknown; message?: unknown } | null | undefined;
  const name = typeof candidate?.name === 'string' ? candidate.name : '';
  const message = typeof candidate?.message === 'string' ? candidate.message : '';
  return name === 'InvalidStateError' || /datapipe|failed to create/i.test(message);
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    if (typeof self !== 'undefined' && 'setTimeout' in self) {
      self.setTimeout(resolve, ms);
    } else {
      setTimeout(resolve, ms);
    }
  });

/**
 * Run a resilient file I/O operation in a worker that retries transient datapipe
 * exhaustion with exponential backoff.
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
 * Run a resilient file write operation in a worker (analogous to runResilientWorkerFileIo).
 */
export async function runResilientWorkerFileWrite<T>(
  handle: unknown,
  task: () => Promise<T>,
  options?: { attempts?: number; baseDelayMs?: number },
): Promise<T> {
  return runResilientWorkerFileIo(handle, task, options);
}

