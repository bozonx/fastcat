import { computed } from 'vue';
import { useWindowSize } from '@vueuse/core';

/**
 * Mobile drawer toolbars switch between a horizontal row (portrait) and a
 * vertical rail (landscape, where the drawer renders as a side panel).
 *
 * Centralises the orientation derivation shared by the timeline property
 * drawers so the `width > height` rule lives in one place.
 */
export function useDrawerToolbarOrientation() {
  const { width, height } = useWindowSize();

  const isLandscape = computed(() => width.value > height.value);
  const toolbarOrientation = computed<'vertical' | 'horizontal'>(() =>
    isLandscape.value ? 'vertical' : 'horizontal',
  );

  return { isLandscape, toolbarOrientation };
}
