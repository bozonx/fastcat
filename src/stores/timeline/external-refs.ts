import { computed, type Ref, type WritableComputedRef } from 'vue';

import type { MediaMetadata } from '~/stores/media.store';

export interface TimelineExternalRefsModule {
  currentProjectName: Ref<string | null>;
  currentTimelinePath: Ref<string | null>;
  mediaMetadata: Ref<Record<string, MediaMetadata>>;
}

/**
 * Creates writable computed refs that read/write directly to the store properties.
 *
 * We use writable computed instead of storeToRefs/toRef because Pinia stores
 * may replace their internal $state during SSR hydration, breaking refs
 * created from the pre-hydration state. Computed getters always read from
 * the current store proxy, maintaining reactivity across hydration.
 */
function createStoreRef<T>(store: any, key: string, fallback: T): WritableComputedRef<T> {
  return computed({
    get: () => (store && key in store ? store[key] : fallback),
    set: (v: T) => {
      if (store && key in store) {
        store[key] = v;
      }
    },
  });
}

export function createTimelineExternalRefsModule(deps: {
  projectStore: unknown;
  mediaStore: unknown;
}): TimelineExternalRefsModule {
  const projectStore = deps.projectStore as any;
  const mediaStore = deps.mediaStore as any;

  return {
    currentProjectName: createStoreRef<string | null>(projectStore, 'currentProjectName', null),
    currentTimelinePath: createStoreRef<string | null>(projectStore, 'currentTimelinePath', null),
    mediaMetadata: createStoreRef<Record<string, MediaMetadata>>(mediaStore, 'mediaMetadata', {}),
  };
}
