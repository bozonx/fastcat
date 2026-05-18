/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useProjectSettingsStore } from '~/stores/project-settings.store';

import { getPlatformSuffix } from '~/stores/ui/uiLocalStorage';

const defaultSettings = {
  version: 1,
  project: { width: 1920, height: 1080, fps: 30 },
  exportDefaults: { encoding: { format: 'mp4' } },
  monitors: {
    cut: {
      previewResolution: 0.5,
      useProxy: true,
      previewEffectsEnabled: true,
      panX: 0,
      panY: 0,
      zoom: 1,
      showGrid: false,
      showTimecode: true,
      toolbarPosition: 'bottom' as const,
    },
    sound: {
      previewResolution: 0.5,
      useProxy: true,
      previewEffectsEnabled: true,
      panX: 0,
      panY: 0,
      zoom: 1,
      showGrid: false,
      showTimecode: true,
      toolbarPosition: 'bottom' as const,
    },
    export: {
      previewResolution: 0.5,
      useProxy: true,
      previewEffectsEnabled: true,
      panX: 0,
      panY: 0,
      zoom: 1,
      showGrid: false,
      showTimecode: true,
      toolbarPosition: 'bottom' as const,
    },
  },
  timelines: { openPaths: [], sessions: {} },
  transitions: { defaultDurationUs: 2_000_000 },
  ui: {
    activeTabId: null,
    fileTabs: [],
    staticTabsOrder: [],
    fileManagerPaths: {},
    fileTreeExpandedPaths: [],
    layout: {
      cutPanels: null,
      soundPanels: null,
      splitSizes: {},
      verticalSplitSizes: {},
      timelineHeights: {},
    },
  },
  timeline: {
    frameSnapMode: 'frames' as const,
    clipSnapMode: 'clips' as const,
    toolbarSnapMode: 'snap' as const,
    toolbarDragMode: 'pseudo_overlap' as const,
    toolbarDragModeEnabled: false,
  },
};

const workspaceMock = {
  projectsHandle: {} as any,
  userSettings: {},
};

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(() => workspaceMock),
}));

vi.mock('~/utils/project-settings', () => {
  const dm = {
    previewResolution: 0.5,
    useProxy: true,
    previewEffectsEnabled: true,
    panX: 0,
    panY: 0,
    zoom: 1,
    showGrid: false,
    showTimecode: true,
    toolbarPosition: 'bottom',
  };
  return {
    createDefaultProjectSettings: vi.fn(() => ({
      version: 1,
      project: { width: 1920, height: 1080, fps: 30 },
      exportDefaults: { encoding: { format: 'mp4' } },
      monitors: { cut: { ...dm }, sound: { ...dm }, export: { ...dm } },
      timelines: { openPaths: [], sessions: {} },
      transitions: { defaultDurationUs: 2_000_000 },
      ui: {
        activeTabId: null,
        fileTabs: [],
        staticTabsOrder: [],
        fileManagerPaths: {},
        fileTreeExpandedPaths: [],
        layout: {
          cutPanels: null,
          soundPanels: null,
          splitSizes: {},
          verticalSplitSizes: {},
          timelineHeights: {},
        },
      },
      timeline: {
        frameSnapMode: 'frames',
        clipSnapMode: 'clips',
        toolbarSnapMode: 'snap',
        toolbarDragMode: 'pseudo_overlap',
        toolbarDragModeEnabled: false,
      },
    })),
    normalizeProjectSettings: vi.fn((raw: any) => raw),
    DEFAULT_MONITOR_SETTINGS: { ...dm },
  };
});

vi.mock('~/stores/ui/uiLocalStorage', () => ({
  getPlatformSuffix: vi.fn(() => ''),
}));

vi.mock('~/repositories/project-settings.repository', () => ({
  createProjectSettingsRepository: vi.fn(() => ({
    load: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('~/repositories/project-ui.repository', () => ({
  createProjectUiRepository: vi.fn(() => ({
    load: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('~/utils/auto-save', () => ({
  createAutoSave: vi.fn(() => ({
    markDirty: vi.fn(),
    markCleanForCurrentRevision: vi.fn(),
    reset: vi.fn(),
    requestSave: vi.fn().mockResolvedValue(undefined),
    isDirty: vi.fn().mockReturnValue(false),
  })),
}));

const focusStoreMock = { activeTimelinePath: null };
const projectTabsStoreMock = {
  setTabsState: vi.fn(),
  activeTabId: null,
  fileTabs: [],
  staticTabsOrder: [],
};
const timelineStoreMock = {
  currentTime: 0,
  masterGain: 1,
  audioMuted: false,
  timelineZoom: 50,
  trackHeights: {},
  selectionRange: null,
};
const timelineSettingsStoreMock = {
  frameSnapMode: 'frames',
  clipSnapMode: 'clips',
  toolbarSnapMode: 'snap',
  toolbarDragMode: 'pseudo_overlap',
  toolbarDragModeEnabled: false,
};
const fileManagerStoreMock = { selectedFolder: null, openFolderByPath: vi.fn() };

vi.mock('~/stores/focus.store', () => ({
  useFocusStore: vi.fn(() => focusStoreMock),
}));

vi.mock('~/stores/project-tabs.store', () => ({
  useProjectTabsStore: vi.fn(() => projectTabsStoreMock),
}));

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: vi.fn(() => timelineStoreMock),
}));

vi.mock('~/stores/timeline-settings.store', () => ({
  useTimelineSettingsStore: vi.fn(() => timelineSettingsStoreMock),
}));

vi.mock('~/stores/file-manager.store', () => ({
  useFileManagerStore: vi.fn(() => fileManagerStoreMock),
  useFilesPageFileManagerStore: vi.fn(() => fileManagerStoreMock),
  useFilesPageSidebarFileManagerStore: vi.fn(() => fileManagerStoreMock),
  useComputerSidebarStore: vi.fn(() => fileManagerStoreMock),
  useBloggerDogSidebarStore: vi.fn(() => fileManagerStoreMock),
}));

describe('ProjectSettingsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('activeMonitor falls back to cut when view is unrecognized', () => {
    const store = useProjectSettingsStore();
    store.setContext({
      getCurrentEditorView: () => 'unknown' as any,
      getLastViewBeforeFullscreen: () => null,
      getProjectDirHandle: async () => null,
      getCurrentProjectName: () => 'test',
      getIsReadOnly: () => false,
      getProjectMeta: () => null,
      saveProjectMeta: async () => {},
    });

    const monitor = store.activeMonitor;
    expect(monitor).toEqual(defaultSettings.monitors.cut);
  });

  it('activeMonitor uses platform-specific monitor when available', () => {
    vi.mocked(getPlatformSuffix).mockReturnValue('-mobile');

    const store = useProjectSettingsStore();
    store.projectSettings.monitors['cut-mobile'] = {
      ...defaultSettings.monitors.cut,
      zoom: 2,
    };

    store.setContext({
      getCurrentEditorView: () => 'cut',
      getLastViewBeforeFullscreen: () => null,
      getProjectDirHandle: async () => null,
      getCurrentProjectName: () => 'test',
      getIsReadOnly: () => false,
      getProjectMeta: () => null,
      saveProjectMeta: async () => {},
    });

    expect(store.activeMonitor.zoom).toBe(2);
  });

  it('closeProjectSettings resets state to defaults', () => {
    const store = useProjectSettingsStore();
    store.projectSettings.monitors.cut.zoom = 5;

    store.closeProjectSettings();

    expect(store.projectSettings).toEqual(defaultSettings);
    expect(store.isLoadingProjectSettings).toBe(false);
    expect(store.isSavingProjectSettings).toBe(false);
  });

  it('setContext assigns context getters', () => {
    const store = useProjectSettingsStore();
    const getProjectDirHandle = async () => null;
    const getCurrentProjectName = () => 'test';
    const getIsReadOnly = () => false;
    const getProjectMeta = () => null;
    const saveProjectMeta = async () => {};
    const getCurrentEditorView = () => 'cut';
    const getLastViewBeforeFullscreen = () => null;

    store.setContext({
      getProjectDirHandle,
      getCurrentProjectName,
      getIsReadOnly,
      getProjectMeta,
      saveProjectMeta,
      getCurrentEditorView,
      getLastViewBeforeFullscreen,
    });

    // Context getters are stored as refs; activeMonitor uses them
    expect(store.activeMonitor).toEqual(defaultSettings.monitors.cut);
  });

  it('loadProjectSettings falls back to defaults when repo returns null', async () => {
    const store = useProjectSettingsStore();
    const mockDir = {} as any;

    store.setContext({
      getProjectDirHandle: async () => mockDir,
      getCurrentProjectName: () => 'test',
      getIsReadOnly: () => false,
      getProjectMeta: () => null,
      saveProjectMeta: async () => {},
      getCurrentEditorView: () => 'cut',
      getLastViewBeforeFullscreen: () => null,
    });

    await store.loadProjectSettings();

    // Watcher adds platform-specific monitor key immediately
    expect(store.projectSettings.monitors.cut).toBeDefined();
    expect(store.projectSettings.version).toBe(1);
    expect(store.isLoadingProjectSettings).toBe(false);
  });
});
