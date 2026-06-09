/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { ref } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { createDefaultExportPresets, createDefaultProjectPresets } from '~/utils/settings';
import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from '~/utils/runtime';

vi.mock('~/utils/runtime', () => ({
  isTauriRuntime: vi.fn(() => false),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/api/path', () => ({
  basename: vi.fn().mockImplementation(async (path: string) => path.split('/').pop() || path),
  join: vi.fn().mockImplementation(async (...parts: string[]) => parts.join('/')),
  dirname: vi
    .fn()
    .mockImplementation(async (path: string) => path.split('/').slice(0, -1).join('/')),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn().mockResolvedValue(false),
  mkdir: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  readTextFile: vi.fn().mockResolvedValue('{}'),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('~/stores/workspace/provider/tauri-handle', () => ({
  TauriDirectoryHandle: vi.fn().mockImplementation(function (path: string, name: string) {
    return {
      kind: 'directory',
      path,
      name,
    };
  }),
}));

const mockVfs = {
  writeFile: vi.fn().mockResolvedValue(undefined),
  createDirectory: vi.fn().mockResolvedValue(undefined),
  exists: vi.fn().mockResolvedValue(true),
  readFile: vi.fn().mockResolvedValue(new Blob(['{}'])),
};
vi.mock('~/composables/useVfs', () => ({
  useVfs: () => mockVfs,
}));

vi.mock('~/repositories/project-meta.repository', () => ({
  createProjectMetaRepository: vi.fn(() => ({
    load: vi.fn().mockResolvedValue({ id: '123-uuid', title: 'TestProject' }),
    save: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('~/repositories/project-settings.repository', () => ({
  createProjectSettingsRepository: vi.fn(() => ({
    load: vi.fn().mockResolvedValue({}),
    save: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('~/repositories/project-ui.repository', () => ({
  createProjectUiRepository: vi.fn(() => ({
    load: vi.fn().mockResolvedValue({}),
    save: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('pinia', async (importOriginal) => {
  const mod = await importOriginal<typeof import('pinia')>();
  return {
    ...mod,
    storeToRefs: vi.fn((store: any) => ({
      projectSettings: ref(store.projectSettings),
      isLoadingProjectSettings: ref(store.isLoadingProjectSettings),
      isSavingProjectSettings: ref(store.isSavingProjectSettings),
      activeMonitor: ref(store.activeMonitor),
    })),
  };
});

const { mockFileThumbnailGeneratorReset, mockThumbnailGeneratorReset } = vi.hoisted(() => ({
  mockFileThumbnailGeneratorReset: vi.fn(),
  mockThumbnailGeneratorReset: vi.fn(),
}));

vi.mock('~/utils/file-thumbnail-generator', () => ({
  fileThumbnailGenerator: {
    reset: mockFileThumbnailGeneratorReset,
  },
}));

vi.mock('~/utils/thumbnail-generator', () => ({
  thumbnailGenerator: {
    reset: mockThumbnailGeneratorReset,
  },
}));

const mockResetMediaState = vi.fn();
const mockResetTimelineState = vi.fn();
const mockClearSelection = vi.fn();
const mockResetFileManagerState = vi.fn();
const mockClearHistory = vi.fn();
const mockClearAllHistory = vi.fn();
const mockReleaseLock = vi.fn();
const mockCloseProjectSettings = vi.fn();
const mockLoadProjectSettings = vi.fn();
const mockSaveProjectSettings = vi.fn();
const mockSetContext = vi.fn();
const mockSaveInitialProjectSettingsForNewProject = vi.fn();

vi.mock('~/stores/media.store', () => ({
  useMediaStore: vi.fn(() => ({ resetMediaState: mockResetMediaState })),
}));

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: vi.fn(() => ({ resetTimelineState: mockResetTimelineState })),
}));

vi.mock('~/stores/selection.store', () => ({
  useSelectionStore: vi.fn(() => ({ clearSelection: mockClearSelection })),
}));

vi.mock('~/stores/file-manager.store', () => ({
  useFileManagerStore: vi.fn(() => ({ resetFileManagerState: mockResetFileManagerState })),
}));

vi.mock('~/stores/history.store', () => ({
  useHistoryStore: vi.fn(() => ({ clear: mockClearHistory, clearAll: mockClearAllHistory })),
}));

vi.mock('~/composables/editor/useProjectLock', () => ({
  useProjectLock: vi.fn(() => ({
    acquireLock: vi.fn(),
    stealLock: vi.fn(),
    releaseLock: mockReleaseLock,
    isLockLost: ref(false),
    setOnBeforeRelease: vi.fn(),
  })),
}));

vi.mock('~/stores/project-settings.store', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { reactive } = require('vue');
  const state = reactive({
    projectSettings: {
      project: { orientation: 'landscape', width: 1920, height: 1080, fps: 30 },
      ui: { layout: null },
      monitors: {},
      timelines: { openPaths: [], sessions: {} },
      timeline: {},
    },
    isLoadingProjectSettings: false,
    isSavingProjectSettings: false,
    activeMonitor: null,
  });
  return {
    useProjectSettingsStore: vi.fn(() => ({
      ...state,
      $state: state,
      closeProjectSettings: mockCloseProjectSettings,
      loadProjectSettings: mockLoadProjectSettings,
      saveProjectSettings: mockSaveProjectSettings,
      setContext: mockSetContext,
      saveInitialProjectSettingsForNewProject: mockSaveInitialProjectSettingsForNewProject,
      restoreFileManagerFolders: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

const workspaceMock = {
  projectsHandle: null,
  projects: [] as string[],
  error: null as string | null,
  lastProjectName: null,
  userSettings: {
    projectDefaults: { audioDeclickDurationUs: 5000, defaultAudioFadeCurve: 'logarithmic' },
    projectPresets: createDefaultProjectPresets(),
    exportPresets: createDefaultExportPresets(),
    optimization: { proxyConcurrency: 2 },
    timeline: { defaultStaticClipDurationUs: 5000000, snapThresholdPx: 8 },
  },
  workspaceState: { fileBrowser: { instances: {} } },
  resolvedStorageTopology: {
    projectsRoot: '/mock-projects',
    tempRoot: '/mock-temp',
    proxiesRoot: '/mock-proxies',
    ephemeralTmpRoot: '/mock-ephemeral-tmp',
    commonRoot: '/mock-common',
    dataRoot: '/mock-data',
  },
  batchUpdateWorkspaceState: vi.fn(),
  loadProjects: vi.fn(),
  updateRecentProject: vi.fn(),
  deleteProject: vi.fn(),
  isLoading: false,
};

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(() => workspaceMock),
}));

describe('ProjectStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    workspaceMock.projectsHandle = null;
    workspaceMock.projects = [];
    workspaceMock.error = null;
  });

  it('initializes with empty state', () => {
    const store = useProjectStore();
    expect(store.currentProjectName).toBeNull();
    expect(store.currentProjectId).toBeNull();
    expect(store.currentTimelinePath).toBeNull();
  });

  it('closeProject resets current project state and dependent stores', () => {
    const store = useProjectStore();
    store.currentProjectName = 'test-project';
    store.currentProjectId = '123';
    store.currentTimelinePath = '/some/path.otio';

    store.closeProject();

    expect(store.currentProjectName).toBeNull();
    expect(store.currentProjectId).toBeNull();
    expect(store.currentTimelinePath).toBeNull();
    expect(mockCloseProjectSettings).toHaveBeenCalled();
    expect(mockResetMediaState).toHaveBeenCalled();
    expect(mockResetTimelineState).toHaveBeenCalled();
    expect(mockClearSelection).toHaveBeenCalled();
    expect(mockResetFileManagerState).toHaveBeenCalled();
    expect(mockClearAllHistory).toHaveBeenCalled();
    expect(mockFileThumbnailGeneratorReset).toHaveBeenCalled();
    expect(mockThumbnailGeneratorReset).toHaveBeenCalled();
    expect(mockReleaseLock).toHaveBeenCalled();
  });

  it('createProject sets error when workspace is not initialized', async () => {
    const store = useProjectStore();
    const workspace = useWorkspaceStore();
    workspace.projectsHandle = null;
    workspace.projects = [];

    await store.createProject('NewProject');

    expect(workspace.error).toBe('Workspace not initialized');
  });

  it('createProject sets error when project already exists', async () => {
    const store = useProjectStore();
    const workspace = useWorkspaceStore();
    workspace.projectsHandle = {} as any;
    workspace.projects = ['ExistingProject'];

    await store.createProject('ExistingProject');

    expect(workspace.error).toBe('Project already exists');
  });

  it('openProject sets error when project is not found', async () => {
    const store = useProjectStore();
    const workspace = useWorkspaceStore();
    workspace.projects = ['OtherProject'];

    await store.openProject('MissingProject');

    expect(workspace.error).toBe('Project not found');
  });

  it('openProject with absolute path in Tauri environment calls allow_path_scope', async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);

    const store = useProjectStore();
    const workspace = useWorkspaceStore();
    workspace.projects = [];

    const absolutePath = '/custom/path/MyExternalProject';
    await store.openProject(absolutePath);

    expect(invoke).toHaveBeenCalledWith('allow_path_scope', { path: absolutePath });
    expect(store.currentProjectName).toBe('MyExternalProject');
    expect(workspace.error).toBeNull();
    const dirHandle = await store.getProjectDirHandle();
    expect(dirHandle).not.toBeNull();
    expect(dirHandle?.name).toBe('MyExternalProject');
    expect((dirHandle as any).path).toBe(absolutePath);
  });

  it('createProject in non-standard folder under Tauri environment calls allow_path_scope for parent', async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(true);

    const store = useProjectStore();
    const workspace = useWorkspaceStore();
    workspace.projectsHandle = {} as any;

    const customParentPath = '/custom/parent/path';
    await store.createProject('MyExternalProject', { parentPath: customParentPath });

    expect(invoke).toHaveBeenCalledWith('allow_path_scope', { path: customParentPath });
    expect(store.currentProjectName).toBe('MyExternalProject');
    expect(workspace.error).toBeNull();
    const dirHandle = await store.getProjectDirHandle();
    expect(dirHandle).not.toBeNull();
    expect(dirHandle?.name).toBe('MyExternalProject');
    expect((dirHandle as any).path).toBe('/custom/parent/path/MyExternalProject');
  });

  it('aborts openProject if closeProject is called while it is loading', async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(false);
    const store = useProjectStore();
    const workspace = useWorkspaceStore();
    workspace.projects = ['TestProject'];

    let resolveSettings: (val: any) => void = () => {};
    const settingsPromise = new Promise((resolve) => {
      resolveSettings = resolve;
    });
    mockLoadProjectSettings.mockReturnValue(settingsPromise);

    const openPromise = store.openProject('TestProject');

    expect(store.currentProjectName).toBe('TestProject');

    await store.closeProject();

    expect(store.currentProjectName).toBeNull();

    resolveSettings({});
    await openPromise;

    expect(store.currentProjectName).toBeNull();
  });
});
