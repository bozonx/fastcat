import { describe, it, expect, vi } from 'vitest';
import App from '~/app.vue';
import { mountWithNuxt } from '../utils/mount';

vi.mock('#imports', () => ({
  useColorMode: () => ({
    preference: 'dark',
    value: 'dark',
  }),
  useHead: vi.fn(),
}));

vi.mock('~/stores/project-settings.store', () => ({
  useProjectSettingsStore: vi.fn(() => ({
    projects: [],
    projectSettings: {
      project: {
        width: 1920,
        height: 1080,
        fps: 25,
        resolutionFormat: '1080p',
        orientation: 'landscape',
        sampleRate: 48000,
        isAutoSettings: false,
        isCustomResolution: false,
      },
      monitors: {
        cut: { orientation: 'landscape' },
        sound: { orientation: 'landscape' },
        export: { orientation: 'landscape' },
      },
      timelines: { openPaths: [], sessions: {} },
      timeline: {
        frameSnapMode: 'frames',
        clipSnapMode: 'clips',
        toolbarSnapMode: 'snap',
        toolbarDragMode: 'pseudo_overlap',
        toolbarDragModeEnabled: false,
      },
      transitions: { defaultDurationUs: 2000000 },
      ui: { activeTabId: null, fileTabs: [], staticTabsOrder: [], fileManagerPaths: {} },
    },
  })),
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: vi.fn(() => ({
    currentProjectName: 'test-project',
    currentProjectId: 'test-id',
    currentView: 'cut',
    currentTimelinePath: 'timeline.otio',
    getFileByPath: vi.fn(),
    closeProject: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    resetWorkspace: vi.fn().mockResolvedValue(undefined),
    workspaceHandle: { kind: 'directory', name: 'test', path: '/' },
    userSettings: {
      projectDefaults: { defaultAudioFadeCurve: 'linear' },
      optimization: { autoCreateProxies: false },
      timeline: { defaultStaticClipDurationUs: 5000000, snapThresholdPx: 10 },
      projectPresets: { items: [] },
    },
    workspaceState: {
      fileBrowser: {
        instances: {},
      },
      presets: {
        custom: [],
        defaultText: '',
      },
    },
    projects: [],
    recentProjects: [],
    error: null,
    isLoading: false,
  })),
}));

describe('App Smoke Test', () => {
  it('can mount the app root component', async () => {
    const component = await mountWithNuxt(App);
    expect(component.exists()).toBe(true);
  }, 15000);
});
