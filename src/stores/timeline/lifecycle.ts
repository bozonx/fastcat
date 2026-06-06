import { watch, type Ref } from 'vue';

import type { TimelineDocument, TimelineSelectionRange } from '~/timeline/types';
import type { MediaPathToTimelinesMap } from '~/utils/timeline-media-usage';
import { computeMediaUsageByTimelineDocs } from '~/utils/timeline-media-usage';
import { generateTimelineThumbnail } from '~/timeline/timeline-thumbnail';
import { quantizeTimeUsToFrames, sanitizeFps } from '~/timeline/commands/utils';
import { TIMELINE_DEFAULTS } from '~/utils/constants';

interface TimelineSelectionModule {
  clearSelection: () => void;
  selectTrack: (trackId: string | null) => void;
}

interface TimelinePersistenceModule {
  resetPersistenceState: () => void;
  markCleanForCurrentRevision: () => void;
  markDirty: () => void;
  loadTimeline: () => Promise<void>;
  saveTimeline: () => Promise<void>;
  requestTimelineSave: (options?: { immediate?: boolean }) => Promise<void>;
  getLoadRequestId: () => number;
}

interface TimelineHistoryDebounceModule {
  clearPendingDebouncedHistory: () => void;
}

interface TimelineMediaUsageStoreModule {
  setLiveUsage: (timelinePath: string | null, usage: MediaPathToTimelinesMap) => void;
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
  trackHeights: Ref<Record<string, number>>;
  selectionRange: Ref<TimelineSelectionRange | null>;
  historyStore: {
    clear: (scope: string) => void;
  };
  historyDebounce: TimelineHistoryDebounceModule;
  selection: TimelineSelectionModule;
  persistence: TimelinePersistenceModule;
  timelineMediaUsageStore: TimelineMediaUsageStoreModule;
  getOrFetchMetadataByPath: (path: string) => Promise<unknown>;
  uiStore: {
    notifyTimelineSave: () => void;
  };
  getProjectSettings: () => unknown;
}

export interface TimelineLifecycleModule {
  handleSaveSuccess: () => Promise<void>;
  loadTimeline: () => Promise<void>;
  loadTimelineMetadata: () => Promise<void>;
  markTimelineAsCleanForCurrentRevision: () => void;
  markTimelineAsDirty: () => void;
  requestTimelineSave: (options?: { immediate?: boolean }) => Promise<void>;
  resetTimelineState: () => void;
  resetTimelineZoom: () => void;
  saveTimeline: () => Promise<void>;
  setCurrentTimeUs: (nextTimeUs: number) => void;
}

export function createTimelineLifecycleModule(
  deps: TimelineLifecycleDeps,
): TimelineLifecycleModule {
  // Shallow watcher: applyTimeline/batchApplyTimeline always replaces
  // timelineDoc.value with a new document object, so identity-level tracking
  // is enough. A deep watcher used to fire on every micro-mutation of the
  // doc tree, dragging O(N) work into the hot path of long timelines.
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
    { immediate: true, flush: 'post' },
  );

  function resetTimelineZoom() {
    deps.timelineZoom.value = TIMELINE_DEFAULTS.ZOOM;
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
    deps.timelineZoom.value = TIMELINE_DEFAULTS.ZOOM;
    deps.selectionRange.value = null;
    deps.selection.clearSelection();
    deps.selection.selectTrack(null);
    deps.historyStore.clear('timeline');
    deps.historyDebounce.clearPendingDebouncedHistory();
  }

  // Note: Switching timelines clears the timeline history stack by design.
  // Each timeline has its own isolated undo/redo state. Undo entries from
  // the previously open timeline are not preserved when a new timeline loads.

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

    // History is now per-tab: `persistence.loadTimeline` parks the outgoing
    // tab's undo stack and restores the incoming tab's (or clears it on a fresh
    // disk load) via the captureHistoryState/restoreHistoryState hooks. Clearing
    // here would wipe the outgoing stack before it could be parked.

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

    const paths = new Set<string>();
    for (const track of deps.timelineDoc.value.tracks) {
      for (const item of track.items) {
        if (item.kind !== 'clip') continue;

        if (item.source?.path) {
          paths.add(item.source.path);
        }

        if (item.mask?.source?.path) {
          paths.add(item.mask.source.path);
        }
      }
    }

    if (requestId !== deps.persistence.getLoadRequestId()) return;
    if (timelinePathSnapshot !== deps.currentTimelinePath.value) return;

    await Promise.all(
      Array.from(paths).map(async (path) => await deps.getOrFetchMetadataByPath(path)),
    );
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
