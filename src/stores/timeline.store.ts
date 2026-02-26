import { defineStore, storeToRefs } from 'pinia';
import { ref } from 'vue';
import PQueue from 'p-queue';

import type { TimelineDocument } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';
import { applyTimelineCommand } from '~/timeline/commands';
import { parseTimelineFromOtio, serializeTimelineToOtio } from '~/timeline/otioSerializer';
import { selectTimelineDurationUs } from '~/timeline/selectors';
import { quantizeTimeUsToFrames, getDocFps } from '~/timeline/commands/utils';

import { useProjectStore } from './project.store';
import { useMediaStore } from './media.store';
import { useHistoryStore } from './history.store';

export const useTimelineStore = defineStore('timeline', () => {
  const projectStore = useProjectStore();
  const mediaStore = useMediaStore();
  const historyStore = useHistoryStore();

  const pendingDebouncedHistory = ref<{
    snapshot: TimelineDocument;
    cmd: TimelineCommand;
    timeoutId: number;
  } | null>(null);

  function clearPendingDebouncedHistory() {
    const pending = pendingDebouncedHistory.value;
    if (!pending) return;
    window.clearTimeout(pending.timeoutId);
    pendingDebouncedHistory.value = null;
  }

  const projectRefs = (() => {
    try {
      return storeToRefs(projectStore as any) as any;
    } catch {
      return projectStore as any;
    }
  })();

  const currentProjectName =
    projectRefs?.currentProjectName && typeof projectRefs.currentProjectName === 'object'
      ? projectRefs.currentProjectName
      : ref((projectStore as any)?.currentProjectName ?? null);

  const currentTimelinePath =
    projectRefs?.currentTimelinePath && typeof projectRefs.currentTimelinePath === 'object'
      ? projectRefs.currentTimelinePath
      : ref((projectStore as any)?.currentTimelinePath ?? null);

  const mediaRefs = (() => {
    try {
      return storeToRefs(mediaStore as any) as any;
    } catch {
      return mediaStore as any;
    }
  })();

  const mediaMetadata =
    mediaRefs?.mediaMetadata && typeof mediaRefs.mediaMetadata === 'object'
      ? mediaRefs.mediaMetadata
      : ref((mediaStore as any)?.mediaMetadata ?? {});

  const DEFAULT_IMAGE_DURATION_US = 5_000_000;
  const DEFAULT_IMAGE_SOURCE_DURATION_US = Number.MAX_SAFE_INTEGER;

  const timelineDoc = ref<TimelineDocument | null>(null);

  const isTimelineDirty = ref(false);
  const isSavingTimeline = ref(false);
  const timelineSaveError = ref<string | null>(null);

  const isPlaying = ref(false);
  const currentTime = ref(0);
  const duration = ref(0);
  const audioVolume = ref(1);
  const audioMuted = ref(false);
  const playbackGestureHandler = ref<((nextPlaying: boolean) => void) | null>(null);

  const timelineZoom = ref(100);

  const selectedItemIds = ref<string[]>([]);
  const selectedTrackId = ref<string | null>(null);
  const selectedTransition = ref<{
    trackId: string;
    itemId: string;
    edge: 'in' | 'out';
  } | null>(null);

  let persistTimelineTimeout: number | null = null;
  let loadTimelineRequestId = 0;
  let timelineRevision = 0;
  let savedTimelineRevision = 0;

  const timelineSaveQueue = new PQueue({ concurrency: 1 });

  function clearSelection() {
    selectedItemIds.value = [];
    selectedTransition.value = null;
  }

  function clearSelectedTransition() {
    selectedTransition.value = null;
  }

  function selectTransition(input: { trackId: string; itemId: string; edge: 'in' | 'out' } | null) {
    selectedTrackId.value = null;
    selectedItemIds.value = [];
    selectedTransition.value = input;
  }

  function setClipFreezeFrameFromPlayhead(input: { trackId: string; itemId: string }) {
    const doc = timelineDoc.value;
    if (!doc) throw new Error('Timeline not loaded');

    const track = doc.tracks.find((t) => t.id === input.trackId) ?? null;
    if (!track) throw new Error('Track not found');

    const item = track.items.find((it) => it.id === input.itemId);
    if (!item || item.kind !== 'clip') throw new Error('Clip not found');
    if (item.clipType !== 'media') throw new Error('Only media clips can freeze frame');

    const fps = getDocFps(doc);

    const clipStartUs = item.timelineRange.startUs;
    const clipEndUs = clipStartUs + item.timelineRange.durationUs;
    const playheadUs = currentTime.value;

    const usePlayhead = playheadUs >= clipStartUs && playheadUs < clipEndUs;
    const localUs = usePlayhead ? playheadUs - clipStartUs : 0;
    const sourceUsRaw = item.sourceRange.startUs + localUs;
    const sourceUs = quantizeTimeUsToFrames(sourceUsRaw, fps, 'round');

    updateClipProperties(input.trackId, input.itemId, { freezeFrameSourceUs: sourceUs });
  }

  function resetClipFreezeFrame(input: { trackId: string; itemId: string }) {
    updateClipProperties(input.trackId, input.itemId, { freezeFrameSourceUs: undefined });
  }

  function selectTrack(trackId: string | null) {
    selectedTrackId.value = trackId;
    if (trackId) {
      selectedTransition.value = null;
      selectedItemIds.value = [];
    }
  }

  async function splitClipsAtPlayhead() {
    const doc = timelineDoc.value;
    if (!doc) return;

    const atUs = currentTime.value;

    const selected = selectedItemIds.value;
    const shouldUseSelection = selected.length > 0;
    const targetIds = new Set<string>();

    for (const t of doc.tracks) {
      for (const it of t.items) {
        if (it.kind !== 'clip') continue;
        if (shouldUseSelection && !selected.includes(it.id)) continue;
        targetIds.add(it.id);
      }
    }

    if (targetIds.size === 0) return;

    for (const t of (timelineDoc.value?.tracks ?? []) as any[]) {
      for (const it of t.items ?? []) {
        if (!it || it.kind !== 'clip') continue;
        if (!targetIds.has(it.id)) continue;
        applyTimeline(
          {
            type: 'split_item',
            trackId: String(t.id),
            itemId: String(it.id),
            atUs,
          },
          { saveMode: 'none' },
        );
      }
    }

    await requestTimelineSave({ immediate: true });
  }

  function toggleSelection(itemId: string, options?: { multi?: boolean }) {
    selectedTransition.value = null;
    if (options?.multi) {
      if (selectedItemIds.value.includes(itemId)) {
        selectedItemIds.value = selectedItemIds.value.filter((id) => id !== itemId);
      } else {
        selectedItemIds.value.push(itemId);
      }
    } else {
      selectedItemIds.value = [itemId];
    }
  }

  function deleteSelectedItems(trackId: string) {
    if (selectedItemIds.value.length === 0) return;
    applyTimeline({
      type: 'delete_items',
      trackId,
      itemIds: [...selectedItemIds.value],
    });
    selectedItemIds.value = [];
  }

  function setTimelineZoom(next: number) {
    const parsed = Math.round(Number(next));
    if (!Number.isFinite(parsed)) return;
    timelineZoom.value = Math.min(200, Math.max(10, parsed));
  }

  function setAudioVolume(next: number) {
    const parsed = Number(next);
    if (!Number.isFinite(parsed)) return;
    audioVolume.value = Math.min(1, Math.max(0, parsed));
    if (audioVolume.value > 0 && audioMuted.value) {
      audioMuted.value = false;
    }
  }

  function setAudioMuted(next: boolean) {
    audioMuted.value = Boolean(next);
  }

  function toggleAudioMuted() {
    audioMuted.value = !audioMuted.value;
  }

  function setPlaybackGestureHandler(handler: ((nextPlaying: boolean) => void) | null) {
    playbackGestureHandler.value = handler;
  }

  function togglePlayback() {
    const nextPlaying = !isPlaying.value;
    playbackGestureHandler.value?.(nextPlaying);
    isPlaying.value = nextPlaying;
  }

  function stopPlayback() {
    playbackGestureHandler.value?.(false);
    isPlaying.value = false;
    currentTime.value = 0;
  }

  function addTrack(kind: 'video' | 'audio', name: string) {
    applyTimeline({ type: 'add_track', kind, name });
  }

  function resolveTargetVideoTrackIdForInsert(): string {
    const doc = timelineDoc.value;
    if (!doc) throw new Error('Timeline not loaded');

    const selected =
      typeof selectedTrackId.value === 'string'
        ? (doc.tracks.find((t) => t.id === selectedTrackId.value) ?? null)
        : null;

    if (selected?.kind === 'video') return selected.id;

    const topVideo = doc.tracks.find((t) => t.kind === 'video') ?? null;
    if (!topVideo) throw new Error('No video tracks');
    return topVideo.id;
  }

  function addVirtualClipAtPlayhead(input: {
    clipType: Extract<import('~/timeline/types').TimelineClipType, 'adjustment' | 'background'>;
    name: string;
    durationUs?: number;
    backgroundColor?: string;
  }) {
    if (!timelineDoc.value) {
      timelineDoc.value = projectStore.createFallbackTimelineDoc();
    }

    const trackId = resolveTargetVideoTrackIdForInsert();
    applyTimeline({
      type: 'add_virtual_clip_to_track',
      trackId,
      clipType: input.clipType,
      name: input.name,
      durationUs: input.durationUs,
      backgroundColor: input.backgroundColor,
      startUs: currentTime.value,
    });
  }

  function addAdjustmentClipAtPlayhead(options?: { durationUs?: number; name?: string }) {
    addVirtualClipAtPlayhead({
      clipType: 'adjustment',
      name: options?.name ?? 'Adjustment',
      durationUs: options?.durationUs,
    });
  }

  function addBackgroundClipAtPlayhead(options?: {
    durationUs?: number;
    name?: string;
    backgroundColor?: string;
  }) {
    addVirtualClipAtPlayhead({
      clipType: 'background',
      name: options?.name ?? 'Background',
      durationUs: options?.durationUs,
      backgroundColor: options?.backgroundColor,
    });
  }

  function renameTrack(trackId: string, name: string) {
    applyTimeline({ type: 'rename_track', trackId, name });
  }

  function updateTrackProperties(
    trackId: string,
    properties: Partial<
      Pick<
        import('~/timeline/types').TimelineTrack,
        'videoHidden' | 'audioMuted' | 'audioSolo' | 'effects'
      >
    >,
  ) {
    applyTimeline(
      {
        type: 'update_track_properties',
        trackId,
        properties,
      },
      { historyMode: 'debounced' },
    );
  }

  function toggleVideoHidden(trackId: string) {
    const track = timelineDoc.value?.tracks.find((t) => t.id === trackId);
    if (!track || track.kind !== 'video') return;
    updateTrackProperties(trackId, { videoHidden: !Boolean(track.videoHidden) });
  }

  function toggleTrackAudioMuted(trackId: string) {
    const track = timelineDoc.value?.tracks.find((t) => t.id === trackId);
    if (!track) return;
    updateTrackProperties(trackId, { audioMuted: !Boolean(track.audioMuted) });
  }

  function toggleTrackAudioSolo(trackId: string) {
    const track = timelineDoc.value?.tracks.find((t) => t.id === trackId);
    if (!track) return;
    updateTrackProperties(trackId, { audioSolo: !Boolean(track.audioSolo) });
  }

  function renameItem(trackId: string, itemId: string, name: string) {
    applyTimeline({
      type: 'rename_item',
      trackId,
      itemId,
      name,
    });
  }

  function updateClipProperties(
    trackId: string,
    itemId: string,
    properties: Partial<
      Pick<
        import('~/timeline/types').TimelineClipItem,
        'opacity' | 'effects' | 'freezeFrameSourceUs' | 'speed' | 'transform'
      >
    > & {
      backgroundColor?: string;
    },
  ) {
    applyTimeline(
      {
        type: 'update_clip_properties',
        trackId,
        itemId,
        properties,
      },
      { historyMode: 'debounced' },
    );
  }

  function updateClipTransition(
    trackId: string,
    itemId: string,
    options: {
      transitionIn?: import('~/timeline/types').ClipTransition | null;
      transitionOut?: import('~/timeline/types').ClipTransition | null;
    },
  ) {
    applyTimeline({
      type: 'update_clip_transition',
      trackId,
      itemId,
      ...options,
    });
  }

  function deleteTrack(trackId: string, options?: { allowNonEmpty?: boolean }) {
    applyTimeline({ type: 'delete_track', trackId, allowNonEmpty: options?.allowNonEmpty });
    if (selectedTrackId.value === trackId) {
      selectedTrackId.value = null;
    }
  }

  function reorderTracks(trackIds: string[]) {
    applyTimeline({ type: 'reorder_tracks', trackIds });
  }

  async function moveItemToTrack(input: {
    fromTrackId: string;
    toTrackId: string;
    itemId: string;
    startUs: number;
  }) {
    const doc = timelineDoc.value;
    const fromTrack = doc?.tracks.find((t) => t.id === input.fromTrackId) ?? null;
    const toTrack = doc?.tracks.find((t) => t.id === input.toTrackId) ?? null;
    if (!fromTrack || !toTrack) throw new Error('Track not found');

    const item = fromTrack.items.find((it) => it.id === input.itemId);
    if (!item || item.kind !== 'clip') throw new Error('Item not found');

    if (item.clipType !== 'media') {
      throw new Error('Only media clips can be moved across tracks');
    }

    const path = item.source?.path;
    if (!path) throw new Error('Invalid source');

    let metadata = mediaMetadata.value[path] ?? null;
    if (!metadata) {
      metadata = await mediaStore.getOrFetchMetadataByPath(path);
    }
    if (!metadata) throw new Error('Failed to resolve media metadata');

    const hasVideo = Boolean(metadata.video);
    const hasAudio = Boolean(metadata.audio);
    const isImageLike = !hasVideo && !hasAudio;

    if (toTrack.kind === 'video' && !hasVideo && !isImageLike) {
      throw new Error('Only video sources can be moved to video tracks');
    }
    if (toTrack.kind === 'audio' && isImageLike) {
      throw new Error('Images cannot be moved to audio tracks');
    }

    applyTimeline({
      type: 'move_item_to_track',
      fromTrackId: input.fromTrackId,
      toTrackId: input.toTrackId,
      itemId: input.itemId,
      startUs: input.startUs,
    });
  }

  async function extractAudioToTrack(input: { videoTrackId: string; videoItemId: string }) {
    const doc = timelineDoc.value;
    if (!doc) throw new Error('Timeline not loaded');
    const videoTrack = doc.tracks.find((t) => t.id === input.videoTrackId) ?? null;
    if (!videoTrack || videoTrack.kind !== 'video') throw new Error('Invalid video track');
    const videoItem = videoTrack.items.find((it) => it.id === input.videoItemId) ?? null;
    if (!videoItem || videoItem.kind !== 'clip') throw new Error('Clip not found');

    if (videoItem.clipType !== 'media') {
      throw new Error('Only media clips can extract audio');
    }

    const audioTracks = doc.tracks.filter((t) => t.kind === 'audio');
    if (audioTracks.length === 0) throw new Error('No audio tracks');

    const selected = doc.tracks.find((t) => t.id === selectedTrackId.value) ?? null;
    const targetAudioTrackId = selected?.kind === 'audio' ? selected.id : audioTracks[0]!.id;

    const path = videoItem.source?.path;
    if (!path) throw new Error('Invalid source');

    let metadata = mediaMetadata.value[path] ?? null;
    if (!metadata) {
      metadata = await mediaStore.getOrFetchMetadataByPath(path);
    }
    if (!metadata) throw new Error('Failed to resolve media metadata');
    if (!metadata.audio) throw new Error('Source has no audio');

    applyTimeline({
      type: 'extract_audio_to_track',
      videoTrackId: videoTrack.id,
      videoItemId: videoItem.id,
      audioTrackId: targetAudioTrackId,
    });
  }

  function returnAudioToVideo(input: { videoItemId: string }) {
    applyTimeline({ type: 'return_audio_to_video', videoItemId: input.videoItemId });
  }

  function clearPersistTimelineTimeout() {
    if (typeof window === 'undefined') return;
    if (persistTimelineTimeout === null) return;
    window.clearTimeout(persistTimelineTimeout);
    persistTimelineTimeout = null;
  }

  function resetTimelineState() {
    clearPersistTimelineTimeout();
    loadTimelineRequestId += 1;
    timelineDoc.value = null;
    isTimelineDirty.value = false;
    isSavingTimeline.value = false;
    timelineSaveError.value = null;
    isPlaying.value = false;
    currentTime.value = 0;
    duration.value = 0;
    audioVolume.value = 1;
    audioMuted.value = false;
    timelineZoom.value = 100;
    clearSelection();
    selectTrack(null);
    timelineRevision = 0;
    savedTimelineRevision = 0;
    historyStore.clear();
    clearPendingDebouncedHistory();
  }

  function markTimelineAsCleanForCurrentRevision() {
    savedTimelineRevision = timelineRevision;
    isTimelineDirty.value = false;
  }

  function markTimelineAsDirty() {
    timelineRevision += 1;
    isTimelineDirty.value = true;
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

  async function persistTimelineNow() {
    if (!timelineDoc.value || !isTimelineDirty.value) return;

    isSavingTimeline.value = true;
    timelineSaveError.value = null;

    const snapshot = timelineDoc.value;
    const revisionToSave = timelineRevision;

    try {
      const handle = await ensureTimelineFileHandle({ create: true });
      if (!handle) return;

      const writable = await (handle as any).createWritable();
      await writable.write(serializeTimelineToOtio(snapshot));
      await writable.close();

      if (savedTimelineRevision < revisionToSave) {
        savedTimelineRevision = revisionToSave;
      }
    } catch (e: any) {
      timelineSaveError.value = e?.message ?? 'Failed to save timeline file';
      console.warn('Failed to save timeline file', e);
    } finally {
      isSavingTimeline.value = false;
      isTimelineDirty.value = savedTimelineRevision < timelineRevision;
    }
  }

  async function enqueueTimelineSave() {
    await timelineSaveQueue.add(async () => {
      await persistTimelineNow();
    });
  }

  async function requestTimelineSave(options?: { immediate?: boolean }) {
    if (!timelineDoc.value) return;

    if (options?.immediate) {
      clearPersistTimelineTimeout();
      await enqueueTimelineSave();
      return;
    }

    if (typeof window === 'undefined') {
      await enqueueTimelineSave();
      return;
    }

    clearPersistTimelineTimeout();
    persistTimelineTimeout = window.setTimeout(() => {
      persistTimelineTimeout = null;
      void enqueueTimelineSave();
    }, 500);
  }

  async function loadTimeline() {
    if (!currentProjectName.value || !currentTimelinePath.value) return;

    const requestId = ++loadTimelineRequestId;
    clearPersistTimelineTimeout();
    clearSelection();
    selectTrack(null);
    isPlaying.value = false;
    currentTime.value = 0;
    historyStore.clear();
    clearPendingDebouncedHistory();

    const fallback = projectStore.createFallbackTimelineDoc();

    try {
      const handle = await ensureTimelineFileHandle({ create: false });
      if (!handle) {
        if (requestId !== loadTimelineRequestId) return;
        timelineDoc.value = fallback;
        return;
      }

      const file = await handle.getFile();
      const text = await file.text();
      const parsed = parseTimelineFromOtio(text, {
        id: fallback.id,
        name: fallback.name,
        fps: fallback.timebase.fps,
      });
      if (requestId !== loadTimelineRequestId) return;
      timelineDoc.value = parsed;
    } catch (e: any) {
      console.warn('Failed to load timeline file, fallback to default', e);
      if (requestId !== loadTimelineRequestId) return;
      timelineDoc.value = fallback;
    } finally {
      if (requestId !== loadTimelineRequestId) return;
      duration.value = timelineDoc.value ? selectTimelineDurationUs(timelineDoc.value) : 0;
      timelineRevision = 0;
      markTimelineAsCleanForCurrentRevision();
      timelineSaveError.value = null;
    }
  }

  async function saveTimeline() {
    await requestTimelineSave({ immediate: true });
  }

  function hydrateClipSourceDuration(
    doc: TimelineDocument,
    cmd: TimelineCommand,
  ): TimelineDocument {
    if (cmd.type !== 'trim_item') return doc;

    const track = doc.tracks.find((t) => t.id === cmd.trackId);
    if (!track) return doc;

    const item = track.items.find((it) => it.id === cmd.itemId);
    if (!item) return doc;
    if (item.kind !== 'clip') return doc;
    if (item.clipType !== 'media') return doc;
    if (!item.source?.path) return doc;

    const meta = mediaMetadata.value[item.source.path];
    const durationS = Number(meta?.duration);
    if (!Number.isFinite(durationS) || durationS <= 0) return doc;
    const durationUs = Math.floor(durationS * 1_000_000);
    if (!Number.isFinite(durationUs) || durationUs <= 0) return doc;
    if (item.sourceDurationUs === durationUs) return doc;

    const nextTracks = doc.tracks.map((t) =>
      t.id !== track.id
        ? t
        : {
            ...t,
            items: t.items.map((it) =>
              it.id === item.id && it.kind === 'clip' && it.clipType === 'media'
                ? { ...it, sourceDurationUs: durationUs }
                : it,
            ),
          },
    );

    return { ...doc, tracks: nextTracks };
  }

  function applyTimeline(
    cmd: TimelineCommand,
    options?: {
      saveMode?: 'debounced' | 'immediate' | 'none';
      skipHistory?: boolean;
      historyMode?: 'immediate' | 'debounced';
      historyDebounceMs?: number;
    },
  ) {
    if (!timelineDoc.value) {
      timelineDoc.value = projectStore.createFallbackTimelineDoc();
    }

    const prev = timelineDoc.value;
    const hydrated = hydrateClipSourceDuration(timelineDoc.value, cmd);
    const { next } = applyTimelineCommand(hydrated, cmd);
    if (next === prev) return;

    if (!options?.skipHistory) {
      const historyMode = options?.historyMode ?? 'immediate';
      if (historyMode === 'debounced') {
        const debounceMs = Math.max(0, Math.round(options?.historyDebounceMs ?? 300));
        const pending = pendingDebouncedHistory.value;

        if (pending) {
          window.clearTimeout(pending.timeoutId);
          pendingDebouncedHistory.value = {
            snapshot: pending.snapshot,
            cmd,
            timeoutId: window.setTimeout(() => {
              const p = pendingDebouncedHistory.value;
              if (!p) return;
              historyStore.push(p.cmd, p.snapshot);
              pendingDebouncedHistory.value = null;
            }, debounceMs),
          };
        } else {
          pendingDebouncedHistory.value = {
            snapshot: prev,
            cmd,
            timeoutId: window.setTimeout(() => {
              const p = pendingDebouncedHistory.value;
              if (!p) return;
              historyStore.push(p.cmd, p.snapshot);
              pendingDebouncedHistory.value = null;
            }, debounceMs),
          };
        }
      } else {
        const pending = pendingDebouncedHistory.value;
        if (pending) {
          window.clearTimeout(pending.timeoutId);
          pendingDebouncedHistory.value = null;
        }
        historyStore.push(cmd, prev);
      }
    }

    timelineDoc.value = next;
    duration.value = selectTimelineDurationUs(next);
    markTimelineAsDirty();

    const saveMode = options?.saveMode ?? 'debounced';
    if (saveMode === 'immediate') {
      void requestTimelineSave({ immediate: true });
    } else if (saveMode === 'debounced') {
      void requestTimelineSave();
    }
  }

  function undoTimeline() {
    if (!timelineDoc.value || !historyStore.canUndo) return;
    const restored = historyStore.undo(timelineDoc.value);
    if (!restored) return;
    timelineDoc.value = restored;
    duration.value = selectTimelineDurationUs(restored);
    markTimelineAsDirty();
    void requestTimelineSave();
  }

  function redoTimeline() {
    if (!timelineDoc.value || !historyStore.canRedo) return;
    const restored = historyStore.redo(timelineDoc.value);
    if (!restored) return;
    timelineDoc.value = restored;
    duration.value = selectTimelineDurationUs(restored);
    markTimelineAsDirty();
    void requestTimelineSave();
  }

  async function addClipToTimelineFromPath(input: {
    trackId: string;
    name: string;
    path: string;
    startUs?: number;
  }) {
    const handle = await projectStore.getFileHandleByPath(input.path);
    if (!handle) throw new Error('Failed to access file handle');

    const resolvedTrackKind = timelineDoc.value?.tracks.find((t) => t.id === input.trackId)?.kind;
    const trackKind =
      resolvedTrackKind === 'audio' || resolvedTrackKind === 'video' ? resolvedTrackKind : null;
    if (!trackKind) throw new Error('Track not found');

    const metadata = await mediaStore.getOrFetchMetadata(handle, input.path);
    if (!metadata) throw new Error('Failed to resolve media metadata');

    const hasVideo = Boolean(metadata.video);
    const hasAudio = Boolean(metadata.audio);
    const isImageLike = !hasVideo && !hasAudio;

    if (trackKind === 'video' && !hasVideo && !isImageLike) {
      throw new Error('Only video sources can be added to video tracks');
    }
    if (trackKind === 'audio' && isImageLike) {
      throw new Error('Images cannot be added to audio tracks');
    }

    let durationUs = 0;
    let sourceDurationUs = 0;
    if (isImageLike) {
      durationUs = DEFAULT_IMAGE_DURATION_US;
      sourceDurationUs = DEFAULT_IMAGE_SOURCE_DURATION_US;
    } else {
      const durationS = Number(metadata?.duration);
      durationUs = Math.floor(durationS * 1_000_000);
      sourceDurationUs = durationUs;
    }
    if (!Number.isFinite(durationUs) || durationUs <= 0) {
      throw new Error('Failed to resolve media duration');
    }

    if (!timelineDoc.value) {
      timelineDoc.value = projectStore.createFallbackTimelineDoc();
    }

    const targetTrack = timelineDoc.value.tracks.find((t) => t.id === input.trackId);
    if (!targetTrack) throw new Error('Track not found');

    applyTimeline({
      type: 'add_clip_to_track',
      trackId: targetTrack.id,
      name: input.name,
      path: input.path,
      clipType: 'media',
      durationUs,
      sourceDurationUs,
      startUs: input.startUs,
    });
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

    const handle = await projectStore.getFileHandleByPath(input.path);
    if (!handle) throw new Error('Failed to access file handle');

    const resolvedTrackKind = timelineDoc.value?.tracks.find((t) => t.id === input.trackId)?.kind;
    const trackKind =
      resolvedTrackKind === 'audio' || resolvedTrackKind === 'video' ? resolvedTrackKind : null;
    if (!trackKind) throw new Error('Track not found');

    let durationUs = 2_000_000;
    try {
      const file = await handle.getFile();
      const text = await file.text();
      const nested = parseTimelineFromOtio(text, { id: 'nested', name: input.name, fps: 25 });
      const nestedDurationUs = selectTimelineDurationUs(nested);
      if (Number.isFinite(nestedDurationUs) && nestedDurationUs > 0) {
        durationUs = Math.max(1, Math.round(nestedDurationUs));
      }
    } catch {
      // keep fallback duration
    }

    if (!timelineDoc.value) {
      timelineDoc.value = projectStore.createFallbackTimelineDoc();
    }

    const targetTrack = timelineDoc.value.tracks.find((t) => t.id === input.trackId);
    if (!targetTrack) throw new Error('Track not found');

    applyTimeline({
      type: 'add_clip_to_track',
      trackId: targetTrack.id,
      name: input.name,
      path: input.path,
      clipType: 'timeline',
      durationUs,
      sourceDurationUs: durationUs,
      startUs: input.startUs,
    });
  }

  async function loadTimelineMetadata() {
    if (!timelineDoc.value) return;

    const requestId = loadTimelineRequestId;
    const timelinePathSnapshot = currentTimelinePath.value;

    const items: { path: string }[] = [];
    for (const track of timelineDoc.value.tracks) {
      for (const item of track.items) {
        if (item.kind === 'clip' && item.clipType === 'media' && item.source?.path) {
          items.push({ path: item.source.path });
        }
      }
    }

    if (requestId !== loadTimelineRequestId) return;
    if (timelinePathSnapshot !== currentTimelinePath.value) return;

    await Promise.all(items.map((it) => mediaStore.getOrFetchMetadataByPath(it.path)));
  }

  return {
    timelineDoc,
    isTimelineDirty,
    isSavingTimeline,
    timelineSaveError,
    isPlaying,
    currentTime,
    duration,
    audioVolume,
    audioMuted,
    timelineZoom,
    selectedItemIds,
    selectedTrackId,
    selectedTransition,
    loadTimeline,
    saveTimeline,
    requestTimelineSave,
    applyTimeline,
    addClipToTimelineFromPath,
    addTimelineClipToTimelineFromPath,
    loadTimelineMetadata,
    clearSelection,
    clearSelectedTransition,
    toggleSelection,
    selectTrack,
    selectTransition,
    deleteSelectedItems,
    setTimelineZoom,
    setAudioVolume,
    setAudioMuted,
    toggleAudioMuted,
    setPlaybackGestureHandler,
    togglePlayback,
    stopPlayback,
    addTrack,
    addAdjustmentClipAtPlayhead,
    addBackgroundClipAtPlayhead,
    renameTrack,
    updateTrackProperties,
    toggleVideoHidden,
    toggleTrackAudioMuted,
    toggleTrackAudioSolo,
    renameItem,
    updateClipProperties,
    updateClipTransition,
    setClipFreezeFrameFromPlayhead,
    resetClipFreezeFrame,
    splitClipsAtPlayhead,
    deleteTrack,
    reorderTracks,
    moveItemToTrack,
    extractAudioToTrack,
    returnAudioToVideo,
    resetTimelineState,
    undoTimeline,
    redoTimeline,
    historyStore,
  };
});
