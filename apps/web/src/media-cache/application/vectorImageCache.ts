import { createDevLogger } from '~/utils/dev-logger';
import { rasterizeSvgToBlob } from '~/utils/svg';
import { toProjectTempVfsPath } from '~/utils/storage-topology';
import { withFileIoSlot } from '~/utils/io/io-governor';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import { CACHE_ROOT_DIR_NAME } from '~/utils/storage-roots';
import { normalizeMediaCachePath } from '~/utils/path';
import { hashString } from '~/utils/base-thumbnail-generator';
const log = createDevLogger('vectorImageCache');

const VECTOR_IMAGE_CACHE_VERSION = 'v3';

export interface EnsureVectorImageRasterParams {
  projectId: string;
  projectRelativePath: string;
  width: number;
  height: number;
  sourceFileHandle: FileSystemFileHandle;
  vfs: IFileSystemAdapter;
}

function normalizeDimension(value: number): number {
  const rounded = Math.round(Number(value) || 0);
  return Math.max(1, rounded);
}

function getVectorImageSourceDirName(projectRelativePath: string): string {
  return hashString(normalizeMediaCachePath(projectRelativePath));
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

function getVectorImageCacheRootVfsPath(projectId: string): string {
  return toProjectTempVfsPath(projectId, [CACHE_ROOT_DIR_NAME, 'vector_image']);
}

function getVectorImageSourceVfsPath(params: {
  projectId: string;
  projectRelativePath: string;
}): string {
  return `${getVectorImageCacheRootVfsPath(params.projectId)}/${getVectorImageSourceDirName(
    params.projectRelativePath,
  )}`;
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    ((error as { name?: unknown }).name === 'NotFoundError' ||
      (error as { name?: unknown }).name === 'VfsNotFoundError')
  );
}

export async function ensureVectorImageRaster(
  params: EnsureVectorImageRasterParams,
): Promise<File> {
  const width = normalizeDimension(params.width);
  const height = normalizeDimension(params.height);
  const sourceFile = await withFileIoSlot(() => params.sourceFileHandle.getFile());

  const sourceDirPath = getVectorImageSourceVfsPath({
    projectId: params.projectId,
    projectRelativePath: params.projectRelativePath,
  });
  const fileName = getVectorImageRasterFileName({ sourceFile, width, height });
  const filePath = `${sourceDirPath}/${fileName}`;

  const sourceStamp = `${sourceFile.lastModified}:${sourceFile.size}`;
  const versionFileName = 'version.json';
  let isSameVersion = false;

  try {
    const versionFile = await params.vfs.readFile(`${sourceDirPath}/${versionFileName}`);
    const versionText = await versionFile.text();
    const versionData = JSON.parse(versionText) as { sourceStamp: string };
    if (versionData.sourceStamp === sourceStamp) {
      isSameVersion = true;
    }
  } catch {
    // version file does not exist or is invalid
  }

  if (!isSameVersion) {
    try {
      const entries = await params.vfs.readDirectory(sourceDirPath);
      await Promise.allSettled(
        entries.map((entry) =>
          params.vfs.deleteEntry(`${sourceDirPath}/${entry.name}`, true).catch(() => {}),
        ),
      );
    } catch (e) {
      if (!isNotFoundError(e)) {
        log.warn('Failed to clean stale vector image cache files', e);
      }
    }

    try {
      await params.vfs.writeFile(
        `${sourceDirPath}/${versionFileName}`,
        JSON.stringify({ sourceStamp }),
      );
    } catch (e) {
      log.warn('Failed to write vector cache version file', e);
    }
  }

  try {
    const cached = await params.vfs.readFile(filePath);
    return new File([cached], fileName, { type: cached.type || 'image/png' });
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }

  const blob = await rasterizeSvgToBlob(sourceFile, {
    maxWidth: width,
    maxHeight: height,
  });
  await params.vfs.writeFile(filePath, blob);
  return new File([blob], fileName, { type: blob.type || 'image/png' });
}

export async function clearVectorImageRasterVfs(params: {
  vfs: IFileSystemAdapter;
  projectId: string;
  projectRelativePath: string;
}): Promise<void> {
  const vfsPath = getVectorImageSourceVfsPath({
    projectId: params.projectId,
    projectRelativePath: params.projectRelativePath,
  });
  try {
    await params.vfs.deleteEntry(vfsPath, true);
  } catch (error) {
    if (!isNotFoundError(error)) {
      log.warn('Failed to clear vector image cache via VFS', error);
    }
  }
}
