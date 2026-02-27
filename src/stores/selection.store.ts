import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { FsEntry } from '~/composables/fileManager/useFileManager';

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

export type SelectedEntity =
  | SelectedTimelineClip
  | SelectedTimelineGap
  | SelectedTimelineTrack
  | SelectedTimelineTransition
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

  function selectFsEntry(entry: FsEntry) {
    selectedEntity.value = {
      source: 'fileManager',
      kind: entry.kind,
      path: entry.path,
      name: entry.name,
      entry,
    };
  }

  function clearSelection() {
    selectedEntity.value = null;
  }

  return {
    selectedEntity,
    selectTimelineItem,
    selectTimelineTrack,
    selectTimelineTransition,
    selectFsEntry,
    clearSelection,
  };
});
