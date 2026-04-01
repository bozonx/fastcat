import { computed, type Ref } from 'vue';

import type { TimelineDocument } from '~/timeline/types';
import { getLinkedClipGroupItemIds } from '~/timeline/commands/utils';

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

export interface TimelineSelectionModule {
  clearSelection: () => void;
  clearSelectedTransition: () => void;
  selectTransition: (input: { trackId: string; itemId: string; edge: 'in' | 'out' } | null) => void;
  selectTrack: (trackId: string | null) => void;
  toggleSelection: (itemId: string, options?: { multi?: boolean }) => void;
  selectTimelineItems: (
    itemIds: string[] | { trackId: string; itemId: string; kind?: 'clip' | 'gap' }[],
  ) => void;
  selectAllClipsOnTrack: (trackId: string) => void;
  selectAllClips: () => void;
  selectClipsRelativeToPlayhead: (params: {
    direction: 'left' | 'right';
    trackId?: string | null;
  }) => void;

  getHotkeyTargetClip: () => { trackId: string; itemId: string } | null;
  getSelectedOrActiveTrackId: () => string | null;
}

export function createTimelineSelectionModule(deps: TimelineSelectionDeps): TimelineSelectionModule {
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
    const doc = deps.timelineDoc.value;
    const groupIds = doc ? getLinkedClipGroupItemIds(doc, itemId) : [itemId];

    if (options?.multi) {
      if (deps.selectedItemIds.value.includes(itemId)) {
        deps.selectedItemIds.value = deps.selectedItemIds.value.filter(
          (id) => !groupIds.includes(id),
        );
      } else {
        const nextIds = new Set(deps.selectedItemIds.value);
        for (const id of groupIds) nextIds.add(id);
        deps.selectedItemIds.value = Array.from(nextIds);
      }
    } else {
      deps.selectedItemIds.value = groupIds;
    }
  }

  function selectTimelineItems(
    items: string[] | { trackId: string; itemId: string; kind?: 'clip' | 'gap' }[],
  ) {
    deps.selectedTransition.value = null;
    if (items.length === 0) {
      deps.selectedItemIds.value = [];
      deps.selectionStore?.clearTimelineSelection?.();
      return;
    }

    const doc = deps.timelineDoc.value;
    const nextIds = new Set<string>();

    if (typeof items[0] === 'string') {
      for (const id of items as string[]) {
        if (doc) {
          for (const gid of getLinkedClipGroupItemIds(doc, id)) nextIds.add(gid);
        } else {
          nextIds.add(id);
        }
      }
      deps.selectedItemIds.value = Array.from(nextIds);
      // We don't update global selection store here because we don't have trackIds
    } else {
      const objects = items as { trackId: string; itemId: string; kind?: 'clip' | 'gap' }[];
      for (const obj of objects) {
        if (doc) {
          for (const gid of getLinkedClipGroupItemIds(doc, obj.itemId)) nextIds.add(gid);
        } else {
          nextIds.add(obj.itemId);
        }
      }
      deps.selectedItemIds.value = Array.from(nextIds);

      const expandedObjects: { trackId: string; itemId: string; kind?: 'clip' | 'gap' }[] = [];
      for (const id of nextIds) {
        const trackId = itemToTrackMap.value.get(id);
        if (trackId) {
          expandedObjects.push({ trackId, itemId: id, kind: 'clip' });
        }
      }
      if (expandedObjects.length > 0) {
        deps.selectionStore?.selectTimelineItems?.(expandedObjects);
      } else {
        deps.selectionStore?.selectTimelineItems?.(objects);
      }
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
