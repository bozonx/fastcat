import { defineStore, storeToRefs } from 'pinia';
import { ref } from 'vue';
import PQueue from 'p-queue';

import type { TimelineDocument, TimelineMarker } from '~/timeline/types';
import type { TimelineCommand } from '~/timeline/commands';
import { applyTimelineCommand } from '~/timeline/commands';
import { parseTimelineFromOtio, serializeTimelineToOtio } from '~/timeline/otioSerializer';
import { selectTimelineDurationUs } from '~/timeline/selectors';
import { quantizeTimeUsToFrames, getDocFps, usToFrame, frameToUs } from '~/timeline/commands/utils';
import { SOURCES_DIR_NAME } from '~/utils/constants';

import { useProjectStore } from './project.store';
import { useMediaStore } from './media.store';
import { useHistoryStore } from './history.store';
import { useWorkspaceStore } from './workspace.store';
import { useProxyStore } from './proxy.store';

export const useTimelineStore = defineStore('timeline', () => {
  const projectStore = useProjectStore();
  const mediaStore = useMediaStore();
  const historyStore = useHistoryStore();
  const workspaceStore = useWorkspaceStore();
  const proxyStore = useProxyStore();

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

  function getMarkers(): TimelineMarker[] {
    const raw = (timelineDoc.value as any)?.metadata?.gran?.markers;
    return Array.isArray(raw) ? (raw as TimelineMarker[]) : [];
  }

  function generateMarkerId(): string {
    return `marker_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function addMarkerAtPlayhead() {
    applyTimeline({
      type: 'add_marker',
      id: generateMarkerId(),
      timeUs: currentTime.value,
      text: '',
    });
  }

  function updateMarker(markerId: string, patch: { timeUs?: number; text?: string }) {
    applyTimeline({
      type: 'update_marker',
      id: markerId,
      timeUs: patch.timeUs,
      text: patch.text,
    });
  }

  function removeMarker(markerId: string) {
    applyTimeline({ type: 'remove_marker', id: markerId });
  }

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

  function setPlaybackSpeed(speed: number) {
    const parsed = Number(speed);
    if (!Number.isFinite(parsed)) return;

    const abs = Math.abs(parsed);
    const clampedAbs = Math.max(0.1, Math.min(10, abs));

    const sign = parsed < 0 ? -1 : 1;
    playbackSpeed.value = clampedAbs * sign;
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

  function getHotkeyTargetClip(): { trackId: string; itemId: string } | null {
    const doc = timelineDoc.value;
    if (!doc) return null;

    const selectedId = selectedItemIds.value[0];
    if (selectedId) {
      for (const track of doc.tracks) {
        for (const it of track.items) {
          if (it.kind !== 'clip') continue;
          if (it.id !== selectedId) continue;
          return { trackId: track.id, itemId: it.id };
        }
      }
    }

    const trackId = selectedTrackId.value;
    if (!trackId) return null;
    const track = doc.tracks.find((t) => t.id === trackId) ?? null;
    if (!track) return null;

    const atUs = currentTime.value;
    for (const it of track.items) {
      if (it.kind !== 'clip') continue;
      const startUs = it.timelineRange.startUs;
      const endUs = startUs + it.timelineRange.durationUs;
      if (atUs >= startUs && atUs < endUs) {
        return { trackId: track.id, itemId: it.id };
      }
    }

    return null;
  }

  function getSelectedOrActiveTrackId(): string | null {
    const doc = timelineDoc.value;
    if (!doc) return null;

    const selectedId = selectedItemIds.value[0];
    if (selectedId) {
      for (const track of doc.tracks) {
        for (const it of track.items) {
          if (it.kind !== 'clip') continue;
          if (it.id === selectedId) return track.id;
        }
      }
    }

    return selectedTrackId.value;
  }

  function computeCutUs(doc: TimelineDocument, atUs: number): number {
    const fps = getDocFps(doc);
    const q = quantizeTimeUsToFrames(Number(atUs), fps, 'round');
    const frame = usToFrame(q, fps, 'round');
    return frameToUs(frame, fps);
  }

  async function trimToPlayheadLeftNoRipple() {
    const doc = timelineDoc.value;
    if (!doc) return;

    const target = getHotkeyTargetClip();
    if (!target) return;

    const track = doc.tracks.find((t) => t.id === target.trackId) ?? null;
    const item = track?.items.find((it) => it.kind === 'clip' && it.id === target.itemId) ?? null;
    if (!track || !item || item.kind !== 'clip') return;

    const cutUs = computeCutUs(doc, currentTime.value);
    const startUs = item.timelineRange.startUs;
    const endUs = startUs + item.timelineRange.durationUs;
    if (!(cutUs > startUs && cutUs < endUs)) return;

    applyTimeline(
      { type: 'split_item', trackId: target.trackId, itemId: target.itemId, atUs: cutUs },
      { saveMode: 'none' },
    );

    const updatedDoc = timelineDoc.value;
    if (!updatedDoc) return;
    const updatedTrack = updatedDoc.tracks.find((t) => t.id === target.trackId) ?? null;
    if (!updatedTrack) return;

    const right =
      updatedTrack.items
        .filter((it) => it.kind === 'clip')
        .find((it) => it.timelineRange.startUs === cutUs) ?? null;
    if (!right || right.kind !== 'clip') return;

    applyTimeline(
      { type: 'delete_items', trackId: target.trackId, itemIds: [right.id] },
      { saveMode: 'none' },
    );

    await requestTimelineSave({ immediate: true });
  }

  async function trimToPlayheadRightNoRipple() {
    const doc = timelineDoc.value;
    if (!doc) return;

    const target = getHotkeyTargetClip();
    if (!target) return;

    const track = doc.tracks.find((t) => t.id === target.trackId) ?? null;
    const item = track?.items.find((it) => it.kind === 'clip' && it.id === target.itemId) ?? null;
    if (!track || !item || item.kind !== 'clip') return;

    const cutUs = computeCutUs(doc, currentTime.value);
    const startUs = item.timelineRange.startUs;
    const endUs = startUs + item.timelineRange.durationUs;
    if (!(cutUs > startUs && cutUs < endUs)) return;

    applyTimeline(
      { type: 'split_item', trackId: target.trackId, itemId: target.itemId, atUs: cutUs },
      { saveMode: 'none' },
    );

    const updatedDoc = timelineDoc.value;
    if (!updatedDoc) return;
    const updatedTrack = updatedDoc.tracks.find((t) => t.id === target.trackId) ?? null;
    if (!updatedTrack) return;

    const left =
      updatedTrack.items.filter((it) => it.kind === 'clip').find((it) => it.id === target.itemId) ??
      null;
    if (!left || left.kind !== 'clip') return;

    applyTimeline(
      { type: 'delete_items', trackId: target.trackId, itemIds: [left.id] },
      { saveMode: 'none' },
    );

    await requestTimelineSave({ immediate: true });
  }

  function rippleDeleteRange(input: { trackIds: string[]; startUs: number; endUs: number }) {
    const doc = timelineDoc.value;
    if (!doc) return;

    const startUs = computeCutUs(doc, input.startUs);
    const endUs = computeCutUs(doc, input.endUs);
    if (!(endUs > startUs)) return;

    const deltaUs = endUs - startUs;
    const trackIdSet = new Set(input.trackIds);

    const splitTargets: Array<{ trackId: string; itemId: string }> = [];
    for (const track of doc.tracks) {
      if (!trackIdSet.has(track.id)) continue;
      for (const it of track.items) {
        if (it.kind !== 'clip') continue;
        splitTargets.push({ trackId: track.id, itemId: it.id });
      }
    }

    const splitAt = (atUs: number) => {
      for (const t of splitTargets) {
        applyTimeline(
          { type: 'split_item', trackId: t.trackId, itemId: t.itemId, atUs },
          { saveMode: 'none', historyMode: 'debounced', historyDebounceMs: 100 },
        );
      }
    };

    splitAt(endUs);
    splitAt(startUs);

    const updated = timelineDoc.value;
    if (!updated) return;

    for (const track of updated.tracks) {
      if (!trackIdSet.has(track.id)) continue;

      const toDelete: string[] = [];
      for (const it of track.items) {
        if (it.kind !== 'clip') continue;
        const itStart = it.timelineRange.startUs;
        const center = itStart + it.timelineRange.durationUs / 2;

        if (center >= startUs && center <= endUs) {
          toDelete.push(it.id);
        }
      }

      if (toDelete.length > 0) {
        applyTimeline(
          { type: 'delete_items', trackId: track.id, itemIds: toDelete },
          { saveMode: 'none', historyMode: 'debounced', historyDebounceMs: 100 },
        );
      }
    }

    const afterDelete = timelineDoc.value;
    if (!afterDelete) return;

    const EPSILON = 10;
    for (const track of afterDelete.tracks) {
      if (!trackIdSet.has(track.id)) continue;

      const clips = track.items
        .filter((it): it is import('~/timeline/types').TimelineClipItem => it.kind === 'clip')
        .slice()
        .sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);

      for (const clip of clips) {
        const clipStart = clip.timelineRange.startUs;
        if (clipStart >= endUs - EPSILON) {
          applyTimeline(
            {
              type: 'move_item',
              trackId: track.id,
              itemId: clip.id,
              startUs: Math.max(0, clipStart - deltaUs),
            },
            { saveMode: 'none', historyMode: 'debounced', historyDebounceMs: 100 },
          );
        }
      }
    }
  }

  async function rippleTrimRight() {
    const doc = timelineDoc.value;
    if (!doc) return;

    const target = getHotkeyTargetClip();
    if (!target) return;

    const track = doc.tracks.find((t) => t.id === target.trackId) ?? null;
    const item = track?.items.find((it) => it.kind === 'clip' && it.id === target.itemId) ?? null;
    if (!track || !item || item.kind !== 'clip') return;

    const cutUs = computeCutUs(doc, currentTime.value);
    const startUs = item.timelineRange.startUs;
    const endUs = startUs + item.timelineRange.durationUs;

    // Check if playhead is within the target clip
    if (!(cutUs > startUs && cutUs < endUs)) return;

    const deltaUs = endUs - cutUs;
    if (deltaUs <= 0) return;

    // 1. Trim the target clip (shrink duration)
    applyTimeline(
      {
        type: 'trim_item',
        trackId: target.trackId,
        itemId: target.itemId,
        edge: 'end',
        deltaUs: -deltaUs,
      },
      { saveMode: 'none' },
    );

    // 2. Shift all subsequent clips on the same track left by deltaUs
    const updatedDoc = timelineDoc.value;
    if (!updatedDoc) return;
    const updatedTrack = updatedDoc.tracks.find((t) => t.id === target.trackId) ?? null;
    if (!updatedTrack) return;

    const subsequentClips = updatedTrack.items
      .filter((it): it is import('~/timeline/types').TimelineClipItem => it.kind === 'clip')
      .filter((it) => it.timelineRange.startUs >= endUs - 10); // Use a small epsilon

    for (const clip of subsequentClips) {
      applyTimeline(
        {
          type: 'move_item',
          trackId: target.trackId,
          itemId: clip.id,
          startUs: Math.max(0, clip.timelineRange.startUs - deltaUs),
        },
        { saveMode: 'none' },
      );
    }

    await requestTimelineSave({ immediate: true });
  }

  async function rippleTrimLeft() {
    const doc = timelineDoc.value;
    if (!doc) return;

    const target = getHotkeyTargetClip();
    if (!target) return;

    const track = doc.tracks.find((t) => t.id === target.trackId) ?? null;
    const item = track?.items.find((it) => it.kind === 'clip' && it.id === target.itemId) ?? null;
    if (!track || !item || item.kind !== 'clip') return;

    const cutUs = computeCutUs(doc, currentTime.value);
    const startUs = item.timelineRange.startUs;
    const endUs = startUs + item.timelineRange.durationUs;

    // Check if playhead is within the target clip
    if (!(cutUs > startUs && cutUs < endUs)) return;

    const deltaUs = cutUs - startUs;
    if (deltaUs <= 0) return;

    // 1. Trim the target clip (shrink duration from start)
    applyTimeline(
      {
        type: 'trim_item',
        trackId: target.trackId,
        itemId: target.itemId,
        edge: 'start',
        deltaUs: deltaUs,
      },
      { saveMode: 'none' },
    );

    // 2. Shift the trimmed clip and all subsequent clips on the same track left by deltaUs
    const updatedDoc = timelineDoc.value;
    if (!updatedDoc) return;
    const updatedTrack = updatedDoc.tracks.find((t) => t.id === target.trackId) ?? null;
    if (!updatedTrack) return;

    const clipsToShift = updatedTrack.items
      .filter((it): it is import('~/timeline/types').TimelineClipItem => it.kind === 'clip')
      .filter((it) => it.timelineRange.startUs >= cutUs - 10); // Target clip is now at cutUs, subsequent are later

    for (const clip of clipsToShift) {
      applyTimeline(
        {
          type: 'move_item',
          trackId: target.trackId,
          itemId: clip.id,
          startUs: Math.max(0, clip.timelineRange.startUs - deltaUs),
        },
        { saveMode: 'none' },
      );
    }

    await requestTimelineSave({ immediate: true });
  }

  function getBoundaryTimesUs(trackFilter: ((trackId: string) => boolean) | null): number[] {
    const doc = timelineDoc.value;
    if (!doc) return [];

    const boundaries: number[] = [];
    for (const track of doc.tracks) {
      if (trackFilter && !trackFilter(track.id)) continue;
      for (const it of track.items) {
        if (it.kind !== 'clip') continue;
        const startUs = Math.max(0, Math.round(it.timelineRange.startUs));
        const endUs = Math.max(
          0,
          Math.round(it.timelineRange.startUs + it.timelineRange.durationUs),
        );
        boundaries.push(startUs, endUs);
      }
    }

    boundaries.sort((a, b) => a - b);
    return Array.from(new Set(boundaries));
  }

  function jumpToPrevClipBoundary(options?: { currentTrackOnly?: boolean }) {
    const doc = timelineDoc.value;
    if (!doc) return;

    const currentTrackOnly = Boolean(options?.currentTrackOnly);
    const trackId = currentTrackOnly ? getSelectedOrActiveTrackId() : null;
    if (currentTrackOnly && !trackId) return;

    const boundaries = getBoundaryTimesUs(trackId ? (id) => id === trackId : null);
    if (boundaries.length === 0) return;

    const atUs = currentTime.value;
    let prev: number | null = null;
    for (const b of boundaries) {
      if (b >= atUs) break;
      prev = b;
    }

    if (prev === null) {
      currentTime.value = 0;
      return;
    }

    currentTime.value = prev;
  }

  function jumpToNextClipBoundary(options?: { currentTrackOnly?: boolean }) {
    const doc = timelineDoc.value;
    if (!doc) return;

    const currentTrackOnly = Boolean(options?.currentTrackOnly);
    const trackId = currentTrackOnly ? getSelectedOrActiveTrackId() : null;
    if (currentTrackOnly && !trackId) return;

    const boundaries = getBoundaryTimesUs(trackId ? (id) => id === trackId : null);
    if (boundaries.length === 0) return;

    const atUs = currentTime.value;
    const next = boundaries.find((b) => b > atUs) ?? null;

    if (next === null) {
      const endFromState =
        Number.isFinite(duration.value) && duration.value > 0
          ? Math.max(0, Math.round(duration.value))
          : 0;
      const end =
        endFromState > 0 ? endFromState : Math.max(0, Math.round(selectTimelineDurationUs(doc)));
      currentTime.value = end;
      return;
    }

    currentTime.value = next;
  }

  async function splitClipAtPlayhead() {
    const doc = timelineDoc.value;
    if (!doc) return;

    const target = getHotkeyTargetClip();
    if (!target) return;

    const cutUs = computeCutUs(doc, currentTime.value);
    applyTimeline(
      { type: 'split_item', trackId: target.trackId, itemId: target.itemId, atUs: cutUs },
      { saveMode: 'none' },
    );
    await requestTimelineSave({ immediate: true });
  }

  async function splitAllClipsAtPlayhead() {
    const doc = timelineDoc.value;
    if (!doc) return;

    const cutUs = computeCutUs(doc, currentTime.value);
    const targets: Array<{ trackId: string; itemId: string }> = [];
    for (const track of doc.tracks) {
      for (const it of track.items) {
        if (it.kind !== 'clip') continue;
        targets.push({ trackId: track.id, itemId: it.id });
      }
    }
    if (targets.length === 0) return;

    for (const t of targets) {
      applyTimeline(
        { type: 'split_item', trackId: t.trackId, itemId: t.itemId, atUs: cutUs },
        { saveMode: 'none' },
      );
    }
    await requestTimelineSave({ immediate: true });
  }

  async function toggleDisableTargetClip() {
    const doc = timelineDoc.value;
    if (!doc) return;
    const target = getHotkeyTargetClip();
    if (!target) return;

    const track = doc.tracks.find((t) => t.id === target.trackId) ?? null;
    const item = track?.items.find((it) => it.kind === 'clip' && it.id === target.itemId) ?? null;
    if (!track || !item || item.kind !== 'clip') return;

    updateClipProperties(target.trackId, target.itemId, { disabled: !item.disabled });
    await requestTimelineSave({ immediate: true });
  }

  async function toggleMuteTargetClip() {
    const doc = timelineDoc.value;
    if (!doc) return;
    const target = getHotkeyTargetClip();
    if (!target) return;

    const track = doc.tracks.find((t) => t.id === target.trackId) ?? null;
    const item = track?.items.find((it) => it.kind === 'clip' && it.id === target.itemId) ?? null;
    if (!track || !item || item.kind !== 'clip') return;

    const prevGain =
      typeof item.audioGain === 'number' && Number.isFinite(item.audioGain) ? item.audioGain : 1;
    const nextGain = prevGain === 0 ? 1 : 0;
    updateClipProperties(target.trackId, target.itemId, { audioGain: nextGain });
    await requestTimelineSave({ immediate: true });
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

  function deleteFirstSelectedItem() {
    const doc = timelineDoc.value;
    if (!doc) return;

    if (selectedTransition.value) {
      updateClipTransition(
        selectedTransition.value.trackId,
        selectedTransition.value.itemId,
        selectedTransition.value.edge === 'in' ? { transitionIn: null } : { transitionOut: null },
      );
      clearSelectedTransition();
      return;
    }

    if (selectedItemIds.value.length === 0) return;

    const selectedSet = new Set(selectedItemIds.value);
    for (const track of doc.tracks) {
      for (const item of track.items) {
        if (selectedSet.has(item.id)) {
          deleteSelectedItems(track.id);
          return;
        }
      }
    }
  }

  function goToStart() {
    currentTime.value = 0;
  }

  function goToEnd() {
    const end = Number.isFinite(duration.value) ? Math.max(0, Math.round(duration.value)) : 0;
    currentTime.value = end;
  }

  function setTimelineZoom(next: number) {
    const parsed = Math.round(Number(next));
    if (!Number.isFinite(parsed)) return;
    timelineZoom.value = Math.min(100, Math.max(0, parsed));
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
    clipType: Extract<
      import('~/timeline/types').TimelineClipType,
      'adjustment' | 'background' | 'text'
    >;
    name: string;
    durationUs?: number;
    backgroundColor?: string;
    text?: string;
    style?: import('~/timeline/types').TextClipStyle;
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
      text: input.text,
      style: input.style,
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

  function addTextClipAtPlayhead(options?: {
    durationUs?: number;
    name?: string;
    text?: string;
    style?: import('~/timeline/types').TextClipStyle;
  }) {
    addVirtualClipAtPlayhead({
      clipType: 'text',
      name: options?.name ?? 'Text',
      durationUs: options?.durationUs,
      text: options?.text,
      style: options?.style,
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
        'videoHidden' | 'audioMuted' | 'audioSolo' | 'effects' | 'audioGain' | 'audioBalance'
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
    updateTrackProperties(trackId, { videoHidden: !track.videoHidden });
  }

  function toggleTrackAudioMuted(trackId: string) {
    const track = timelineDoc.value?.tracks.find((t) => t.id === trackId);
    if (!track) return;
    updateTrackProperties(trackId, { audioMuted: !track.audioMuted });
  }

  function toggleTrackAudioSolo(trackId: string) {
    const track = timelineDoc.value?.tracks.find((t) => t.id === trackId);
    if (!track) return;
    updateTrackProperties(trackId, { audioSolo: !track.audioSolo });
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
        | 'disabled'
        | 'locked'
        | 'opacity'
        | 'effects'
        | 'freezeFrameSourceUs'
        | 'speed'
        | 'transform'
        | 'audioGain'
        | 'audioBalance'
        | 'audioFadeInUs'
        | 'audioFadeOutUs'
      >
    > & {
      backgroundColor?: string;
      text?: string;
      style?: import('~/timeline/types').TextClipStyle;
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
    timelineZoom.value = 50;
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

    // Inject the current playhead position before saving
    const snapshot: TimelineDocument = {
      ...timelineDoc.value,
      metadata: {
        ...(timelineDoc.value.metadata ?? {}),
        gran: {
          ...(timelineDoc.value.metadata?.gran ?? {}),
          playheadUs: currentTime.value,
        },
      },
    };
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

      if (
        typeof parsed.metadata?.gran?.playheadUs === 'number' &&
        Number.isFinite(parsed.metadata.gran.playheadUs)
      ) {
        currentTime.value = parsed.metadata.gran.playheadUs;
      }
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
    if (cmd.type !== 'trim_item' && cmd.type !== 'overlay_trim_item') return doc;

    const track = doc.tracks.find((t) => t.id === cmd.trackId);
    if (!track) return doc;

    const item = track.items.find((it) => it.id === cmd.itemId);
    if (!item) return doc;
    if (item.kind !== 'clip') return doc;
    if (item.clipType !== 'media') return doc;
    if (!item.source?.path) return doc;

    const meta = mediaMetadata.value[item.source.path];
    if (!meta) return doc;

    const hasVideo = Boolean(meta.video);
    const hasAudio = Boolean(meta.audio);
    const isImageLike = !hasVideo && !hasAudio;

    const durationS = Number(meta.duration);
    const durationUs = Number.isFinite(durationS) && durationS > 0 ? Math.floor(durationS * 1_000_000) : 0;

    const needsSourceDurationPatch = durationUs > 0 && item.sourceDurationUs !== durationUs;
    const needsIsImagePatch = isImageLike && !item.isImage;

    if (!needsSourceDurationPatch && !needsIsImagePatch) return doc;

    const nextTracks = doc.tracks.map((t) =>
      t.id !== track.id
        ? t
        : {
            ...t,
            items: t.items.map((it) => {
              if (it.id === item.id && it.kind === 'clip' && it.clipType === 'media') {
                const patch: any = {};
                if (needsSourceDurationPatch) patch.sourceDurationUs = durationUs;
                if (needsIsImagePatch) patch.isImage = true;
                return { ...it, ...patch };
              }
              return it;
            }),
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

    const shouldAutoCreateProxy =
      workspaceStore.userSettings.optimization.autoCreateProxies &&
      hasVideo &&
      input.path.startsWith(`${SOURCES_DIR_NAME}/video/`) &&
      !proxyStore.existingProxies.has(input.path);

    if (shouldAutoCreateProxy) {
      void proxyStore.generateProxy(handle, input.path);
    }

    applyTimeline({
      type: 'add_clip_to_track',
      trackId: targetTrack.id,
      name: input.name,
      path: input.path,
      clipType: 'media',
      durationUs,
      sourceDurationUs,
      isImage: isImageLike,
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
    getMarkers,
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
    hoveredTrackId,
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
    deleteFirstSelectedItem,
    goToStart,
    goToEnd,
    setTimelineZoom,
    setAudioVolume,
    setAudioMuted,
    toggleAudioMuted,
    playbackSpeed,
    setPlaybackSpeed,
    setPlaybackGestureHandler,
    togglePlayback,
    stopPlayback,
    addMarkerAtPlayhead,
    updateMarker,
    removeMarker,
    addTrack,
    addAdjustmentClipAtPlayhead,
    addBackgroundClipAtPlayhead,
    addTextClipAtPlayhead,
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
    trimToPlayheadLeftNoRipple,
    trimToPlayheadRightNoRipple,
    rippleTrimLeft,
    rippleTrimRight,
    jumpToPrevClipBoundary,
    jumpToNextClipBoundary,
    splitClipAtPlayhead,
    splitAllClipsAtPlayhead,
    toggleDisableTargetClip,
    toggleMuteTargetClip,
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
