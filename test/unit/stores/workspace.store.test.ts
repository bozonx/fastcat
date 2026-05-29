/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';

vi.unmock('~/stores/workspace.store');

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

  it('updates lastProjectName in workspace state', async () => {
    const store = useWorkspaceStore();
    store.lastProjectName = 'test-project';
    await nextTick();
    expect(store.workspaceState.ui.lastProjectName).toBe('test-project');
    expect(localStorage.getItem('fastcat:workspace:last-opened-project')).toBeNull();
    expect(localStorage.getItem('fastcat-editor-last-opened-project')).toBeNull();

    store.lastProjectName = null;
    await nextTick();
    expect(store.workspaceState.ui.lastProjectName).toBeNull();
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

  describe('updateRecentProject', () => {
    it('adds project to the top and limits to 5', () => {
      const store = useWorkspaceStore();
      for (let i = 1; i <= 6; i++) {
        store.updateRecentProject({ projectName: `project-${i}`, projectId: `id-${i}` });
      }
      expect(store.recentProjects).toHaveLength(5);
      expect(store.recentProjects[0].projectName).toBe('project-6');
      expect(store.recentProjects[4].projectName).toBe('project-2');
    });

    it('moves existing project to the top and updates timestamp', () => {
      vi.useFakeTimers();
      const store = useWorkspaceStore();
      store.updateRecentProject({ projectName: 'a', projectId: 'id-a' });
      const firstDate = store.recentProjects[0].updatedAt;

      vi.advanceTimersByTime(1000);
      store.updateRecentProject({ projectName: 'b', projectId: 'id-b' });
      vi.advanceTimersByTime(1000);
      store.updateRecentProject({ projectName: 'a', projectId: 'id-a' });

      expect(store.recentProjects[0].projectName).toBe('a');
      expect(store.recentProjects[1].projectName).toBe('b');
      expect(store.recentProjects[0].updatedAt).not.toBe(firstDate);
      vi.useRealTimers();
    });

    it('sets lastProjectName', () => {
      const store = useWorkspaceStore();
      store.updateRecentProject({ projectName: 'my-project', projectId: 'id-1' });
      expect(store.lastProjectName).toBe('my-project');
    });

    it('syncs to workspaceState.ui.recentProjects', async () => {
      const store = useWorkspaceStore();
      store.updateRecentProject({ projectName: 'sync-test', projectId: 'id-1' });
      await nextTick();
      expect(store.workspaceState.ui.recentProjects).toHaveLength(1);
      expect(store.workspaceState.ui.recentProjects[0].projectName).toBe('sync-test');
    });
  });

  describe('deleteProject', () => {
    it('removes project from recentProjects', async () => {
      const store = useWorkspaceStore();
      store.recentProjects = [
        { projectName: 'p1', projectId: 'id1', updatedAt: '2024-01-01' },
        { projectName: 'p2', projectId: 'id2', updatedAt: '2024-01-02' },
      ];
      store.projects = ['p1', 'p2'];
      store.lastProjectName = 'p1';

      const mockProjectsHandle = {
        removeEntry: vi.fn().mockResolvedValue(undefined),
        values: vi.fn().mockImplementation(async function* () {
          yield { name: 'p2', kind: 'directory', name: 'p2' } as any;
        }),
      };
      store.projectsHandle = mockProjectsHandle as any;
      store.workspaceHandle = { name: 'root' } as any;

      await store.deleteProject('p1');

      expect(store.recentProjects).toHaveLength(1);
      expect(store.recentProjects[0].projectName).toBe('p2');
      expect(store.lastProjectName).toBeNull();
    });
  });

  describe('renameProject', () => {
    it('updates project name in recentProjects', async () => {
      const store = useWorkspaceStore();
      store.recentProjects = [
        { projectName: 'old-name', projectId: 'id1', updatedAt: '2024-01-01' },
      ];
      store.projects = ['old-name'];
      store.lastProjectName = 'old-name';

      const mockOldHandle = {
        move: vi.fn().mockResolvedValue(undefined),
      };
      const mockProjectsHandle = {
        getDirectoryHandle: vi.fn().mockResolvedValue(mockOldHandle),
        values: vi.fn().mockReturnValue([]),
      };
      store.projectsHandle = mockProjectsHandle as any;

      await store.renameProject('old-name', 'new-name');

      expect(store.recentProjects[0].projectName).toBe('new-name');
      expect(store.lastProjectName).toBe('new-name');
    });
  });

  describe('recentProjects filtering of non-existent projects', () => {
    it('does not filter if workspaceHandle is null', async () => {
      const store = useWorkspaceStore();
      store.workspaceHandle = null;
      store.projects = [];
      store.recentProjects = [
        { projectName: 'p1', projectId: 'id1', updatedAt: '2024-01-01' },
      ];
      await nextTick();
      expect(store.recentProjects).toHaveLength(1);
    });

    it('filters out recent projects that do not exist physically when workspace is active', async () => {
      const store = useWorkspaceStore();
      store.workspaceHandle = { name: 'root' } as any;
      store.projects = ['p2'];
      store.recentProjects = [
        { projectName: 'p1', projectId: 'id1', updatedAt: '2024-01-01' },
        { projectName: 'p2', projectId: 'id2', updatedAt: '2024-01-02' },
      ];
      await nextTick();
      expect(store.recentProjects).toHaveLength(1);
      expect(store.recentProjects[0].projectName).toBe('p2');
    });
  });
});
