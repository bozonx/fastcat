import { computed, type Ref } from 'vue';
import { useProxyStore } from '~/stores/proxy.store';

export interface FilePropertiesProxyDeps {
  isRootDirectory: Ref<boolean>;
  isExternalContext: Ref<boolean>;
  isVideoFile: Ref<boolean>;
  selectedPath: Ref<string | null | undefined>;
}

/**
 * Per-file proxy availability/state (whether proxy actions apply, and whether a
 * proxy is generating / already exists). Extracted from `FileProperties.vue`.
 */
export function useFilePropertiesProxy(deps: FilePropertiesProxyDeps) {
  const proxyStore = useProxyStore();

  const showVideoProxyActions = computed(() => {
    if (deps.isRootDirectory.value || deps.isExternalContext.value) return false;
    if (!deps.isVideoFile.value) return false;
    if (!deps.selectedPath.value) return false;
    return true;
  });

  const isGeneratingProxyForFile = computed(() => {
    if (!showVideoProxyActions.value) return false;
    return proxyStore.generatingProxies.has(deps.selectedPath.value!);
  });

  const hasExistingProxyForFile = computed(() => {
    if (!showVideoProxyActions.value) return false;
    return proxyStore.existingProxies.has(deps.selectedPath.value!);
  });

  return {
    showVideoProxyActions,
    isGeneratingProxyForFile,
    hasExistingProxyForFile,
  };
}
