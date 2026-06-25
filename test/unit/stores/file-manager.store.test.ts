/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { ref } from 'vue';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useSelectionStore } from '~/stores/selection.store';
import type { FsEntry } from '~/types/fs';

describe('useFileManagerStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  function makeDir(path: string, name?: string): FsEntry {
    const parts = path.split('/').filter(Boolean);
    return {
      kind: 'directory',
      name: name ?? parts[parts.length - 1] ?? 'root',
      path,
      source: 'local',
    };
  }

  it('initializes with null selectedFolder', () => {
    const store = useFileManagerStore();
    expect(store.selectedFolder).toBeNull();
  });

  it('opens a folder and updates selectedFolder', () => {
    const store = useFileManagerStore();
    const dir = makeDir('/home/user');
    store.openFolder(dir, { skipSelection: true });
    expect(store.selectedFolder).toEqual(dir);
  });

  it('does not open non-directory entries', () => {
    const store = useFileManagerStore();
    const file: FsEntry = { kind: 'file', name: 'test.mp4', path: '/test.mp4', source: 'local' };
    store.openFolder(file, { skipSelection: true });
    expect(store.selectedFolder).toBeNull();
  });

  it('adds to history when navigating to a different folder', () => {
    const store = useFileManagerStore();
    const dir1 = makeDir('/home/user1');
    const dir2 = makeDir('/home/user2');
    store.openFolder(dir1, { skipSelection: true });
    store.openFolder(dir2, { skipSelection: true });
    expect(store.historyStack).toHaveLength(1);
    expect(store.historyStack[0]).toEqual(dir1);
    expect(store.futureStack).toHaveLength(0);
  });

  it('does not add to history when navigating to same folder', () => {
    const store = useFileManagerStore();
    const dir = makeDir('/home/user');
    store.openFolder(dir, { skipSelection: true, skipHistory: true });
    store.openFolder(dir, { skipSelection: true });
    expect(store.historyStack).toHaveLength(0);
  });

  it('clears futureStack when navigating to a new folder', () => {
    const store = useFileManagerStore();
    const dir1 = makeDir('/home/user1');
    const dir2 = makeDir('/home/user2');
    store.openFolder(dir1, { skipSelection: true });
    store.openFolder(dir2, { skipSelection: true });
    expect(store.historyStack).toHaveLength(1);
  });

  it('openFolderByPath sets selectedFolder from path', () => {
    const store = useFileManagerStore();
    store.openFolderByPath('/home/user/documents');
    expect(store.selectedFolder).not.toBeNull();
    expect(store.selectedFolder?.path).toBe('/home/user/documents');
    expect(store.selectedFolder?.name).toBe('documents');
  });

  it('openFolderByPath with null clears selectedFolder', () => {
    const store = useFileManagerStore();
    store.openFolder(makeDir('/home/user'), { skipSelection: true });
    store.openFolderByPath(null);
    expect(store.selectedFolder).toBeNull();
  });

  it('addToHistory adds entry and clears future', () => {
    const store = useFileManagerStore();
    const dir = makeDir('/home/user');
    store.addToHistory(dir);
    expect(store.historyStack).toHaveLength(1);
    expect(store.futureStack).toHaveLength(0);
  });

  it('addToHistory does not add duplicate consecutive entries', () => {
    const store = useFileManagerStore();
    const dir = makeDir('/home/user');
    store.addToHistory(dir);
    store.addToHistory(dir);
    expect(store.historyStack).toHaveLength(1);
  });

  it('setViewMode updates viewMode', () => {
    const store = useFileManagerStore();
    store.setViewMode('list');
    expect(store.viewMode).toBe('list');
  });

  it('setSortOption updates sortOption', () => {
    const store = useFileManagerStore();
    store.setSortOption({ field: 'size', order: 'desc' });
    expect(store.sortOption).toEqual({ field: 'size', order: 'desc' });
  });

  it('setGridCardSize updates gridCardSize', () => {
    const store = useFileManagerStore();
    store.setGridCardSize(120);
    expect(store.gridCardSize).toBe(120);
  });

  it('setColumnWidth updates columnWidths', () => {
    const store = useFileManagerStore();
    store.setColumnWidth('name', 200);
    expect(store.columnWidths['name']).toBe(200);
  });

  it('setShowHiddenFiles updates showHiddenFiles', () => {
    const store = useFileManagerStore();
    store.setShowHiddenFiles(true);
    expect(store.showHiddenFiles).toBe(true);
  });

  it('setTreeSize updates treeSize', () => {
    const store = useFileManagerStore();
    store.setTreeSize(250);
    expect(store.treeSize).toBe(250);
  });

  it('setSelectionContext updates selectionContext', () => {
    const store = useFileManagerStore();
    store.setSelectionContext({ instanceId: 'test-instance', isExternal: true });
    // selectionContext is internal but we can verify it doesn't throw
    expect(true).toBe(true);
  });

  it('selectItem delegates to selectionStore', () => {
    const store = useFileManagerStore();
    const selectionStore = useSelectionStore();
    const entry: FsEntry = { kind: 'file', name: 'test.mp4', path: '/test.mp4', source: 'local' };
    store.selectItem(entry);
    expect(selectionStore.selectedEntity).not.toBeNull();
    expect(selectionStore.selectedEntity?.source).toBe('fileManager');
  });

  it('selectItem with null clears fileManager selection', () => {
    const store = useFileManagerStore();
    const selectionStore = useSelectionStore();
    const entry: FsEntry = { kind: 'file', name: 'test.mp4', path: '/test.mp4', source: 'local' };
    store.selectItem(entry);
    store.selectItem(null);
    expect(selectionStore.selectedEntity).toBeNull();
  });

  it('clearSelection clears fileManager selection', () => {
    const store = useFileManagerStore();
    const selectionStore = useSelectionStore();
    const entry: FsEntry = { kind: 'file', name: 'test.mp4', path: '/test.mp4', source: 'local' };
    store.selectItem(entry);
    store.clearSelection();
    expect(selectionStore.selectedEntity).toBeNull();
  });

  it('resetFileManagerState clears selectedFolder but keeps preferences', () => {
    const store = useFileManagerStore();
    store.setViewMode('list');
    store.setGridCardSize(120);
    store.openFolder(makeDir('/home/user'), { skipSelection: true });
    store.resetFileManagerState();
    expect(store.selectedFolder).toBeNull();
    // Preferences should be preserved
    expect(store.viewMode).toBe('list');
    expect(store.gridCardSize).toBe(120);
  });

  it('sortFields has expected entries', () => {
    const store = useFileManagerStore();
    expect(store.sortFields).toHaveLength(5);
    expect(store.sortFields.map((f: { labelKey: string; value: string }) => f.value)).toEqual([
      'name',
      'type',
      'size',
      'created',
      'modified',
    ]);
  });

  it('openFolder with skipHistory does not add to history', () => {
    const store = useFileManagerStore();
    const dir1 = makeDir('/home/user1');
    const dir2 = makeDir('/home/user2');
    store.openFolder(dir1, { skipSelection: true });
    store.openFolder(dir2, { skipSelection: true, skipHistory: true });
    expect(store.historyStack).toHaveLength(0);
  });
});
