import { computed, inject, type Ref } from 'vue';

/**
 * Composable to resolve the correct teleport target for components.
 * Returns 'body' for regular apps, and a local Shadow DOM target for embedded mode.
 */
export function useTeleportTarget() {
  const isEmbedded = inject('isEmbedded', false);
  const teleportTarget = inject<Ref<HTMLElement | string> | null>('teleportTarget', null);

  const target = computed(() => {
    if (isEmbedded && teleportTarget?.value) return teleportTarget.value;
    return 'body';
  });

  return {
    target,
    isEmbedded,
  };
}
