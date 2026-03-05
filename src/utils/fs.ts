export interface FsDirectoryHandleWithIteration extends FileSystemDirectoryHandle {
  values?: () => AsyncIterable<FileSystemHandle>;
  entries?: () => AsyncIterable<[string, FileSystemHandle]>;
}

export async function generateUniqueFsEntryName(params: {
  dirHandle: FileSystemDirectoryHandle;
  baseName: string;
  extension: string;
  existingNames?: string[];
  startIndex?: number;
}): Promise<string> {
  let index = params.startIndex ?? 1;
  let fileName = '';

  if (params.existingNames) {
    const existing = new Set(params.existingNames);
    do {
      fileName = `${params.baseName}${String(index).padStart(3, '0')}${params.extension}`;
      index++;
    } while (existing.has(fileName));
  } else {
    let exists = true;
    while (exists) {
      fileName = `${params.baseName}${String(index).padStart(3, '0')}${params.extension}`;
      try {
        await params.dirHandle.getFileHandle(fileName);
        index += 1;
      } catch (e: unknown) {
        const err = e as { name?: string };
        if (err?.name === 'NotFoundError') {
          exists = false;
          continue;
        }
        throw e;
      }
    }
  }

  return fileName;
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
