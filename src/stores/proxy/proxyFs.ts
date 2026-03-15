import type { Ref } from 'vue';

import { ensureResolvedProjectProxiesDir } from '~/utils/storage-handles';
import type { ResolvedStorageTopology } from '~/utils/storage-topology';

export interface ProxyFsModule {
  getProxyFileName: (projectRelativePath: string) => Promise<string>;
  ensureProjectProxiesDir: () => Promise<FileSystemDirectoryHandle | null>;
}

export function createProxyFsModule(params: {
  workspaceHandle: Ref<FileSystemDirectoryHandle | null>;
  currentProjectId: Ref<string | null>;
  resolvedStorageTopology: Ref<ResolvedStorageTopology>;
}): ProxyFsModule {
  async function hashString(str: string): Promise<string> {
    const msgUint8 = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function getProxyFileName(projectRelativePath: string): Promise<string> {
    const hash = await hashString(projectRelativePath);
    return `${hash}.mp4`;
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
