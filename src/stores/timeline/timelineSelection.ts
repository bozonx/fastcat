import type { Ref } from 'vue';

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

  getHotkeyTargetClip: () => { trackId: string; itemId: string } | null;
  getSelectedOrActiveTrackId: () => string | null;
}

export function createTimelineSelection(deps: TimelineSelectionDeps): TimelineSelectionApi {
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

  function getHotkeyTargetClip(): { trackId: string; itemId: string } | null {
    const doc = deps.timelineDoc.value;
    if (!doc) return null;

    const selectedId = deps.selectedItemIds.value[0];
    if (selectedId) {
      for (const track of doc.tracks) {
        for (const it of track.items) {
          if (it.kind !== 'clip') continue;
          if (it.id !== selectedId) continue;
          return { trackId: track.id, itemId: it.id };
        }
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
      for (const track of doc.tracks) {
        for (const it of track.items) {
          if (it.kind !== 'clip') continue;
          if (it.id === selectedId) return track.id;
        }
      }
    }

    return deps.selectedTrackId.value;
  }

  return {
    clearSelection,
    clearSelectedTransition,
    selectTransition,
    selectTrack,
    toggleSelection,
    getHotkeyTargetClip,
    getSelectedOrActiveTrackId,
  };
}
