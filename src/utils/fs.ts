export interface FsDirectoryHandleWithIteration extends FileSystemDirectoryHandle {
  values?: () => AsyncIterable<FileSystemHandle>;
  entries?: () => AsyncIterable<[string, FileSystemHandle]>;
}

export async function computeDirectorySize(
  dirHandle: FileSystemDirectoryHandle,
  options?: { maxEntries?: number },
): Promise<number | undefined> {
  const maxEntries = options?.maxEntries ?? 25_000;
  let seen = 0;

  async function walk(handle: FileSystemDirectoryHandle): Promise<number> {
    const iterator =
      (handle as FsDirectoryHandleWithIteration).values?.() ??
      (handle as FsDirectoryHandleWithIteration).entries?.();
    if (!iterator) return 0;

    let total = 0;
    for await (const value of iterator) {
      if (seen >= maxEntries) {
        throw new Error('Directory too large');
      }
      seen += 1;

      const entryHandle = (Array.isArray(value) ? value[1] : value) as
        | FileSystemFileHandle
        | FileSystemDirectoryHandle;

      if (entryHandle.kind === 'file') {
        try {
          const file = await (entryHandle as FileSystemFileHandle).getFile();
          total += file.size;
        } catch {
          // ignore
        }
      } else {
        total += await walk(entryHandle as FileSystemDirectoryHandle);
      }
    }
    return total;
  }

  try {
    return await walk(dirHandle);
  } catch {
    return undefined;
  }
}
