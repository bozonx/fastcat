/** @vitest-environment node */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { InMemoryFileSystemAdapter } from '~/file-manager/core/vfs/adapters/InMemoryFileSystemAdapter';
import { readDir, exists } from '@tauri-apps/plugin-fs';

vi.unmock('~/stores/workspace.store');

// Project list/delete/rename go through the application VFS (`@project/<name>`).
let mockVfs: InMemoryFileSystemAdapter;
vi.mock('~/composables/useVfs', () => ({
  useVfs: () => mockVfs,
}));
// Mock tauri-media-processing
const mockNativeUpdateFfmpegSettings = vi.fn().mockResolvedValue(undefined);
vi.mock('~/utils/tauri-media-processing', () => ({
  nativeUpdateFfmpegSettings: (...args: any[]) => mockNativeUpdateFfmpegSettings(...args),
}));

vi.mock('@tauri-apps/api/path', () => ({
  join: async (...args: string[]) => args.join('/'),
  resolve: async (path: string) => path,
  dirname: async (path: string) => path.split('/').slice(0, -1).join('/') || '/',
  basename: async (path: string) => path.split('/').pop() ?? path,
  appConfigDir: async () => '/mock/config',
  appDataDir: async () => '/mock/data',
  appCacheDir: async () => '/mock/cache',
  tempDir: async () => '/mock/temp',
  documentDir: async () => '/mock/documents',
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readDir: vi.fn(),
  exists: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
  mkdir: vi.fn(),
  copyFile: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

describe('WorkspaceStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    localStorage.clear();
    mockVfs = new InMemoryFileSystemAdapter();
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

    it('preserves tauri projectPath when updating an existing project by id', () => {
      const store = useWorkspaceStore();
      store.updateRecentProject({
        projectName: 'same-name',
        projectId: 'id-1',
        projectPath: '/projects/a/same-name',
      });

      store.updateRecentProject({
        projectName: 'same-name',
        projectId: 'id-1',
        lastTimelinePath: 'timelines/main.otio',
      });

      expect(store.recentProjects).toHaveLength(1);
      expect(store.recentProjects[0]).toMatchObject({
        projectName: 'same-name',
        projectId: 'id-1',
        projectPath: '/projects/a/same-name',
        lastTimelinePath: 'timelines/main.otio',
      });
    });

    it('keeps tauri projects with the same name separate when paths differ', () => {
      const store = useWorkspaceStore();
      store.updateRecentProject({
        projectName: 'duplicate',
        projectId: 'id-1',
        projectPath: '/projects/a/duplicate',
      });
      store.updateRecentProject({
        projectName: 'duplicate',
        projectId: 'id-2',
        projectPath: '/projects/b/duplicate',
      });

      expect(store.recentProjects).toHaveLength(2);
      expect(store.recentProjects.map((project) => project.projectPath)).toEqual([
        '/projects/b/duplicate',
        '/projects/a/duplicate',
      ]);
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

      await mockVfs.createDirectory('@project/p1');
      await mockVfs.createDirectory('@project/p2');
      store.projectsHandle = { name: 'projects' } as any;
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

      await mockVfs.createDirectory('@project/old-name');
      store.projectsHandle = { name: 'projects' } as any;

      await store.renameProject('old-name', 'new-name');

      expect(store.recentProjects[0].projectName).toBe('new-name');
      expect(store.lastProjectName).toBe('new-name');
    });
  });

  describe('duplicateProject', () => {
    it('copies project and generates a new projectId', async () => {
      const store = useWorkspaceStore();
      store.recentProjects = [
        { projectName: 'source', projectId: 'original-id', updatedAt: '2024-01-01' },
      ];
      store.projects = ['source'];

      await mockVfs.createDirectory('@project/source');
      await mockVfs.createDirectory('@project/source/.fastcat');
      await mockVfs.writeFile(
        '@project/source/.fastcat/project.meta.json',
        JSON.stringify({ id: 'original-id', version: 1 }),
      );
      await mockVfs.createDirectory('@project/source/timelines');
      await mockVfs.writeFile('@project/source/timelines/main.otio', '{"tracks":[]}');
      store.projectsHandle = { name: 'projects' } as any;

      await store.duplicateProject({ sourceName: 'source', targetName: 'copy' });

      expect(store.projects).toContain('copy');
      expect(store.recentProjects).toHaveLength(2);
      const copied = store.recentProjects.find(
        (p: { projectName: string; projectId: string }) => p.projectName === 'copy',
      );
      expect(copied).toBeDefined();
      expect(copied!.projectId).not.toBe('original-id');

      const metaBlob = await mockVfs.readFile('@project/copy/.fastcat/project.meta.json');
      const meta = JSON.parse(await metaBlob.text());
      expect(meta.id).toBe(copied!.projectId);

      const mainExists = await mockVfs.exists('@project/copy/timelines/main.otio');
      expect(mainExists).toBe(true);
    });

    it('skips backups and autosave folders', async () => {
      const store = useWorkspaceStore();
      store.projects = ['source'];

      await mockVfs.createDirectory('@project/source');
      await mockVfs.createDirectory('@project/source/.fastcat');
      await mockVfs.createDirectory('@project/source/.fastcat/backups');
      await mockVfs.createDirectory('@project/source/.fastcat/autosave');
      await mockVfs.writeFile(
        '@project/source/.fastcat/project.meta.json',
        JSON.stringify({ id: 'original-id', version: 1 }),
      );
      store.projectsHandle = { name: 'projects' } as any;

      await store.duplicateProject({ sourceName: 'source', targetName: 'copy' });

      expect(await mockVfs.exists('@project/copy/.fastcat/backups')).toBe(false);
      expect(await mockVfs.exists('@project/copy/.fastcat/autosave')).toBe(false);
    });
  });

  describe('recentProjects filtering of non-existent projects', () => {
    it('does not filter if workspaceHandle is null', async () => {
      const store = useWorkspaceStore();
      store.workspaceHandle = null;
      store.projects = [];
      store.recentProjects = [{ projectName: 'p1', projectId: 'id1', updatedAt: '2024-01-01' }];
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

  describe('Tauri mode sync', () => {
    let originalTauriInternals: any;

    beforeEach(() => {
      originalTauriInternals = (window as any).__TAURI_INTERNALS__;
      (window as any).__TAURI_INTERNALS__ = {};
    });

    afterEach(() => {
      if (originalTauriInternals === undefined) {
        delete (window as any).__TAURI_INTERNALS__;
      } else {
        (window as any).__TAURI_INTERNALS__ = originalTauriInternals;
      }
    });

    it('synchronizes projects list with recent projects names in tauri mode', async () => {
      const store = useWorkspaceStore();

      store.recentProjects = [
        {
          projectName: 'tauri-p1',
          projectId: 'id1',
          updatedAt: '2024-01-01',
          projectPath: '/path/to/tauri-p1',
        },
        {
          projectName: 'tauri-p2',
          projectId: 'id2',
          updatedAt: '2024-01-02',
          projectPath: '/path/to/tauri-p2',
        },
      ];

      await nextTick();

      expect(store.projects).toEqual(['tauri-p1', 'tauri-p2']);
    });

    it('scans projectsRoot and merges with recentProjects in tauri mode', async () => {
      const store = useWorkspaceStore();
      await nextTick();
      const projectsRoot = store.resolvedStorageTopology.projectsRoot;

      store.recentProjects = [
        {
          projectName: 'recent-only',
          projectId: 'id1',
          updatedAt: '2024-01-01',
          projectPath: '/custom/recent-only',
        },
      ];

      (readDir as ReturnType<typeof vi.fn>).mockResolvedValue([
        { name: 'disk-only', isDirectory: true, isFile: false, isSymlink: false },
        { name: 'recent-only', isDirectory: true, isFile: false, isSymlink: false },
      ]);

      await store.loadProjects();

      expect(store.projects).toEqual(['disk-only', 'recent-only']);
      expect(readDir).toHaveBeenCalledWith(store.resolvedStorageTopology.projectsRoot);
    });

    it('falls back to default projectsRoot when custom root is not set in tauri mode', async () => {
      const store = useWorkspaceStore();
      await nextTick();

      store.recentProjects = [];

      (readDir as ReturnType<typeof vi.fn>).mockResolvedValue([
        { name: 'default-project', isDirectory: true, isFile: false, isSymlink: false },
      ]);

      await store.loadProjects();

      expect(store.projects).toEqual(['default-project']);
      expect(readDir).toHaveBeenCalledWith('/mock/documents/FastCat/projects');
    });

    it('sets error when deleting a tauri project with unknown path and missing fallback', async () => {
      const store = useWorkspaceStore();
      store.resolvedStorageTopology.projectsRoot = '/mock/projects';
      store.recentProjects = [];

      (exists as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      await store.deleteProject('missing-project');

      expect(store.error).toBe('Cannot resolve project path for "missing-project"');
    });

    it('sets error when renaming a tauri project with unknown path and missing fallback', async () => {
      const store = useWorkspaceStore();
      store.resolvedStorageTopology.projectsRoot = '/mock/projects';
      store.recentProjects = [];

      (exists as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      await store.renameProject('missing-project', 'new-name');

      expect(store.error).toBe('Cannot resolve project path for "missing-project"');
    });

    it('sets error when duplicating a tauri project with unknown path and missing fallback', async () => {
      const store = useWorkspaceStore();
      store.resolvedStorageTopology.projectsRoot = '/mock/projects';
      store.recentProjects = [];

      (exists as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      await store.duplicateProject({ sourceName: 'missing-project', targetName: 'copy' });

      expect(store.error).toBe('Cannot resolve project path for "missing-project"');
    });
  });

  describe('lastProjectPath', () => {
    it('initializes from localStorage', () => {
      localStorage.setItem('fastcat_last_project_path', '/custom/my-project');
      setActivePinia(createPinia());
      const store = useWorkspaceStore();
      expect(store.lastProjectPath).toBe('/custom/my-project');
    });

    it('is set by updateRecentProject', () => {
      const store = useWorkspaceStore();
      store.updateRecentProject({
        projectName: 'my-project',
        projectId: 'id-1',
        projectPath: '/custom/my-project',
      });
      expect(store.lastProjectPath).toBe('/custom/my-project');
    });

    it('persists to localStorage', async () => {
      const store = useWorkspaceStore();
      store.updateRecentProject({
        projectName: 'my-project',
        projectId: 'id-1',
        projectPath: '/custom/my-project',
      });
      await nextTick();
      expect(localStorage.getItem('fastcat_last_project_path')).toBe('/custom/my-project');
    });

    it('is cleared by resetWorkspace', () => {
      const store = useWorkspaceStore();
      store.lastProjectPath = '/custom/my-project';
      store.resetWorkspace();
      expect(store.lastProjectPath).toBeNull();
      expect(localStorage.getItem('fastcat_last_project_path')).toBeNull();
    });
  });

  describe('ffmpeg settings synchronization', () => {
    let originalTauriInternals: any;

    beforeEach(() => {
      originalTauriInternals = (window as any).__TAURI_INTERNALS__;
      (window as any).__TAURI_INTERNALS__ = {};
      vi.clearAllMocks();
    });

    afterEach(() => {
      if (originalTauriInternals === undefined) {
        delete (window as any).__TAURI_INTERNALS__;
      } else {
        (window as any).__TAURI_INTERNALS__ = originalTauriInternals;
      }
    });

    it('sends hardwareAccelerationMode as auto when experimentalFeatures is false', async () => {
      const store = useWorkspaceStore();

      await mockVfs.writeFile(
        '@config/user.settings.json',
        JSON.stringify({
          experimentalFeatures: false,
          optimization: {
            hardwareAccelerationMode: 'nvdec',
          },
        }),
      );

      const mockDirectoryHandle = {
        getDirectoryHandle: vi.fn().mockResolvedValue({}),
        name: 'root',
        kind: 'directory',
      } as any;

      // setupWorkspace triggers syncFfmpegSettingsToNative
      await store.setupWorkspace(mockDirectoryHandle);

      expect(mockNativeUpdateFfmpegSettings).toHaveBeenCalledWith(expect.objectContaining({
        hardwareAccelerationMode: 'auto',
      }));
    });

    it('sends hardwareAccelerationMode as custom mode when experimentalFeatures is true', async () => {
      const store = useWorkspaceStore();

      await mockVfs.writeFile(
        '@config/user.settings.json',
        JSON.stringify({
          experimentalFeatures: true,
          optimization: {
            hardwareAccelerationMode: 'nvdec',
          },
        }),
      );

      const mockDirectoryHandle = {
        getDirectoryHandle: vi.fn().mockResolvedValue({}),
        name: 'root',
        kind: 'directory',
      } as any;

      await store.setupWorkspace(mockDirectoryHandle);

      expect(mockNativeUpdateFfmpegSettings).toHaveBeenCalledWith(expect.objectContaining({
        hardwareAccelerationMode: 'nvdec',
      }));
    });
  });
});
