/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  applyLoadedTimelineSessionSnapshot,
  useProjectSettingsStore,
} from '~/stores/project-settings.store';

import { getPlatformSuffix } from '~/stores/ui/uiLocalStorage';

const { defaultProjectMonitor, defaultMonitorView } = vi.hoisted(() => ({
  defaultProjectMonitor: {
    previewResolution: 0.5,
    useProxy: true,
    previewEffectsEnabled: true,
    showGrid: false,
    showTimecode: true,
    toolbarPosition: 'bottom' as const,
  },
  defaultMonitorView: {
    panX: 0,
    panY: 0,
    zoom: 1,
  },
}));

const defaultSettings = {
  version: 1,
  project: { width: 1920, height: 1080, fps: 30 },
  exportDefaults: { encoding: { format: 'mp4' } },
  monitor: { ...defaultProjectMonitor },
  monitors: {
    cut: { ...defaultMonitorView },
    sound: { ...defaultMonitorView },
    export: { ...defaultMonitorView },
  },
  timelines: { openPaths: [], sessions: {} },
  transitions: { defaultDurationUs: 2_000_000 },
  ui: {
    activeTabId: null,
    fileTabs: [],
    staticTabsOrder: [],
    fileManagerPaths: {},
    layout: {
      cutPanels: null,
      soundPanels: null,
      splitSizes: {},
      verticalSplitSizes: {},
      timelineHeights: {},
    },
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
  const dpm = { ...defaultProjectMonitor };
  const dmv = { ...defaultMonitorView };
  return {
    createDefaultProjectSettings: vi.fn(() => ({
      version: 1,
      project: { width: 1920, height: 1080, fps: 30 },
      exportDefaults: { encoding: { format: 'mp4' } },
      monitor: { ...dpm },
      monitors: { cut: { ...dmv }, sound: { ...dmv }, export: { ...dmv } },
      timelines: { openPaths: [], sessions: {} },
      transitions: { defaultDurationUs: 2_000_000 },
      ui: {
        activeTabId: null,
        fileTabs: [],
        staticTabsOrder: [],
        fileManagerPaths: {},
        layout: {
          cutPanels: null,
          soundPanels: null,
          splitSizes: {},
          verticalSplitSizes: {},
          timelineHeights: {},
        },
      },
    })),
    normalizeProjectSettings: vi.fn((raw: any) => raw),
    DEFAULT_PROJECT_MONITOR_SETTINGS: { ...dpm },
    DEFAULT_MONITOR_VIEW_SETTINGS: { ...dmv },
    DEFAULT_MONITOR_SETTINGS: { ...dpm, ...dmv },
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
    save: uiSaveSpy,
  })),
}));

const { capturedAutoSave, uiSaveSpy } = vi.hoisted(() => ({
  capturedAutoSave: { doSave: null as null | (() => Promise<unknown>) },
  uiSaveSpy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('~/utils/auto-save', () => ({
  createAutoSave: vi.fn((config: { doSave: () => Promise<unknown> }) => {
    capturedAutoSave.doSave = config.doSave;
    return {
      markDirty: vi.fn(),
      markCleanForCurrentRevision: vi.fn(),
      reset: vi.fn(),
      requestSave: vi.fn().mockResolvedValue(undefined),
      isDirty: vi.fn().mockReturnValue(false),
    };
  }),
}));

vi.mock('~/composables/useVfs', () => ({
  useVfs: vi.fn(() => ({
    exists: vi.fn().mockResolvedValue(true),
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
    // Proxy merges project-wide and per-view fields
    expect({ ...monitor }).toEqual({ ...defaultMonitorView, ...defaultProjectMonitor });
  });

  it('activeMonitor uses platform-specific monitor when available', () => {
    vi.mocked(getPlatformSuffix).mockReturnValue('-mobile');

    const store = useProjectSettingsStore();
    store.projectSettings.monitors['cut-mobile'] = {
      ...defaultMonitorView,
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
    expect({ ...store.activeMonitor }).toEqual({
      ...defaultMonitorView,
      ...defaultProjectMonitor,
    });
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

  it('autosave persists the live UI layout (panel sizes, vertical splits, timeline heights)', async () => {
    const store = useProjectSettingsStore();
    store.setContext({
      getProjectDirHandle: async () => ({}) as any,
      getCurrentProjectName: () => 'test',
      getIsReadOnly: () => false,
      getProjectMeta: () => null,
      saveProjectMeta: async () => {},
      getCurrentEditorView: () => 'cut',
      getLastViewBeforeFullscreen: () => null,
    });

    // Simulate sizes the user produced by dragging splitters / timeline divider.
    store.projectSettings.ui.layout.splitSizes['editor-files-top:p1'] = [70, 30];
    store.projectSettings.ui.layout.verticalSplitSizes['vkey'] = { 'col-1': [60, 40] };
    store.projectSettings.ui.layout.timelineHeights['timeline-height-cut:p1'] = 55;

    expect(capturedAutoSave.doSave).toBeTypeOf('function');
    await capturedAutoSave.doSave!();

    expect(uiSaveSpy).toHaveBeenCalled();
    const saved = uiSaveSpy.mock.calls.at(-1)![0];
    // Regression guard: these were previously written as empty objects, so every
    // drag-resized panel/timeline size was silently dropped on save.
    expect(saved.ui.layout.splitSizes['editor-files-top:p1']).toEqual([70, 30]);
    expect(saved.ui.layout.verticalSplitSizes['vkey']).toEqual({ 'col-1': [60, 40] });
    expect(saved.ui.layout.timelineHeights['timeline-height-cut:p1']).toBe(55);
  });
});

describe('applyLoadedTimelineSessionSnapshot', () => {
  it('preserves saved playhead when timeline document is not loaded yet', () => {
    const timelines = {
      openPaths: ['timelines/main.otio'],
      sessions: {
        'timelines/main.otio': {
          playheadUs: 12_000_000,
          masterGain: 0.75,
          masterMuted: false,
          zoom: 80,
          trackHeights: { v1: 64 },
        },
      },
    };

    const next = applyLoadedTimelineSessionSnapshot(timelines as any, {
      activeTimelinePath: 'timelines/main.otio',
      timelineDoc: null,
      currentTime: 0,
      masterGain: 1,
      masterMuted: false,
      zoom: 50,
      trackHeights: {},
      selectionRange: null,
    });

    expect(next.sessions['timelines/main.otio']?.playheadUs).toBe(12_000_000);
  });

  it('updates saved playhead after timeline document is loaded', () => {
    const timelines = {
      openPaths: ['timelines/main.otio'],
      sessions: {},
    };

    const next = applyLoadedTimelineSessionSnapshot(timelines as any, {
      activeTimelinePath: 'timelines/main.otio',
      timelineDoc: { tracks: [] },
      currentTime: 8_000_000,
      masterGain: 0.5,
      masterMuted: true,
      zoom: 90,
      trackHeights: { a1: 72 },
      selectionRange: { startUs: 1_000_000, endUs: 2_000_000 },
    });

    expect(next.sessions['timelines/main.otio']).toEqual({
      playheadUs: 8_000_000,
      masterGain: 0.5,
      masterMuted: true,
      zoom: 90,
      trackHeights: { a1: 72 },
      selectionRange: { startUs: 1_000_000, endUs: 2_000_000 },
    });
  });
});
