import { watch, type Ref } from 'vue';

import type { TimelineDocument } from '~/timeline/types';
import { computeMediaUsageByTimelineDocs } from '~/utils/timeline-media-usage';
import { generateTimelineThumbnail } from '~/timeline/timelineThumbnail';
import { quantizeTimeUsToFrames, sanitizeFps } from '~/timeline/commands/utils';

interface TimelineSelectionApi {
  clearSelection: () => void;
  selectTrack: (trackId: string | null) => void;
}

interface TimelinePersistenceApi {
  resetPersistenceState: () => void;
  markCleanForCurrentRevision: () => void;
  markDirty: () => void;
  loadTimeline: () => Promise<void>;
  saveTimeline: () => Promise<void>;
  requestTimelineSave: (options?: { immediate?: boolean }) => Promise<void>;
  getLoadRequestId: () => number;
}

interface TimelineHistoryDebounceApi {
  clearPendingDebouncedHistory: () => void;
}

interface TimelineMediaUsageStoreApi {
  setLiveUsage: (timelinePath: string | null, usage: any) => void;
  refreshUsage: () => Promise<void>;
}

interface TimelineLifecycleDeps {
  timelineDoc: Ref<TimelineDocument | null>;
  currentTimelinePath: Ref<string | null>;
  isTimelineDirty: Ref<boolean>;
  isSavingTimeline: Ref<boolean>;
  timelineSaveError: Ref<string | null>;
  isPlaying: Ref<boolean>;
  currentTime: Ref<number>;
  duration: Ref<number>;
  masterGain: Ref<number>;
  audioMuted: Ref<boolean>;
  audioLevels: Ref<Record<string, { rmsDb: number; peakDb: number }>>;
  timelineZoom: Ref<number>;
  historyStore: {
    clear: (scope: string) => void;
  };
  historyDebounce: TimelineHistoryDebounceApi;
  selection: TimelineSelectionApi;
  persistence: TimelinePersistenceApi;
  timelineMediaUsageStore: TimelineMediaUsageStoreApi;
  getOrFetchMetadataByPath: (path: string) => Promise<unknown>;
  uiStore: {
    notifyTimelineSave: () => void;
  };
}

export function createTimelineLifecycle(deps: TimelineLifecycleDeps) {
  watch(
    [() => deps.timelineDoc.value, () => deps.currentTimelinePath.value],
    ([doc, path]) => {
      if (!doc || !path) {
        deps.timelineMediaUsageStore.setLiveUsage(null, {});
        return;
      }

      const name = path.split('/').pop() ?? path;
      const usage = computeMediaUsageByTimelineDocs([
        { timelinePath: path, timelineDoc: doc, timelineName: name },
      ]);
      deps.timelineMediaUsageStore.setLiveUsage(path, usage.mediaPathToTimelines);
    },
    { immediate: true, deep: true },
  );

  watch(
    () => deps.timelineDoc.value?.metadata?.fastcat?.masterMuted,
    (next) => {
      if (deps.timelineDoc.value) {
        deps.audioMuted.value = Boolean(next);
      }
    },
    { flush: 'post' },
  );

  watch(
    () => deps.timelineDoc.value?.metadata?.fastcat?.masterGain,
    (next) => {
      if (deps.timelineDoc.value && typeof next === 'number') {
        deps.masterGain.value = next;
      }
    },
    { flush: 'post' },
  );

  function resetTimelineZoom() {
    deps.timelineZoom.value = 50;
  }

  function setCurrentTimeUs(nextTimeUs: number) {
    const fps = sanitizeFps(deps.timelineDoc.value?.timebase?.fps);
    const quantized = quantizeTimeUsToFrames(nextTimeUs, fps, 'round');
    const max = Number.isFinite(deps.duration.value)
      ? Math.max(0, Math.round(deps.duration.value))
      : 0;
    deps.currentTime.value =
      max > 0 ? Math.min(Math.max(0, quantized), max) : Math.max(0, quantized);
  }

  function resetTimelineState() {
    deps.persistence.resetPersistenceState();
    deps.timelineDoc.value = null;
    deps.isTimelineDirty.value = false;
    deps.isSavingTimeline.value = false;
    deps.timelineSaveError.value = null;
    deps.isPlaying.value = false;
    deps.currentTime.value = 0;
    deps.duration.value = 0;
    deps.masterGain.value = 1;
    deps.audioMuted.value = false;
    deps.audioLevels.value = {};
    deps.timelineZoom.value = 50;
    deps.selection.clearSelection();
    deps.selection.selectTrack(null);
    deps.historyStore.clear('timeline');
    deps.historyDebounce.clearPendingDebouncedHistory();
  }

  function markTimelineAsCleanForCurrentRevision() {
    deps.persistence.markCleanForCurrentRevision();
  }

  function markTimelineAsDirty() {
    deps.persistence.markDirty();
  }

  async function requestTimelineSave(options?: { immediate?: boolean }) {
    await deps.persistence.requestTimelineSave(options);
  }

  async function loadTimeline() {
    deps.selection.clearSelection();
    deps.selection.selectTrack(null);
    deps.isPlaying.value = false;
    deps.currentTime.value = 0;
    deps.historyStore.clear('timeline');
    deps.historyDebounce.clearPendingDebouncedHistory();

    await deps.persistence.loadTimeline();
  }

  async function saveTimeline() {
    await deps.persistence.saveTimeline();
  }

  async function handleSaveSuccess() {
    deps.uiStore.notifyTimelineSave();
    await deps.timelineMediaUsageStore.refreshUsage();

    if (deps.currentTimelinePath.value && deps.timelineDoc.value) {
      await generateTimelineThumbnail({
        timelinePath: deps.currentTimelinePath.value,
        timelineDoc: deps.timelineDoc.value,
      });
    }
  }

  async function loadTimelineMetadata() {
    if (!deps.timelineDoc.value) return;

    const requestId = deps.persistence.getLoadRequestId();
    const timelinePathSnapshot = deps.currentTimelinePath.value;

    const items: { path: string }[] = [];
    for (const track of deps.timelineDoc.value.tracks) {
      for (const item of track.items) {
        if (item.kind === 'clip' && item.clipType === 'media' && item.source?.path) {
          items.push({ path: item.source.path });
        }
      }
    }

    if (requestId !== deps.persistence.getLoadRequestId()) return;
    if (timelinePathSnapshot !== deps.currentTimelinePath.value) return;

    await Promise.all(items.map(async (item) => await deps.getOrFetchMetadataByPath(item.path)));
  }

  return {
    handleSaveSuccess,
    loadTimeline,
    loadTimelineMetadata,
    markTimelineAsCleanForCurrentRevision,
    markTimelineAsDirty,
    requestTimelineSave,
    resetTimelineState,
    resetTimelineZoom,
    saveTimeline,
    setCurrentTimeUs,
  };
}
