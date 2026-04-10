import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { FsEntry } from '~/types/fs';
import { useUiStore } from './ui.store';

export type SelectionSource = 'timeline' | 'fileManager' | 'project';
export type FileManagerSelectionOrigin =
  | 'project-manager'
  | 'workspace-browser'
  | 'remote-browser';

export interface SelectedEntityBase {
  source: SelectionSource;
}

export interface SelectedProjectEffect extends SelectedEntityBase {
  source: 'project';
  kind: 'effect';
  effectType: string;
}

export interface SelectedProjectTransition extends SelectedEntityBase {
  source: 'project';
  kind: 'transition';
  transitionType: string;
}

export interface SelectedProjectLibraryItem extends SelectedEntityBase {
  source: 'project';
  kind: 'library-item';
  itemKind: 'text' | 'shape' | 'hud';
  itemId: string;
  presetParams?: any;
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

export interface SelectedTimelineSelectionRange extends SelectedEntityBase {
  source: 'timeline';
  kind: 'selection-range';
}

export interface SelectedFsEntry extends SelectedEntityBase {
  source: 'fileManager';
  kind: 'file' | 'directory';
  path?: string;
  name: string;
  entry: FsEntry;
  instanceId?: string;
  isExternal?: boolean;
  origin?: FileManagerSelectionOrigin;
}

export interface SelectedFsEntries extends SelectedEntityBase {
  source: 'fileManager';
  kind: 'multiple';
  entries: FsEntry[];
  instanceId?: string;
  isExternal?: boolean;
  origin?: FileManagerSelectionOrigin;
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
  | SelectedTimelineSelectionRange
  | SelectedTimelineProperties
  | SelectedFsEntry
  | SelectedFsEntries
  | SelectedProjectEffect
  | SelectedProjectTransition
  | SelectedProjectLibraryItem;

export const useSelectionStore = defineStore('selection', () => {
  const selectedEntity = ref<SelectedEntity | null>(null);

  function resolveFileManagerOrigin(
    entry: FsEntry,
    instanceId?: string,
    isExternal?: boolean,
  ): FileManagerSelectionOrigin {
    if (entry.source === 'remote') return 'remote-browser';
    if (isExternal || instanceId === 'computer' || instanceId === 'sidebar') {
      return 'workspace-browser';
    }
    return 'project-manager';
  }

  function selectTimelineItem(trackId: string, itemId: string, kind: 'clip' | 'gap' = 'clip') {
    selectedEntity.value = {
      source: 'timeline',
      kind,
      trackId,
      itemId,
    };
  }

  function selectTimelineItems(
    items: { trackId: string; itemId: string; kind?: 'clip' | 'gap' }[],
  ) {
    if (items.length === 0) {
      selectedEntity.value = null;
    } else if (items.length === 1 && items[0]) {
      selectedEntity.value = {
        source: 'timeline',
        kind: items[0].kind ?? 'clip',
        trackId: items[0].trackId,
        itemId: items[0].itemId,
      } as SelectedTimelineClip | SelectedTimelineGap;
    } else {
      selectedEntity.value = {
        source: 'timeline',
        kind: 'clips',
        items: items.map((it) => ({ trackId: it.trackId, itemId: it.itemId })),
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

  function selectTimelineSelectionRange() {
    selectedEntity.value = {
      source: 'timeline',
      kind: 'selection-range',
    };
  }

  function selectFsEntry(entry: FsEntry, instanceId?: string, isExternal?: boolean) {
    selectedEntity.value = {
      source: 'fileManager',
      kind: entry.kind,
      path: entry.path,
      name: entry.name,
      entry,
      instanceId,
      isExternal,
      origin: resolveFileManagerOrigin(entry, instanceId, isExternal),
    };
  }

  function selectFsEntryWithUiUpdate(entry: FsEntry, instanceId?: string, isExternal?: boolean) {
    const uiStore = useUiStore();
    selectFsEntry(entry, instanceId, isExternal);

    uiStore.selectedFsEntry = {
      kind: entry.kind,
      name: entry.name,
      path: entry.path,
      parentPath: entry.parentPath,
      lastModified: entry.lastModified,
      size: entry.size,
      source: entry.source ?? 'local',
      remoteId: entry.remoteId,
      remotePath: entry.remotePath,
      adapterPayload: entry.adapterPayload,
    };
  }

  function selectFsEntries(entries: FsEntry[], instanceId?: string, isExternal?: boolean) {
    if (entries.length === 0) {
      clearSelection();
      return;
    }
    if (entries.length === 1 && entries[0]) {
      selectFsEntry(entries[0], instanceId, isExternal);
      return;
    }
    selectedEntity.value = {
      source: 'fileManager',
      kind: 'multiple',
      entries,
      instanceId,
      isExternal,
      origin: resolveFileManagerOrigin(entries[0]!, instanceId, isExternal),
    };
  }

  function selectFsEntriesWithUiUpdate(
    entries: FsEntry[],
    instanceId?: string,
    isExternal?: boolean,
  ) {
    const uiStore = useUiStore();
    selectFsEntries(entries, instanceId, isExternal);

    if (entries.length === 1 && entries[0]) {
      uiStore.selectedFsEntry = {
        kind: entries[0].kind,
        name: entries[0].name,
        path: entries[0].path,
        source: entries[0].source as 'local' | 'remote',
      };
    } else {
      // For multiple entries, we usually clear the single entry selection in uiStore
      // or set it to null if that's what the UI expects for "multiple select" properties.
      uiStore.selectedFsEntry = null;
    }
  }

  function selectTimelineProperties() {
    selectedEntity.value = {
      source: 'timeline',
      kind: 'timeline-properties',
    };
  }

  function selectProjectEffect(effectType: string) {
    selectedEntity.value = {
      source: 'project',
      kind: 'effect',
      effectType,
    };
  }

  function selectProjectTransition(transitionType: string) {
    selectedEntity.value = {
      source: 'project',
      kind: 'transition',
      transitionType,
    };
  }

  function selectProjectLibraryItem(
    itemKind: 'text' | 'shape' | 'hud',
    itemId: string,
    presetParams?: any,
  ) {
    selectedEntity.value = {
      source: 'project',
      kind: 'library-item',
      itemKind,
      itemId,
      presetParams,
    };
  }

  function clearSelection() {
    selectedEntity.value = null;
    const uiStore = useUiStore();
    uiStore.selectedFsEntry = null;
  }

  function isTrackVisuallySelected(trackId: string) {
    if (selectedEntity.value?.source === 'timeline') {
      const entity = selectedEntity.value;
      if (entity.kind === 'track') return entity.trackId === trackId;
      if (entity.kind === 'clip') return entity.trackId === trackId;
      if (entity.kind === 'gap') return entity.trackId === trackId;
      if (entity.kind === 'transition') return entity.trackId === trackId;
      if (entity.kind === 'clips' && entity.items) {
        return entity.items.some((item) => item.trackId === trackId);
      }
    }
    return false;
  }

  return {
    selectedEntity,
    selectTimelineItem,
    selectTimelineItems,
    selectTimelineTrack,
    selectTimelineTransition,
    selectTimelineMarker,
    selectTimelineSelectionRange,
    selectFsEntry,
    selectFsEntryWithUiUpdate,
    selectFsEntries,
    selectFsEntriesWithUiUpdate,
    selectTimelineProperties,
    selectProjectEffect,
    selectProjectTransition,
    selectProjectLibraryItem,
    clearSelection,
    isTrackVisuallySelected,
  };
});
