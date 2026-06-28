import { createDevLogger } from '~/utils/dev-logger';
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

import type { TimelineDocument, TimelineSelectionRange } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';
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
import { createTimelineBackupModule } from '~/stores/timeline/backup';
import type { TimelinePreviewBackupInfo } from '~/stores/timeline/backup';

import { getDocFps } from '~/timeline/commands/utils';
import {
  getTimelineFormat,
  setTimelineFormat,
  resolveEffectiveTimelineFormat,
  type TimelineFormatInput,
} from '~/timeline/format';
import { applyResolutionPreset } from '~/utils/settings/helpers';
import { findNextMarkerTime, findPreviousMarkerTime } from '~/utils/timeline/marker-navigation';

import { useProjectStore } from './project.store';
import { useMediaStore } from './media.store';
import { useHistoryStore } from './history.store';
import { useWorkspaceStore } from './workspace.store';
import { useProxyStore } from './proxy.store';
import { useSelectionStore } from './selection.store';
import { useFocusStore } from './focus.store';
import { useUiStore } from './ui.store';
import { useProjectSettingsStore } from './project-settings.store';
import { MAX_TIMELINE_ZOOM_POSITION, MIN_TIMELINE_ZOOM_POSITION } from '~/utils/zoom';
import { TIMELINE_DEFAULTS } from '~/utils/constants';
import { normalizeMediaCachePath } from '~/utils/path';
import { useNuxtApp } from 'nuxt/app';
import { useTimelineMediaUsageStore } from './timeline-media-usage.store';

import type { AppNotificationService } from '~/services/app-notification.service';
import type { I18nService } from '~/services/i18n.service';
const log = createDevLogger('timeline.store');

export type { TimelineBackupVersion } from '~/stores/timeline/backup';

export const useTimelineStore = defineStore('timeline', () => {
  const projectStore = useProjectStore();
  const mediaStore = useMediaStore();
  const historyStore = useHistoryStore();
  const workspaceStore = useWorkspaceStore();
  const proxyStore = useProxyStore();
  const selectionStore = useSelectionStore();
  const uiStore = useUiStore();
  const focusStore = useFocusStore();
  const nuxtApp = useNuxtApp();
  const toast = nuxtApp.$notificationService as AppNotificationService;
  const { t } = nuxtApp.$i18nService as I18nService;
  const timelineMediaUsageStore = useTimelineMediaUsageStore();
  const isMobileLayout = computed(() => {
    if (typeof window === 'undefined') return false;
    const path = window.location.pathname;
    return path === '/m' || path.startsWith('/m/');
  });

  const historyDebounce = createTimelineHistoryDebounceModule({ historyStore });

  historyStore.registerStateGetter('timeline', () => timelineDoc.value);

  const { currentProjectName, currentTimelinePath, mediaMetadata } =
    createTimelineExternalRefsModule({
      projectStore,
      mediaStore,
    });

  const timelineDoc = ref<TimelineDocument | null>(null);
  const previewMode = ref(false);
  const previewBackupInfo = ref<TimelinePreviewBackupInfo | null>(null);

  const isTimelineDirty = ref(false);
  const isSavingTimeline = ref(false);
  const timelineSaveError = ref<string | null>(null);
  const skipRecoveryDialog = ref(false);

  // Per-path (per-tab) dirty state. Only one timeline doc lives in memory at a
  // time, so this map remembers which open timelines have uncommitted changes
  // even while they are not the active tab — used for tab dots and the
  // aggregated unsaved-changes warning on close.
  const dirtyPaths = ref<Record<string, boolean>>({});

  const isPlaying = ref(false);
  const playbackSpeed = ref(TIMELINE_DEFAULTS.PLAYBACK_SPEED);
  const currentTime = ref(0);
  const duration = ref(0);
  const masterGain = ref<number>(TIMELINE_DEFAULTS.MASTER_GAIN);
  const audioMuted = ref(false);
  const audioLevels = ref<Record<string, { rmsDb: number; peakDb: number }>>({});

  // Provide getter/setter for reactivity since Vue does not always catch dynamic property additions deeply out of the box in setup
  const playbackGestureHandler = ref<((nextPlaying: boolean) => void) | null>(null);

  const timelineZoom = ref<number>(TIMELINE_DEFAULTS.ZOOM);
  const timelineViewportWidth = ref(0);
  const timelineScrollLeftPx = ref(0);
  const scrollResetTicket = ref(0);
  const scrollToPlayheadRequest = ref(0);
  const trackHeights = ref<Record<string, number>>({});
  const mobileTrackHeightsEnlarged = ref<Record<string, boolean>>({});
  const selectionRange = ref<TimelineSelectionRange | null>(null);
  const lastClipTrimmed = ref(false);

  const fps = computed(() => {
    if (timelineDoc.value) return getDocFps(timelineDoc.value);
    return TIMELINE_DEFAULTS.FPS;
  });
  const timelineFormat = computed(() =>
    resolveEffectiveTimelineFormat(
      getTimelineFormat(timelineDoc.value),
      projectStore.projectSettings?.project,
    ),
  );

  async function updateTimelineFormat(settings: TimelineFormatInput) {
    if (!timelineDoc.value) {
      timelineDoc.value = projectStore.createFallbackTimelineDoc();
    }

    timelineDoc.value = setTimelineFormat(timelineDoc.value, settings);
    lifecycle.markTimelineAsDirty();
    await requestTimelineSave();
  }

  const selectedItemIds = ref<string[]>([]);
  const selectedTrackId = ref<string | null>(null);
  const hoveredTrackId = ref<string | null>(null);
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
    pushTimelineHistory: (preState, commandType, labelKey) =>
      dispatcher.pushTimelineHistory(preState, commandType, labelKey),
    requestTimelineSave,
    getSelectionRange: () => selectionRange.value,
    updateSelectionRange: (range) => {
      selectionRange.value = range;
    },
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
    getDocFps: () => (timelineDoc.value ? getDocFps(timelineDoc.value) : TIMELINE_DEFAULTS.FPS),
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
    currentTime,
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
    timelineZoom,
    selectedItemIds,
    applyTimeline,
    batchApplyTimeline,
    requestTimelineSave,
    getHotkeyTargetClip: () => selection.getHotkeyTargetClip(),
    getSelectedOrActiveTrackId: () => selection.getSelectedOrActiveTrackId(),
    onPlayheadJump: () => {
      scrollToPlayheadRequest.value++;
    },
    editService,
  });

  const captions = createTimelineCaptionsModule({
    timelineDoc,
    getWorkspaceHandle: () => workspaceStore.workspaceHandle,
    getProjectId: () => projectStore.currentProjectId,
    getCurrentProjectName: () => projectStore.currentProjectName,
    mediaMetadata,
    batchApplyTimeline,
    requestTimelineSave,
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
    removeFromSelection: (ids) => selection.removeFromSelection(ids),
    rippleDeleteRange: (input) => trimming.rippleDeleteRange(input),
    createFallbackTimelineDoc: () => projectStore.createFallbackTimelineDoc(),
    deleteTrack: (trackId, options) => tracks.deleteTrack(trackId, options),
    selectTrack: (trackId) => selection.selectTrack(trackId),
    getHotkeyTargetClip: () => selection.getHotkeyTargetClip(),
    ensureNoNestedTimelineCycle: (path) =>
      commands.commandService.ensureNoNestedTimelineCycle(path),
    get defaultStaticClipDurationUs() {
      return workspaceStore.userSettings.timeline.defaultStaticClipDurationUs;
    },
    get defaultAudioFadeCurve() {
      return workspaceStore.userSettings.projectDefaults.defaultAudioFadeCurve;
    },
    lastClipTrimmed,
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

  // Track only the set of media paths with known metadata. A deep watcher would
  // refire on every nested mutation (e.g. audioPeaks updates) and trigger a full
  // hydrateAllClips pass — which walks every clip on every track. Hydration only
  // needs to react when a NEW path with a positive duration becomes available.
  watch(
    () => {
      const meta = mediaMetadata.value;
      const keys: string[] = [];
      for (const path in meta) {
        const d = Number(meta[path]?.duration);
        if (Number.isFinite(d) && d > 0) keys.push(path);
      }
      keys.sort();
      return keys.join('|');
    },
    () => {
      if (timelineDoc.value) {
        const next = hydration.hydrateAllClips(timelineDoc.value);
        if (next !== timelineDoc.value) {
          timelineDoc.value = next;
        }
      }
    },
  );

  async function requestTimelineSave(options?: { immediate?: boolean }) {
    await lifecycle.requestTimelineSave(options);
  }

  async function loadTimeline() {
    await lifecycle.loadTimeline();
    scrollToPlayheadRequest.value++;
  }

  // eslint-disable-next-line prefer-const -- late-initialized before createTimelineLifecycleModule call
  let lifecycle!: ReturnType<typeof createTimelineLifecycleModule>;

  // Backup history + version preview/restore. `lifecycle` is created later in
  // setup, so its methods are forwarded through closures that resolve at call
  // time (the same late-binding pattern the persistence save callbacks use).
  const backup = createTimelineBackupModule({
    timelineDoc,
    currentTimelinePath,
    duration,
    currentTime,
    previewMode,
    previewBackupInfo,
    isReadOnly: computed(() => projectStore.isReadOnly || previewMode.value),
    isMobile: isMobileLayout,
    isDirty: isTimelineDirty,
    projectStore,
    workspaceStore,
    toast,
    t,
    loadTimeline,
    deleteTimelineAutosaveFile,
    readTimelineFile: async (relativePath) => {
      const text = await projectStore.readTextByPath(relativePath);
      if (!text) return null;
      const meta = await projectStore.getFileMetadata(relativePath);
      return { text, lastModified: meta?.lastModified ?? 0, size: meta?.size ?? text.length };
    },
    markTimelineAsDirty: () => lifecycle.markTimelineAsDirty(),
    requestTimelineSave: (options) => lifecycle.requestTimelineSave(options),
    saveTimeline: () => lifecycle.saveTimeline(),
    clearSelection: () => selection.clearSelection(),
    removeSelectionRange: () => selectionRangeModule.removeSelectionRange(),
  });

  // Deletes the crash-recovery sidecar (`.fastcat/autosave/<path>`) for a
  // timeline. Called after an explicit save commits the work, and on clean
  // shutdown so a leftover sidecar is never mistaken for crash data.
  async function deleteTimelineAutosaveFile(timelinePath: string) {
    try {
      await projectStore.deleteByPath(`.fastcat/autosave/${timelinePath}`);
    } catch (e) {
      log.warn('Failed to delete autosave sidecar', timelinePath, e);
    }
  }

  const persistence = createTimelinePersistenceModule({
    timelineDoc,
    currentTime,
    duration,
    masterGain,
    timelineZoom,
    trackHeights,
    mobileTrackHeightsEnlarged,
    audioMuted,
    selectionRange,

    isTimelineDirty,
    isSavingTimeline,
    timelineSaveError,

    isReadOnly: computed(() => projectStore.isReadOnly || previewMode.value),

    currentProjectName,
    currentTimelinePath,

    readTimelineText: (p) => projectStore.readTextByPath(p),
    writeTimelineText: (p, text) => projectStore.writeTextByPath(p, text),
    deleteTimelinePath: (p) => projectStore.deleteByPath(p),
    getTimelineMetadata: (p) => projectStore.getFileMetadata(p),
    createFallbackTimelineDoc: () => projectStore.createFallbackTimelineDoc(),
    getProjectSettings: () => projectStore.projectSettings,
    getOpenPaths: () => projectStore.projectSettings?.timelines?.openPaths ?? [],

    // Per-tab undo: park the outgoing tab's timeline undo stack (committing any
    // pending debounced entry first) and restore the incoming tab's on switch.
    captureHistoryState: () => {
      historyDebounce.flushPendingDebouncedHistory();
      return historyStore.extractScope('timeline');
    },
    restoreHistoryState: (state) => {
      historyDebounce.clearPendingDebouncedHistory();
      historyStore.injectScope(
        'timeline',
        (state as Parameters<typeof historyStore.injectScope>[1]) ?? null,
      );
    },

    parseTimelineFromOtio,
    serializeTimelineToOtio,
    selectTimelineDurationUs,
    getAutosaveIntervalMs: () => {
      const minutes = workspaceStore.userSettings.autosave?.intervalMinutes ?? 2;
      return Math.max(1, minutes) * 60_000;
    },
    autosaveDebounceMs: () => (isMobileLayout.value ? 1_500 : 500),
    isMobile: isMobileLayout,
    onMobileBackup: (serialized) => backup.handleBackup(serialized, { force: true }),
    deleteAutosaveFile: (timelinePath) => deleteTimelineAutosaveFile(timelinePath),
    discardAutosave: (timelinePath) => backup.preserveAndDiscardAutosave(timelinePath),
    onDirtyStateChange: (timelinePath, dirty) => {
      if (!timelinePath) return;
      dirtyPaths.value[timelinePath] = dirty;
    },
    // Internal flows (tab close, save-all-on-window-close) can suppress the
    // recovery prompt intentionally. Normal desktop and mobile loads both show
    // the dialog so the user can choose saved vs autosaved content.
    shouldRestoreAutosaveSilently: () => {
      if (skipRecoveryDialog.value) return true;
      return false;
    },
    showRecoveryDialog: ({ timelinePath }) => {
      return new Promise((resolve) => {
        // Rapid tab switches can start a second load while a recovery dialog is
        // still pending. Settle the previous one (default: keep the saved file)
        // so its awaiting load doesn't hang on an orphaned, never-resolved promise.
        uiStore.pendingRecoveryDialog?.resolve('open-saved');
        uiStore.pendingRecoveryDialog = {
          timelinePath,
          resolve,
        };
      });
    },
    onRecoveryChoice: (choice) => {
      if (choice === 'open-saved') {
        // The newer unsaved sidecar is preserved as a numbered backup (see
        // `discardAutosave`), so point the user at the Backups tab to find it.
        toast.add({
          title: t('videoEditor.timeline.backups.toastUnsavedTitle'),
          description: t('videoEditor.timeline.backups.toastUnsavedDesc'),
          color: 'warning',
        });
      }
    },
    exitPreview: () => {
      previewMode.value = false;
      previewBackupInfo.value = null;
    },
    onSaveSuccess: (serialized) => {
      void lifecycle.handleSaveSuccess();
      // On desktop backups are created on every explicit save; on mobile they
      // are taken only when switching timelines or leaving the project.
      if (!isMobileLayout.value) {
        void backup.handleBackup(serialized);
      }
    },
    onSaveError: () => {
      toast.add({
        title: t('common.saveError'),
        color: 'error',
      });
    },
    onSaveBlockedReadOnly: () => {
      toast.add({
        title: t('videoEditor.timeline.saveBlockedReadOnlyTitle'),
        description: previewMode.value
          ? t('videoEditor.timeline.saveBlockedPreviewDesc')
          : t('videoEditor.timeline.saveBlockedLockedDesc'),
        color: 'warning',
      });
    },
  });

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
    trackHeights,
    mobileTrackHeightsEnlarged,
    selectionRange,
    historyStore,
    historyDebounce,
    selection,
    persistence,
    timelineMediaUsageStore,
    getOrFetchMetadataByPath: (path) => mediaStore.getOrFetchMetadataByPath(path),
    uiStore,
    getProjectSettings: () => projectStore.projectSettings,
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
    isReadOnly: computed(() => projectStore.isReadOnly || previewMode.value),
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
    pruneSelection: selection.pruneSelectionForDoc,
    notifyWarning: (messageKey: string) => {
      toast.add({
        title: t(messageKey),
        color: 'warning',
      });
    },
  });

  const { undoTimeline, redoTimeline, pushTimelineHistory } = dispatcher;

  const commands = createTimelineCommandsModule({
    timelineDoc,
    currentTimelinePath,
    mediaMetadata,
    applyTimeline,
    createFallbackTimelineDoc: () => projectStore.createFallbackTimelineDoc(),
    getFileHandleByPath: (path) => projectStore.getFileHandleByPath(path),
    getFileByPath: (path) =>
      (
        nuxtApp as unknown as { $vfs: { getFile: (p: string) => Promise<File | null> } }
      ).$vfs.getFile(path),
    getOrFetchMetadataByPath: (path) => mediaStore.getOrFetchMetadataByPath(path),
    getUserSettings: () => workspaceStore.userSettings,
    getProjectSettings: () => projectStore.projectSettings,
    updateTimelineFormat,
    updateProjectFormat: (settings) => {
      const proj = projectStore.projectSettings?.project;
      if (!proj) return;
      // Auto-detection writer. Geometry and sample rate are applied independently
      // (an audio-only first clip sets only the sample rate, a video-only one only
      // geometry) and each marks its own `*Resolved` state flag. We deliberately
      // do NOT touch `isAutoSettings`: this is detection, so the project stays in
      // "auto" intent until the user configures it manually. The project-settings
      // store's deep watcher persists these mutations automatically.
      if (settings.width !== undefined && settings.height !== undefined) {
        // Derive the display fields (format/orientation/aspect) from the *new*
        // geometry via the shared helper so a portrait clip can't inherit the
        // project's old `landscape` orientation.
        const derived = applyResolutionPreset({
          width: settings.width,
          height: settings.height,
        });
        proj.width = derived.width;
        proj.height = derived.height;
        if (settings.fps !== undefined) proj.fps = settings.fps;
        proj.resolutionFormat = derived.resolutionFormat;
        proj.orientation = derived.orientation;
        proj.aspectRatio = derived.aspectRatio;
        proj.isCustomResolution = derived.isCustomResolution;
        proj.geometryResolved = true;
      }
      if (settings.sampleRate !== undefined) {
        proj.sampleRate = settings.sampleRate;
        proj.sampleRateResolved = true;
      }
    },
    hasProxy: (path: string) => proxyStore.existingProxies.has(normalizeMediaCachePath(path)),
    ensureProxy: async (options: {
      file: File | FileSystemFileHandle;
      projectRelativePath: string;
    }) => await proxyStore.generateProxy(options.file, options.projectRelativePath),
    openProjectSettings: () => {
      uiStore.isProjectSettingsOpen = true;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    toast: toast as any,
    t,
  });

  const selectionRangeModule = createTimelineSelectionRangeModule({
    timelineDoc,
    currentTime,
    selectionRange,
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

  function setTimelineZoomExact(next: number) {
    const parsed = Number(next);
    if (!Number.isFinite(parsed)) return;

    timelineZoom.value = Math.min(
      MAX_TIMELINE_ZOOM_POSITION,
      Math.max(MIN_TIMELINE_ZOOM_POSITION, parsed),
    );
  }

  async function copySessionSettingsToNewTimeline(newPath: string) {
    const projectSettingsStore = useProjectSettingsStore();
    projectSettingsStore.projectSettings.timelines.sessions[newPath] = {
      playheadUs: currentTime.value,
      masterGain: masterGain.value,
      masterMuted: audioMuted.value,
      zoom: timelineZoom.value,
      trackHeights: { ...trackHeights.value },
      selectionRange: selectionRange.value ? { ...selectionRange.value } : undefined,
      mobileTrackHeightsEnlarged: { ...mobileTrackHeightsEnlarged.value },
    };
    projectSettingsStore.markProjectSettingsAsDirty();
    await projectSettingsStore.requestProjectSettingsSave({ immediate: true });
  }

  async function duplicateCurrentTimeline() {
    if (!currentTimelinePath.value || !timelineDoc.value) return;
    if (projectStore.isReadOnly || previewMode.value) {
      toast.add({
        title: t('videoEditor.timeline.saveBlockedReadOnlyTitle'),
        description: previewMode.value
          ? t('videoEditor.timeline.saveBlockedPreviewDesc')
          : t('videoEditor.timeline.saveBlockedLockedDesc'),
        color: 'warning',
      });
      return;
    }
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
      log.error('Failed to save timeline before creating version', e);
      toast.add({
        title: t('videoEditor.timeline.versionSaveError'),
        color: 'error',
      });
      return;
    }

    const baseName = fileName.replace(/\.otio$/, '');
    const match = baseName.match(/^(.*)_(\d{3})$/);
    const prefix = match ? match[1]! : baseName;

    const parentPath = parts.join('/');

    const existingNames = await projectStore.listEntryNames(parentPath);
    const existingVersions: number[] = [];
    for (const name of existingNames) {
      if (name.startsWith(prefix) && name.endsWith('.otio')) {
        const vMatch = name.slice(0, -'.otio'.length).match(/_(\d{3})$/);
        if (vMatch) {
          existingVersions.push(parseInt(vMatch[1]!, 10));
        } else if (name === prefix + '.otio') {
          existingVersions.push(0);
        }
      }
    }

    existingVersions.sort((a, b) => a - b);
    let nextNum =
      existingVersions.length > 0 ? existingVersions[existingVersions.length - 1]! + 1 : 1;
    let nextName = `${prefix}_${nextNum.toString().padStart(3, '0')}.otio`;
    while (existingNames.includes(nextName)) {
      nextNum++;
      nextName = `${prefix}_${nextNum.toString().padStart(3, '0')}.otio`;
    }

    try {
      const newPath = parentPath ? `${parentPath}/${nextName}` : nextName;
      await projectStore.writeTextByPath(newPath, snapshotSerialized);
      await copySessionSettingsToNewTimeline(newPath);

      toast.add({
        title: t('videoEditor.timeline.versionCreated', {
          name: nextName,
        }),
        color: 'success',
      });

      const newRelativePath = newPath;
      await projectStore.openTimelineFile(newRelativePath);
      focusStore.setActiveTimelinePath(newRelativePath);
      await loadTimeline();
      void lifecycle.loadTimelineMetadata();
    } catch (e) {
      log.error('Failed to duplicate timeline', e);
      toast.add({
        title: t('common.saveError'),
        color: 'error',
      });
    }
  }

  async function getNextVersionName(): Promise<string> {
    if (!currentTimelinePath.value) return '';
    const path = currentTimelinePath.value;
    const parts = path.split('/');
    const fileName = parts.pop();
    if (!fileName) return '';

    const baseName = fileName.replace(/\.otio$/, '');
    const match = baseName.match(/^(.*)_(\d{3})$/);
    const prefix = match ? match[1]! : baseName;

    const parentPath = parts.join('/');
    const existingNames = await projectStore.listEntryNames(parentPath);
    const existingVersions: number[] = [];
    for (const name of existingNames) {
      if (name.startsWith(prefix) && name.endsWith('.otio')) {
        const vMatch = name.slice(0, -'.otio'.length).match(/_(\d{3})$/);
        if (vMatch) {
          existingVersions.push(parseInt(vMatch[1]!, 10));
        } else if (name === prefix + '.otio') {
          existingVersions.push(0);
        }
      }
    }

    existingVersions.sort((a, b) => a - b);
    let nextNum =
      existingVersions.length > 0 ? existingVersions[existingVersions.length - 1]! + 1 : 1;
    let nextName = `${prefix}_${nextNum.toString().padStart(3, '0')}.otio`;
    while (existingNames.includes(nextName)) {
      nextNum++;
      nextName = `${prefix}_${nextNum.toString().padStart(3, '0')}.otio`;
    }
    return nextName;
  }

  async function createVersionFromBackup(
    version: TimelineBackupVersion | TimelinePreviewBackupInfo,
    newName: string,
  ) {
    if (!currentTimelinePath.value) return;
    try {
      let text: string | null = null;
      if (version.type === 'main') {
        text = await projectStore.readTextByPath(currentTimelinePath.value);
      } else if (version.type === 'autosave') {
        text = await projectStore.readTextByPath(`.fastcat/autosave/${currentTimelinePath.value}`);
      } else {
        text = await projectStore.readTextByPath(version.path);
      }
      if (!text) throw new Error('Version file not found');

      const path = currentTimelinePath.value;
      const parts = path.split('/');
      parts.pop();
      const parentPath = parts.join('/');
      const finalName = newName.trim();
      const finalNameWithExt = finalName.toLowerCase().endsWith('.otio')
        ? finalName
        : `${finalName}.otio`;
      const newRelativePath = parentPath ? `${parentPath}/${finalNameWithExt}` : finalNameWithExt;

      await projectStore.writeTextByPath(newRelativePath, text);
      await copySessionSettingsToNewTimeline(newRelativePath);

      toast.add({
        title: t('videoEditor.timeline.versionCreated', {
          name: finalNameWithExt,
        }),
        color: 'success',
      });

      if (previewMode.value) {
        previewMode.value = false;
        previewBackupInfo.value = null;
      }

      await projectStore.openTimelineFile(newRelativePath);
      focusStore.setActiveTimelinePath(newRelativePath);
      await loadTimeline();
      void lifecycle.loadTimelineMetadata();
    } catch (e) {
      log.error('Failed to create version from backup', e);
      toast.add({
        title: t('common.saveError'),
        color: 'error',
      });
    }
  }

  async function saveTimelineAs(newName: string) {
    if (!currentTimelinePath.value || !timelineDoc.value) return;
    if (projectStore.isReadOnly || previewMode.value) {
      toast.add({
        title: t('videoEditor.timeline.saveBlockedReadOnlyTitle'),
        description: previewMode.value
          ? t('videoEditor.timeline.saveBlockedPreviewDesc')
          : t('videoEditor.timeline.saveBlockedLockedDesc'),
        color: 'warning',
      });
      return;
    }

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
      log.error('Failed to save timeline before save as', e);
      toast.add({
        title: t('videoEditor.timeline.versionSaveError'),
        color: 'error',
      });
      return;
    }

    const parentPath = parts.join('/');
    const sanitizedName = newName.trim();
    const finalName = sanitizedName.toLowerCase().endsWith('.otio')
      ? sanitizedName
      : `${sanitizedName}.otio`;

    try {
      const newPath = parentPath ? `${parentPath}/${finalName}` : finalName;
      await projectStore.writeTextByPath(newPath, snapshotSerialized);
      await copySessionSettingsToNewTimeline(newPath);

      toast.add({
        title: t('videoEditor.timeline.timelineSavedAs', {
          name: finalName,
        }),
        color: 'success',
      });

      const newRelativePath = newPath;
      await projectStore.openTimelineFile(newRelativePath);
      focusStore.setActiveTimelinePath(newRelativePath);
      await loadTimeline();
      void lifecycle.loadTimelineMetadata();
    } catch (e) {
      log.error('Failed to save timeline as', e);
      toast.add({
        title: t('common.saveError'),
        color: 'error',
      });
    }
  }

  // True when any open timeline (active or background tab) has uncommitted
  // changes. Used by the close handler to warn about unsaved work across tabs.
  const hasAnyDirtyTimeline = computed(() => Object.values(dirtyPaths.value).some(Boolean));

  function isPathDirty(path: string) {
    return !!dirtyPaths.value[path];
  }

  // Writes the active timeline's crash-recovery sidecar immediately (used on
  // window blur / page hide / before switching tabs), bypassing the periodic
  // timer so accumulated edits survive an unexpected exit.
  async function flushTimelineAutosave() {
    await persistence.flushTimelineAutosave();
  }

  // True when `path` has a crash-recovery sidecar that is both newer than and
  // genuinely different from the saved file (mtime first, content-confirmed only
  // when sizes match; see the equality guard in persistence.loadTimeline).
  async function hasPendingRecovery(path: string): Promise<boolean> {
    const autosavePath = `.fastcat/autosave/${path}`;
    const [mainMeta, autosaveMeta] = await Promise.all([
      projectStore.getFileMetadata(path),
      projectStore.getFileMetadata(autosavePath),
    ]);
    if (!autosaveMeta) return false;
    if (mainMeta && autosaveMeta.lastModified <= mainMeta.lastModified) return false;
    if (mainMeta && mainMeta.size === autosaveMeta.size) {
      const [mainText, autoText] = await Promise.all([
        projectStore.readTextByPath(path),
        projectStore.readTextByPath(autosavePath),
      ]);
      if (mainText && autoText && mainText === autoText) return false;
    }
    return true;
  }

  // On project open only the active timeline is loaded, so a crash that left
  // *background* tabs with unsaved work wouldn't surface (no dirty indicator, and
  // `hasAnyDirtyTimeline` would understate the risk) until each tab is clicked.
  // Stat every open path up front and flag the ones with pending recovery so the
  // tab shows dirty and close-protection covers them; opening the tab then runs
  // the normal recovery dialog.
  async function scanOpenPathsForRecovery() {
    const active = currentTimelinePath.value;
    const paths = projectStore.projectSettings?.timelines?.openPaths ?? [];
    for (const path of paths) {
      if (path === active) continue; // the active load handles its own recovery
      try {
        if (await hasPendingRecovery(path)) dirtyPaths.value[path] = true;
      } catch (e) {
        log.warn('Failed to scan timeline for recovery', path, e);
      }
    }
  }

  // Removes crash-recovery sidecars for every open timeline. Called on clean
  // shutdown (and when the user explicitly chooses "Don't save"): a clean exit
  // leaves no sidecar, so its presence on next launch means a crash.
  async function deleteAllOpenAutosaves() {
    const paths = new Set<string>(projectStore.projectSettings?.timelines?.openPaths ?? []);
    if (currentTimelinePath.value) paths.add(currentTimelinePath.value);
    for (const path of paths) {
      try {
        await deleteTimelineAutosaveFile(path);
      } catch (e) {
        log.warn('Failed to delete autosave on shutdown', path, e);
      }
      dirtyPaths.value[path] = false;
    }
  }

  return {
    timelineDoc,
    currentTimelinePath,
    dirtyPaths,
    hasAnyDirtyTimeline,
    isPathDirty,
    flushTimelineAutosave,
    deleteAllOpenAutosaves,
    deleteTimelineAutosaveFile,
    scanOpenPathsForRecovery,
    skipRecoveryDialog,
    markers: computed(() => markerService.getMarkers()),
    selectionRange: computed(() => selectionRangeModule.getSelectionRange()),
    lastClipTrimmed: computed(() => lastClipTrimmed.value),
    getMarkers: markerService.getMarkers,
    getSelectionRange: selectionRangeModule.getSelectionRange,
    setPreviewSelectionRange: selectionRangeModule.setPreviewSelectionRange,
    timelineViewportWidth,
    timelineScrollLeftPx,
    scrollResetTicket,
    scrollToPlayheadRequest,
    requestScrollToPlayhead: () => {
      scrollToPlayheadRequest.value++;
    },
    fps,
    timelineFormat,
    updateTimelineFormat,
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
    selectedTransition,
    isTrimModeActive,
    trackHeights,
    mobileTrackHeightsEnlarged,
    loadTimeline,
    ensureTimelineDoc: () => commands.ensureTimelineDoc(),
    saveTimeline: lifecycle.saveTimeline,
    requestTimelineSave: lifecycle.requestTimelineSave,
    applyTimeline,
    setMasterGain: (gain: number) => {
      masterGain.value = gain;
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
      const createdMarker = nextMarkers.find(
        (marker) => !existingMarkers.some((item) => item.id === marker.id),
      );

      if (createdMarker && options?.select !== false) {
        selectionStore.selectTimelineMarker(createdMarker.id);
      }
      return createdMarker;
    },
    goToNextMarker: () => {
      const next = findNextMarkerTime(markerService.getMarkers(), currentTime.value, fps.value);
      if (next !== undefined) {
        lifecycle.setCurrentTimeUs(next);
        scrollToPlayheadRequest.value++;
      }
    },
    goToPreviousMarker: () => {
      const prev = findPreviousMarkerTime(markerService.getMarkers(), currentTime.value, fps.value);
      if (prev !== undefined) {
        lifecycle.setCurrentTimeUs(prev);
        scrollToPlayheadRequest.value++;
      }
    },
    addZoneMarkerAtPlayhead: markerService.addZoneMarkerAtPlayhead,
    createSelectionRangeAtPlayhead: selectionRangeModule.createSelectionRangeAtPlayhead,
    createSelectionRange: selectionRangeModule.createSelectionRange,
    updateMarker: markerService.updateMarker,
    removeMarker: markerService.removeMarker,
    updateSelectionRange: selectionRangeModule.updateSelectionRange,
    removeSelectionRange: selectionRangeModule.removeSelectionRange,
    convertMarkerToZone: markerService.convertMarkerToZone,
    convertZoneToMarker: markerService.convertZoneToMarker,
    convertMarkerToSelectionRange: selectionRangeModule.convertMarkerToSelectionRange,
    createSelectionRangeFromMarker: selectionRangeModule.createSelectionRangeFromMarker,
    convertSelectionRangeToMarker: selectionRangeModule.convertSelectionRangeToMarker,
    isSelectionRangeSelected: selectionRangeModule.isSelectionRangeSelected,
    rippleTrimSelectionRange: selectionRangeModule.rippleTrimSelectionRange,
    moveItemToTrack: commands.moveItemToTrack,
    extractAudioToTrack: commands.extractAudioToTrack,
    markTimelineAsDirty: lifecycle.markTimelineAsDirty,
    markTimelineAsCleanForCurrentRevision: lifecycle.markTimelineAsCleanForCurrentRevision,
    resetTimelineState() {
      previewMode.value = false;
      previewBackupInfo.value = null;
      lifecycle.resetTimelineState();
      // Drop stale per-tab dirty flags so they can't leak across projects (a
      // lingering `true` would falsely trip `hasAnyDirtyTimeline`).
      dirtyPaths.value = {};
    },
    undoTimeline,
    redoTimeline,
    pushTimelineHistory,
    applyRestoredSnapshot: dispatcher.applyRestoredSnapshot,
    selectTimelineProperties: () => selectionStore.selectTimelineProperties(),
    batchApplyTimeline,
    historyStore,
    historyDebounce,
    setPlaybackSpeed: playback.setPlaybackSpeed,
    togglePlayback: playback.togglePlayback,
    stopPlayback: playback.stopPlayback,
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
    saveTimelineAs,
    getNextVersionName,
    createVersionFromBackup,
    previewMode,
    previewBackupInfo,
    backupVersions: backup.backupVersions,
    exitPreviewAndReload: backup.exitPreviewAndReload,
    restorePreviewVersion: backup.restorePreviewVersion,
    openVersionForPreview: backup.openVersionForPreview,
    restoreVersion: backup.restoreVersion,
    deleteBackupVersion: backup.deleteBackupVersion,
    loadBackupVersions: backup.loadBackupVersions,
    clearAllBackups: backup.clearAllBackups,
    isMobileLayout,
    // Create a forced backup of the current timeline before leaving the project
    // or switching timelines on mobile.
    async maybeCreateMobileBackup() {
      if (!isMobileLayout.value || !currentTimelinePath.value || !timelineDoc.value) return;
      if (!isPathDirty(currentTimelinePath.value)) return;
      const serialized = serializeTimelineToOtio(timelineDoc.value);
      await backup.handleBackup(serialized, { force: true });
    },
  };
});
