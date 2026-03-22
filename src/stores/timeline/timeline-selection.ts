import { computed, type Ref } from 'vue';

import type { TimelineDocument } from '~/timeline/types';

export interface TimelineSelectionDeps {
  timelineDoc: Ref<TimelineDocument | null>;
  currentTime: Ref<number>;

  selectedItemIds: Ref<string[]>;
  selectedTrackId: Ref<string | null>;
  selectedTransition: Ref<{
    trackId: string;
    itemId: string;
    edge: 'in' | 'out';
  } | null>;
  selectionStore?: any;
}

export interface TimelineSelectionApi {
  clearSelection: () => void;
  clearSelectedTransition: () => void;
  selectTransition: (input: { trackId: string; itemId: string; edge: 'in' | 'out' } | null) => void;
  selectTrack: (trackId: string | null) => void;
  toggleSelection: (itemId: string, options?: { multi?: boolean }) => void;
  selectTimelineItems: (itemIds: string[] | { trackId: string; itemId: string }[]) => void;
  selectAllClipsOnTrack: (trackId: string) => void;
  selectAllClips: () => void;
  selectClipsRelativeToPlayhead: (params: {
    direction: 'left' | 'right';
    trackId?: string | null;
  }) => void;

  getHotkeyTargetClip: () => { trackId: string; itemId: string } | null;
  getSelectedOrActiveTrackId: () => string | null;
}

export function createTimelineSelection(deps: TimelineSelectionDeps): TimelineSelectionApi {
  const itemToTrackMap = computed(() => {
    const map = new Map<string, string>();
    const doc = deps.timelineDoc.value;
    if (!doc) return map;
    for (const track of doc.tracks) {
      for (const item of track.items) {
        if (item.kind === 'clip') {
          map.set(item.id, track.id);
        }
      }
    }
    return map;
  });

  function clearSelection() {
    deps.selectedItemIds.value = [];
    deps.selectedTransition.value = null;
    deps.selectionStore?.clearTimelineSelection?.();
  }

  function clearSelectedTransition() {
    deps.selectedTransition.value = null;
  }

  function selectTransition(input: { trackId: string; itemId: string; edge: 'in' | 'out' } | null) {
    deps.selectedTrackId.value = null;
    deps.selectedItemIds.value = [];
    deps.selectedTransition.value = input;
  }

  function selectTrack(trackId: string | null) {
    deps.selectedTrackId.value = trackId;
    if (trackId) {
      deps.selectedTransition.value = null;
      deps.selectedItemIds.value = [];
      deps.selectionStore?.selectTimelineTrack?.(trackId);
    }
  }

  function toggleSelection(itemId: string, options?: { multi?: boolean }) {
    deps.selectedTransition.value = null;
    if (options?.multi) {
      if (deps.selectedItemIds.value.includes(itemId)) {
        deps.selectedItemIds.value = deps.selectedItemIds.value.filter((id) => id !== itemId);
      } else {
        deps.selectedItemIds.value.push(itemId);
      }
    } else {
      deps.selectedItemIds.value = [itemId];
    }
  }

  function selectTimelineItems(items: string[] | { trackId: string; itemId: string; kind?: 'clip' | 'gap' }[]) {
    deps.selectedTransition.value = null;
    if (items.length === 0) {
      deps.selectedItemIds.value = [];
      deps.selectionStore?.clearTimelineSelection?.();
      return;
    }

    if (typeof items[0] === 'string') {
      deps.selectedItemIds.value = [...(items as string[])];
      // We don't update global selection store here because we don't have trackIds
    } else {
      const objects = items as { trackId: string; itemId: string; kind?: 'clip' | 'gap' }[];
      deps.selectedItemIds.value = objects.map((it) => it.itemId);
      deps.selectionStore?.selectTimelineItems?.(objects);
    }
  }

  function selectAllClipsOnTrack(trackId: string) {
    const track = deps.timelineDoc.value?.tracks.find((t) => t.id === trackId);
    if (!track) return;
    const ids = track.items.filter((it) => it.kind === 'clip').map((it) => it.id);
    selectTimelineItems(ids);
  }

  function selectAllClips() {
    const doc = deps.timelineDoc.value;
    if (!doc) return;

    const ids = doc.tracks.flatMap((track) =>
      track.items.filter((item) => item.kind === 'clip').map((item) => item.id),
    );
    selectTimelineItems(ids);
  }

  function selectClipsRelativeToPlayhead(params: {
    direction: 'left' | 'right';
    trackId?: string | null;
  }) {
    const doc = deps.timelineDoc.value;
    if (!doc) return;

    const playheadUs = deps.currentTime.value;
    const trackIds = params.trackId ? new Set([params.trackId]) : null;
    const items = doc.tracks.flatMap((track) => {
      if (trackIds && !trackIds.has(track.id)) return [];

      return track.items
        .filter((item) => {
          if (item.kind !== 'clip') return false;

          const startUs = item.timelineRange.startUs;
          const endUs = startUs + item.timelineRange.durationUs;

          if (params.direction === 'left') {
            return endUs <= playheadUs;
          }

          return startUs >= playheadUs;
        })
        .map((item) => item.id);
    });

    selectTimelineItems(items);
  }

  function getHotkeyTargetClip(): { trackId: string; itemId: string } | null {
    const doc = deps.timelineDoc.value;
    if (!doc) return null;

    const selectedId = deps.selectedItemIds.value[0];
    if (selectedId) {
      const trackId = itemToTrackMap.value.get(selectedId);
      if (trackId) {
        return { trackId, itemId: selectedId };
      }
    }

    const trackId = deps.selectedTrackId.value;
    if (!trackId) return null;
    const track = doc.tracks.find((t) => t.id === trackId) ?? null;
    if (!track) return null;

    const atUs = deps.currentTime.value;
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
    const doc = deps.timelineDoc.value;
    if (!doc) return null;

    const selectedId = deps.selectedItemIds.value[0];
    if (selectedId) {
      const trackId = itemToTrackMap.value.get(selectedId);
      if (trackId) return trackId;
    }

    return deps.selectedTrackId.value;
  }

  return {
    clearSelection,
    clearSelectedTransition,
    selectTransition,
    selectTrack,
    toggleSelection,
    selectTimelineItems,
    selectAllClipsOnTrack,
    selectAllClips,
    selectClipsRelativeToPlayhead,
    getHotkeyTargetClip,
    getSelectedOrActiveTrackId,
  };
}
