import PQueue from 'p-queue';
import type { Ref } from 'vue';

import type { TimelineDocument } from '~/timeline/types';

export interface TimelinePersistenceDeps {
  timelineDoc: Ref<TimelineDocument | null>;
  currentTime: Ref<number>;
  duration: Ref<number>;

  isTimelineDirty: Ref<boolean>;
  isSavingTimeline: Ref<boolean>;
  timelineSaveError: Ref<string | null>;

  currentProjectName: Ref<string | null>;
  currentTimelinePath: Ref<string | null>;

  ensureTimelineFileHandle: (options?: { create?: boolean }) => Promise<FileSystemFileHandle | null>;
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
  let persistTimelineTimeout: number | null = null;
  let loadTimelineRequestId = 0;
  let timelineRevision = 0;
  let savedTimelineRevision = 0;

  const timelineSaveQueue = new PQueue({ concurrency: 1 });

  function clearPersistTimelineTimeout() {
    if (typeof window === 'undefined') return;
    if (persistTimelineTimeout === null) return;
    window.clearTimeout(persistTimelineTimeout);
    persistTimelineTimeout = null;
  }

  function resetPersistenceState() {
    clearPersistTimelineTimeout();
    loadTimelineRequestId += 1;
    timelineRevision = 0;
    savedTimelineRevision = 0;
  }

  function getLoadRequestId() {
    return loadTimelineRequestId;
  }

  function markCleanForCurrentRevision() {
    savedTimelineRevision = timelineRevision;
    deps.isTimelineDirty.value = false;
  }

  function markDirty() {
    timelineRevision += 1;
    deps.isTimelineDirty.value = true;
  }

  async function persistTimelineNow() {
    const doc = deps.timelineDoc.value;
    if (!doc || !deps.isTimelineDirty.value) return;

    deps.isSavingTimeline.value = true;
    deps.timelineSaveError.value = null;

    const snapshot: TimelineDocument = {
      ...doc,
      metadata: {
        ...(doc.metadata ?? {}),
        gran: {
          ...(doc.metadata?.gran ?? {}),
          playheadUs: deps.currentTime.value,
        },
      },
    };

    const revisionToSave = timelineRevision;

    try {
      const handle = await deps.ensureTimelineFileHandle({ create: true });
      if (!handle) return;

      const writable = await (handle as any).createWritable();
      await writable.write(deps.serializeTimelineToOtio(snapshot));
      await writable.close();

      if (savedTimelineRevision < revisionToSave) {
        savedTimelineRevision = revisionToSave;
      }
    } catch (e: any) {
      deps.timelineSaveError.value = e?.message ?? 'Failed to save timeline file';
      console.warn('Failed to save timeline file', e);
    } finally {
      deps.isSavingTimeline.value = false;
      deps.isTimelineDirty.value = savedTimelineRevision < timelineRevision;
    }
  }

  async function enqueueTimelineSave() {
    await timelineSaveQueue.add(async () => {
      await persistTimelineNow();
    });
  }

  async function requestTimelineSave(options?: { immediate?: boolean }) {
    if (!deps.timelineDoc.value) return;

    if (options?.immediate) {
      clearPersistTimelineTimeout();
      await enqueueTimelineSave();
      return;
    }

    if (typeof window === 'undefined') {
      await enqueueTimelineSave();
      return;
    }

    clearPersistTimelineTimeout();
    persistTimelineTimeout = window.setTimeout(() => {
      persistTimelineTimeout = null;
      void enqueueTimelineSave();
    }, 500);
  }

  async function loadTimeline() {
    if (!deps.currentProjectName.value || !deps.currentTimelinePath.value) return;

    const requestId = ++loadTimelineRequestId;
    clearPersistTimelineTimeout();

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
    } catch (e: any) {
      console.warn('Failed to load timeline file, fallback to default', e);
      if (requestId !== loadTimelineRequestId) return;
      deps.timelineDoc.value = fallback;
    } finally {
      if (requestId !== loadTimelineRequestId) return;
      deps.duration.value = deps.timelineDoc.value ? deps.selectTimelineDurationUs(deps.timelineDoc.value) : 0;
      timelineRevision = 0;
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
