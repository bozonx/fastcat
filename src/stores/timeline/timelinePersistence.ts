import type { Ref } from 'vue';
import { createAutoSave } from '~/utils/autoSave';

import type { TimelineDocument } from '~/timeline/types';

export interface TimelinePersistenceDeps {
  timelineDoc: Ref<TimelineDocument | null>;
  currentTime: Ref<number>;
  duration: Ref<number>;
  masterGain: Ref<number>;

  isTimelineDirty: Ref<boolean>;
  isSavingTimeline: Ref<boolean>;
  timelineSaveError: Ref<string | null>;

  currentProjectName: Ref<string | null>;
  currentTimelinePath: Ref<string | null>;

  ensureTimelineFileHandle: (options?: {
    create?: boolean;
  }) => Promise<FileSystemFileHandle | null>;
  createFallbackTimelineDoc: () => TimelineDocument;

  parseTimelineFromOtio: (
    text: string,
    options: { id: string; name: string; fps: number },
  ) => TimelineDocument;
  serializeTimelineToOtio: (doc: TimelineDocument) => string;
  selectTimelineDurationUs: (doc: TimelineDocument) => number;
}

export interface TimelinePersistence {
  resetPersistenceState: () => void;
  getLoadRequestId: () => number;

  markDirty: () => void;
  markCleanForCurrentRevision: () => void;

  requestTimelineSave: (options?: { immediate?: boolean }) => Promise<void>;
  loadTimeline: () => Promise<void>;
  saveTimeline: () => Promise<void>;
}

export function createTimelinePersistence(deps: TimelinePersistenceDeps): TimelinePersistence {
  let loadTimelineRequestId = 0;

  const autoSave = createAutoSave({
    doSave: async () => {
      const doc = deps.timelineDoc.value;
      if (!doc || !deps.isTimelineDirty.value) return false;

      deps.isSavingTimeline.value = true;
      deps.timelineSaveError.value = null;

      const snapshot: TimelineDocument = {
        ...doc,
        metadata: {
          ...(doc.metadata ?? {}),
          gran: {
            ...(doc.metadata?.gran ?? {}),
            playheadUs: deps.currentTime.value,
            masterGain: deps.masterGain.value,
          },
        },
      };

      try {
        const handle = await deps.ensureTimelineFileHandle({ create: true });
        if (!handle) return false;

        const writable = await (handle as any).createWritable();
        await writable.write(deps.serializeTimelineToOtio(snapshot));
        await writable.close();
      } catch (e: unknown) {
        deps.timelineSaveError.value =
          e instanceof Error ? e.message : 'Failed to save timeline file';
        console.warn('Failed to save timeline file', e);
        // Throw to let autoSave know it failed, but we also handle toast in the global error handler
        throw e;
      } finally {
        deps.isSavingTimeline.value = false;
        deps.isTimelineDirty.value = autoSave.isDirty();
      }
    },
    onError: (e) => {
      // In Nuxt, we can't easily access useToast outside of Vue context unless we pass it down
      // However, we can use console.error or try to access the global nuxt app toast if injected
      const nuxtApp = useNuxtApp();
      const toast = (nuxtApp as any).$toast;
      if (toast) {
        toast.error('Failed to save timeline', {
          description: e instanceof Error ? e.message : 'Unknown error occurred',
        });
      } else {
        console.error('Failed to save timeline', e);
      }
    },
  });

  function resetPersistenceState() {
    autoSave.reset();
    loadTimelineRequestId += 1;
  }

  function getLoadRequestId() {
    return loadTimelineRequestId;
  }

  function markCleanForCurrentRevision() {
    autoSave.markCleanForCurrentRevision();
    deps.isTimelineDirty.value = false;
  }

  function markDirty() {
    autoSave.markDirty();
    deps.isTimelineDirty.value = true;
  }

  async function requestTimelineSave(options?: { immediate?: boolean }) {
    if (!deps.timelineDoc.value) return;
    await autoSave.requestSave(options);
  }

  async function loadTimeline() {
    if (!deps.currentProjectName.value || !deps.currentTimelinePath.value) return;

    const requestId = ++loadTimelineRequestId;
    autoSave.reset();

    const fallback = deps.createFallbackTimelineDoc();

    try {
      const handle = await deps.ensureTimelineFileHandle({ create: false });
      if (!handle) {
        if (requestId !== loadTimelineRequestId) return;
        deps.timelineDoc.value = fallback;
        return;
      }

      const file = await handle.getFile();
      const text = await file.text();
      const parsed = deps.parseTimelineFromOtio(text, {
        id: fallback.id,
        name: fallback.name,
        fps: fallback.timebase.fps,
      });
      if (requestId !== loadTimelineRequestId) return;
      deps.timelineDoc.value = parsed;

      if (
        typeof parsed.metadata?.gran?.playheadUs === 'number' &&
        Number.isFinite(parsed.metadata.gran.playheadUs)
      ) {
        deps.currentTime.value = parsed.metadata.gran.playheadUs;
      }
      if (
        typeof parsed.metadata?.gran?.masterGain === 'number' &&
        Number.isFinite(parsed.metadata.gran.masterGain)
      ) {
        deps.masterGain.value = parsed.metadata.gran.masterGain;
      } else {
        deps.masterGain.value = 1;
      }
    } catch (e: unknown) {
      console.warn('Failed to load timeline file, fallback to default', e);
      if (requestId !== loadTimelineRequestId) return;
      deps.timelineDoc.value = fallback;
    } finally {
      if (requestId !== loadTimelineRequestId) return;
      deps.duration.value = deps.timelineDoc.value
        ? deps.selectTimelineDurationUs(deps.timelineDoc.value)
        : 0;
      markCleanForCurrentRevision();
      deps.timelineSaveError.value = null;
    }
  }

  async function saveTimeline() {
    await requestTimelineSave({ immediate: true });
  }

  return {
    resetPersistenceState,
    getLoadRequestId,
    markDirty,
    markCleanForCurrentRevision,
    requestTimelineSave,
    loadTimeline,
    saveTimeline,
  };
}
