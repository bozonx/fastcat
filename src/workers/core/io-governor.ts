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
