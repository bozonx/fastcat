/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { reactive, nextTick } from 'vue';
import {
  applyLoadedTimelineSessionSnapshot,
  useProjectSettingsStore,
} from '~/stores/project-settings.store';
import { createProjectSettingsRepository } from '~/repositories/project-settings.repository';
import { createProjectUiRepository } from '~/repositories/project-ui.repository';

import { getPlatformSuffix } from '~/stores/ui/uiLocalStorage';

const { defaultProjectMonitor, defaultMonitorView } = vi.hoisted(() => ({
  defaultProjectMonitor: {
    previewResolution: 0.5,
    useProxy: true,
    previewEffectsEnabled: true,
    showGrid: false,
    showTimecode: true,
    toolbarPosition: 'bottom' as const,
    showTransparencyGrid: false,
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

const { capturedAutoSave, settingsRepoMocks, uiSaveSpy, markDirtySpy } = vi.hoisted(() => ({
  capturedAutoSave: { doSave: null as null | ((...args: unknown[]) => Promise<unknown>) },
  settingsRepoMocks: { load: vi.fn().mockResolvedValue(null), save: vi.fn().mockResolvedValue(undefined) },
  uiSaveSpy: vi.fn().mockResolvedValue(undefined),
  markDirtySpy: vi.fn(),
}));

vi.mock('~/repositories/project-settings.repository', () => ({
  createProjectSettingsRepository: vi.fn(() => ({
    load: settingsRepoMocks.load,
    save: settingsRepoMocks.save,
  })),
}));

vi.mock('~/repositories/project-ui.repository', () => ({
  createProjectUiRepository: vi.fn(() => ({
    load: vi.fn().mockResolvedValue(null),
    save: uiSaveSpy,
  })),
}));

vi.mock('~/utils/auto-save', () => ({
  createAutoSave: vi.fn((config: { doSave: (...args: unknown[]) => Promise<unknown> }) => {
    capturedAutoSave.doSave = config.doSave;
    return {
      markDirty: markDirtySpy,
      markCleanForCurrentRevision: vi.fn(),
      reset: vi.fn(),
      // `immediate: true` exercises the real save path (store → doSave → repo.save),
      // mirroring production behavior. Non-immediate saves stay debounced/no-op
      // (no event loop in the unit env).
      requestSave: vi.fn((opts?: { immediate?: boolean }) =>
        opts?.immediate && capturedAutoSave.doSave
          ? capturedAutoSave.doSave()
          : Promise.resolve(undefined),
      ),
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
  syncHiddenStaticTabsWithLayout: vi.fn(),
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
const fileManagerStoreMock = reactive<{
  selectedFolder: { path: string } | null;
  openFolderByPath: ReturnType<typeof vi.fn>;
}>({
  selectedFolder: null,
  openFolderByPath: vi.fn(),
});

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
    workspaceMock.projectsHandle = {} as any;
    fileManagerStoreMock.selectedFolder = null;
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

  it('autosave persists in tauri workspace-less mode when an active project handle exists', async () => {
    workspaceMock.projectsHandle = null;
    const store = useProjectSettingsStore();
    store.setContext({
      getProjectDirHandle: async () => ({ kind: 'directory', path: '/projects/demo' }) as any,
      getCurrentProjectName: () => 'demo',
      getIsReadOnly: () => false,
      getProjectMeta: () => null,
      saveProjectMeta: async () => {},
      getCurrentEditorView: () => 'cut',
      getLastViewBeforeFullscreen: () => null,
    });

    expect(capturedAutoSave.doSave).toBeTypeOf('function');
    await capturedAutoSave.doSave!();

    expect(uiSaveSpy).toHaveBeenCalled();
  });

  it('marks project settings dirty when internal file manager folder changes', async () => {
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

    // Simulate navigating to a folder in the mobile file manager
    fileManagerStoreMock.selectedFolder = { path: '/videos' };
    await nextTick();

    expect(markDirtySpy).toHaveBeenCalled();
  });

  describe('save and re-binding', () => {
    function makeStore() {
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
      return store;
    }

    it('saveProjectSettings persists technical settings via repo.save with the full object', async () => {
      const store = makeStore();

      await store.saveProjectSettings();

      expect(settingsRepoMocks.save).toHaveBeenCalledTimes(1);
      const saved = settingsRepoMocks.save.mock.calls.at(-1)![0];
      expect(saved).toBe(store.projectSettings);
    });

    it('saveProjectSettings persists UI payload with layout fields via uiRepo.save', async () => {
      const store = makeStore();
      store.projectSettings.ui.layout.splitSizes['a:b'] = [1, 2];

      await store.saveProjectSettings();

      expect(uiSaveSpy).toHaveBeenCalled();
      const ui = uiSaveSpy.mock.calls.at(-1)![0];
      expect(ui.version).toBe(1);
      expect(ui.ui.layout.splitSizes['a:b']).toEqual([1, 2]);
    });

    it('saveProjectSettings toggles isSavingProjectSettings and clears error on success', async () => {
      const store = makeStore();

      let savingDuringRequest = false;
      settingsRepoMocks.save.mockImplementationOnce(async () => {
        savingDuringRequest = store.isSavingProjectSettings;
      });

      await store.saveProjectSettings();

      expect(savingDuringRequest).toBe(true);
      expect(store.isSavingProjectSettings).toBe(false);
      expect(store.projectSettingsSaveError).toBeNull();
    });

    it('saveProjectSettings records error and resets isSaving in finally when repo.save throws', async () => {
      const store = makeStore();
      settingsRepoMocks.save.mockRejectedValueOnce(new Error('disk full'));

      await expect(store.saveProjectSettings()).rejects.toThrow('disk full');

      expect(store.projectSettingsSaveError).toBe('disk full');
      expect(store.isSavingProjectSettings).toBe(false);
    });

    it('saveProjectSettings skips save when getIsReadOnly is true', async () => {
      const store = useProjectSettingsStore();
      store.setContext({
        getProjectDirHandle: async () => ({}) as any,
        getCurrentProjectName: () => 'test',
        getIsReadOnly: () => true,
        getProjectMeta: () => null,
        saveProjectMeta: async () => {},
        getCurrentEditorView: () => 'cut',
        getLastViewBeforeFullscreen: () => null,
      });

      await store.saveProjectSettings();

      expect(settingsRepoMocks.save).not.toHaveBeenCalled();
      expect(uiSaveSpy).not.toHaveBeenCalled();
    });

    it('saveProjectSettings skips save when project name is empty', async () => {
      const store = useProjectSettingsStore();
      store.setContext({
        getProjectDirHandle: async () => ({}) as any,
        getCurrentProjectName: () => '',
        getIsReadOnly: () => false,
        getProjectMeta: () => null,
        saveProjectMeta: async () => {},
        getCurrentEditorView: () => 'cut',
        getLastViewBeforeFullscreen: () => null,
      });

      await store.saveProjectSettings();

      expect(settingsRepoMocks.save).not.toHaveBeenCalled();
    });

    it('saveProjectSettings skips save when no project dir handle', async () => {
      const store = useProjectSettingsStore();
      store.setContext({
        getProjectDirHandle: async () => null,
        getCurrentProjectName: () => 'test',
        getIsReadOnly: () => false,
        getProjectMeta: () => null,
        saveProjectMeta: async () => {},
        getCurrentEditorView: () => 'cut',
        getLastViewBeforeFullscreen: () => null,
      });

      await store.saveProjectSettings();

      expect(settingsRepoMocks.save).not.toHaveBeenCalled();
    });

    it('saveInitialProjectSettingsForNewProject rebinds repos with @project/<name> path and saves', async () => {
      const store = makeStore();

      await store.saveInitialProjectSettingsForNewProject({ projectName: 'demo' });

      expect(vi.mocked(createProjectSettingsRepository)).toHaveBeenCalledWith(
        expect.objectContaining({ projectPath: '@project/demo' }),
      );
      expect(vi.mocked(createProjectUiRepository)).toHaveBeenCalledWith(
        expect.objectContaining({ projectPath: '@project/demo' }),
      );
      expect(settingsRepoMocks.save).toHaveBeenCalled();
      expect(uiSaveSpy).toHaveBeenCalled();
    });

    it('saveInitialProjectSettingsForNewProject omits projectPath when projectName is empty', async () => {
      const store = makeStore();

      await store.saveInitialProjectSettingsForNewProject({ projectName: '' });

      expect(vi.mocked(createProjectSettingsRepository)).toHaveBeenCalledWith(
        expect.not.objectContaining({ projectPath: expect.anything() }),
      );
    });

    it('loadProjectSettings rebinds repos without projectPath (active project route)', async () => {
      const store = makeStore();
      vi.mocked(createProjectSettingsRepository).mockClear();

      await store.loadProjectSettings();

      expect(vi.mocked(createProjectSettingsRepository)).toHaveBeenCalledWith(
        expect.not.objectContaining({ projectPath: expect.anything() }),
      );
    });

    it('ensureRepo does not recreate repos on a second save (early return)', async () => {
      const store = makeStore();

      await store.saveProjectSettings();
      const callsAfterFirst = vi.mocked(createProjectSettingsRepository).mock.calls.length;

      await store.saveProjectSettings();

      // Second save hits ensureRepo's early return (repos already bound), so
      // createProjectSettingsRepository is not called again.
      expect(vi.mocked(createProjectSettingsRepository).mock.calls.length).toBe(callsAfterFirst);
    });
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
      mobileTrackHeightsEnlarged: {},
      selectionRange: { startUs: 1_000_000, endUs: 2_000_000 },
    });
  });
});
