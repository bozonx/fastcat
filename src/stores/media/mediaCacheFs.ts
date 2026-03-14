import type { ResolvedStorageTopology } from '~/utils/storage-topology';
import { ensureResolvedProjectTempDir } from '~/utils/storage-handles';

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

    return (await ensureResolvedProjectTempDir({
      workspaceHandle,
      topology: deps.getResolvedStorageTopology(),
      projectId,
      leafSegments: ['frame-cache'],
      create: true,
    })) as FileSystemDirectoryHandle;
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

    return (await ensureResolvedProjectTempDir({
      workspaceHandle,
      topology: deps.getResolvedStorageTopology(),
      projectId,
      leafSegments: ['waveforms'],
      create: true,
    })) as FileSystemDirectoryHandle;
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
