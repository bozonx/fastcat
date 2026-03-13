import { rasterizeSvgToBlob } from '~/utils/svg';
import type { ResolvedStorageTopology } from '~/utils/storage-topology';
import { ensureResolvedProjectTempDir } from '~/utils/storage-handles';
import { getProjectCacheSegments } from '~/utils/vardata-paths';

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
      leafSegments: ['frame-cache', 'vector_image'],
      create: input.create,
    })) as FileSystemDirectoryHandle;
  }

  return await (input.create ? ensureDirectory : getDirectory)(input.workspaceHandle, [
    ...getProjectCacheSegments(input.projectId),
    'vector_image',
  ]);
}

async function getDirectory(
  root: FileSystemDirectoryHandle,
  segments: string[],
): Promise<FileSystemDirectoryHandle> {
  let dir = root;
  for (const segment of segments) {
    dir = await dir.getDirectoryHandle(segment);
  }
  return dir;
}

export async function ensureVectorImageRaster(
  params: EnsureVectorImageRasterParams,
): Promise<FileSystemFileHandle> {
  const width = normalizeDimension(params.width);
  const height = normalizeDimension(params.height);
  const sourceFile = await params.sourceFileHandle.getFile();

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

  const writable = await createWritable.call(fileHandle);
  await writable.write(blob);
  await writable.close();
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
      console.warn('Failed to clear vector image cache', error);
    }
  }
}
