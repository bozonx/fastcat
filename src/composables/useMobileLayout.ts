import { computed } from 'vue';

/**
 * Returns true when the app is running in the mobile layout route (`/m/*`).
 * Used to branch UI behaviour (e.g. foreground vs background tasks).
 */
export function useMobileLayout() {
  const route = useRoute();
  const isMobileLayout = computed(() => route.path === '/m' || route.path.startsWith('/m/'));
  return { isMobileLayout };
}
