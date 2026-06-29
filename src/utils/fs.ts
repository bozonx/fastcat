import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import { useWorkspaceStore } from '~/stores/workspace.store';
import type { FsEntry } from '~/types/fs';
import { withFileIoSlot } from '~/utils/io/io-governor';
import { VIDEO_EXTENSIONS } from '~/utils/media-types';
import { getNextIncrementName } from '~/utils/filename-increment';

export type FsDirectoryHandleWithIteration = FileSystemDirectoryHandle;

/**
 * Resolves a FileSystemFileHandle for a project-relative path within the
 * current workspace. Returns null if the workspace handle is unavailable or
 * the path cannot be resolved.
 */
export async function getWorkspaceFileHandle(
  path: string,
  options?: { create?: boolean },
): Promise<FileSystemFileHandle | null> {
  const workspaceStore = useWorkspaceStore();
  const workspaceHandle = workspaceStore.workspaceHandle;
  if (!workspaceHandle) return null;

  const parts = path.split('/').filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) return null;

  try {
    let currentDir = workspaceHandle;
    for (const part of parts) {
      currentDir = await currentDir.getDirectoryHandle(part, {
        create: options?.create ?? false,
      });
    }

    return await currentDir.getFileHandle(fileName, {
      create: options?.create ?? false,
    });
  } catch {
    return null;
  }
}

/**
 * Checks if a proxy is currently being generated for any direct child of the given directory.
 */
export function isGeneratingProxyInDirectory(
  entry: FsEntry,
  generatingProxies: Set<string> | string[],
): boolean {
  if (entry.kind !== 'directory') return false;
  const dirPath = entry.path;
  for (const p of generatingProxies) {
    if (!dirPath) {
      if (!p.includes('/')) return true;
    } else {
      if (p.startsWith(`${dirPath}/`)) {
        const rel = p.slice(dirPath.length + 1);
        if (!rel.includes('/')) return true;
      }
    }
  }
  return false;
}

/**
 * Checks if any direct file children of a directory have a video extension.
 */
export function folderHasVideos(entry: FsEntry): boolean {
  if (entry.kind !== 'directory') return false;
  const children = Array.isArray(entry.children) ? entry.children : [];
  return children.some(
    (child) =>
      child.kind === 'file' &&
      VIDEO_EXTENSIONS.includes(child.name.split('.').pop()?.toLowerCase() ?? ''),
  );
}

export async function generateUniqueFsEntryName(params: {
  vfs: IFileSystemAdapter;
  dirPath: string;
  baseName: string;
  extension: string;
  existingNames?: string[];
  startIndex?: number;
  padWidth?: number;
}): Promise<string> {
  const startIndex = params.startIndex ?? 1;
  const padWidth = params.padWidth ?? 3;
  const extension = params.extension;

  let names = params.existingNames;
  if (!names) {
    names =
      typeof params.vfs.listEntryNames === 'function'
        ? await params.vfs.listEntryNames(params.dirPath)
        : [];
  }

  // Determine actual style and clean base name based on the baseName suffix
  let style: 'underscore' | 'parentheses' | 'space' | 'none' = 'none';
  let cleanBaseName = params.baseName;
  if (cleanBaseName.endsWith('_')) {
    style = 'underscore';
    cleanBaseName = cleanBaseName.slice(0, -1);
  } else if (cleanBaseName.endsWith(' ')) {
    style = 'space';
    cleanBaseName = cleanBaseName.slice(0, -1);
  }

  const dummyFileName = `${cleanBaseName}${extension}`;
  let proposedName = getNextIncrementName({
    fileName: dummyFileName,
    existingNames: names,
    style,
    padWidth,
    startIndex,
    forceIndex: true,
  });

  // Verify against the filesystem as a safety net in case existingNames was stale.
  let verifyPath = params.dirPath ? `${params.dirPath}/${proposedName}` : proposedName;
  const currentNames = [...names];
  while (await params.vfs.exists(verifyPath)) {
    currentNames.push(proposedName);
    proposedName = getNextIncrementName({
      fileName: dummyFileName,
      existingNames: currentNames,
      style,
      padWidth,
      startIndex,
      forceIndex: true,
    });
    verifyPath = params.dirPath ? `${params.dirPath}/${proposedName}` : proposedName;
  }

  return proposedName;
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

/**
 * VFS-native variant of {@link computeDirectoryStats}: walks a directory tree by
 * path through the application VFS, aggregating byte size and file count.
 * Returns partial stats with `truncated: true` if `maxEntries` is hit.
 */
export async function computeDirectoryStatsByPath(
  vfs: IFileSystemAdapter,
  dirPath: string,
  options?: { maxEntries?: number; recursiveFilesCount?: boolean },
): Promise<DirectoryStats> {
  const maxEntries = options?.maxEntries ?? 25_000;
  const recursiveFilesCount = options?.recursiveFilesCount ?? true;
  let seen = 0;
  let totalSizeAcrossWalk = 0;
  let totalFilesAcrossWalk = 0;

  async function walk(path: string, isRoot = true): Promise<DirectoryStats> {
    const entries = await vfs.readDirectory(path);
    let totalSize = 0;
    let totalFiles = 0;
    for (const entry of entries) {
      if (seen >= maxEntries) {
        throw new DirectoryTooLargeError({
          size: totalSizeAcrossWalk,
          filesCount: totalFilesAcrossWalk,
          truncated: true,
        });
      }
      seen += 1;

      if (entry.kind === 'file') {
        try {
          const metadata = await vfs.getMetadata(entry.path);
          const size = metadata?.kind === 'file' ? metadata.size : 0;
          totalSize += size;
          totalSizeAcrossWalk += size;
          if (isRoot || recursiveFilesCount) {
            totalFiles += 1;
            totalFilesAcrossWalk += 1;
          }
        } catch {
          // Non-fatal: skip unreadable entry.
        }
      } else {
        const sub = await walk(entry.path, false);
        totalSize += sub.size;
        if (recursiveFilesCount) {
          totalFiles += sub.filesCount;
        }
      }
    }
    return { size: totalSize, filesCount: totalFiles };
  }

  try {
    return await walk(dirPath);
  } catch (e) {
    if (e instanceof DirectoryTooLargeError) {
      return e.partial;
    }
    throw e;
  }
}
