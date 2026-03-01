import { computed, ref, watch, type Ref } from 'vue';

interface UseFileStorageInfoOptions {
  selectedFsEntry: Ref<any>;
  currentProjectName: Ref<string | null | undefined>;
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

  watch(
    isProjectRootDir,
    async (isRoot) => {
      storageEstimate.value = null;
      if (!isRoot) return;
      const estimateFn = (navigator as any)?.storage?.estimate as undefined | (() => Promise<any>);
      if (typeof estimateFn !== 'function') return;
      try {
        const res = await estimateFn.call((navigator as any).storage);
        if (!res || typeof res !== 'object') return;
        const quota = typeof res.quota === 'number' ? res.quota : undefined;
        const usage = typeof res.usage === 'number' ? res.usage : undefined;
        if (quota === undefined || usage === undefined) return;
        storageEstimate.value = { quota, usage };
      } catch {
        storageEstimate.value = null;
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
  };
}
