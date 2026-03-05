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
}

export interface TimelineSelectionApi {
  clearSelection: () => void;
  clearSelectedTransition: () => void;
  selectTransition: (input: { trackId: string; itemId: string; edge: 'in' | 'out' } | null) => void;
  selectTrack: (trackId: string | null) => void;
  toggleSelection: (itemId: string, options?: { multi?: boolean }) => void;
  selectTimelineItems: (itemIds: string[]) => void;

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

  function selectTimelineItems(itemIds: string[]) {
    deps.selectedTransition.value = null;
    deps.selectedItemIds.value = [...itemIds];
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
    getHotkeyTargetClip,
    getSelectedOrActiveTrackId,
  };
}
