import { computed, type Ref } from 'vue';
import type { FsEntry } from '~/types/fs';

export interface ProxyStoreLike {
  generatingProxies:
    | Set<string>
    | ReadonlySet<string>
    | {
        value: Set<string> | ReadonlySet<string>;
      };
  generateProxiesForFolder: (params: {
    dirHandle: FileSystemDirectoryHandle;
    dirPath: string;
  }) => Promise<void>;
  cancelProxyGeneration: (path: string) => Promise<void>;
}

interface UseFileProxyFolderOptions {
  selectedFsEntry: Ref<FsEntry | null>;
  proxyStore: ProxyStoreLike;
  videoExtensions: readonly string[];
  resolveDirectoryHandle: (path: string) => Promise<FileSystemDirectoryHandle | null>;
}

export function useFileProxyFolder(options: UseFileProxyFolderOptions) {
  const generatingProxies = computed(() => {
    const gp = options.proxyStore.generatingProxies;
    return gp && typeof gp === 'object' && 'value' in gp ? gp.value : gp;
  });

  const isFolderWithVideo = computed(() => {
    const entry = options.selectedFsEntry.value;
    if (!entry || entry.kind !== 'directory') return false;
    const children = Array.isArray(entry.children) ? entry.children : [];
    return children.some((c: FsEntry) => {
      if (c?.kind !== 'file') return false;
      const name = typeof c?.name === 'string' ? c.name : '';
      const ext = name.split('.').pop()?.toLowerCase() ?? '';
      return options.videoExtensions.includes(ext);
    });
  });

  const isGeneratingProxyForFolder = computed(() => {
    const entry = options.selectedFsEntry.value;
    if (!entry || entry.kind !== 'directory' || !entry.path) return false;

    const gp = generatingProxies.value;
    if (!gp || gp.size === 0) return false;

    const dirPath = entry.path;
    for (const p of gp) {
      if (p.startsWith(`${dirPath}/`)) {
        return true;
      }
    }
    return false;
  });

  async function generateProxiesForSelectedFolder() {
    const entry = options.selectedFsEntry.value;
    if (!entry || entry.kind !== 'directory' || !entry.path) return;
    const dirHandle = await options.resolveDirectoryHandle(entry.path);
    if (!dirHandle) return;
    await options.proxyStore.generateProxiesForFolder({
      dirHandle,
      dirPath: entry.path,
    });
  }

  async function stopProxyGenerationForSelectedFolder() {
    const entry = options.selectedFsEntry.value;
    if (!entry || entry.kind !== 'directory' || !entry.path) return;
    const dirPath = entry.path;

    for (const p of generatingProxies.value) {
      if (p.startsWith(`${dirPath}/`)) {
        const rel = p.slice(dirPath.length + 1);
        if (!rel.includes('/')) {
          await options.proxyStore.cancelProxyGeneration(p);
        }
      }
    }
  }

  return {
    generateProxiesForSelectedFolder,
    isFolderWithVideo,
    isGeneratingProxyForFolder,
    stopProxyGenerationForSelectedFolder,
  };
}
