import type { DirectoryHandleLike } from '~/repositories/fastcat-fs';
import { PROJECTS_ROOT_DIR_NAME, THUMBNAILS_ROOT_DIR_NAME } from './storage-roots';
import { toStoragePathSegments, type ResolvedStorageTopology } from './storage-topology';

function trimPath(path: string): string {
  return path.trim();
}

function isAbsoluteStoragePath(path: string): boolean {
  const normalized = trimPath(path);
  return /^\//.test(normalized) || /^[a-zA-Z]:[\\/]/.test(normalized);
}

function getPathBaseName(path: string): string {
  const normalized = trimPath(path).replace(/[\\/]+$/, '');
  if (!normalized) return 'root';

  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? 'root';
}

function createDirectoryHandleLikeFromPath(
  workspaceHandle: DirectoryHandleLike,
  path: string,
): DirectoryHandleLike {
  const handleWithConstructor = workspaceHandle as unknown as {
    constructor: new (path: string, name: string) => DirectoryHandleLike;
  };
  const HandleCtor = handleWithConstructor.constructor;

  return new HandleCtor(path, getPathBaseName(path));
}

export async function ensureDirectoryChain(input: {
  baseDir: DirectoryHandleLike;
  segments: string[];
  create?: boolean;
}): Promise<DirectoryHandleLike> {
  let currentDir = input.baseDir;

  for (const segment of input.segments) {
    currentDir = await currentDir.getDirectoryHandle(segment, { create: input.create });
  }

  return currentDir;
}

export async function resolveStorageRootHandle(input: {
  workspaceHandle: DirectoryHandleLike;
  rootPath: string;
  create?: boolean;
}): Promise<DirectoryHandleLike> {
  const normalizedPath = trimPath(input.rootPath);
  if (!normalizedPath) {
    return input.workspaceHandle;
  }

  if (isAbsoluteStoragePath(normalizedPath) && 'path' in (input.workspaceHandle as object)) {
    return createDirectoryHandleLikeFromPath(input.workspaceHandle, normalizedPath);
  }

  return await ensureDirectoryChain({
    baseDir: input.workspaceHandle,
    segments: toStoragePathSegments(normalizedPath),
    create: input.create,
  });
}

export async function ensureProjectStorageDir(input: {
  workspaceHandle: DirectoryHandleLike;
  rootPath: string;
  projectId: string;
  leafSegments: string[];
  create?: boolean;
}): Promise<DirectoryHandleLike> {
  const rootDir = await resolveStorageRootHandle({
    workspaceHandle: input.workspaceHandle,
    rootPath: input.rootPath,
    create: input.create,
  });

  return await ensureDirectoryChain({
    baseDir: rootDir,
    segments: ['projects', input.projectId, ...input.leafSegments],
    create: input.create,
  });
}

export async function ensureResolvedProjectTempDir(input: {
  workspaceHandle: DirectoryHandleLike;
  topology: ResolvedStorageTopology;
  projectId: string;
  leafSegments?: string[];
  create?: boolean;
}): Promise<DirectoryHandleLike> {
  return await ensureProjectStorageDir({
    workspaceHandle: input.workspaceHandle,
    rootPath: input.topology.tempRoot,
    projectId: input.projectId,
    leafSegments: input.leafSegments ?? [],
    create: input.create,
  });
}

export async function ensureResolvedProjectThumbnailsDir(input: {
  workspaceHandle: DirectoryHandleLike;
  topology: ResolvedStorageTopology;
  projectId: string;
  subDir?: string;
  create?: boolean;
}): Promise<DirectoryHandleLike> {
  const rootDir = await resolveStorageRootHandle({
    workspaceHandle: input.workspaceHandle,
    rootPath: input.topology.tempRoot,
    create: input.create,
  });

  const segments = [
    THUMBNAILS_ROOT_DIR_NAME,
    PROJECTS_ROOT_DIR_NAME,
    input.projectId,
    ...(input.subDir ? [input.subDir] : []),
  ];

  return await ensureDirectoryChain({
    baseDir: rootDir,
    segments,
    create: input.create,
  });
}

export async function ensureResolvedProjectProxiesDir(input: {
  workspaceHandle: DirectoryHandleLike;
  topology: ResolvedStorageTopology;
  projectId: string;
  create?: boolean;
}): Promise<DirectoryHandleLike> {
  if (!trimPath(input.topology.proxiesRoot)) {
    return await ensureResolvedProjectTempDir({
      workspaceHandle: input.workspaceHandle,
      topology: input.topology,
      projectId: input.projectId,
      leafSegments: ['proxies'],
      create: input.create,
    });
  }

  return await ensureProjectStorageDir({
    workspaceHandle: input.workspaceHandle,
    rootPath: input.topology.proxiesRoot,
    projectId: input.projectId,
    leafSegments: [],
    create: input.create,
  });
}
