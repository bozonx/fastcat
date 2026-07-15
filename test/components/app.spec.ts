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

vi.mock('~/stores/presets.store', () => ({
  usePresetsStore: vi.fn(() => ({
    load: vi.fn(),
    customPresets: [],
    textsCustomCollapsed: false,
    hudsCustomCollapsed: false,
    textsStandardCollapsed: false,
  })),
}));

vi.mock('~/composables/useConfirmClose', () => ({
  useConfirmClose: vi.fn(),
}));

vi.mock('~/composables/useDismissMenusOnEscape', () => ({
  useDismissMenusOnEscape: vi.fn(),
}));

vi.mock('~/utils/video-editor/load-fonts', () => ({
  loadFonts: vi.fn(),
}));

vi.mock('~/utils/browser-compatibility', () => ({
  evaluateBrowserCompatibility: vi.fn(() => ({
    checks: [],
    criticalFailures: [],
    warnings: [],
    isSupported: true,
  })),
}));

vi.mock('~/components/file-manager/BackgroundTaskToasts.vue', () => ({
  default: { name: 'BackgroundTaskToasts', template: '<div data-testid="bg-task-toasts" />' },
}));

vi.mock('~/components/timeline/RecoveryDialog.vue', () => ({
  default: { name: 'RecoveryDialog', template: '<div data-testid="recovery-dialog" />' },
}));

vi.mock('~/components/timeline/CloseConfirmDialog.vue', () => ({
  default: { name: 'CloseConfirmDialog', template: '<div data-testid="close-confirm-dialog" />' },
}));

vi.mock('~/components/timeline/DesktopMediaReplaceModal.vue', () => ({
  default: {
    name: 'DesktopMediaReplaceModal',
    template: '<div data-testid="desktop-media-replace" />',
  },
}));

vi.mock('~/components/timeline/MobileMediaPickerDrawer.vue', () => ({
  default: {
    name: 'MobileMediaPickerDrawer',
    props: ['isOpen', 'isReplaceMode'],
    template: '<div v-if="isOpen" data-testid="mobile-media-picker" />',
  },
}));

vi.mock('~/components/ui/MobileForegroundTaskOverlay.vue', () => ({
  default: {
    name: 'MobileForegroundTaskOverlay',
    template: '<div data-testid="mobile-fg-overlay" />',
  },
}));

describe('App Smoke Test', () => {
  it('can mount the app root component', async () => {
    const component = await mountWithNuxt(App);
    expect(component.exists()).toBe(true);
  }, 60_000);

  it('renders key child components', async () => {
    const component = await mountWithNuxt(App);

    expect(component.find('[data-testid="bg-task-toasts"]').exists()).toBe(true);
    expect(component.find('[data-testid="recovery-dialog"]').exists()).toBe(true);
    expect(component.find('[data-testid="close-confirm-dialog"]').exists()).toBe(true);
    expect(component.find('[data-testid="desktop-media-replace"]').exists()).toBe(true);
  });

  it('does not render mobile media picker on desktop', async () => {
    const component = await mountWithNuxt(App);

    expect(component.find('[data-testid="mobile-media-picker"]').exists()).toBe(false);
  });

  it('applies interface scale from workspace settings to document root', async () => {
    await mountWithNuxt(App);

    // The workspace mock has no interfaceScale set, so font size should not be set
    // or should be undefined. This test verifies the watchEffect doesn't crash.
    expect(document.documentElement.style.fontSize).toBe('');
  });
});
