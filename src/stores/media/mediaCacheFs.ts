import {
  getResolvedProjectCacheSegments,
  getResolvedProjectWaveformsSegments,
  type ResolvedStorageTopology,
} from '~/utils/storage-topology';

export interface MediaCacheFsModule {
  getCacheFileName: (projectRelativePath: string) => string;
  ensureCacheDir: () => Promise<FileSystemDirectoryHandle | null>;
  ensureFilesMetaDir: () => Promise<FileSystemDirectoryHandle | null>;
  ensureWaveformsDir: () => Promise<FileSystemDirectoryHandle | null>;
  removeCacheFiles: (projectRelativePath: string) => Promise<void>;
}

export function createMediaCacheFsModule(deps: {
  getWorkspaceHandle: () => FileSystemDirectoryHandle | null;
  getProjectId: () => string | null;
  getResolvedStorageTopology: () => ResolvedStorageTopology;
}) {
  function getCacheFileName(projectRelativePath: string): string {
    return `${encodeURIComponent(projectRelativePath)}.json`;
  }

  async function ensureCacheDir(): Promise<FileSystemDirectoryHandle | null> {
    const workspaceHandle = deps.getWorkspaceHandle();
    const projectId = deps.getProjectId();
    if (!workspaceHandle || !projectId) return null;

    const parts = getResolvedProjectCacheSegments(deps.getResolvedStorageTopology(), projectId);
    let dir = workspaceHandle;
    for (const segment of parts) {
      dir = await dir.getDirectoryHandle(segment, { create: true });
    }
    return dir;
  }

  async function ensureFilesMetaDir(): Promise<FileSystemDirectoryHandle | null> {
    const projectCacheDir = await ensureCacheDir();
    if (!projectCacheDir) return null;
    return await projectCacheDir.getDirectoryHandle('files-meta', { create: true });
  }

  async function ensureWaveformsDir(): Promise<FileSystemDirectoryHandle | null> {
    const workspaceHandle = deps.getWorkspaceHandle();
    const projectId = deps.getProjectId();
    if (!workspaceHandle || !projectId) return null;

    const parts = getResolvedProjectWaveformsSegments(deps.getResolvedStorageTopology(), projectId);
    let dir = workspaceHandle;
    for (const segment of parts) {
      dir = await dir.getDirectoryHandle(segment, { create: true });
    }
    return dir;
  }

  async function removeCacheFiles(projectRelativePath: string): Promise<void> {
    const fileName = getCacheFileName(projectRelativePath);

    try {
      const metaDir = await ensureFilesMetaDir();
      if (metaDir) await metaDir.removeEntry(fileName);
    } catch {
      // ignore
    }

    try {
      const waveformsDir = await ensureWaveformsDir();
      if (waveformsDir) await waveformsDir.removeEntry(fileName);
    } catch {
      // ignore
    }
  }

  return {
    getCacheFileName,
    ensureCacheDir,
    ensureFilesMetaDir,
    ensureWaveformsDir,
    removeCacheFiles,
  } satisfies MediaCacheFsModule;
}
