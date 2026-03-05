import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { FsEntry } from '~/types/fs';

export type SelectionSource = 'timeline' | 'fileManager';

export interface SelectedEntityBase {
  source: SelectionSource;
}

export interface SelectedTimelineClip extends SelectedEntityBase {
  source: 'timeline';
  kind: 'clip';
  trackId: string;
  itemId: string;
}

export interface SelectedTimelineClips extends SelectedEntityBase {
  source: 'timeline';
  kind: 'clips';
  items: { trackId: string; itemId: string }[];
}

export interface SelectedTimelineTrack extends SelectedEntityBase {
  source: 'timeline';
  kind: 'track';
  trackId: string;
}

export interface SelectedTimelineTransition extends SelectedEntityBase {
  source: 'timeline';
  kind: 'transition';
  trackId: string;
  itemId: string;
  edge: 'in' | 'out';
}

export interface SelectedTimelineMarker extends SelectedEntityBase {
  source: 'timeline';
  kind: 'marker';
  markerId: string;
}

export interface SelectedFsEntry extends SelectedEntityBase {
  source: 'fileManager';
  kind: 'file' | 'directory';
  path?: string;
  name: string;
  entry: FsEntry;
}

export interface SelectedTimelineGap extends SelectedEntityBase {
  source: 'timeline';
  kind: 'gap';
  trackId: string;
  itemId: string;
}

export interface SelectedTimelineProperties extends SelectedEntityBase {
  source: 'timeline';
  kind: 'timeline-properties';
}

export type SelectedEntity =
  | SelectedTimelineClip
  | SelectedTimelineClips
  | SelectedTimelineGap
  | SelectedTimelineTrack
  | SelectedTimelineTransition
  | SelectedTimelineMarker
  | SelectedTimelineProperties
  | SelectedFsEntry;

export const useSelectionStore = defineStore('selection', () => {
  const selectedEntity = ref<SelectedEntity | null>(null);

  function selectTimelineItem(trackId: string, itemId: string, kind: 'clip' | 'gap' = 'clip') {
    selectedEntity.value = {
      source: 'timeline',
      kind,
      trackId,
      itemId,
    };
  }

  function selectTimelineItems(items: { trackId: string; itemId: string }[]) {
    if (items.length === 0) {
      selectedEntity.value = null;
    } else if (items.length === 1 && items[0]) {
      selectedEntity.value = {
        source: 'timeline',
        kind: 'clip',
        trackId: items[0].trackId,
        itemId: items[0].itemId,
      };
    } else {
      selectedEntity.value = {
        source: 'timeline',
        kind: 'clips',
        items,
      };
    }
  }

  function selectTimelineTrack(trackId: string) {
    selectedEntity.value = {
      source: 'timeline',
      kind: 'track',
      trackId,
    };
  }

  function selectTimelineTransition(trackId: string, itemId: string, edge: 'in' | 'out') {
    selectedEntity.value = {
      source: 'timeline',
      kind: 'transition',
      trackId,
      itemId,
      edge,
    };
  }

  function selectTimelineMarker(markerId: string) {
    selectedEntity.value = {
      source: 'timeline',
      kind: 'marker',
      markerId,
    };
  }

  function selectFsEntry(entry: FsEntry) {
    selectedEntity.value = {
      source: 'fileManager',
      kind: entry.kind,
      path: entry.path,
      name: entry.name,
      entry,
    };
  }

  function selectTimelineProperties() {
    selectedEntity.value = {
      source: 'timeline',
      kind: 'timeline-properties',
    };
  }

  function clearSelection() {
    selectedEntity.value = null;
  }

  return {
    selectedEntity,
    selectTimelineItem,
    selectTimelineItems,
    selectTimelineTrack,
    selectTimelineTransition,
    selectTimelineMarker,
    selectFsEntry,
    selectTimelineProperties,
    clearSelection,
  };
});
