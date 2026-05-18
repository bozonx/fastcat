/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { ref } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { createDefaultExportPresets, createDefaultProjectPresets } from '~/utils/settings';

const mockResetMediaState = vi.fn();
const mockResetTimelineState = vi.fn();
const mockClearSelection = vi.fn();
const mockResetFileManagerState = vi.fn();
const mockClearHistory = vi.fn();
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
  useHistoryStore: vi.fn(() => ({ clear: mockClearHistory })),
}));

vi.mock('~/composables/editor/useProjectLock', () => ({
  useProjectLock: vi.fn(() => ({
    acquireLock: vi.fn(),
    stealLock: vi.fn(),
    releaseLock: mockReleaseLock,
    isLockLost: ref(false),
  })),
}));

vi.mock('~/stores/project-settings.store', () => ({
  useProjectSettingsStore: vi.fn(() => ({
    get projectSettings() {
      return {
        project: { orientation: 'landscape', width: 1920, height: 1080, fps: 30 },
        ui: { layout: null },
        monitors: {},
        timelines: { openPaths: [], sessions: {} },
        timeline: {},
      };
    },
    isLoadingProjectSettings: false,
    isSavingProjectSettings: false,
    activeMonitor: null,
    closeProjectSettings: mockCloseProjectSettings,
    loadProjectSettings: mockLoadProjectSettings,
    saveProjectSettings: mockSaveProjectSettings,
    setContext: mockSetContext,
    saveInitialProjectSettingsForNewProject: mockSaveInitialProjectSettingsForNewProject,
  })),
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(() => ({
    projectsHandle: null,
    projects: [],
    error: null,
    lastProjectName: null,
    userSettings: {
      projectDefaults: { audioDeclickDurationUs: 5000, defaultAudioFadeCurve: 'logarithmic' },
      projectPresets: createDefaultProjectPresets(),
      exportPresets: createDefaultExportPresets(),
      optimization: { proxyConcurrency: 2 },
      timeline: { defaultStaticClipDurationUs: 5000000, snapThresholdPx: 8 },
    },
    workspaceState: {
      fileBrowser: {
        instances: {},
      },
    },
    batchUpdateWorkspaceState: vi.fn(),
    loadProjects: vi.fn(),
    updateRecentProject: vi.fn(),
    deleteProject: vi.fn(),
    isLoading: false,
  })),
}));

describe('ProjectStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
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
    expect(mockClearHistory).toHaveBeenCalledWith('timeline');
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
});
