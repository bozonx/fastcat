import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import { useWorkspaceStore } from '../../../src/stores/workspace.store';

vi.mock('~/utils/indexedDB', () => ({
  saveWorkspaceHandleToIndexedDB: vi.fn().mockResolvedValue(undefined),
  getWorkspaceHandleFromIndexedDB: vi.fn().mockResolvedValue(null),
  clearWorkspaceHandleFromIndexedDB: vi.fn().mockResolvedValue(undefined),
}));

describe('WorkspaceStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('initializes with default settings', () => {
    const store = useWorkspaceStore();
    expect(store.workspaceHandle).toBeNull();
    expect(store.projects).toEqual([]);
    expect(store.userSettings.projectDefaults.width).toBe(1920);
    expect(store.userSettings.exportDefaults.encoding.format).toBe('mp4');
  });

  it('updates lastProjectName in localStorage', async () => {
    const store = useWorkspaceStore();
    store.lastProjectName = 'test-project';
    await nextTick();
    expect(localStorage.getItem('gran-editor-last-project')).toBe('test-project');

    store.lastProjectName = null;
    await nextTick();
    expect(localStorage.getItem('gran-editor-last-project')).toBeNull();
  });

  it('resets workspace state', () => {
    const store = useWorkspaceStore();
    store.projects = ['p1', 'p2'];
    store.error = 'some error';

    store.resetWorkspace();

    expect(store.workspaceHandle).toBeNull();
    expect(store.projects).toEqual([]);
    expect(store.error).toBeNull();
  });

  it('setupWorkspace creates required directories', async () => {
    const store = useWorkspaceStore();

    const mockDirectoryHandle = {
      getDirectoryHandle: vi.fn().mockResolvedValue({}),
      name: 'root',
      kind: 'directory',
    } as any;

    await store.setupWorkspace(mockDirectoryHandle);

    expect(mockDirectoryHandle.getDirectoryHandle).toHaveBeenCalledWith('projects', {
      create: true,
    });
    expect(mockDirectoryHandle.getDirectoryHandle).toHaveBeenCalledWith('vardata', {
      create: true,
    });
    expect(store.workspaceHandle).toStrictEqual(mockDirectoryHandle);
  });
});
