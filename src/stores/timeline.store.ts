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

import { quantizeTimeUsToFrames, sanitizeFps } from '~/timeline/commands/utils';
import {
  createDefaultCaptionStylePreset,
  buildCaptionChunksFromWords,
  extractTranscriptionWords,
  type CaptionGenerationSettings,
  type TimelineCaptionWord,
} from '~/utils/transcription/captions';
import {
  createTranscriptionCacheRepository,
  type TranscriptionCacheRecord,
} from '~/repositories/transcription-cache.repository';
import { getMediaTypeFromFilename } from '~/utils/media-types';

import { useProjectStore } from './project.store';
import { useMediaStore } from './media.store';
import { useHistoryStore } from './history.store';
import { useWorkspaceStore } from './workspace.store';
import { useProxyStore } from './proxy.store';
import { useSelectionStore } from './selection.store';
import { useUiStore } from './ui.store';
import type { ProxyThumbnailService } from '~/media-cache/application/proxyThumbnailService';
import { MAX_TIMELINE_ZOOM_POSITION, MIN_TIMELINE_ZOOM_POSITION } from '~/utils/zoom';
import { useTimelineSettingsStore } from './timelineSettings.store';

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
    audioVolume: masterGain,
    audioMuted,
    duration,
    playbackGestureHandler,
  });

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
  });

  const markerService = createTimelineMarkerService({
    getDoc: () => timelineDoc.value,
    getCurrentTime: () => currentTime.value,
    applyTimeline,
  });

  function getSelectionRange(): TimelineSelectionRange | null {
    const range = timelineDoc.value?.metadata?.fastcat?.selectionRange;
    if (!range) return null;
    if (!Number.isFinite(range.startUs) || !Number.isFinite(range.endUs)) return null;

    const startUs = Math.max(0, Math.round(range.startUs));
    const endUs = Math.max(startUs, Math.round(range.endUs));

    if (endUs <= startUs) return null;

    return {
      startUs,
      endUs,
    };
  }

  function updateSelectionRange(range: TimelineSelectionRange | null) {
    const currentFastCat = timelineDoc.value?.metadata?.fastcat ?? {};
    applyTimeline({
      type: 'update_timeline_properties',
      properties: {
        ...currentFastCat,
        selectionRange: range
          ? {
              startUs: Math.max(0, Math.round(range.startUs)),
              endUs: Math.max(Math.round(range.startUs), Math.round(range.endUs)),
            }
          : undefined,
      },
    });
  }

  function createSelectionRangeAtPlayhead(durationUs = 5_000_000) {
    const startUs = Math.max(0, Math.round(currentTime.value));
    updateSelectionRange({
      startUs,
      endUs: startUs + Math.max(1, Math.round(durationUs)),
    });
    selectionStore.selectTimelineSelectionRange();
  }

  function createSelectionRange(input: TimelineSelectionRange) {
    updateSelectionRange({
      startUs: Math.max(0, Math.round(input.startUs)),
      endUs: Math.max(Math.round(input.startUs) + 1, Math.round(input.endUs)),
    });
    selectionStore.selectTimelineSelectionRange();
  }

  function removeSelectionRange() {
    updateSelectionRange(null);
    if (
      selectionStore.selectedEntity?.source === 'timeline' &&
      selectionStore.selectedEntity.kind === 'selection-range'
    ) {
      selectionStore.clearSelection();
    }
  }

  function convertMarkerToSelectionRange(markerId: string) {
    const marker = markerService.getMarkers().find((item) => item.id === markerId);
    if (!marker) return;

    const startUs = Math.max(0, Math.round(marker.timeUs));
    const durationUs = Math.max(1, Math.round(marker.durationUs ?? 5_000_000));

    createSelectionRange({
      startUs,
      endUs: startUs + durationUs,
    });
    markerService.removeMarker(markerId);
  }

  function createSelectionRangeFromMarker(markerId: string) {
    const marker = markerService.getMarkers().find((item) => item.id === markerId);
    if (!marker) return;

    const startUs = Math.max(0, Math.round(marker.timeUs));
    const durationUs = Math.max(1, Math.round(marker.durationUs ?? 5_000_000));

    createSelectionRange({
      startUs,
      endUs: startUs + durationUs,
    });
  }

  function isSelectionRangeSelected() {
    return (
      selectionStore.selectedEntity?.source === 'timeline' &&
      selectionStore.selectedEntity.kind === 'selection-range'
    );
  }

  function convertSelectionRangeToMarker() {
    const range = getSelectionRange();
    if (!range) return;

    applyTimeline({
      type: 'add_marker',
      id: `marker_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
      timeUs: range.startUs,
      durationUs: range.endUs - range.startUs,
      text: '',
    });
    removeSelectionRange();
  }

  function rippleTrimSelectionRange() {
    const range = getSelectionRange();
    const doc = timelineDoc.value;
    if (!range || !doc) return;

    trimming.rippleDeleteRange({
      trackIds: doc.tracks.map((track) => track.id),
      startUs: range.startUs,
      endUs: range.endUs,
    });

    const deltaUs = range.endUs - range.startUs;
    if (deltaUs > 0) {
      const markers = markerService.getMarkers();
      for (const marker of markers) {
        const markerStartUs = marker.timeUs;
        const markerEndUs = marker.timeUs + Math.max(0, marker.durationUs ?? 0);

        if (markerEndUs <= range.startUs) continue;

        if (markerStartUs >= range.endUs) {
          markerService.updateMarker(marker.id, {
            timeUs: Math.max(0, markerStartUs - deltaUs),
          });
          continue;
        }

        markerService.removeMarker(marker.id);
      }
    }

    removeSelectionRange();
  }

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
    getCurrentTimelinePath: () => currentTimelinePath.value,
    getTrackById: (trackId) => timelineDoc.value?.tracks.find((t) => t.id === trackId) ?? null,
    applyTimeline,
    getFileHandleByPath: (path) => projectStore.getFileHandleByPath(path),
    getFileByPath: (path) => projectStore.getFileByPath(path),
    getOrFetchMetadataByPath: (path) => mediaStore.getOrFetchMetadataByPath(path),
    getMediaMetadataByPath: (path) => mediaMetadata.value[path] ?? null,
    fetchMediaMetadataByPath: (path) => mediaStore.getOrFetchMetadataByPath(path),
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
    showFpsWarning: (fileFps, projectFps) => {
      toast.add({
        title: t('videoEditor.timeline.fpsMismatch', 'FPS mismatch'),
        description: t('videoEditor.timeline.fpsMismatchDesc', { fileFps, projectFps }),
        color: 'warning',
        actions: [
          {
            label: t('videoEditor.projectSettings.title'),
            onClick: () => {
              uiStore.isProjectSettingsOpen = true;
            },
          },
        ],
      });
    },
    mediaCache: {
      hasProxy: (path: string) => proxyStore.existingProxies.has(path),
      ensureProxy: async (params: {
        file: File | FileSystemFileHandle;
        projectRelativePath: string;
      }) => await proxyStore.generateProxy(params.file, params.projectRelativePath),
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
    masterGain.value = 1;
    audioMuted.value = false;
    audioLevels.value = {};
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
    masterGain,
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

  async function addClipToTimelineFromPath(
    input: {
      trackId: string;
      name: string;
      path: string;
      startUs?: number;
      pseudo?: boolean;
    },
    options?: {
      historyMode?: 'immediate' | 'debounced';
      historyDebounceMs?: number;
      label?: string;
      skipHistory?: boolean;
      saveMode?: 'none' | 'debounced' | 'immediate';
    },
  ) {
    return await commandService.addClipToTimelineFromPath(input, options);
  }

  async function addTimelineClipToTimelineFromPath(
    input: {
      trackId: string;
      name: string;
      path: string;
      startUs?: number;
      pseudo?: boolean;
    },
    options?: {
      historyMode?: 'immediate' | 'debounced';
      historyDebounceMs?: number;
      label?: string;
      skipHistory?: boolean;
      saveMode?: 'none' | 'debounced' | 'immediate';
    },
  ) {
    if (currentTimelinePath.value && input.path === currentTimelinePath.value) {
      throw new Error('Cannot insert the currently opened timeline into itself');
    }
    return await commandService.addTimelineClipFromPath(input, options);
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

  async function listCachedTranscriptions(): Promise<TranscriptionCacheRecord[]> {
    const workspaceHandle = workspaceStore.workspaceHandle;
    const projectId = projectStore.currentProjectId;
    if (!workspaceHandle || !projectId) return [];

    const repository = createTranscriptionCacheRepository({
      workspaceDir: workspaceHandle,
      topology: workspaceStore.resolvedStorageTopology,
      projectId,
    });

    return await repository.list();
  }

  function isTrackActiveForCaptions(track: TimelineDocument['tracks'][number]): boolean {
    if (track.kind === 'video' && track.videoHidden) return false;
    if (track.audioMuted) return false;
    return true;
  }

  function isClipActiveForCaptions(
    item: TimelineDocument['tracks'][number]['items'][number],
  ): boolean {
    if (item.kind !== 'clip') return false;
    if (item.clipType !== 'media') return false;
    if (item.disabled || item.audioMuted) return false;
    if (!item.source?.path) return false;
    return true;
  }

  function asActiveCaptionMediaClip(item: TimelineTrackItem): TimelineMediaClipItem | null {
    if (!isClipActiveForCaptions(item)) return null;
    return item as TimelineMediaClipItem;
  }

  function findMatchingTranscriptionRecord(params: {
    records: TranscriptionCacheRecord[];
    sourcePath: string;
  }): TranscriptionCacheRecord | null {
    return params.records.find((record) => record.sourcePath === params.sourcePath) ?? null;
  }

  function projectClipWordsToTimeline(params: {
    trackId: string;
    trackOrder: number;
    clipId: string;
    sourceName: string;
    sourcePath: string;
    sourceStartUs: number;
    sourceEndUs: number;
    timelineStartUs: number;
    speed: number;
    words: ReturnType<typeof extractTranscriptionWords>;
  }): TimelineCaptionWord[] {
    const result: TimelineCaptionWord[] = [];

    for (const word of params.words) {
      const wordStartUs = Math.round(word.start * 1000);
      const wordEndUs = Math.round(word.end * 1000);
      if (wordEndUs <= params.sourceStartUs || wordStartUs >= params.sourceEndUs) continue;

      const clippedStartUs = Math.max(wordStartUs, params.sourceStartUs);
      const clippedEndUs = Math.min(wordEndUs, params.sourceEndUs);
      if (clippedEndUs <= clippedStartUs) continue;

      const relativeStartUs = clippedStartUs - params.sourceStartUs;
      const relativeEndUs = clippedEndUs - params.sourceStartUs;
      const timelineStartUs = params.timelineStartUs + Math.round(relativeStartUs / params.speed);
      const timelineEndUs = params.timelineStartUs + Math.round(relativeEndUs / params.speed);
      if (timelineEndUs <= timelineStartUs) continue;

      result.push({
        start: word.start,
        end: word.end,
        text: word.text,
        confidence: word.confidence,
        timelineStartMs: Math.round(timelineStartUs / 1000),
        timelineEndMs: Math.round(timelineEndUs / 1000),
        sourcePath: params.sourcePath,
        sourceName: params.sourceName,
        trackId: params.trackId,
        clipId: params.clipId,
        trackOrder: params.trackOrder,
      });
    }

    return result;
  }

  function trimWordsByCoveredRanges(params: {
    words: TimelineCaptionWord[];
    coveredRanges: Array<{ startMs: number; endMs: number }>;
  }): TimelineCaptionWord[] {
    if (params.coveredRanges.length === 0) return params.words;

    const result: TimelineCaptionWord[] = [];
    for (const word of params.words) {
      let segments = [{ startMs: word.timelineStartMs, endMs: word.timelineEndMs }];

      for (const covered of params.coveredRanges) {
        const nextSegments: Array<{ startMs: number; endMs: number }> = [];
        for (const segment of segments) {
          if (covered.endMs <= segment.startMs || covered.startMs >= segment.endMs) {
            nextSegments.push(segment);
            continue;
          }

          if (covered.startMs > segment.startMs) {
            nextSegments.push({ startMs: segment.startMs, endMs: covered.startMs });
          }
          if (covered.endMs < segment.endMs) {
            nextSegments.push({ startMs: covered.endMs, endMs: segment.endMs });
          }
        }
        segments = nextSegments.filter((segment) => segment.endMs > segment.startMs);
        if (segments.length === 0) break;
      }

      for (const segment of segments) {
        result.push({
          ...word,
          timelineStartMs: segment.startMs,
          timelineEndMs: segment.endMs,
        });
      }
    }

    return result;
  }

  async function collectTimelineCaptionWords(): Promise<TimelineCaptionWord[]> {
    const doc = timelineDoc.value;
    if (!doc) {
      throw new Error('Timeline not loaded');
    }

    const workspaceHandle = workspaceStore.workspaceHandle;
    const projectId = projectStore.currentProjectId;
    if (!workspaceHandle || !projectId) {
      throw new Error('Project workspace is not available');
    }

    const repository = createTranscriptionCacheRepository({
      workspaceDir: workspaceHandle,
      topology: workspaceStore.resolvedStorageTopology,
      projectId,
    });
    const records = await repository.list();

    const allWords: TimelineCaptionWord[] = [];

    for (const [trackOrder, track] of doc.tracks.entries()) {
      if (!isTrackActiveForCaptions(track)) continue;

      for (const item of track.items) {
        const clip = asActiveCaptionMediaClip(item);
        if (!clip) continue;

        const sourcePath = clip.source.path;
        const mediaType = getMediaTypeFromFilename(sourcePath);
        if (mediaType !== 'video' && mediaType !== 'audio') continue;

        const record = findMatchingTranscriptionRecord({ records, sourcePath });
        if (!record) continue;

        const words = extractTranscriptionWords(record);
        if (words.length === 0) continue;

        const speedRaw = clip.speed;
        const speed =
          typeof speedRaw === 'number' && Number.isFinite(speedRaw) && speedRaw !== 0
            ? Math.abs(speedRaw)
            : 1;

        allWords.push(
          ...projectClipWordsToTimeline({
            trackId: track.id,
            trackOrder,
            clipId: clip.id,
            sourceName: record.sourceName,
            sourcePath,
            sourceStartUs: Math.max(0, Math.round(clip.sourceRange.startUs)),
            sourceEndUs: Math.max(
              0,
              Math.round(clip.sourceRange.startUs + clip.sourceRange.durationUs),
            ),
            timelineStartUs: Math.max(0, Math.round(clip.timelineRange.startUs)),
            speed,
            words,
          }),
        );
      }
    }

    if (allWords.length === 0) {
      throw new Error('No active transcription cache was found for timeline media clips');
    }

    const visibleWords: TimelineCaptionWord[] = [];
    const coveredRanges: Array<{ startMs: number; endMs: number }> = [];

    for (const track of doc.tracks) {
      if (!isTrackActiveForCaptions(track)) continue;

      const trackWords = allWords.filter((word) => word.trackId === track.id);
      const trimmed = trimWordsByCoveredRanges({ words: trackWords, coveredRanges });
      visibleWords.push(...trimmed);

      if (track.kind === 'video') {
        for (const item of track.items) {
          const clip = asActiveCaptionMediaClip(item);
          if (!clip) continue;
          coveredRanges.push({
            startMs: Math.round(clip.timelineRange.startUs / 1000),
            endMs: Math.round((clip.timelineRange.startUs + clip.timelineRange.durationUs) / 1000),
          });
        }
      }
    }

    return visibleWords.sort((a, b) => a.timelineStartMs - b.timelineStartMs);
  }

  async function generateCaptionsFromTimeline(input: {
    trackId: string;
    settings: CaptionGenerationSettings;
  }) {
    const doc = timelineDoc.value;
    if (!doc) {
      throw new Error('Timeline not loaded');
    }

    const track = doc.tracks.find((item) => item.id === input.trackId) ?? null;
    if (!track || track.kind !== 'video') {
      throw new Error('Captions can only be generated on a video track');
    }
    if (track.items.some((item) => item.kind === 'clip')) {
      throw new Error('Select an empty video track for generated captions');
    }

    const words = await collectTimelineCaptionWords();
    const chunks = buildCaptionChunksFromWords({
      words,
      settings: input.settings,
    });
    const stylePreset = createDefaultCaptionStylePreset();

    const fps = sanitizeFps(doc.timebase?.fps ?? 30);
    let addedCount = 0;
    let lastEndUs = 0;

    for (const chunk of chunks) {
      const rawStartUs = Math.max(lastEndUs, Math.round(chunk.startMs * 1000));
      const rawDurationUs = Math.max(1_000, Math.round((chunk.endMs - chunk.startMs) * 1000));

      const startUs = quantizeTimeUsToFrames(rawStartUs, fps, 'round');
      const durationUs = quantizeTimeUsToFrames(rawDurationUs, fps, 'round');

      if (durationUs <= 0) continue;

      clips.addVirtualClipToTrack(
        {
          trackId: input.trackId,
          startUs,
          clipType: 'text',
          name: 'Generated captions',
          durationUs,
          text: chunk.text,
          style: stylePreset.textStyle,
        },
        {
          skipHistory: addedCount > 0,
          saveMode: 'none',
          historyMode: 'immediate',
        },
      );
      lastEndUs = startUs + durationUs;
      addedCount += 1;
    }

    if (addedCount === 0) {
      throw new Error('No caption clips were generated from transcription cache');
    }

    await requestTimelineSave({ immediate: true });

    return {
      addedCount,
      sourceCount: new Set(words.map((word) => word.sourcePath)).size,
    };
  }

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
    getSelectionRange,
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
    addClipToTimelineFromPath,
    addTimelineClipToTimelineFromPath,
    loadTimelineMetadata,
    listCachedTranscriptions,
    generateCaptionsFromTimeline,
    clearSelection: () => selection.clearSelection(),
    selectTrack: (trackId: string | null) => selection.selectTrack(trackId),
    toggleSelection: (itemId: string, options?: { multi?: boolean }) =>
      selection.toggleSelection(itemId, options),
    selectTimelineItems: (itemIds: string[]) => selection.selectTimelineItems(itemIds),
    selectTransition: (input: { trackId: string; itemId: string; edge: 'in' | 'out' } | null) =>
      selection.selectTransition(input),
    ...playback,
    setTimelineZoomExact,
    setAudioVolume: (gain: number) => applyTimeline({ type: 'update_master_gain', gain }),
    setMasterMuted,
    ...tracks,
    ...trimming,
    ...clips,
    addMarkerAtPlayhead: markerService.addMarkerAtPlayhead,
    addZoneMarkerAtPlayhead: markerService.addZoneMarkerAtPlayhead,
    createSelectionRangeAtPlayhead,
    createSelectionRange,
    updateMarker: markerService.updateMarker,
    removeMarker: markerService.removeMarker,
    updateSelectionRange,
    removeSelectionRange,
    convertMarkerToZone: markerService.convertMarkerToZone,
    convertZoneToMarker: markerService.convertZoneToMarker,
    convertMarkerToSelectionRange,
    createSelectionRangeFromMarker,
    convertSelectionRangeToMarker,
    isSelectionRangeSelected,
    rippleTrimSelectionRange,
    moveItemToTrack,
    extractAudioToTrack,
    returnAudioToVideo,
    resetTimelineState,
    undoTimeline,
    redoTimeline,
    selectTimelineProperties: () => selectionStore.selectTimelineProperties(),
    batchApplyTimeline,
    historyStore,
  };
});
