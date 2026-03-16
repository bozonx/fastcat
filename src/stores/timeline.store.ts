import { defineStore } from 'pinia';
import { ref, watch, toRef } from 'vue';

import type {
  TimelineDocument,
  TimelineMarker,
  TimelineSelectionRange,
  TimelineMediaClipItem,
  TimelineTrackItem,
} from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';
import { applyTimelineCommand } from '~/timeline/commands';
import { createTimelineCommandService } from '~/timeline/application/timelineCommandService';
import { createTimelineEditService } from '~/timeline/application/timelineEditService';
import { parseTimelineFromOtio, serializeTimelineToOtio } from '~/timeline/otioSerializer';
import { selectTimelineDurationUs } from '~/timeline/selectors';

import { createTimelinePersistence } from '~/stores/timeline/timelinePersistence';
import { generateTimelineThumbnail } from '~/timeline/timelineThumbnail';
import { createTimelineMarkerService } from '~/timeline/application/timelineMarkerService';
import { createTimelineSelection } from '~/stores/timeline/timelineSelection';
import { createTimelinePlayback } from '~/stores/timeline/timelinePlayback';
import { createTimelineTracks } from '~/stores/timeline/timelineTracks';
import { createTimelineClips } from '~/stores/timeline/timelineClips';
import { createTimelineTrimming } from '~/stores/timeline/timelineTrimming';
import { createTimelineHydration } from '~/stores/timeline/timelineHydration';
import { createTimelineExternalRefs } from '~/stores/timeline/timelineExternalRefs';
import { createTimelineHistoryDebounce } from '~/stores/timeline/timelineHistoryDebounce';
import { createTimelineDispatcher } from '~/stores/timeline/timelineDispatcher';
import { createTimelineSelectionRange } from '~/stores/timeline/timelineSelectionRange';
import { createTimelineCaptions } from '~/stores/timeline/timelineCaptions';
import { createTimelineCommands } from '~/stores/timeline/timelineCommands';

import { quantizeTimeUsToFrames, sanitizeFps, getDocFps } from '~/timeline/commands/utils';

import { useProjectStore } from './project.store';
import { useMediaStore } from './media.store';
import { useHistoryStore } from './history.store';
import { useWorkspaceStore } from './workspace.store';
import { useProxyStore } from './proxy.store';
import { useSelectionStore } from './selection.store';
import { useUiStore } from './ui.store';
import type { ProxyThumbnailService } from '~/media-cache/application/proxyThumbnailService';
import { MAX_TIMELINE_ZOOM_POSITION, MIN_TIMELINE_ZOOM_POSITION } from '~/utils/zoom';
import { useTimelineMediaUsageStore } from './timeline-media-usage.store';
import { computeMediaUsageByTimelineDocs } from '~/utils/timeline-media-usage';

export const useTimelineStore = defineStore('timeline', () => {
  const projectStore = useProjectStore();
  const mediaStore = useMediaStore();
  const historyStore = useHistoryStore();
  const workspaceStore = useWorkspaceStore();
  const proxyStore = useProxyStore();
  const selectionStore = useSelectionStore();
  const uiStore = useUiStore();
  const toast = useToast();
  const { t } = useI18n();
  const timelineMediaUsageStore = useTimelineMediaUsageStore();

  const historyDebounce = createTimelineHistoryDebounce({ historyStore });

  const { currentProjectName, currentTimelinePath, mediaMetadata } = createTimelineExternalRefs({
    projectStore,
    mediaStore,
  });

  const DEFAULT_IMAGE_DURATION_US = 5_000_000;
  const DEFAULT_IMAGE_SOURCE_DURATION_US = DEFAULT_IMAGE_DURATION_US;

  const timelineDoc = ref<TimelineDocument | null>(null);

  const isTimelineDirty = ref(false);
  const isSavingTimeline = ref(false);
  const timelineSaveError = ref<string | null>(null);

  const isPlaying = ref(false);
  const playbackSpeed = ref(1);
  const currentTime = ref(0);
  const duration = ref(0);
  const masterGain = ref(1);
  const audioMuted = ref(false);
  const audioLevels = ref<Record<string, { rmsDb: number; peakDb: number }>>({});

  // Provide getter/setter for reactivity since Vue does not always catch dynamic property additions deeply out of the box in setup
  const playbackGestureHandler = ref<((nextPlaying: boolean) => void) | null>(null);

  const timelineZoom = ref(50);
  const trackHeights = ref<Record<string, number>>({});

  const fps = computed(() =>
    getDocFps(timelineDoc.value || ({ timebase: { fps: 30 }, tracks: [] } as any)),
  );

  const selectedItemIds = ref<string[]>([]);
  const selectedTrackId = ref<string | null>(null);
  const hoveredTrackId = ref<string | null>(null);
  const renamingTrackId = ref<string | null>(null);
  const selectedTransition = ref<{
    trackId: string;
    itemId: string;
    edge: 'in' | 'out';
  } | null>(null);

  // Sync live usage to the usage store
  watch(
    [() => timelineDoc.value, () => projectStore.currentTimelinePath],
    ([doc, path]) => {
      if (!doc || !path) {
        timelineMediaUsageStore.setLiveUsage(null, {});
        return;
      }
      const name = path.split('/').pop() ?? path;
      const usage = computeMediaUsageByTimelineDocs([
        { timelinePath: path, timelineDoc: doc, timelineName: name },
      ]);
      timelineMediaUsageStore.setLiveUsage(path, usage.mediaPathToTimelines);
    },
    { immediate: true, deep: true },
  );

  const isTrimModeActive = ref(false);

  // Wrapper for applyTimeline to resolve circular dependencies in setup
  function applyTimeline(
    cmd: TimelineCommand,
    options?: {
      saveMode?: 'debounced' | 'immediate' | 'none';
      skipHistory?: boolean;
      historyMode?: 'immediate' | 'debounced';
      historyDebounceMs?: number;
      labelKey?: string;
    },
  ) {
    dispatcher.applyTimeline(cmd, options);
  }

  function batchApplyTimeline(
    cmds: TimelineCommand[],
    options?: {
      saveMode?: 'debounced' | 'immediate' | 'none';
      skipHistory?: boolean;
      historyMode?: 'immediate' | 'debounced';
      historyDebounceMs?: number;
      labelKey?: string;
    },
  ) {
    dispatcher.batchApplyTimeline(cmds, options);
  }

  const selection = createTimelineSelection({
    timelineDoc,
    currentTime,
    selectedItemIds,
    selectedTrackId,
    selectedTransition,
  });

  const editService = createTimelineEditService({
    getDoc: () => timelineDoc.value,
    getHotkeyTargetClip: () => selection.getHotkeyTargetClip(),
    getSelectedItemIds: () => selectedItemIds.value,
    getCurrentTime: () => currentTime.value,
    applyTimeline,
    requestTimelineSave,
  });

  const playback = createTimelinePlayback({
    currentTime,
    isPlaying,
    playbackSpeed,
    timelineZoom,
    audioVolume: masterGain,
    audioMuted,
    duration,
    playbackGestureHandler,
  });

  function resetTimelineZoom() {
    timelineZoom.value = 50;
  }

  function setMasterMuted(nextMuted: boolean) {
    const muted = Boolean(nextMuted);
    audioMuted.value = muted;
    if (!timelineDoc.value) return;
    applyTimeline({ type: 'update_master_muted', muted });
  }

  function setCurrentTimeUs(nextTimeUs: number) {
    const fps = sanitizeFps(timelineDoc.value?.timebase?.fps);
    const quantized = quantizeTimeUsToFrames(nextTimeUs, fps, 'round');
    const max = Number.isFinite(duration.value) ? Math.max(0, Math.round(duration.value)) : 0;
    currentTime.value = max > 0 ? Math.min(Math.max(0, quantized), max) : Math.max(0, quantized);
  }

  const tracks = createTimelineTracks({
    timelineDoc,
    selectedTrackId,
    applyTimeline,
    requestTimelineSave,
    getSelectedOrActiveTrackId: () => selection.getSelectedOrActiveTrackId(),
  });

  const trimming = createTimelineTrimming({
    timelineDoc,
    currentTime,
    duration,
    selectedItemIds,
    applyTimeline,
    batchApplyTimeline,
    requestTimelineSave,
    getHotkeyTargetClip: () => selection.getHotkeyTargetClip(),
    getSelectedOrActiveTrackId: () => selection.getSelectedOrActiveTrackId(),
    editService,
  });

  const clips = createTimelineClips({
    timelineDoc,
    selectedItemIds,
    selectedTrackId,
    selectedTransition,
    currentTime,
    applyTimeline,
    requestTimelineSave,
    resolveTargetVideoTrackIdForInsert: () => tracks.resolveTargetVideoTrackIdForInsert(),
    clearSelection: () => selection.clearSelection(),
    clearSelectedTransition: () => selection.clearSelectedTransition(),
    rippleDeleteRange: (input) => trimming.rippleDeleteRange(input),
    createFallbackTimelineDoc: () => projectStore.createFallbackTimelineDoc(),
    deleteTrack: (trackId, options) => tracks.deleteTrack(trackId, options),
    selectTrack: (trackId) => selection.selectTrack(trackId),
    getHotkeyTargetClip: () => selection.getHotkeyTargetClip(),
    get defaultStaticClipDurationUs() {
      return workspaceStore.userSettings.timeline.defaultStaticClipDurationUs;
    },
  });

  const markerService = createTimelineMarkerService({
    getDoc: () => timelineDoc.value,
    getCurrentTime: () => currentTime.value,
    applyTimeline,
  });

  const hydration = createTimelineHydration({
    mediaMetadata,
  });

  function resetTimelineState() {
    persistence.resetPersistenceState();
    timelineDoc.value = null;
    isTimelineDirty.value = false;
    isSavingTimeline.value = false;
    timelineSaveError.value = null;
    isPlaying.value = false;
    currentTime.value = 0;
    duration.value = 0;
    masterGain.value = 1;
    audioMuted.value = false;
    audioLevels.value = {};
    timelineZoom.value = 50;
    selection.clearSelection();
    selection.selectTrack(null);
    historyStore.clear('timeline');
    historyDebounce.clearPendingDebouncedHistory();
  }

  function markTimelineAsCleanForCurrentRevision() {
    persistence.markCleanForCurrentRevision();
  }

  function markTimelineAsDirty() {
    persistence.markDirty();
  }

  async function ensureTimelineFileHandle(options?: {
    create?: boolean;
  }): Promise<FileSystemFileHandle | null> {
    if (!currentTimelinePath.value) return null;
    return await projectStore.getProjectFileHandleByRelativePath({
      relativePath: currentTimelinePath.value,
      create: options?.create ?? false,
    });
  }

  const persistence = createTimelinePersistence({
    timelineDoc,
    currentTime,
    duration,
    masterGain,
    timelineZoom,
    trackHeights,
    audioMuted,

    isTimelineDirty,
    isSavingTimeline,
    timelineSaveError,

    isReadOnly: toRef(projectStore, 'isReadOnly'),

    currentProjectName,
    currentTimelinePath,

    ensureTimelineFileHandle,
    createFallbackTimelineDoc: () => projectStore.createFallbackTimelineDoc(),

    parseTimelineFromOtio,
    serializeTimelineToOtio,
    selectTimelineDurationUs,
    onSaveSuccess: () => {
      uiStore.notifyTimelineSave();
      void timelineMediaUsageStore.refreshUsage();

      // Generate background thumbnail for nested timeline preview
      if (currentTimelinePath.value && timelineDoc.value) {
        void generateTimelineThumbnail({
          timelinePath: currentTimelinePath.value,
          timelineDoc: timelineDoc.value,
        });
      }
    },
  });

  watch(
    () => timelineDoc.value?.metadata?.fastcat?.masterMuted,
    (next) => {
      if (timelineDoc.value) {
        audioMuted.value = Boolean(next);
      }
    },
    { flush: 'post' },
  );

  async function requestTimelineSave(options?: { immediate?: boolean }) {
    await persistence.requestTimelineSave(options);
  }

  async function loadTimeline() {
    selection.clearSelection();
    selection.selectTrack(null);
    isPlaying.value = false;
    currentTime.value = 0;
    historyStore.clear('timeline');
    historyDebounce.clearPendingDebouncedHistory();

    await persistence.loadTimeline();
  }

  async function saveTimeline() {
    await persistence.saveTimeline();
  }

  const dispatcher = createTimelineDispatcher({
    timelineDoc,
    duration,
    createFallbackTimelineDoc: () => projectStore.createFallbackTimelineDoc(),
    hydration,
    historyDebounce,
    historyStore,
    requestTimelineSave,
    markTimelineAsDirty,
    selectTimelineItems: selection.selectTimelineItems,
    selectGlobalTimelineItems: (itemIds, doc) => {
      const itemIdSet = new Set(itemIds);
      const items = doc.tracks.flatMap((track) =>
        track.items
          .filter((item) => item.kind === 'clip' && itemIdSet.has(item.id))
          .map((item) => ({
            trackId: track.id,
            itemId: item.id,
          })),
      );

      selectionStore.selectTimelineItems(items);
    },
  });

  const { undoTimeline, redoTimeline } = dispatcher;

  const commands = createTimelineCommands({
    timelineDoc,
    currentTimelinePath,
    mediaMetadata,
    applyTimeline,
    projectStore,
    mediaStore,
    workspaceStore,
    proxyStore,
    uiStore,
    toast,
    t,
  });

  async function loadTimelineMetadata() {
    if (!timelineDoc.value) return;

    const requestId = persistence.getLoadRequestId();
    const timelinePathSnapshot = currentTimelinePath.value;

    const items: { path: string }[] = [];
    for (const track of timelineDoc.value.tracks) {
      for (const item of track.items) {
        if (item.kind === 'clip' && item.clipType === 'media' && item.source?.path) {
          items.push({ path: item.source.path });
        }
      }
    }

    if (requestId !== persistence.getLoadRequestId()) return;
    if (timelinePathSnapshot !== currentTimelinePath.value) return;

    await Promise.all(items.map((it) => mediaStore.getOrFetchMetadataByPath(it.path)));
  }

  const selectionRange = createTimelineSelectionRange({
    timelineDoc,
    currentTime,
    selectionStore,
    markerService,
    trimming,
  });

  const captions = createTimelineCaptions({
    timelineDoc,
    workspaceStore,
    projectStore,
    clips,
    requestTimelineSave,
  });

  function setTimelineZoomExact(next: number) {
    const parsed = Number(next);
    if (!Number.isFinite(parsed)) return;

    timelineZoom.value = Math.min(
      MAX_TIMELINE_ZOOM_POSITION,
      Math.max(MIN_TIMELINE_ZOOM_POSITION, parsed),
    );
  }

  return {
    timelineDoc,
    getMarkers: markerService.getMarkers,
    getSelectionRange: selectionRange.getSelectionRange,
    fps,
    isTimelineDirty,
    isSavingTimeline,
    timelineSaveError,
    isPlaying,
    currentTime,
    setCurrentTimeUs,
    duration,
    masterGain,
    audioVolume: masterGain,
    audioMuted,
    audioLevels,
    playbackSpeed,
    timelineZoom,
    selectedItemIds,
    selectedTrackId,
    hoveredTrackId,
    renamingTrackId,
    selectedTransition,
    isTrimModeActive,
    trackHeights,
    loadTimeline,
    saveTimeline,
    requestTimelineSave,
    applyTimeline,
    setMasterGain: (gain: number) => {
      applyTimeline({ type: 'update_master_gain', gain });
      if (gain > 0 && audioMuted.value) {
        setMasterMuted(false);
      }
    },
    addClipToTimelineFromPath: commands.addClipToTimelineFromPath,
    addTimelineClipToTimelineFromPath: commands.addTimelineClipToTimelineFromPath,
    ...captions,
    ...tracks,
    ...trimming,
    ...clips,
    addMarkerAtPlayhead: markerService.addMarkerAtPlayhead,
    addZoneMarkerAtPlayhead: markerService.addZoneMarkerAtPlayhead,
    createSelectionRangeAtPlayhead: selectionRange.createSelectionRangeAtPlayhead,
    createSelectionRange: selectionRange.createSelectionRange,
    updateMarker: markerService.updateMarker,
    removeMarker: markerService.removeMarker,
    updateSelectionRange: selectionRange.updateSelectionRange,
    removeSelectionRange: selectionRange.removeSelectionRange,
    convertMarkerToZone: markerService.convertMarkerToZone,
    convertZoneToMarker: markerService.convertZoneToMarker,
    convertMarkerToSelectionRange: selectionRange.convertMarkerToSelectionRange,
    createSelectionRangeFromMarker: selectionRange.createSelectionRangeFromMarker,
    convertSelectionRangeToMarker: selectionRange.convertSelectionRangeToMarker,
    isSelectionRangeSelected: selectionRange.isSelectionRangeSelected,
    rippleTrimSelectionRange: selectionRange.rippleTrimSelectionRange,
    moveItemToTrack: commands.moveItemToTrack,
    extractAudioToTrack: commands.extractAudioToTrack,
    returnAudioToVideo: commands.returnAudioToVideo,
    markTimelineAsDirty,
    markTimelineAsCleanForCurrentRevision,
    resetTimelineState,
    undoTimeline,
    redoTimeline,
    selectTimelineProperties: () => selectionStore.selectTimelineProperties(),
    batchApplyTimeline,
    historyStore,
    setPlaybackSpeed: playback.setPlaybackSpeed,
    togglePlayback: playback.togglePlayback,
    goToStart: playback.goToStart,
    goToEnd: playback.goToEnd,
    setAudioVolume: playback.setAudioVolume,
    setTimelineZoom: playback.setTimelineZoom,
    resetTimelineZoom,
    toggleAudioMuted: playback.toggleAudioMuted,
    setMasterMuted,
    setPlaybackGestureHandler: playback.setPlaybackGestureHandler,
    loadTimelineMetadata,
    selectTimelineItems: selection.selectTimelineItems,
    selectTrack: selection.selectTrack,
    selectTransition: selection.selectTransition,
    toggleSelection: selection.toggleSelection,
    clearSelection: selection.clearSelection,
    selectAllClipsOnTrack: selection.selectAllClipsOnTrack,
    selectAllClips: selection.selectAllClips,
    selectClipsRelativeToPlayhead: selection.selectClipsRelativeToPlayhead,
    getSelectedOrActiveTrackId: selection.getSelectedOrActiveTrackId,
    setTimelineZoomExact,
    seekFrames: (deltaFrames: number) => {
      const fps = getDocFps(timelineDoc.value || ({ timebase: { fps: 30 } } as any));
      const frameUs = 1_000_000 / fps;
      setCurrentTimeUs(currentTime.value + deltaFrames * frameUs);
    },
  };
});
