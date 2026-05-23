import PQueue from 'p-queue';

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

const workerWriteQueue = new PQueue({ concurrency: 2 });

export function withWorkerFileWriteSlot<T>(task: () => Promise<T>): Promise<T> {
  return workerWriteQueue.add(task) as Promise<T>;
}

export function withWorkerFileWriteSlotForHandle<T>(
  handle: unknown,
  task: () => Promise<T>,
): Promise<T> {
  if (!isNativeOpfsHandle(handle)) {
    return task();
  }
  return withWorkerFileWriteSlot(task);
}
