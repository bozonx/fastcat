import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';

export interface FsDirectoryHandleWithIteration extends FileSystemDirectoryHandle {
  values?: () => AsyncIterable<FileSystemHandle>;
  entries?: () => AsyncIterable<[string, FileSystemHandle]>;
}

export async function generateUniqueFsEntryName(params: {
  vfs: IFileSystemAdapter;
  dirPath: string;
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
      const nextPath = params.dirPath ? `${params.dirPath}/${fileName}` : fileName;
      if (await params.vfs.exists(nextPath)) {
        index += 1;
      } else {
        exists = false;
      }
    }
  }

  return fileName;
}

export interface DirectoryStats {
  size: number;
  filesCount: number;
}

export async function computeDirectoryStats(
  dirHandle: FileSystemDirectoryHandle,
  options?: { maxEntries?: number; recursiveFilesCount?: boolean },
): Promise<DirectoryStats | undefined> {
  const maxEntries = options?.maxEntries ?? 25_000;
  const recursiveFilesCount = options?.recursiveFilesCount ?? true;
  let seen = 0;

  async function walk(handle: FileSystemDirectoryHandle, isRoot = true): Promise<DirectoryStats> {
    const iterator =
      (handle as FsDirectoryHandleWithIteration).values?.() ??
      (handle as FsDirectoryHandleWithIteration).entries?.();
    if (!iterator) return { size: 0, filesCount: 0 };

    let totalSize = 0;
    let totalFiles = 0;
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
          totalSize += file.size;
          if (isRoot || recursiveFilesCount) {
            totalFiles += 1;
          }
        } catch {
          // ignore
        }
      } else {
        const sub = await walk(entryHandle as FileSystemDirectoryHandle, false);
        totalSize += sub.size;
        if (recursiveFilesCount) {
          totalFiles += sub.filesCount;
        }
      }
    }
    return { size: totalSize, filesCount: totalFiles };
  }

  try {
    return await walk(dirHandle);
  } catch {
    return undefined;
  }
}
