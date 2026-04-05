import { defineStore } from 'pinia';
import { ref, toRef, computed } from 'vue';

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
import { parseTimelineFromOtio, serializeTimelineToOtio } from '~/timeline/otio-serializer';
import { selectTimelineDurationUs } from '~/timeline/selectors';
import { pxPerSecondToZoom } from '~/utils/timeline/geometry';

import { createTimelinePersistenceModule } from '~/stores/timeline/persistence';
import { createTimelineMarkerService } from '~/timeline/application/timelineMarkerService';
import { createTimelineSelectionModule } from '~/stores/timeline/selection';
import { createTimelinePlaybackModule } from '~/stores/timeline/playback';
import { createTimelineTracksModule } from '~/stores/timeline/tracks';
import { createTimelineClipsModule } from '~/stores/timeline/clips';
import { createTimelineTrimmingModule } from '~/stores/timeline/trimming';
import { createTimelineHydrationModule } from '~/stores/timeline/hydration';
import { createTimelineExternalRefsModule } from '~/stores/timeline/external-refs';
import { createTimelineHistoryDebounceModule } from '~/stores/timeline/history-debounce';
import { createTimelineDispatcherModule } from '~/stores/timeline/dispatcher';
import { createTimelineSelectionRangeModule } from '~/stores/timeline/selection-range';
import { createTimelineCaptionsModule } from '~/stores/timeline/captions';
import { createTimelineCommandsModule } from '~/stores/timeline/commands';
import { createTimelineLifecycleModule } from '~/stores/timeline/lifecycle';

import { getDocFps } from '~/timeline/commands/utils';

import { useProjectStore } from './project.store';
import { useMediaStore } from './media.store';
import { useHistoryStore } from './history.store';
import { useWorkspaceStore } from './workspace.store';
import { useProxyStore } from './proxy.store';
import { useSelectionStore } from './selection.store';
import { useFocusStore } from './focus.store';
import { useUiStore } from './ui.store';
import type { ProxyThumbnailService } from '~/media-cache/application/proxyThumbnailService';
import { MAX_TIMELINE_ZOOM_POSITION, MIN_TIMELINE_ZOOM_POSITION } from '~/utils/zoom';
import { useNuxtApp } from '#app';
import { useTimelineMediaUsageStore } from './timeline-media-usage.store';

import type { AppNotificationService } from '~/services/app-notification.service';
import type { I18nService } from '~/services/i18n.service';

export const useTimelineStore = defineStore('timeline', () => {
  const projectStore = useProjectStore();
  const mediaStore = useMediaStore();
  const historyStore = useHistoryStore();
  const workspaceStore = useWorkspaceStore();
  const proxyStore = useProxyStore();
  const selectionStore = useSelectionStore();
  const focusStore = useFocusStore();
  const uiStore = useUiStore();
  const nuxtApp = useNuxtApp();
  const toast = nuxtApp.$notificationService as AppNotificationService;
  const { t } = nuxtApp.$i18nService as I18nService;
  const timelineMediaUsageStore = useTimelineMediaUsageStore();

  const historyDebounce = createTimelineHistoryDebounceModule({ historyStore });

  historyStore.registerStateGetter('timeline', () => timelineDoc.value);

  const { currentProjectName, currentTimelinePath, mediaMetadata } =
    createTimelineExternalRefsModule({
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
  const timelineViewportWidth = ref(0);
  const scrollResetTicket = ref(0);
  const scrollToPlayheadRequest = ref(0);
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
  ): string[] {
    return dispatcher.applyTimeline(cmd, options);
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
  ): string[] {
    return dispatcher.batchApplyTimeline(cmds, options);
  }

  const selection = createTimelineSelectionModule({
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

  const playback = createTimelinePlaybackModule({
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

  const tracks = createTimelineTracksModule({
    timelineDoc,
    selectedTrackId,
    applyTimeline,
    batchApplyTimeline,
    requestTimelineSave,
    getSelectedOrActiveTrackId: () => selection.getSelectedOrActiveTrackId(),
    selectedItemIds,
  });

  const trimming = createTimelineTrimmingModule({
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

  const clips = createTimelineClipsModule({
    timelineDoc,
    selectedItemIds,
    selectedTrackId,
    selectedTransition,
    currentTime,
    applyTimeline,
    batchApplyTimeline,
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

  const hydration = createTimelineHydrationModule({
    mediaMetadata,
  });

  watch(
    () => mediaMetadata.value,
    () => {
      if (timelineDoc.value) {
        const next = hydration.hydrateAllClips(timelineDoc.value);
        if (next !== timelineDoc.value) {
          timelineDoc.value = next;
        }
      }
    },
    { deep: true },
  );

  async function requestTimelineSave(options?: { immediate?: boolean }) {
    await lifecycle.requestTimelineSave(options);
  }

  async function loadTimeline() {
    await lifecycle.loadTimeline();
  }

  async function saveTimeline() {
    await lifecycle.saveTimeline();
  }

  let lifecycle!: ReturnType<typeof createTimelineLifecycleModule>;

  async function ensureTimelineFileHandle(options?: {
    create?: boolean;
  }): Promise<FileSystemFileHandle | null> {
    if (!currentTimelinePath.value) return null;
    return await projectStore.getProjectFileHandleByRelativePath({
      relativePath: currentTimelinePath.value,
      create: options?.create ?? false,
    });
  }

  const persistence = createTimelinePersistenceModule({
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
    onSaveSuccess: (serialized) => {
      void lifecycle.handleSaveSuccess();
      void handleBackup(serialized);
    },
    onSaveError: () => {
      toast.add({
        title: t('common.saveError'),
        color: 'error',
      });
    },
  });

  let lastBackupTime = 0;

  async function handleBackup(serialized: string) {
    if (!currentTimelinePath.value) return;
    const backupSettings = workspaceStore.userSettings.backup;
    if (!backupSettings || backupSettings.intervalMinutes <= 0) return;

    const now = Date.now();
    const intervalMs = backupSettings.intervalMinutes * 60 * 1000;
    if (now - lastBackupTime < intervalMs) return;

    lastBackupTime = now;

    try {
      const pathParts = currentTimelinePath.value.split('/');
      const fileName = pathParts.pop();
      if (!fileName) return;

      const baseName = fileName.replace(/\.otio$/, '');
      const dirPath = pathParts.length > 0 ? pathParts.join('/') + '/' : '';

      const backupDirStr = `.fastcat/backups/${dirPath}`;

      const backupDirHandle = await projectStore.getDirectoryHandleByPath(backupDirStr, {
        create: true,
      });
      if (!backupDirHandle) return;

      const existingBackups: { name: string; num: number; handle: FileSystemFileHandle }[] = [];
      // @ts-expect-error entries() exists on FileSystemDirectoryHandle
      for await (const [name, handle] of backupDirHandle.entries()) {
        if (
          handle.kind === 'file' &&
          name.startsWith(baseName + '__bak') &&
          name.endsWith('.otio')
        ) {
          const match = name.match(/__bak(\d{3})\.otio$/);
          if (match) {
            existingBackups.push({
              name,
              num: parseInt(match[1]!, 10),
              handle: handle as FileSystemFileHandle,
            });
          }
        }
      }

      existingBackups.sort((a, b) => a.num - b.num);

      const nextNum =
        existingBackups.length > 0 ? existingBackups[existingBackups.length - 1]!.num + 1 : 1;
      const nextName = `${baseName}__bak${nextNum.toString().padStart(3, '0')}.otio`;

      const newHandle = await backupDirHandle.getFileHandle(nextName, { create: true });
      const writable = await (newHandle as any).createWritable();
      await writable.write(serialized);
      await writable.close();

      if (existingBackups.length >= backupSettings.count) {
        const toDeleteCount = existingBackups.length - backupSettings.count + 1;
        const toDelete = existingBackups.slice(0, toDeleteCount);
        for (const item of toDelete) {
          try {
            await backupDirHandle.removeEntry(item.name);
          } catch (e) {
            console.warn('Failed to delete old backup', e);
          }
        }
      }
    } catch (e) {
      console.error('Failed to create timeline backup', e);
      toast.add({
        title: t('videoEditor.timeline.backupError', 'Failed to create timeline backup'),
        description: t(
          'videoEditor.timeline.backupErrorDesc',
          'Your data is safe, butautomatic backup failed',
        ),
        color: 'warning',
      });
    }
  }

  lifecycle = createTimelineLifecycleModule({
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

  const dispatcher = createTimelineDispatcherModule({
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

  const commands = createTimelineCommandsModule({
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

  const selectionRange = createTimelineSelectionRangeModule({
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

  const captions = createTimelineCaptionsModule({
    timelineDoc,
    mediaMetadata,
    batchApplyTimeline,
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

  async function duplicateCurrentTimeline() {
    if (!currentTimelinePath.value || !timelineDoc.value) return;
    const path = currentTimelinePath.value;
    const parts = path.split('/');
    const fileName = parts.pop();
    if (!fileName) return;

    const docSnapshot = timelineDoc.value;
    const { serializeTimelineToOtio } = await import('~/timeline/otio-serializer');
    const snapshotSerialized = serializeTimelineToOtio(docSnapshot);

    try {
      await lifecycle.saveTimeline();
    } catch (e) {
      console.error('Failed to save timeline before creating version', e);
      toast.add({
        title: t(
          'videoEditor.timeline.versionSaveError',
          'Failed to save current timeline before creating version',
        ),
        color: 'error',
      });
      return;
    }

    const baseName = fileName.replace(/\.otio$/, '');
    const match = baseName.match(/^(.*)_v(\d{1,3})$/);
    const prefix = match ? match[1]! : baseName;

    const parentPath = parts.join('/');
    const dirHandle = await projectStore.getDirectoryHandleByPath(parentPath, { create: true });
    if (!dirHandle) return;

    const existingVersions: number[] = [];
    // @ts-expect-error entries()
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind === 'file' && name.startsWith(prefix) && name.endsWith('.otio')) {
        const vMatch = name.slice(0, -'.otio'.length).match(/_v(\d{1,3})$/);
        if (vMatch) {
          existingVersions.push(parseInt(vMatch[1]!, 10));
        } else if (name === prefix + '.otio') {
          existingVersions.push(0);
        }
      }
    }

    existingVersions.sort((a, b) => a - b);
    const nextNum =
      existingVersions.length > 0 ? existingVersions[existingVersions.length - 1]! + 1 : 1;
    const nextName = `${prefix}_v${nextNum.toString().padStart(2, '0')}.otio`;

    try {
      const newHandle = await dirHandle.getFileHandle(nextName, { create: true });

      const writable = await (newHandle as any).createWritable();
      await writable.write(snapshotSerialized);
      await writable.close();

      toast.add({
        title: t('videoEditor.timeline.versionCreated', 'Version created: {name}', {
          name: nextName,
        }),
        color: 'success',
      });

      const newRelativePath = parentPath ? `${parentPath}/${nextName}` : nextName;
      await projectStore.openTimelineFile(newRelativePath);
      focusStore.setActiveTimelinePath(newRelativePath);
      await loadTimeline();
      void lifecycle.loadTimelineMetadata();
    } catch (e) {
      console.error('Failed to duplicate timeline', e);
      toast.add({
        title: t('common.saveError', 'Save error'),
        color: 'error',
      });
    }
  }

  return {
    timelineDoc,
    markers: computed(() => markerService.getMarkers()),
    selectionRange: computed(() => selectionRange.getSelectionRange()),
    getMarkers: markerService.getMarkers,
    getSelectionRange: selectionRange.getSelectionRange,
    setPreviewSelectionRange: selectionRange.setPreviewSelectionRange,
    timelineViewportWidth,
    scrollResetTicket,
    scrollToPlayheadRequest,
    requestScrollToPlayhead: () => {
      scrollToPlayheadRequest.value++;
    },
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
    ensureTimelineDoc: () => commands.ensureTimelineDoc(),
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
    addMarkerAtPlayhead: (options?: Record<string, unknown>) => {
      const existingMarkers = markerService.getMarkers();
      markerService.addMarkerAtPlayhead(options);
      const nextMarkers = markerService.getMarkers();
      const createdMarker =
        nextMarkers.find((marker) => !existingMarkers.some((item) => item.id === marker.id)) ??
        nextMarkers[nextMarkers.length - 1];

      if (createdMarker && options?.select !== false) {
        selectionStore.selectTimelineMarker(createdMarker.id);
      }
      return createdMarker;
    },
    goToNextMarker: () => {
      const markers = markerService.getMarkers();
      const points = markers
        .flatMap((m) => {
          const pts = [m.timeUs];
          if (m.durationUs) pts.push(m.timeUs + m.durationUs);
          return pts;
        })
        .sort((a, b) => a - b);

      const next = points.find((p) => p > currentTime.value + 100);
      if (next !== undefined) {
        lifecycle.setCurrentTimeUs(next);
      }
    },
    goToPreviousMarker: () => {
      const markers = markerService.getMarkers();
      const points = markers
        .flatMap((m) => {
          const pts = [m.timeUs];
          if (m.durationUs) pts.push(m.timeUs + m.durationUs);
          return pts;
        })
        .sort((a, b) => b - a);

      const prev = points.find((p) => p < currentTime.value - 100);
      if (prev !== undefined) {
        lifecycle.setCurrentTimeUs(prev);
      }
    },
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
    applyRestoredSnapshot: dispatcher.applyRestoredSnapshot,
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
    fitTimelineZoom: () => {
      if (timelineViewportWidth.value <= 0) return;
      if (duration.value <= 0) {
        lifecycle.resetTimelineZoom();
      } else {
        const desiredPPS = (timelineViewportWidth.value * 0.9) / (duration.value / 1e6);
        setTimelineZoomExact(pxPerSecondToZoom(desiredPPS));
      }
      scrollResetTicket.value++;
    },
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
    duplicateCurrentTimeline,
  };
});
