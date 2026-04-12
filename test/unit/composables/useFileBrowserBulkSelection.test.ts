import { describe, expect, it, vi } from 'vitest';
import { useFileBrowserBulkSelection } from '~/composables/file-manager/useFileBrowserBulkSelection';
import type { FsEntry } from '~/types/fs';

function createEntry(path: string): FsEntry {
  return {
    kind: 'file',
    name: path.split('/').pop() ?? path,
    path,
  };
}

describe('useFileBrowserBulkSelection', () => {
  it('selects all visible entries and clears selection when all are already selected', () => {
    const entries = [createEntry('a.mp4'), createEntry('b.mp4')];
    const selectEntries = vi.fn();
    const clearSelection = vi.fn();

    const bulkSelection = useFileBrowserBulkSelection({
      getVisibleEntries: () => entries,
      getSelectedEntries: () => [entries[0]!],
      selectEntries,
      clearSelection,
      getUsedPaths: () => new Set(),
      instanceId: 'left',
      isExternal: false,
    });

    bulkSelection.selectAll();
    expect(selectEntries).toHaveBeenCalledWith(entries, 'left', false);

    selectEntries.mockClear();

    const toggleSelection = useFileBrowserBulkSelection({
      getVisibleEntries: () => entries,
      getSelectedEntries: () => entries,
      selectEntries,
      clearSelection,
      getUsedPaths: () => new Set(),
      instanceId: 'left',
      isExternal: false,
    });

    toggleSelection.selectAll();
    expect(clearSelection).toHaveBeenCalled();
    expect(selectEntries).not.toHaveBeenCalled();
  });

  it('selects only unused files after refreshing usage', async () => {
    const entries = [
      createEntry('used.mp4'),
      createEntry('unused.mp4'),
      {
        kind: 'directory',
        name: 'folder',
        path: 'folder',
      } as FsEntry,
    ];
    const refreshUsage = vi.fn(async () => {});
    const selectEntries = vi.fn();

    const bulkSelection = useFileBrowserBulkSelection({
      getVisibleEntries: () => entries,
      getSelectedEntries: () => [],
      selectEntries,
      clearSelection: vi.fn(),
      getUsedPaths: () => new Set(['used.mp4']),
      refreshUsage,
    });

    await bulkSelection.selectUnused();

    expect(refreshUsage).toHaveBeenCalled();
    expect(selectEntries).toHaveBeenCalledWith([entries[1]], undefined, undefined);
  });

  it('inverts current selection within visible entries', () => {
    const entries = [createEntry('a.mp4'), createEntry('b.mp4'), createEntry('c.mp4')];
    const selectEntries = vi.fn();

    const bulkSelection = useFileBrowserBulkSelection({
      getVisibleEntries: () => entries,
      getSelectedEntries: () => [entries[0]!, entries[2]!],
      selectEntries,
      clearSelection: vi.fn(),
      getUsedPaths: () => new Set(),
    });

    bulkSelection.invertSelection();

    expect(selectEntries).toHaveBeenCalledWith([entries[1]], undefined, undefined);
  });
});
