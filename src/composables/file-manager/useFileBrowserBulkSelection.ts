import type { FsEntry } from '~/types/fs';

export interface FileBrowserBulkSelectionParams {
  getVisibleEntries: () => FsEntry[];
  getSelectedEntries: () => FsEntry[];
  selectEntries: (entries: FsEntry[], instanceId?: string, isExternal?: boolean) => void;
  clearSelection: () => void;
  getUsedPaths: () => Set<string>;
  refreshUsage?: () => Promise<void>;
  instanceId?: string;
  isExternal?: boolean;
}

function getEntryKey(entry: FsEntry): string {
  return `${entry.kind}:${entry.path ?? entry.name}`;
}

export function useFileBrowserBulkSelection(params: FileBrowserBulkSelectionParams) {
  function selectAll() {
    const visibleEntries = params.getVisibleEntries();
    const selectedKeys = new Set(params.getSelectedEntries().map(getEntryKey));
    const visibleKeys = visibleEntries.map(getEntryKey);

    const isAllSelected =
      visibleEntries.length > 0 &&
      visibleKeys.every((entryKey) => selectedKeys.has(entryKey)) &&
      selectedKeys.size === visibleEntries.length;

    if (isAllSelected) {
      params.clearSelection();
      return;
    }

    params.selectEntries(visibleEntries, params.instanceId, params.isExternal);
  }

  async function selectUnused() {
    await params.refreshUsage?.();

    const usedPaths = params.getUsedPaths();
    const unusedEntries = params
      .getVisibleEntries()
      .filter((entry) => entry.kind === 'file' && entry.path && !usedPaths.has(entry.path));

    params.selectEntries(unusedEntries, params.instanceId, params.isExternal);
  }

  function invertSelection() {
    const selectedKeys = new Set(params.getSelectedEntries().map(getEntryKey));
    const nextSelection = params
      .getVisibleEntries()
      .filter((entry) => !selectedKeys.has(getEntryKey(entry)));

    params.selectEntries(nextSelection, params.instanceId, params.isExternal);
  }

  return {
    selectAll,
    selectUnused,
    invertSelection,
  };
}
