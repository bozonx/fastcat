import { runResilientFileWrite } from './io-governor';

type WritableData = string | BufferSource | Blob;

interface AtomicWritableHandle {
  createWritable(): Promise<FileSystemWritableFileStream>;
  move?: (destination: unknown, name: string) => Promise<void>;
}

interface AtomicWriteDir {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<AtomicWritableHandle>;
  removeEntry?(name: string, options?: { recursive?: boolean }): Promise<void>;
}

function createTempName(fileName: string): string {
  return `${fileName}.tmp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function writeAndClose(handle: AtomicWritableHandle, data: WritableData): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(data as FileSystemWriteChunkType);
    await writable.close();
  } catch (error) {
    await (writable as FileSystemWritableFileStream & { abort?: () => Promise<void> })
      .abort?.()
      .catch(() => undefined);
    throw error;
  }
}

function isDestinationLocked(error: unknown): boolean {
  const candidate = error as { name?: string; message?: string } | null;
  return (
    candidate?.name === 'NoModificationAllowedError' ||
    !!candidate?.message?.toLowerCase().includes('locked')
  );
}

/**
 * Atomically writes `data` to `fileName` inside `dir`.
 *
 * OPFS file handles truncate the moment `createWritable()` opens them, so a
 * crashed or failed write would otherwise leave a half-written cache file. This
 * stages the bytes in a sibling temp file and `move()`s it into place — the same
 * strategy the file-manager OPFS adapter uses. Where `move()` is unavailable
 * (Safari) or the destination is locked, it falls back to a direct overwrite
 * (non-atomic, best effort).
 *
 * Runs under the global write governor with transient-failure retry. It does NOT
 * serialize against concurrent writes/reads of the same path — compose it with a
 * per-path lock (e.g. `runQueuedFileAccess`) when callers can race on one file.
 */
export function writeFileAtomic(input: {
  dir: AtomicWriteDir;
  fileName: string;
  data: WritableData;
}): Promise<void> {
  return runResilientFileWrite(() => writeOnce(input.dir, input.fileName, input.data));
}

async function writeOnce(dir: AtomicWriteDir, fileName: string, data: WritableData): Promise<void> {
  const tempName = createTempName(fileName);
  const tempHandle = await dir.getFileHandle(tempName, { create: true });

  if (typeof tempHandle.move !== 'function') {
    // No atomic rename (e.g. Safari): discard the staging file and overwrite
    // the target directly. Non-atomic, but the best the platform allows.
    await dir.removeEntry?.(tempName).catch(() => undefined);
    const handle = await dir.getFileHandle(fileName, { create: true });
    await writeAndClose(handle, data);
    return;
  }

  try {
    await writeAndClose(tempHandle, data);
    await tempHandle.move(dir, fileName);
  } catch (error) {
    await dir.removeEntry?.(tempName).catch(() => undefined);
    if (isDestinationLocked(error)) {
      // Another context holds the destination open — fall back to direct write.
      const handle = await dir.getFileHandle(fileName, { create: true });
      await writeAndClose(handle, data);
      return;
    }
    throw error;
  }
}
