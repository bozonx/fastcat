import { toRaw, type Ref } from 'vue';
import { createAutoSave } from '~/utils/auto-save';
import { getPlatformSuffix } from '~/stores/ui/uiLocalStorage';

import type { TimelineDocument } from '~/timeline/types';

export interface TimelinePersistenceDeps {
  timelineDoc: Ref<TimelineDocument | null>;
  currentTime: Ref<number>;
  duration: Ref<number>;
  masterGain: Ref<number>;
  timelineZoom: Ref<number>;
  trackHeights: Ref<Record<string, number>>;
  audioMuted?: Ref<boolean>;

  isTimelineDirty: Ref<boolean>;
  isSavingTimeline: Ref<boolean>;
  isReadOnly?: Ref<boolean>;
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

  onSaveSuccess?: (serialized: string) => void;
  onSaveError?: (error: unknown) => void;
}

export interface TimelinePersistenceModule {
  resetPersistenceState: () => void;
  getLoadRequestId: () => number;

  markDirty: () => void;
  markCleanForCurrentRevision: () => void;

  requestTimelineSave: (options?: { immediate?: boolean }) => Promise<void>;
  loadTimeline: () => Promise<void>;
  saveTimeline: () => Promise<void>;
}

function serializeInWorker(doc: TimelineDocument): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('../../workers/timeline-serializer.worker.ts', import.meta.url),
      {
        type: 'module',
      },
    );
    worker.onmessage = (e) => {
      if (e.data.success) {
        resolve(e.data.serialized);
      } else {
        reject(new Error(e.data.error));
      }
      worker.terminate();
    };
    worker.onerror = (e) => {
      reject(e);
      worker.terminate();
    };
    worker.postMessage(toRaw(doc));
  });
}

export function createTimelinePersistenceModule(
  deps: TimelinePersistenceDeps,
): TimelinePersistenceModule {
  let loadTimelineRequestId = 0;

  const autoSave = createAutoSave({
    debounceMs: 2000,
    onStateChange: (state) => {
      deps.isTimelineDirty.value = state.isDirty;
    },
    doSave: async () => {
      const doc = deps.timelineDoc.value;
      if (!doc || !deps.isTimelineDirty.value) return false;
      if (deps.isReadOnly?.value) return false;

      const currentProjectId = deps.currentProjectName.value;
      const currentTimelinePath = deps.currentTimelinePath.value;

      if (!currentProjectId || !currentTimelinePath) return false;

      deps.isSavingTimeline.value = true;
      deps.timelineSaveError.value = null;

      const suffix = getPlatformSuffix();
      const docRaw = JSON.parse(JSON.stringify(toRaw(doc)));

      const snapshot: TimelineDocument = {
        ...docRaw,
        metadata: {
          ...(docRaw.metadata ?? {}),
          fastcat: {
            ...(docRaw.metadata?.fastcat ?? {}),
            playheadUs: deps.currentTime.value,
            masterGain: deps.masterGain.value,
            zoom: deps.timelineZoom.value,
            trackHeights: { ...deps.trackHeights.value },
            ...(suffix ? { [`zoom${suffix}`]: deps.timelineZoom.value } : {}),
            ...(suffix ? { [`trackHeights${suffix}`]: { ...deps.trackHeights.value } } : {}),
            ...(deps.audioMuted ? { masterMuted: deps.audioMuted.value } : {}),
          },
        },
      };

      try {
        // Double check if context changed before writing
        if (
          currentProjectId !== deps.currentProjectName.value ||
          currentTimelinePath !== deps.currentTimelinePath.value
        ) {
          return false; // Skip save, context changed
        }

        const handle = await deps.ensureTimelineFileHandle({ create: true });
        if (!handle) return false;

        const serialized = await serializeInWorker(snapshot);

        // Validation: prevent writing empty or corrupted data
        if (!serialized || serialized.length < 10) {
          throw new Error(
            'Refusing to save: Serialized timeline data is suspiciously small or empty',
          );
        }

        try {
          JSON.parse(serialized);
        } catch (e) {
          console.error('Invalid timeline serialization', e, serialized.substring(0, 100));
          throw new Error('Refusing to save: Invalid timeline JSON structure');
        }

        const writable = await (handle as any).createWritable();
        await writable.write(serialized);
        await writable.close();

        deps.onSaveSuccess?.(serialized);
        return true;
      } catch (e: unknown) {
        deps.timelineSaveError.value =
          e instanceof Error ? e.message : 'Failed to save timeline file';
        console.warn('Failed to save timeline file', e);
        // Throw to let autoSave know it failed, but we also handle toast in the global error handler
        throw e;
      } finally {
        // Only reset flags if we're still on the same timeline context
        if (
          currentProjectId === deps.currentProjectName.value &&
          currentTimelinePath === deps.currentTimelinePath.value
        ) {
          deps.isSavingTimeline.value = false;
        }
      }
    },
    onError: (e) => {
      console.error('Failed to save timeline', e);
      deps.onSaveError?.(e);
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
  }

  function markDirty() {
    autoSave.markDirty();
    void autoSave.requestSave();
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
        typeof parsed.metadata?.fastcat?.playheadUs === 'number' &&
        Number.isFinite(parsed.metadata.fastcat.playheadUs)
      ) {
        deps.currentTime.value = parsed.metadata.fastcat.playheadUs;
      }
      if (
        typeof parsed.metadata?.fastcat?.masterGain === 'number' &&
        Number.isFinite(parsed.metadata.fastcat.masterGain)
      ) {
        deps.masterGain.value = parsed.metadata.fastcat.masterGain;
      } else {
        deps.masterGain.value = 1;
      }

      if (deps.audioMuted) {
        deps.audioMuted.value = Boolean(parsed.metadata?.fastcat?.masterMuted);
      }

      const suffix = getPlatformSuffix();
      const zoomKey = suffix ? `zoom${suffix}` : 'zoom';
      const storedZoom =
        (parsed.metadata?.fastcat as any)?.[zoomKey] ?? parsed.metadata?.fastcat?.zoom;

      if (typeof storedZoom === 'number' && Number.isFinite(storedZoom)) {
        deps.timelineZoom.value = storedZoom;
      }

      const trackHeightsKey = suffix ? `trackHeights${suffix}` : 'trackHeights';
      const storedTrackHeights =
        (parsed.metadata?.fastcat as any)?.[trackHeightsKey] ??
        parsed.metadata?.fastcat?.trackHeights;

      if (storedTrackHeights && typeof storedTrackHeights === 'object') {
        deps.trackHeights.value = { ...storedTrackHeights };
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
