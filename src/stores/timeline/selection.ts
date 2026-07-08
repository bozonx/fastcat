import { computed, type Ref } from 'vue';

import type { TimelineDocument } from '~/timeline/types';
import { getLinkedClipGroupItemIds } from '~/timeline/commands/utils';

interface TimelineSelectableItem {
  trackId: string;
  itemId: string;
  kind: 'clip' | 'gap';
}

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
  selectionStore?: {
    clearSelection?: () => void;
    selectTimelineTrack?: (trackId: string) => void;
    selectTimelineItems?: (
      items: { trackId: string; itemId: string; kind?: 'clip' | 'gap' }[],
    ) => void;
  };
}

export interface TimelineSelectionModule {
  clearSelection: () => void;
  clearSelectedTransition: () => void;
  selectTransition: (input: { trackId: string; itemId: string; edge: 'in' | 'out' } | null) => void;
  selectTrack: (trackId: string | null) => void;
  toggleSelection: (itemId: string, options?: { multi?: boolean }) => void;
  selectTimelineItems: (
    itemIds: string[] | { trackId: string; itemId: string; kind?: 'clip' | 'gap' }[],
    options?: { append?: boolean; bypassGroup?: boolean },
  ) => void;
  removeFromSelection: (itemIds: string[]) => void;
  selectAllClipsOnTrack: (trackId: string, options?: { append?: boolean }) => void;
  selectAllClips: () => void;
  selectAllTimelineItems: () => void;
  selectClipsRelativeToPlayhead: (params: {
    direction: 'left' | 'right';
    trackId?: string | null;
  }) => void;

  pruneSelectionForDoc: (doc: TimelineDocument) => void;

  getHotkeyTargetClip: () => { trackId: string; itemId: string } | null;
  getSelectedOrActiveTrackId: () => string | null;
}

export function createTimelineSelectionModule(
  deps: TimelineSelectionDeps,
): TimelineSelectionModule {
  const itemToTrackMap = computed(() => {
    const map = new Map<string, TimelineSelectableItem>();
    const doc = deps.timelineDoc.value;
    if (!doc) return map;
    for (const track of doc.tracks) {
      for (const item of track.items) {
        if (item.kind === 'clip' || item.kind === 'gap') {
          map.set(item.id, { trackId: track.id, itemId: item.id, kind: item.kind });
        }
      }
    }
    return map;
  });

  function clearSelection() {
    deps.selectedItemIds.value = [];
    deps.selectedTransition.value = null;
    deps.selectionStore?.clearSelection?.();
  }

  function clearSelectedTransition() {
    deps.selectedTransition.value = null;
  }

  function selectTransition(input: { trackId: string; itemId: string; edge: 'in' | 'out' } | null) {
    // Only clear the track/clip selection when actually selecting a transition.
    // Calling this with `null` merely deselects the transition and must NOT wipe
    // an existing clip selection (mirrors `selectTrack`'s guarded behavior).
    if (input) {
      deps.selectedTrackId.value = null;
      deps.selectedItemIds.value = [];
    }
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
    options?: { append?: boolean; bypassGroup?: boolean },
  ) {
    deps.selectedTransition.value = null;
    if (items.length === 0) {
      if (!options?.append) {
        deps.selectedItemIds.value = [];
        deps.selectionStore?.clearSelection?.();
      }
      return;
    }

    const doc = deps.timelineDoc.value;
    const bypass = options?.bypassGroup ?? false;
    const nextIds = new Set<string>(options?.append ? deps.selectedItemIds.value : []);

    if (typeof items[0] === 'string') {
      for (const id of items as string[]) {
        if (doc && !bypass) {
          for (const gid of getLinkedClipGroupItemIds(doc, id)) nextIds.add(gid);
        } else {
          nextIds.add(id);
        }
      }
      deps.selectedItemIds.value = Array.from(nextIds);

      const expandedObjects: { trackId: string; itemId: string; kind?: 'clip' | 'gap' }[] = [];
      for (const id of nextIds) {
        const item = itemToTrackMap.value.get(id);
        if (item) {
          expandedObjects.push(item);
        }
      }
      if (expandedObjects.length > 0) {
        deps.selectionStore?.selectTimelineItems?.(expandedObjects);
      } else {
        deps.selectionStore?.clearSelection?.();
      }
    } else {
      const objects = items as { trackId: string; itemId: string; kind?: 'clip' | 'gap' }[];
      for (const obj of objects) {
        if (doc && !bypass) {
          for (const gid of getLinkedClipGroupItemIds(doc, obj.itemId)) nextIds.add(gid);
        } else {
          nextIds.add(obj.itemId);
        }
      }
      deps.selectedItemIds.value = Array.from(nextIds);

      const expandedObjects: { trackId: string; itemId: string; kind?: 'clip' | 'gap' }[] = [];
      for (const id of nextIds) {
        const item = itemToTrackMap.value.get(id);
        if (item) {
          expandedObjects.push(item);
        }
      }
      if (expandedObjects.length > 0) {
        deps.selectionStore?.selectTimelineItems?.(expandedObjects);
      } else {
        deps.selectionStore?.selectTimelineItems?.(objects);
      }
    }
  }

  function removeFromSelection(itemIds: string[]) {
    const toRemove = new Set(itemIds);
    const next = deps.selectedItemIds.value.filter((id) => !toRemove.has(id));
    if (next.length !== deps.selectedItemIds.value.length) {
      deps.selectedItemIds.value = next;
    }
  }

  function selectAllClipsOnTrack(trackId: string, options?: { append?: boolean }) {
    const track = deps.timelineDoc.value?.tracks.find((t) => t.id === trackId);
    if (!track) return;
    const ids = track.items.filter((it) => it.kind === 'clip').map((it) => it.id);

    if (options?.append && deps.selectedItemIds.value.length > 0) {
      const allObjects: { trackId: string; itemId: string; kind: 'clip' }[] = [];
      const mergedIds = new Set([...deps.selectedItemIds.value, ...ids]);
      for (const id of mergedIds) {
        const item = itemToTrackMap.value.get(id);
        if (item?.kind === 'clip') {
          allObjects.push({ trackId: item.trackId, itemId: item.itemId, kind: 'clip' });
        }
      }
      selectTimelineItems(allObjects, { append: false });
    } else {
      selectTimelineItems(ids);
    }
  }

  function selectAllClips() {
    const doc = deps.timelineDoc.value;
    if (!doc) return;

    const ids = doc.tracks.flatMap((track) =>
      track.items.filter((item) => item.kind === 'clip').map((item) => item.id),
    );
    selectTimelineItems(ids);
  }

  function selectAllTimelineItems() {
    const doc = deps.timelineDoc.value;
    if (!doc) return;

    const items = doc.tracks.flatMap((track) =>
      track.items
        .filter((item) => item.kind === 'clip' || item.kind === 'gap')
        .map((item) => ({ trackId: track.id, itemId: item.id, kind: item.kind })),
    );
    selectTimelineItems(items);
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
      const item = itemToTrackMap.value.get(selectedId);
      if (item?.kind === 'clip') {
        return { trackId: item.trackId, itemId: selectedId };
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

  function pruneSelectionForDoc(doc: TimelineDocument) {
    const validItemIds = new Set<string>();
    const validTrackIds = new Set<string>();
    for (const track of doc.tracks) {
      validTrackIds.add(track.id);
      for (const item of track.items) {
        if (item.kind === 'clip' || item.kind === 'gap') validItemIds.add(item.id);
      }
    }

    const currentItemIds = deps.selectedItemIds.value;
    const filteredItemIds = currentItemIds.filter((id) => validItemIds.has(id));
    if (filteredItemIds.length !== currentItemIds.length) {
      if (filteredItemIds.length === 0) {
        clearSelection();
      } else {
        // Rebuild as {trackId,itemId} objects so the global selection store stays in sync.
        const objects: TimelineSelectableItem[] = [];
        for (const id of filteredItemIds) {
          const item = itemToTrackMap.value.get(id);
          if (item) objects.push(item);
        }
        if (objects.length > 0) {
          selectTimelineItems(objects);
        } else {
          clearSelection();
        }
      }
    }

    if (deps.selectedTrackId.value && !validTrackIds.has(deps.selectedTrackId.value)) {
      deps.selectedTrackId.value = null;
    }

    if (deps.selectedTransition.value) {
      const { trackId, itemId } = deps.selectedTransition.value;
      if (!validTrackIds.has(trackId) || !validItemIds.has(itemId)) {
        deps.selectedTransition.value = null;
      }
    }
  }

  function getSelectedOrActiveTrackId(): string | null {
    const doc = deps.timelineDoc.value;
    if (!doc) return null;

    const selectedId = deps.selectedItemIds.value[0];
    if (selectedId) {
      const item = itemToTrackMap.value.get(selectedId);
      if (item) return item.trackId;
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
    removeFromSelection,
    selectAllClipsOnTrack,
    selectAllClips,
    selectAllTimelineItems,
    selectClipsRelativeToPlayhead,
    pruneSelectionForDoc,
    getHotkeyTargetClip,
    getSelectedOrActiveTrackId,
  };
}
