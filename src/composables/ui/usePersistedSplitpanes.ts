import { readLocalStorageJson, writeLocalStorageJson } from '~/stores/ui/uiLocalStorage';
import { type Ref, isRef } from 'vue';

const PANEL_SIZES_PREFIX = 'fastcat:layout:split-sizes';

export function getPanelSizesKey(pageKey: string, projectId: string | null): string {
  const id = projectId ?? 'no-project';
  return `${PANEL_SIZES_PREFIX}:${pageKey}:${id}`;
}

/**
 * A composable to manage and persist splitpane sizes in local storage.
 *
 * @param pageKey Unique key for the page (e.g., 'files', 'cut', 'sound'), can be a Ref
 * @param projectId Reactive ref to current project ID
 * @param defaultSizes The default sizes for the panes.
 * @returns An object containing the current sizes and the onResized handler.
 */
export function usePersistedSplitpanes(
  pageKey: string | Ref<string>,
  projectId: Ref<string | null>,
  defaultSizes: number[] | Ref<number[]>,
) {
  const getKey = () => {
    const keyString = isRef(pageKey) ? pageKey.value : pageKey;
    return getPanelSizesKey(keyString, projectId.value);
  };

  const key = ref(getKey());
  const sizes = ref<number[]>(isRef(defaultSizes) ? [...defaultSizes.value] : [...defaultSizes]);
  const isLoaded = ref(false);

  function loadSizes() {
    const newKey = getKey();
    key.value = newKey;
    const stored = readLocalStorageJson<number[] | null>(newKey, null);
    const defaults = isRef(defaultSizes) ? defaultSizes.value : defaultSizes;

    if (stored && Array.isArray(stored) && stored.length === defaults.length) {
      sizes.value = stored;
    } else {
      sizes.value = [...defaults];
    }
    isLoaded.value = true;
  }

  // Watch projectId, pageKey, and defaultSizes to reload if length changes
  watch(
    [
      () => projectId.value,
      isRef(pageKey) ? pageKey : () => pageKey,
      isRef(defaultSizes) ? () => defaultSizes.value.length : () => defaultSizes.length,
    ],
    loadSizes,
    {
      immediate: true,
    },
  );

  function onResized(event: { panes: { size: number }[] }) {
    if (Array.isArray(event?.panes)) {
      const newSizes = event.panes.map((p) => p.size);
      sizes.value = newSizes;
      writeLocalStorageJson(key.value, newSizes);
    }
  }

  function reset() {
    const defaults = isRef(defaultSizes) ? defaultSizes.value : defaultSizes;
    sizes.value = [...defaults];
    writeLocalStorageJson(key.value, sizes.value);
  }

  return {
    sizes,
    onResized,
    reset,
  };
}
