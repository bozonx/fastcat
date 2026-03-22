import { defineStore } from 'pinia';
import { ref, toRef } from 'vue';

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

import { createTimelinePersistence } from '~/stores/timeline/timeline-persistence';
import { createTimelineMarkerService } from '~/timeline/application/timelineMarkerService';
import { createTimelineSelection } from '~/stores/timeline/timeline-selection';
import { createTimelinePlayback } from '~/stores/timeline/timeline-playback';
import { createTimelineTracks } from '~/stores/timeline/timeline-tracks';
import { createTimelineClips } from '~/stores/timeline/timeline-clips';
import { createTimelineTrimming } from '~/stores/timeline/timeline-trimming';
import { createTimelineHydration } from '~/stores/timeline/timeline-hydration';
import { createTimelineExternalRefs } from '~/stores/timeline/timeline-external-refs';
import { createTimelineHistoryDebounce } from '~/stores/timeline/timeline-history-debounce';
import { createTimelineDispatcher } from '~/stores/timeline/timeline-dispatcher';
import { createTimelineSelectionRange } from '~/stores/timeline/timeline-selection-range';
import { createTimelineCaptions } from '~/stores/timeline/timeline-captions';
import { createTimelineCommands } from '~/stores/timeline/timeline-commands';
import { createTimelineLifecycle } from '~/stores/timeline/timeline-lifecycle';

import { getDocFps } from '~/timeline/commands/utils';

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

import type { AppNotificationService } from '~/services/AppNotificationService';
import type { I18nService } from '~/services/I18nService';

export const useTimelineStore = defineStore('timeline', () => {
  const projectStore = useProjectStore();
  const mediaStore = useMediaStore();
  const historyStore = useHistoryStore();
  const workspaceStore = useWorkspaceStore();
  const proxyStore = useProxyStore();
  const selectionStore = useSelectionStore();
  const uiStore = useUiStore();
  const nuxtApp = useNuxtApp();
  const toast = nuxtApp.$notificationService as AppNotificationService;
  const { t } = nuxtApp.$i18nService as I18nService;
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

  const fps = computed(() => {
    if (timelineDoc.value) return getDocFps(timelineDoc.value);
    return 30;
  });

  const selectedItemIds = ref<string[]>([]);
  const selectedTrackId = ref<string | null>(null);
  const hoveredTrackId = ref<string | null>(null);
  const renamingTrackId = ref<string | null>(null);
  const selectedTransition = ref<{
    trackId: string;
    itemId: string;
    edge: 'in' | 'out';
  } | null>(null);

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
    selectionStore,
  });

  const editService = createTimelineEditService({
    getDoc: () => timelineDoc.value,
    getHotkeyTargetClip: () => selection.getHotkeyTargetClip(),
    getSelectedItemIds: () => selectedItemIds.value,
    getCurrentTime: () => currentTime.value,
    applyTimeline,
    batchApplyTimeline,
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
    getDocFps: () => (timelineDoc.value ? getDocFps(timelineDoc.value) : 30),
    setCurrentTimeUs: (nextTimeUs) => lifecycle.setCurrentTimeUs(nextTimeUs),
  });

  function setMasterMuted(nextMuted: boolean) {
    const muted = Boolean(nextMuted);
    audioMuted.value = muted;
    if (!timelineDoc.value) return;
    applyTimeline({ type: 'update_master_muted', muted });
  }

  const tracks = createTimelineTracks({
    timelineDoc,
    selectedTrackId,
    applyTimeline,
    batchApplyTimeline,
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
    get defaultAudioFadeCurve() {
      return workspaceStore.userSettings.projectDefaults.defaultAudioFadeCurve;
    },
  });

  const markerService = createTimelineMarkerService({
    getDoc: () => timelineDoc.value,
    getCurrentTime: () => currentTime.value,
    applyTimeline,
    get defaultZoneDurationUs() {
      return workspaceStore.userSettings.timeline.defaultStaticClipDurationUs;
    },
  });

  const hydration = createTimelineHydration({
    mediaMetadata,
  });

  async function requestTimelineSave(options?: { immediate?: boolean }) {
    await lifecycle.requestTimelineSave(options);
  }

  async function loadTimeline() {
    await lifecycle.loadTimeline();
  }

  async function saveTimeline() {
    await lifecycle.saveTimeline();
  }

  let lifecycle!: ReturnType<typeof createTimelineLifecycle>;

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
      void lifecycle.handleSaveSuccess();
    },
  });

  lifecycle = createTimelineLifecycle({
    timelineDoc,
    currentTimelinePath,
    isTimelineDirty,
    isSavingTimeline,
    timelineSaveError,
    isPlaying,
    currentTime,
    duration,
    masterGain,
    audioMuted,
    audioLevels,
    timelineZoom,
    historyStore,
    historyDebounce,
    selection,
    persistence,
    timelineMediaUsageStore,
    getOrFetchMetadataByPath: (path) => mediaStore.getOrFetchMetadataByPath(path),
    uiStore,
  });

  const dispatcher = createTimelineDispatcher({
    timelineDoc,
    duration,
    createFallbackTimelineDoc: () => projectStore.createFallbackTimelineDoc(),
    hydration,
    historyDebounce,
    historyStore,
    requestTimelineSave: lifecycle.requestTimelineSave,
    markTimelineAsDirty: lifecycle.markTimelineAsDirty,
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
    createFallbackTimelineDoc: () => projectStore.createFallbackTimelineDoc(),
    getFileHandleByPath: (path) => projectStore.getFileHandleByPath(path),
    getFileByPath: (path) => projectStore.getFileByPath(path),
    getOrFetchMetadataByPath: (path) => mediaStore.getOrFetchMetadataByPath(path),
    getUserSettings: () => workspaceStore.userSettings,
    getProjectSettings: () => projectStore.projectSettings,
    updateProjectSettings: async (settings) => {
      const { getResolutionPreset } = await import('~/utils/settings/helpers');
      const preset = getResolutionPreset(settings.width, settings.height);

      Object.assign(projectStore.projectSettings.project, {
        ...settings,
        ...preset,
      });
      await projectStore.saveProjectSettings();
    },
    hasProxy: (path: string) => proxyStore.existingProxies.has(path),
    ensureProxy: async (options: {
      file: File | FileSystemFileHandle;
      projectRelativePath: string;
    }) => await proxyStore.generateProxy(options.file, options.projectRelativePath),
    openProjectSettings: () => {
      uiStore.isProjectSettingsOpen = true;
    },
    toast,
    t,
  });

  const selectionRange = createTimelineSelectionRange({
    timelineDoc,
    currentTime,
    isSelectionRangeSelected: () =>
      selectionStore.selectedEntity?.source === 'timeline' &&
      selectionStore.selectedEntity.kind === 'selection-range',
    selectTimelineSelectionRange: () => selectionStore.selectTimelineSelectionRange(),
    clearSelection: () => selectionStore.clearSelection(),
    markerService,
    trimming,
    applyTimeline,
    get defaultStaticClipDurationUs() {
      return workspaceStore.userSettings.timeline.defaultStaticClipDurationUs;
    },
  });

  const captions = createTimelineCaptions({
    timelineDoc,
    clips,
    requestTimelineSave,
    getWorkspaceHandle: () => workspaceStore.workspaceHandle,
    getResolvedStorageTopology: () => workspaceStore.resolvedStorageTopology,
    getCurrentProjectId: () => projectStore.currentProjectId,
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
    setPreviewSelectionRange: selectionRange.setPreviewSelectionRange,
    fps,
    isTimelineDirty,
    isSavingTimeline,
    timelineSaveError,
    isPlaying,
    currentTime,
    setCurrentTimeUs: lifecycle.setCurrentTimeUs,
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
    saveTimeline: lifecycle.saveTimeline,
    requestTimelineSave: lifecycle.requestTimelineSave,
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
    markTimelineAsDirty: lifecycle.markTimelineAsDirty,
    markTimelineAsCleanForCurrentRevision: lifecycle.markTimelineAsCleanForCurrentRevision,
    resetTimelineState: lifecycle.resetTimelineState,
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
    resetTimelineZoom: lifecycle.resetTimelineZoom,
    toggleAudioMuted: playback.toggleAudioMuted,
    setMasterMuted,
    setPlaybackGestureHandler: playback.setPlaybackGestureHandler,
    seekFrames: playback.seekFrames,
    loadTimelineMetadata: lifecycle.loadTimelineMetadata,
    selectTimelineItems: selection.selectTimelineItems,
    selectTrack: selection.selectTrack,
    selectTransition: selection.selectTransition,
    toggleSelection: selection.toggleSelection,
    clearSelection: selection.clearSelection,
    selectAllClipsOnTrack: selection.selectAllClipsOnTrack,
    selectAllClips: selection.selectAllClips,
    selectClipsRelativeToPlayhead: selection.selectClipsRelativeToPlayhead,
    getSelectedOrActiveTrackId: selection.getSelectedOrActiveTrackId,
    getHotkeyTargetClip: selection.getHotkeyTargetClip,
    setTimelineZoomExact,
  };
});
