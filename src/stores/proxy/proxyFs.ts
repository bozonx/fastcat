import type { Ref } from 'vue';

import {
  getResolvedProjectProxiesSegments,
  type ResolvedStorageTopology,
} from '~/utils/storage-topology';

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
      const parts = getResolvedProjectProxiesSegments(
        params.resolvedStorageTopology.value,
        params.currentProjectId.value,
      );
      let dir = params.workspaceHandle.value;
      for (const segment of parts) {
        dir = await dir.getDirectoryHandle(segment, { create: true });
      }
      return dir;
    } catch {
      return null;
    }
  }

  return {
    getProxyFileName,
    ensureProjectProxiesDir,
  };
}
