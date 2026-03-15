import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import { useWorkspaceStore } from '../../../src/stores/workspace.store';

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
    expect(store.userSettings.projectPresets.items[0]?.width).toBe(1920);
    expect(store.userSettings.exportPresets.items[0]?.format).toBe('mkv');
  });

  it('updates lastProjectName in localStorage', async () => {
    const store = useWorkspaceStore();
    store.lastProjectName = 'test-project';
    await nextTick();
    expect(localStorage.getItem('fastcat:workspace:last-opened-project')).toBe('test-project');
    expect(localStorage.getItem('fastcat-editor-last-opened-project')).toBeNull();

    store.lastProjectName = null;
    await nextTick();
    expect(localStorage.getItem('fastcat:workspace:last-opened-project')).toBeNull();
    expect(localStorage.getItem('fastcat-editor-last-opened-project')).toBeNull();
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
    expect(mockDirectoryHandle.getDirectoryHandle).toHaveBeenCalledWith('common', {
      create: true,
    });
    expect(mockDirectoryHandle.getDirectoryHandle).toHaveBeenCalledWith('vardata', {
      create: true,
    });
    expect(store.workspaceHandle).toStrictEqual(mockDirectoryHandle);
  });
});
