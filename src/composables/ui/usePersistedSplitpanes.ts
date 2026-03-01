import { useLocalStorage } from '@vueuse/core';
import { readLocalStorageJson, writeLocalStorageJson } from '~/stores/ui/uiLocalStorage';
import type { Ref } from 'vue';

const PANEL_SIZES_PREFIX = 'gran-panel-sizes';

export function getPanelSizesKey(pageKey: string, projectId: string | null): string {
  const id = projectId ?? 'no-project';
  return `${PANEL_SIZES_PREFIX}-${pageKey}-${id}`;
}

/**
 * A composable to manage and persist splitpane sizes in local storage.
 *
 * @param pageKey Unique key for the page (e.g., 'files', 'cut', 'sound')
 * @param projectId Reactive ref to current project ID
 * @param defaultSizes The default sizes for the panes.
 * @returns An object containing the current sizes and the onResized handler.
 */
export function usePersistedSplitpanes(
  pageKey: string,
  projectId: Ref<string | null>,
  defaultSizes: number[],
) {
  const key = computed(() => getPanelSizesKey(pageKey, projectId.value));
  const sizes = ref<number[]>([...defaultSizes]);

  function loadSizes() {
    const stored = readLocalStorageJson<number[] | null>(key.value, null);
    if (stored && Array.isArray(stored) && stored.length === defaultSizes.length) {
      sizes.value = stored;
    } else {
      sizes.value = [...defaultSizes];
    }
  }

  onMounted(loadSizes);
  watch(() => projectId.value, loadSizes);

  function onResized(event: { panes: { size: number }[] }) {
    if (Array.isArray(event?.panes)) {
      const newSizes = event.panes.map((p) => p.size);
      sizes.value = newSizes;
      writeLocalStorageJson(key.value, newSizes);
    }
  }

  return {
    sizes,
    onResized,
  };
}
