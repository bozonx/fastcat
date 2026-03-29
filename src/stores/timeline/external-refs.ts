import { storeToRefs } from 'pinia';
import { ref, type Ref } from 'vue';

import type { MediaMetadata } from '~/stores/media.store';

export interface TimelineExternalRefsModule {
  currentProjectName: Ref<string | null>;
  currentTimelinePath: Ref<string | null>;
  mediaMetadata: Ref<Record<string, MediaMetadata>>;
}

function isRefLike<T>(value: unknown): value is Ref<T> {
  return Boolean(value) && typeof value === 'object' && 'value' in (value as any);
}

export function createTimelineExternalRefsModule(deps: {
  projectStore: unknown;
  mediaStore: unknown;
}): TimelineExternalRefsModule {
  const projectStoreAny = deps.projectStore as any;
  const mediaStoreAny = deps.mediaStore as any;

  const currentProjectName = (() => {
    if (isRefLike<string | null>(projectStoreAny?.currentProjectName)) {
      return projectStoreAny.currentProjectName as Ref<string | null>;
    }
    try {
      const projectRefs = storeToRefs(projectStoreAny) as any;
      if (isRefLike<string | null>(projectRefs?.currentProjectName)) {
        return projectRefs.currentProjectName as Ref<string | null>;
      }
    } catch {
      // ignore
    }
    return ref(projectStoreAny?.currentProjectName ?? null);
  })();

  const currentTimelinePath = (() => {
    if (isRefLike<string | null>(projectStoreAny?.currentTimelinePath)) {
      return projectStoreAny.currentTimelinePath as Ref<string | null>;
    }
    try {
      const projectRefs = storeToRefs(projectStoreAny) as any;
      if (isRefLike<string | null>(projectRefs?.currentTimelinePath)) {
        return projectRefs.currentTimelinePath as Ref<string | null>;
      }
    } catch {
      // ignore
    }
    return ref(projectStoreAny?.currentTimelinePath ?? null);
  })();

  const mediaMetadata = (() => {
    if (isRefLike<Record<string, MediaMetadata>>(mediaStoreAny?.mediaMetadata)) {
      return mediaStoreAny.mediaMetadata as Ref<Record<string, MediaMetadata>>;
    }
    try {
      const mediaRefs = storeToRefs(mediaStoreAny) as any;
      if (isRefLike<Record<string, MediaMetadata>>(mediaRefs?.mediaMetadata)) {
        return mediaRefs.mediaMetadata as Ref<Record<string, MediaMetadata>>;
      }
    } catch {
      // ignore
    }
    return ref(mediaStoreAny?.mediaMetadata ?? {});
  })();

  return {
    currentProjectName,
    currentTimelinePath,
    mediaMetadata,
  };
}
