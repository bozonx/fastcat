import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import { withFileIoSlot } from '~/utils/io/io-governor';

export type FsDirectoryHandleWithIteration = FileSystemDirectoryHandle;

export async function generateUniqueFsEntryName(params: {
  vfs: IFileSystemAdapter;
  dirPath: string;
  baseName: string;
  extension: string;
  existingNames?: string[];
  startIndex?: number;
  padWidth?: number;
}): Promise<string> {
  let index = params.startIndex ?? 1;
  const padWidth = params.padWidth ?? 3;
  let fileName = '';

  if (params.existingNames) {
    const existing = new Set(params.existingNames);
    do {
      fileName = `${params.baseName}${String(index).padStart(padWidth, '0')}${params.extension}`;
      index++;
    } while (existing.has(fileName));
  } else {
    let exists = true;
    while (exists) {
      fileName = `${params.baseName}${String(index).padStart(padWidth, '0')}${params.extension}`;
      const nextPath = params.dirPath ? `${params.dirPath}/${fileName}` : fileName;
      if (await params.vfs.exists(nextPath)) {
        index += 1;
      } else {
        exists = false;
      }
    }
  }

  // Verify against the filesystem as a safety net in case existingNames was stale.
  let verifyPath = params.dirPath ? `${params.dirPath}/${fileName}` : fileName;
  while (await params.vfs.exists(verifyPath)) {
    fileName = `${params.baseName}${String(index).padStart(padWidth, '0')}${params.extension}`;
    index++;
    verifyPath = params.dirPath ? `${params.dirPath}/${fileName}` : fileName;
  }

  return fileName;
}

export interface DirectoryStats {
  size: number;
  filesCount: number;
  /** True when traversal stopped because the maxEntries limit was reached. */
  truncated?: boolean;
}

class DirectoryTooLargeError extends Error {
  partial: DirectoryStats;
  constructor(partial: DirectoryStats) {
    super('Directory too large');
    this.partial = partial;
  }
}

/**
 * Walks a directory tree and aggregates byte size and file count.
 *
 * Errors propagate to the caller — the function does not blanket-catch them so
 * that "directory not found" and "permission denied" can be distinguished from
 * a valid empty result. The `truncated` flag signals that traversal stopped
 * because the maxEntries limit was reached; partial stats are still returned.
 */
export async function computeDirectoryStats(
  dirHandle: FileSystemDirectoryHandle,
  options?: { maxEntries?: number; recursiveFilesCount?: boolean },
): Promise<DirectoryStats> {
  const maxEntries = options?.maxEntries ?? 25_000;
  const recursiveFilesCount = options?.recursiveFilesCount ?? true;
  let seen = 0;
  let totalSizeAcrossWalk = 0;
  let totalFilesAcrossWalk = 0;

  async function walk(handle: FileSystemDirectoryHandle, isRoot = true): Promise<DirectoryStats> {
    const iterator =
      (handle as FsDirectoryHandleWithIteration).values?.() ??
      (handle as FsDirectoryHandleWithIteration).entries?.();
    if (!iterator) return { size: 0, filesCount: 0 };

    let totalSize = 0;
    let totalFiles = 0;
    for await (const value of iterator) {
      if (seen >= maxEntries) {
        throw new DirectoryTooLargeError({
          size: totalSizeAcrossWalk,
          filesCount: totalFilesAcrossWalk,
          truncated: true,
        });
      }
      seen += 1;

      const entryHandle = (Array.isArray(value) ? value[1] : value) as
        | FileSystemFileHandle
        | FileSystemDirectoryHandle;

      if (entryHandle.kind === 'file') {
        try {
          const file = await withFileIoSlot(() => (entryHandle as FileSystemFileHandle).getFile());
          totalSize += file.size;
          totalSizeAcrossWalk += file.size;
          if (isRoot || recursiveFilesCount) {
            totalFiles += 1;
            totalFilesAcrossWalk += 1;
          }
        } catch {
          // Individual file read failure (e.g. revoked permission) is
          // non-fatal: we skip it and continue with the rest of the tree.
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
  } catch (e) {
    if (e instanceof DirectoryTooLargeError) {
      return e.partial;
    }
    throw e;
  }
}
