import { getProjectCacheSegments } from '~/utils/vardata-paths';

export interface MediaCacheFsModule {
  getCacheFileName: (projectRelativePath: string) => string;
  ensureCacheDir: () => Promise<FileSystemDirectoryHandle | null>;
  ensureFilesMetaDir: () => Promise<FileSystemDirectoryHandle | null>;
}

export function createMediaCacheFsModule(deps: {
  getWorkspaceHandle: () => FileSystemDirectoryHandle | null;
  getProjectId: () => string | null;
}) {
  function getCacheFileName(projectRelativePath: string): string {
    return `${encodeURIComponent(projectRelativePath)}.json`;
  }

  async function ensureCacheDir(): Promise<FileSystemDirectoryHandle | null> {
    const workspaceHandle = deps.getWorkspaceHandle();
    const projectId = deps.getProjectId();
    if (!workspaceHandle || !projectId) return null;

    const parts = getProjectCacheSegments(projectId);
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

  return {
    getCacheFileName,
    ensureCacheDir,
    ensureFilesMetaDir,
  } satisfies MediaCacheFsModule;
}
