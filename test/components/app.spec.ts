import { describe, it, expect, vi } from 'vitest';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import App from '~/app.vue';
import { mountWithNuxt } from '../utils/mount';

mockNuxtImport('useColorMode', () => {
  return () => ({ preference: 'dark', value: 'dark' });
});

mockNuxtImport('useI18n', () => {
  return () => ({
    t: (key: string) => key,
    locale: { value: 'en-US' },
  });
});

mockNuxtImport('useDevice', () => {
  return () => ({ isMobile: false });
});

vi.mock('~/components/file-manager/FileConversionModal.vue', () => ({
  default: { name: 'FileConversionModal', template: '<div />' },
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

vi.mock('~/stores/ui.store', () => ({
  useUiStore: vi.fn(() => ({
    isMediaReplaceModalOpen: false,
    notifyFileManagerUpdate: vi.fn(),
    showIntegrationSettings: vi.fn(),
  })),
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    resetWorkspace: vi.fn().mockResolvedValue(undefined),
    workspaceHandle: { kind: 'directory', name: 'test', path: '/' },
    workspaceProviderId: 'web',
    userSettings: {
      projectDefaults: { defaultAudioFadeCurve: 'linear' },
      optimization: { autoCreateProxies: false },
      timeline: { defaultStaticClipDurationUs: 5000000, snapThresholdPx: 10 },
      projectPresets: { items: [] },
      presets: {
        custom: [],
        defaultTextPresetId: '',
        collapsed: {},
      },
    },
    workspaceState: {
      fileBrowser: {
        instances: {},
      },
    },
    resolvedStorageTopology: { projectsRoot: '/' },
    projects: [],
    recentProjects: [],
    error: null,
    isLoading: false,
    isInitializing: false,
  })),
}));

describe('App Smoke Test', () => {
  it('can mount the app root component', async () => {
    const component = await mountWithNuxt(App);
    expect(component.exists()).toBe(true);
  }, 15000);
});
