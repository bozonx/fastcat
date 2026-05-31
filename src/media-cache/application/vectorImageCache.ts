import { createDevLogger } from '~/utils/dev-logger';
import { rasterizeSvgToBlob } from '~/utils/svg';
import type { ResolvedStorageTopology } from '~/utils/storage-topology';
import { toProjectTempVfsPath } from '~/utils/storage-topology';
import { ensureResolvedProjectTempDir } from '~/utils/storage-handles';
import { withFileWriteSlot, withFileIoSlot } from '~/utils/io/io-governor';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import { CACHE_ROOT_DIR_NAME } from '~/utils/storage-roots';
const log = createDevLogger('vectorImageCache');

const VECTOR_IMAGE_CACHE_VERSION = 'v3';

export interface EnsureVectorImageRasterParams {
  projectId: string;
  projectRelativePath: string;
  width: number;
  height: number;
  sourceFileHandle: FileSystemFileHandle;
  workspaceHandle: FileSystemDirectoryHandle;
  resolvedStorageTopology?: ResolvedStorageTopology;
}

export interface ClearVectorImageRasterParams {
  projectId: string;
  projectRelativePath: string;
  workspaceHandle: FileSystemDirectoryHandle;
  resolvedStorageTopology?: ResolvedStorageTopology;
}

function hashString(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `h${(hash >>> 0).toString(16)}`;
}

function normalizeDimension(value: number): number {
  const rounded = Math.round(Number(value) || 0);
  return Math.max(1, rounded);
}

function getVectorImageSourceDirName(projectRelativePath: string): string {
  return hashString(projectRelativePath);
}

function getVectorImageRasterFileName(params: {
  sourceFile: File;
  width: number;
  height: number;
}): string {
  const sourceStamp = `${params.sourceFile.lastModified}:${params.sourceFile.size}`;
  const dims = `${normalizeDimension(params.width)}x${normalizeDimension(params.height)}`;
  return `${hashString(`${VECTOR_IMAGE_CACHE_VERSION}:${sourceStamp}:${dims}`)}.png`;
}

async function ensureDirectory(
  root: FileSystemDirectoryHandle,
  segments: string[],
): Promise<FileSystemDirectoryHandle> {
  let dir = root;
  for (const segment of segments) {
    dir = await dir.getDirectoryHandle(segment, { create: true });
  }
  return dir;
}

async function ensureVectorImageCacheRoot(input: {
  projectId: string;
  workspaceHandle: FileSystemDirectoryHandle;
  resolvedStorageTopology?: ResolvedStorageTopology;
  create?: boolean;
}): Promise<FileSystemDirectoryHandle> {
  if (input.resolvedStorageTopology) {
    return (await ensureResolvedProjectTempDir({
      workspaceHandle: input.workspaceHandle,
      topology: input.resolvedStorageTopology,
      projectId: input.projectId,
      leafSegments: ['cache', 'vector_image'],
      create: input.create,
    })) as FileSystemDirectoryHandle;
  }

  throw new Error('Vector image cache requires resolved storage topology');
}

export async function ensureVectorImageRaster(
  params: EnsureVectorImageRasterParams,
): Promise<FileSystemFileHandle> {
  const width = normalizeDimension(params.width);
  const height = normalizeDimension(params.height);
  const sourceFile = await withFileIoSlot(() => params.sourceFileHandle.getFile());

  const cacheRoot = await ensureVectorImageCacheRoot({
    projectId: params.projectId,
    workspaceHandle: params.workspaceHandle,
    resolvedStorageTopology: params.resolvedStorageTopology,
    create: true,
  });
  const sourceDir = await ensureDirectory(cacheRoot, [
    getVectorImageSourceDirName(params.projectRelativePath),
  ]);
  const fileName = getVectorImageRasterFileName({ sourceFile, width, height });

  const sourceStamp = `${sourceFile.lastModified}:${sourceFile.size}`;
  const versionFileName = 'version.json';
  let isSameVersion = false;

  try {
    const versionHandle = await sourceDir.getFileHandle(versionFileName);
    const versionFile = await withFileIoSlot(() => versionHandle.getFile());
    const versionText = await withFileIoSlot(() => versionFile.text());
    const versionData = JSON.parse(versionText) as { sourceStamp: string };
    if (versionData.sourceStamp === sourceStamp) {
      isSameVersion = true;
    }
  } catch {
    // version file does not exist or is invalid
  }

  if (!isSameVersion) {
    try {
      const entriesToDelete: string[] = [];
      for await (const entry of (
        sourceDir as unknown as {
          values: () => AsyncIterable<{ kind: string; name: string }>;
        }
      ).values()) {
        entriesToDelete.push(entry.name);
      }
      for (const name of entriesToDelete) {
        await sourceDir.removeEntry(name, { recursive: true }).catch(() => {});
      }
    } catch (e) {
      log.warn('Failed to clean stale vector image cache files', e);
    }

    try {
      const versionHandle = await sourceDir.getFileHandle(versionFileName, { create: true });
      await withFileWriteSlot(async () => {
        const writable = await (
          versionHandle as unknown as {
            createWritable: () => Promise<FileSystemWritableFileStream>;
          }
        ).createWritable();
        await writable.write(JSON.stringify({ sourceStamp }));
        await writable.close();
      });
    } catch (e) {
      log.warn('Failed to write vector cache version file', e);
    }
  }

  try {
    return await sourceDir.getFileHandle(fileName);
  } catch (error) {
    const err = error as { name?: string };
    if (err?.name !== 'NotFoundError') throw error;
  }

  const blob = await rasterizeSvgToBlob(sourceFile, {
    maxWidth: width,
    maxHeight: height,
  });
  const fileHandle = await sourceDir.getFileHandle(fileName, { create: true });
  const createWritable = (fileHandle as FileSystemFileHandle).createWritable;
  if (typeof createWritable !== 'function') {
    throw new Error('Failed to write vector image cache: createWritable is not available');
  }

  await withFileWriteSlot(async () => {
    const writable = await createWritable.call(fileHandle);
    await writable.write(blob);
    await writable.close();
  });
  return fileHandle;
}

export async function clearVectorImageRaster(params: ClearVectorImageRasterParams): Promise<void> {
  try {
    const cacheRoot = await ensureVectorImageCacheRoot({
      projectId: params.projectId,
      workspaceHandle: params.workspaceHandle,
      resolvedStorageTopology: params.resolvedStorageTopology,
    });
    await cacheRoot.removeEntry(getVectorImageSourceDirName(params.projectRelativePath), {
      recursive: true,
    });
  } catch (error) {
    const err = error as { name?: string };
    if (err?.name !== 'NotFoundError') {
      log.warn('Failed to clear vector image cache', error);
    }
  }
}

/**
 * VFS-based variant of {@link clearVectorImageRaster}. Removes the cached
 * raster directory for a vector image source via VFS, avoiding handle
 * dependencies. Preferred on the main thread where VFS is available.
 */
export async function clearVectorImageRasterVfs(params: {
  vfs: IFileSystemAdapter;
  projectId: string;
  projectRelativePath: string;
}): Promise<void> {
  const sourceDirName = getVectorImageSourceDirName(params.projectRelativePath);
  const vfsPath = toProjectTempVfsPath(params.projectId, [
    CACHE_ROOT_DIR_NAME,
    'vector_image',
    sourceDirName,
  ]);
  try {
    await params.vfs.deleteEntry(vfsPath, true);
  } catch (error) {
    const err = error as { name?: string };
    if (err?.name !== 'NotFoundError') {
      log.warn('Failed to clear vector image cache via VFS', error);
    }
  }
}
