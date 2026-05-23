import { type Ref, isRef } from 'vue';

const PANEL_SIZES_PREFIX = 'fastcat:layout:split-sizes';

function getPanelSizesKey(pageKey: string, projectId: string | null): string {
  const id = projectId ?? 'no-project';
  return `${PANEL_SIZES_PREFIX}:${pageKey}:${id}`;
}

/**
 * A composable to manage and persist splitpane sizes via project settings storage.
 *
 * @param pageKey Unique key for the page (e.g., 'files', 'cut', 'sound'), can be a Ref
 * @param projectId Reactive ref to current project ID
 * @param defaultSizes The default sizes for the panes.
 * @param storage Storage adapter for persisting split sizes.
 * @returns An object containing the current sizes and the onResized handler.
 */
export function usePersistedSplitpanes(
  pageKey: string | Ref<string>,
  projectId: Ref<string | null>,
  defaultSizes: number[] | Ref<number[]>,
  storage: {
    get: (key: string) => number[] | null | undefined;
    set: (key: string, value: number[]) => void;
  },
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
    const stored = storage.get(newKey);
    const defaults = isRef(defaultSizes) ? defaultSizes.value : defaultSizes;

    if (stored && Array.isArray(stored) && stored.length === defaults.length) {
      sizes.value = stored;
    } else {
      sizes.value = [...defaults];
    }
    isLoaded.value = true;
  }

  // Watch projectId, pageKey, defaultSizes length, AND the stored value itself.
  // The stored snapshot is essential: project settings load asynchronously
  // (after projectId is already set), so without it loadSizes runs once against
  // empty storage, falls back to defaults, and never re-runs when the persisted
  // sizes actually arrive — leaving panels at default widths on every reload.
  watch(
    [
      () => projectId.value,
      isRef(pageKey) ? pageKey : () => pageKey,
      isRef(defaultSizes) ? () => defaultSizes.value.length : () => defaultSizes.length,
      () => {
        const stored = storage.get(getKey());
        return Array.isArray(stored) ? stored.join(',') : '';
      },
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
      storage.set(key.value, newSizes);
    }
  }

  function reset() {
    const defaults = isRef(defaultSizes) ? defaultSizes.value : defaultSizes;
    sizes.value = [...defaults];
    storage.set(key.value, sizes.value);
  }

  return {
    sizes,
    onResized,
    reset,
  };
}
