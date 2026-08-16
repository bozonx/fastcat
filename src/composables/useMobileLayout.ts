import { computed } from 'vue';
import { getLayoutModeOverride } from '~/composables/layout/useLayoutMode';

/**
 * True when the touch-oriented shell is active.
 *
 * An explicit layout mode wins when one is set — that is how the embeddable
 * build, which has no `/m/*` route, selects its shell. The standalone app sets
 * none and keeps deciding from the route.
 */
export function useMobileLayout() {
  const route = useRoute();
  const layoutModeOverride = getLayoutModeOverride();

  const isMobileLayout = computed(() => {
    if (layoutModeOverride.value) return layoutModeOverride.value === 'mobile';
    return route.path === '/m' || route.path.startsWith('/m/');
  });

  return { isMobileLayout };
}
