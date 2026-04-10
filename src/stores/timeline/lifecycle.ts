import { watch, type Ref } from 'vue';

import type { TimelineDocument } from '~/timeline/types';
import type { MediaPathToTimelinesMap } from '~/utils/timeline-media-usage';
import { computeMediaUsageByTimelineDocs } from '~/utils/timeline-media-usage';
import { generateTimelineThumbnail } from '~/timeline/timeline-thumbnail';
import { quantizeTimeUsToFrames, sanitizeFps } from '~/timeline/commands/utils';

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
  getProjectSettings: () => any; // Using any for now to avoid circularity if it happens, but better if we can type it
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

    // Restore session data from ProjectSettings if available
    const settings = deps.getProjectSettings();
    const path = deps.currentTimelinePath.value;
    if (path && settings?.timelines?.sessions?.[path]) {
        const session = settings.timelines.sessions[path];
        deps.currentTime.value = session.playheadUs;
        deps.masterGain.value = session.masterGain;
        if (deps.audioMuted) deps.audioMuted.value = session.masterMuted;
        deps.timelineZoom.value = session.zoom;
        deps.trackHeights.value = { ...session.trackHeights };
    }
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
        if (item.kind !== 'clip') continue;

        if (item.clipType === 'media' && item.source?.path) {
          items.push({ path: item.source.path });
        }

        if (item.mask?.source?.path) {
          items.push({ path: item.mask.source.path });
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
