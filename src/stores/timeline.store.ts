import { defineStore } from 'pinia';
import { ref } from 'vue';

import type { TimelineDocument, TimelineMarker } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';
import { applyTimelineCommand } from '~/timeline/commands';
import { createTimelineCommandService } from '~/timeline/application/timelineCommandService';
import { createTimelineEditService } from '~/timeline/application/timelineEditService';
import { parseTimelineFromOtio, serializeTimelineToOtio } from '~/timeline/otioSerializer';
import { selectTimelineDurationUs } from '~/timeline/selectors';

import { createTimelinePersistence } from '~/stores/timeline/timelinePersistence';
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

import { useProjectStore } from './project.store';
import { useMediaStore } from './media.store';
import { useHistoryStore } from './history.store';
import { useWorkspaceStore } from './workspace.store';
import { useProxyStore } from './proxy.store';
import type { ProxyThumbnailService } from '~/media-cache/application/proxyThumbnailService';

export const useTimelineStore = defineStore('timeline', () => {
  const projectStore = useProjectStore();
  const mediaStore = useMediaStore();
  const historyStore = useHistoryStore();
  const workspaceStore = useWorkspaceStore();
  const proxyStore = useProxyStore();

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
  const audioVolume = ref(1);
  const audioMuted = ref(false);
  const playbackGestureHandler = ref<((nextPlaying: boolean) => void) | null>(null);

  const timelineZoom = ref(50);

  const selectedItemIds = ref<string[]>([]);
  const selectedTrackId = ref<string | null>(null);
  const hoveredTrackId = ref<string | null>(null);
  const selectedTransition = ref<{
    trackId: string;
    itemId: string;
    edge: 'in' | 'out';
  } | null>(null);

  // Wrapper for applyTimeline to resolve circular dependencies in setup
  function applyTimeline(
    cmd: TimelineCommand,
    options?: {
      saveMode?: 'debounced' | 'immediate' | 'none';
      skipHistory?: boolean;
      historyMode?: 'immediate' | 'debounced';
      historyDebounceMs?: number;
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
    audioVolume,
    audioMuted,
    duration,
    playbackGestureHandler,
  });

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
  });

  const markerService = createTimelineMarkerService({
    getDoc: () => timelineDoc.value,
    getCurrentTime: () => currentTime.value,
    applyTimeline,
  });

  const hydration = createTimelineHydration({
    mediaMetadata,
  });

  const commandService = createTimelineCommandService({
    getTimelineDoc: () => timelineDoc.value,
    ensureTimelineDoc: () => {
      if (!timelineDoc.value) {
        timelineDoc.value = projectStore.createFallbackTimelineDoc();
      }
      return timelineDoc.value;
    },
    getTrackById: (trackId) => timelineDoc.value?.tracks.find((t) => t.id === trackId) ?? null,
    applyTimeline,
    getFileHandleByPath: (path) => projectStore.getFileHandleByPath(path),
    getOrFetchMetadata: (handle, path) => mediaStore.getOrFetchMetadata(handle, path),
    getMediaMetadataByPath: (path) => mediaMetadata.value[path] ?? null,
    fetchMediaMetadataByPath: (path) => mediaStore.getOrFetchMetadataByPath(path),
    getUserSettings: () => workspaceStore.userSettings,
    mediaCache: {
      hasProxy: (path: string) => proxyStore.existingProxies.has(path),
      ensureProxy: async (params: {
        fileHandle: FileSystemFileHandle;
        projectRelativePath: string;
      }) => await proxyStore.generateProxy(params.fileHandle, params.projectRelativePath),
    } satisfies Pick<ProxyThumbnailService, 'hasProxy' | 'ensureProxy'>,
    defaultImageDurationUs: DEFAULT_IMAGE_DURATION_US,
    defaultImageSourceDurationUs: DEFAULT_IMAGE_DURATION_US,
    parseTimelineFromOtio,
    selectTimelineDurationUs,
  });

  async function moveItemToTrack(input: {
    fromTrackId: string;
    toTrackId: string;
    itemId: string;
    startUs: number;
  }) {
    await commandService.moveItemToTrack(input);
  }

  async function extractAudioToTrack(input: { videoTrackId: string; videoItemId: string }) {
    await commandService.extractAudioToTrack({
      videoTrackId: input.videoTrackId,
      videoItemId: input.videoItemId,
    });
  }

  function returnAudioToVideo(input: { videoItemId: string }) {
    applyTimeline({ type: 'return_audio_to_video', videoItemId: input.videoItemId });
  }

  function resetTimelineState() {
    persistence.resetPersistenceState();
    timelineDoc.value = null;
    isTimelineDirty.value = false;
    isSavingTimeline.value = false;
    timelineSaveError.value = null;
    isPlaying.value = false;
    currentTime.value = 0;
    duration.value = 0;
    audioVolume.value = 1;
    audioMuted.value = false;
    timelineZoom.value = 50;
    selection.clearSelection();
    selection.selectTrack(null);
    historyStore.clear();
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

    isTimelineDirty,
    isSavingTimeline,
    timelineSaveError,

    currentProjectName,
    currentTimelinePath,

    ensureTimelineFileHandle,
    createFallbackTimelineDoc: () => projectStore.createFallbackTimelineDoc(),

    parseTimelineFromOtio,
    serializeTimelineToOtio,
    selectTimelineDurationUs,
  });

  async function requestTimelineSave(options?: { immediate?: boolean }) {
    await persistence.requestTimelineSave(options);
  }

  async function loadTimeline() {
    selection.clearSelection();
    selection.selectTrack(null);
    isPlaying.value = false;
    currentTime.value = 0;
    historyStore.clear();
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
  });

  const { undoTimeline, redoTimeline } = dispatcher;

  async function addClipToTimelineFromPath(input: {
    trackId: string;
    name: string;
    path: string;
    startUs?: number;
  }) {
    await commandService.addClipToTimelineFromPath(input);
  }

  async function addTimelineClipToTimelineFromPath(input: {
    trackId: string;
    name: string;
    path: string;
    startUs?: number;
  }) {
    if (currentTimelinePath.value && input.path === currentTimelinePath.value) {
      throw new Error('Cannot insert the currently opened timeline into itself');
    }
    await commandService.addTimelineClipFromPath(input);
  }

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

  return {
    timelineDoc,
    getMarkers: markerService.getMarkers,
    isTimelineDirty,
    isSavingTimeline,
    timelineSaveError,
    isPlaying,
    currentTime,
    duration,
    audioVolume,
    audioMuted,
    playbackSpeed,
    timelineZoom,
    selectedItemIds,
    selectedTrackId,
    hoveredTrackId,
    selectedTransition,
    loadTimeline,
    saveTimeline,
    requestTimelineSave,
    applyTimeline,
    addClipToTimelineFromPath,
    addTimelineClipToTimelineFromPath,
    loadTimelineMetadata,
    clearSelection: () => selection.clearSelection(),
    selectTrack: (trackId: string | null) => selection.selectTrack(trackId),
    toggleSelection: (itemId: string, options?: { multi?: boolean }) =>
      selection.toggleSelection(itemId, options),
    selectTransition: (input: { trackId: string; itemId: string; edge: 'in' | 'out' } | null) =>
      selection.selectTransition(input),
    ...playback,
    ...tracks,
    ...trimming,
    ...clips,
    addMarkerAtPlayhead: markerService.addMarkerAtPlayhead,
    addZoneMarkerAtPlayhead: markerService.addZoneMarkerAtPlayhead,
    updateMarker: markerService.updateMarker,
    removeMarker: markerService.removeMarker,
    convertMarkerToZone: markerService.convertMarkerToZone,
    convertZoneToMarker: markerService.convertZoneToMarker,
    moveItemToTrack,
    extractAudioToTrack,
    returnAudioToVideo,
    resetTimelineState,
    undoTimeline,
    redoTimeline,
    batchApplyTimeline,
    historyStore,
  };
});
