import { useLocalStorage } from '@vueuse/core';

/**
 * A composable to manage and persist splitpane sizes in local storage.
 * 
 * @param key The local storage key to use.
 * @param defaultSizes The default sizes for the panes.
 * @returns An object containing the current sizes and the onResized handler.
 */
export function usePersistedSplitpanes(key: string, defaultSizes: number[]) {
  const sizes = useLocalStorage<number[]>(key, defaultSizes);

  function onResized(event: { panes: { size: number }[] }) {
    if (Array.isArray(event?.panes)) {
      sizes.value = event.panes.map((p) => p.size);
    }
  }

  return {
    sizes,
    onResized,
  };
}
