import { defineStore, storeToRefs } from 'pinia';
import { ref } from 'vue';
import PQueue from 'p-queue';

import type { TimelineDocument } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';
import { applyTimelineCommand } from '~/timeline/commands';
import { parseTimelineFromOtio, serializeTimelineToOtio } from '~/timeline/otioSerializer';
import { selectTimelineDurationUs } from '~/timeline/selectors';

import { useProjectStore } from './project.store';
import { useMediaStore } from './media.store';

export const useTimelineStore = defineStore('timeline', () => {
  const projectStore = useProjectStore();
  const mediaStore = useMediaStore();
  const { currentProjectName, currentTimelinePath } = storeToRefs(projectStore);
  const { mediaMetadata } = storeToRefs(mediaStore);

  const timelineDoc = ref<TimelineDocument | null>(null);

  const isTimelineDirty = ref(false);
  const isSavingTimeline = ref(false);
  const timelineSaveError = ref<string | null>(null);

  const isPlaying = ref(false);
  const currentTime = ref(0);
  const duration = ref(0);

  const timelineZoom = ref(100);

  const selectedItemIds = ref<string[]>([]);
  const selectedTrackId = ref<string | null>(null);

  let persistTimelineTimeout: number | null = null;
  let timelineRevision = 0;
  let savedTimelineRevision = 0;

  const timelineSaveQueue = new PQueue({ concurrency: 1 });

  function clearSelection() {
    selectedItemIds.value = [];
  }

  function selectTrack(trackId: string | null) {
    selectedTrackId.value = trackId;
  }

  function toggleSelection(itemId: string, options?: { multi?: boolean }) {
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

  function addTrack(kind: 'video' | 'audio', name: string) {
    applyTimeline({ type: 'add_track', kind, name });
  }

  function renameTrack(trackId: string, name: string) {
    applyTimeline({ type: 'rename_track', trackId, name });
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

    if (toTrack.kind === 'video' && !hasVideo) {
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

    const fallback = projectStore.createFallbackTimelineDoc();

    try {
      const handle = await ensureTimelineFileHandle({ create: false });
      if (!handle) {
        timelineDoc.value = fallback;
        return;
      }

      const file = await handle.getFile();
      const text = await file.text();
      timelineDoc.value = parseTimelineFromOtio(text, {
        id: fallback.id,
        name: fallback.name,
        fps: fallback.timebase.fps,
      });
    } catch (e: any) {
      console.warn('Failed to load timeline file, fallback to default', e);
      timelineDoc.value = fallback;
    } finally {
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
              it.id === item.id ? { ...it, sourceDurationUs: durationUs } : it,
            ),
          },
    );

    return { ...doc, tracks: nextTracks };
  }

  function applyTimeline(
    cmd: TimelineCommand,
    options?: { saveMode?: 'debounced' | 'immediate' | 'none' },
  ) {
    if (!timelineDoc.value) {
      timelineDoc.value = projectStore.createFallbackTimelineDoc();
    }

    const prev = timelineDoc.value;
    const hydrated = hydrateClipSourceDuration(timelineDoc.value, cmd);
    const { next } = applyTimelineCommand(hydrated, cmd);
    if (next === prev) return;

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

  async function addClipToTimelineFromPath(input: { trackId: string; name: string; path: string }) {
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

    if (trackKind === 'video' && !hasVideo) {
      throw new Error('Only video sources can be added to video tracks');
    }
    if (trackKind === 'audio' && isImageLike) {
      throw new Error('Images cannot be added to audio tracks');
    }

    const durationS = Number(metadata?.duration);
    const durationUs = Math.floor(durationS * 1_000_000);
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
      durationUs,
      sourceDurationUs: durationUs,
    });
  }

  async function loadTimelineMetadata() {
    if (!timelineDoc.value) return;

    const items: { path: string }[] = [];
    for (const track of timelineDoc.value.tracks) {
      for (const item of track.items) {
        if (item.kind === 'clip' && item.source.path) {
          items.push({ path: item.source.path });
        }
      }
    }

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
    timelineZoom,
    selectedItemIds,
    selectedTrackId,
    loadTimeline,
    saveTimeline,
    requestTimelineSave,
    applyTimeline,
    addClipToTimelineFromPath,
    loadTimelineMetadata,
    clearSelection,
    toggleSelection,
    selectTrack,
    deleteSelectedItems,
    setTimelineZoom,
    addTrack,
    renameTrack,
    deleteTrack,
    reorderTracks,
    moveItemToTrack,
    extractAudioToTrack,
    returnAudioToVideo,
  };
});
