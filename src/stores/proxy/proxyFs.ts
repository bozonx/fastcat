import type { Ref } from 'vue';

import { ensureResolvedProjectProxiesDir } from '~/utils/storage-handles';
import type { ResolvedStorageTopology } from '~/utils/storage-topology';

export interface ProxyFsModule {
  getProxyFileName: (projectRelativePath: string) => string;
  ensureProjectProxiesDir: () => Promise<FileSystemDirectoryHandle | null>;
}

export function createProxyFsModule(params: {
  workspaceHandle: Ref<FileSystemDirectoryHandle | null>;
  currentProjectId: Ref<string | null>;
  resolvedStorageTopology: Ref<ResolvedStorageTopology>;
}): ProxyFsModule {
  function getProxyFileName(projectRelativePath: string): string {
    return `${encodeURIComponent(projectRelativePath)}.webm`;
  }

  async function ensureProjectProxiesDir(): Promise<FileSystemDirectoryHandle | null> {
    if (!params.workspaceHandle.value || !params.currentProjectId.value) return null;
    try {
      return (await ensureResolvedProjectProxiesDir({
        workspaceHandle: params.workspaceHandle.value,
        topology: params.resolvedStorageTopology.value,
        projectId: params.currentProjectId.value,
        create: true,
      })) as FileSystemDirectoryHandle;
    } catch {
      return null;
    }
  }

  return {
    getProxyFileName,
    ensureProjectProxiesDir,
  };
}
