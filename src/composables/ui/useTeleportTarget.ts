import { computed, inject } from 'vue';

/**
 * Composable to resolve the correct teleport target for components.
 * Returns 'body' for regular apps, and a local Shadow DOM target for embedded mode.
 */
export function useTeleportTarget() {
  const isEmbedded = inject('isEmbedded', false);
  const teleportTarget = inject<any>('teleportTarget', null);

  const target = computed(() => {
    if (isEmbedded && teleportTarget?.value) return teleportTarget.value;
    return 'body';
  });

  return {
    target,
    isEmbedded
  };
}
