import { useSelectionStore } from '~/stores/selection.store';
import { useUiStore } from '~/stores/ui.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { isLayer1Active, isLayer2Active } from '~/utils/hotkeys/layerUtils';
import type { FsEntry } from '~/types/fs';

function getParentPath(entry: FsEntry): string {
  return entry.path ? entry.path.split('/').slice(0, -1).join('/') : '';
}

export interface FileManagerSelectionOptions {
  getVisibleEntries: () => FsEntry[];
  enforceSameLevel?: boolean;
  onSingleSelect?: (entry: FsEntry) => void;
  instanceId?: string;
  isExternal?: boolean;
}

export function useFileManagerSelection({
  getVisibleEntries,
  enforceSameLevel = true,
  onSingleSelect,
  instanceId,
  isExternal,
}: FileManagerSelectionOptions) {
  const selectionStore = useSelectionStore();
  const uiStore = useUiStore();
  const workspaceStore = useWorkspaceStore();

  function setUiEntry(entry: FsEntry) {
    uiStore.selectedFsEntry = {
      kind: entry.kind,
      name: entry.name,
      path: entry.path,
      parentPath: entry.parentPath,
      lastModified: entry.lastModified,
      size: entry.size,
      source: entry.source,
      remoteId: entry.remoteId,
      remotePath: entry.remotePath,
      adapterPayload: entry.adapterPayload,
    };
  }

  function selectSingle(entry: FsEntry) {
    setUiEntry(entry);
    selectionStore.selectFsEntry(entry, instanceId, isExternal);
    onSingleSelect?.(entry);
  }

  /**
   * Handles Ctrl/Cmd click — toggle individual entry in selection.
   * Enforces same-level rule: cross-level entries are rejected and fall back to single select.
   */
  function handleToggleSelect(entry: FsEntry) {
    const selected = selectionStore.selectedEntity;
    if (!selected || selected.source !== 'fileManager') {
      selectionStore.selectFsEntries([entry], instanceId, isExternal);
      return;
    }

    let currentEntries: FsEntry[] = [];
    if (selected.kind === 'multiple') {
      currentEntries = [...selected.entries];
    } else if (selected.kind === 'file' || selected.kind === 'directory') {
      currentEntries = [selected.entry];
    }

    const existingIndex = currentEntries.findIndex((e) => e.path === entry.path);
    if (existingIndex >= 0) {
      currentEntries.splice(existingIndex, 1);
      selectionStore.selectFsEntries(currentEntries, instanceId, isExternal);
      return;
    }

    if (currentEntries.length > 0) {
      const firstParent = getParentPath(currentEntries[0]!);
      const entryParent = getParentPath(entry);
      if (enforceSameLevel && firstParent !== entryParent) {
        selectSingle(entry);
        return;
      }
    }

    selectionStore.selectFsEntries([...currentEntries, entry], instanceId, isExternal);
  }

  /**
   * Handles Shift click — selects a contiguous range of visible entries.
   * Enforces same-level rule: filters range to entries at same directory level.
   */
  function handleRangeSelect(entry: FsEntry) {
    const selected = selectionStore.selectedEntity;
    const visibleEntries = getVisibleEntries();
    const targetIndex = visibleEntries.findIndex((e) => e.path === entry.path);

    let lastSelectedIndex = -1;
    if (selected?.source === 'fileManager') {
      if (selected.kind === 'multiple' && selected.entries.length > 0) {
        const last = selected.entries[selected.entries.length - 1];
        lastSelectedIndex = visibleEntries.findIndex((e) => e.path === last?.path);
      } else if (selected && 'path' in selected) {
        lastSelectedIndex = visibleEntries.findIndex((e) => e.path === selected.path);
      }
    }

    if (lastSelectedIndex < 0 || targetIndex < 0) {
      selectSingle(entry);
      return;
    }

    const start = Math.min(lastSelectedIndex, targetIndex);
    const end = Math.max(lastSelectedIndex, targetIndex);
    const entryParent = getParentPath(entry);
    const range = enforceSameLevel
      ? visibleEntries.slice(start, end + 1).filter((e) => getParentPath(e) === entryParent)
      : visibleEntries.slice(start, end + 1);

    selectionStore.selectFsEntries(range, instanceId, isExternal);
  }

  /**
   * Handles a mouse click on an fs entry, dispatching to range/toggle/single select
   * based on modifier keys.
   */
  function handleEntryClick(event: MouseEvent, entry: FsEntry) {
    const isL1 = isLayer1Active(event, workspaceStore.userSettings);
    const isL2 = isLayer2Active(event, workspaceStore.userSettings);

    if (isL2) {
      handleToggleSelect(entry);
    } else if (isL1) {
      handleRangeSelect(entry);
    } else {
      selectSingle(entry);
    }
  }

  return {
    selectSingle,
    handleToggleSelect,
    handleRangeSelect,
    handleEntryClick,
  };
}
