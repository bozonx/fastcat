import { computed, ref, watch, type Ref } from 'vue';
import { computeDirectoryStats, type DirectoryStats } from '~/utils/fs';

interface UseFileStorageInfoOptions {
  selectedFsEntry: Ref<any>;
  currentProjectName: Ref<string | null | undefined>;
  getDirectoryHandleByPath?: (path: string) => Promise<FileSystemDirectoryHandle | null>;
}

export function useFileStorageInfo(options: UseFileStorageInfoOptions) {
  const isProjectRootDir = computed(() => {
    const entry = options.selectedFsEntry.value;
    if (!entry || entry.kind !== 'directory') return false;
    const path = typeof entry.path === 'string' ? entry.path : undefined;
    if (path !== '') return false;
    if (!options.currentProjectName.value) return false;
    return entry.name === options.currentProjectName.value;
  });

  const storageEstimate = ref<{ quota?: number; usage?: number } | null>(null);
  const projectStats = ref<DirectoryStats | null>(null);

  watch(
    isProjectRootDir,
    async (isRoot) => {
      storageEstimate.value = null;
      projectStats.value = null;
      if (!isRoot) return;

      const estimateFn = (navigator as any)?.storage?.estimate as undefined | (() => Promise<any>);
      if (typeof estimateFn === 'function') {
        try {
          const res = await estimateFn.call((navigator as any).storage);
          if (res && typeof res === 'object') {
            const quota = typeof res.quota === 'number' ? res.quota : undefined;
            const usage = typeof res.usage === 'number' ? res.usage : undefined;
            if (quota !== undefined && usage !== undefined) {
              storageEstimate.value = { quota, usage };
            }
          }
        } catch {
          storageEstimate.value = null;
        }
      }

      if (options.getDirectoryHandleByPath) {
        try {
          const rootHandle = await options.getDirectoryHandleByPath('');
          if (rootHandle) {
            projectStats.value = (await computeDirectoryStats(rootHandle)) ?? null;
          }
        } catch {
          projectStats.value = null;
        }
      }
    },
    { immediate: true },
  );

  const storageFreeBytes = computed<number | null>(() => {
    const est = storageEstimate.value;
    if (!est || typeof est.quota !== 'number' || typeof est.usage !== 'number') return null;
    const free = est.quota - est.usage;
    return Number.isFinite(free) && free >= 0 ? free : null;
  });

  return {
    isProjectRootDir,
    storageFreeBytes,
    projectStats,
  };
}
