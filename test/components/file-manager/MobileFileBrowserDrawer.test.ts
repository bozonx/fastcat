import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive } from 'vue';
import MobileFileBrowserDrawer from '~/components/file-manager/MobileFileBrowserDrawer.vue';

const mockSelectionStore = reactive({
  selectedEntity: null as any,
});

const mockProxyStore = reactive({
  existingProxies: new Set<string>(),
  generatingProxies: new Set<string>(),
  cancelProxyGeneration: vi.fn(),
});

const mockProjectStore = reactive({
  getFileHandleByPath: vi.fn(),
});

const mockWorkspaceStore = reactive({
  userSettings: {
    integrations: [],
  },
});

const mockReadDirectory = vi.fn();

vi.mock('~/stores/selection.store', () => ({
  useSelectionStore: () => mockSelectionStore,
}));

vi.mock('~/stores/proxy.store', () => ({
  useProxyStore: () => mockProxyStore,
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => mockProjectStore,
}));

vi.mock('~/stores/file-conversion.store', () => ({
  useFileConversionStore: () => ({
    openConversionModal: vi.fn(),
  }),
}));

vi.mock('~/composables/file-manager/useAudioExtraction', () => ({
  useAudioExtraction: () => ({
    extractAudio: vi.fn(),
  }),
}));

vi.mock('~/composables/file-manager/useComputerVfs', () => ({
  useComputerVfs: () => ({
    vfs: { value: null },
  }),
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

vi.mock('~/composables/useAppClipboard', () => ({
  useAppClipboard: () => ({
    hasFileManagerPayload: false,
  }),
}));

vi.mock('~/stores/media.store', () => ({
  useMediaStore: () => ({
    metadataLoadFailed: {},
    mediaMetadata: {},
  }),
}));

vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: () => ({
    readDirectory: mockReadDirectory,
  }),
}));

vi.mock('~/utils/external-integrations', () => ({
  resolveExternalServiceConfig: () => null,
}));

vi.mock('nuxt/app', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nuxt/app')>();
  return {
    ...actual,
    useRuntimeConfig: () => ({
      public: {},
    }),
  };
});

describe('MobileFileBrowserDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectionStore.selectedEntity = null;
    mockProxyStore.existingProxies.clear();
    mockProxyStore.generatingProxies.clear();
    mockReadDirectory.mockResolvedValue([]);
  });

  it('shows regenerate and delete proxy actions for video with existing proxy', async () => {
    const entry = { kind: 'file', name: 'clip.mp4', path: 'clip.mp4' };
    mockSelectionStore.selectedEntity = {
      source: 'fileManager',
      kind: 'file',
      name: entry.name,
      path: entry.path,
      entry,
    };
    mockProxyStore.existingProxies.add(entry.path);

    const wrapper = await mountSuspended(MobileFileBrowserDrawer, {
      props: {
        isOpen: true,
        isSelectionMode: false,
      },
      global: {
        stubs: {
          UiMobileDrawer: { template: '<div><slot /></div>' },
          MobileDrawerToolbar: { template: '<div><slot /></div>' },
          MobileDrawerToolbarButton: true,
          FileProperties: true,
          MultiFileProperties: true,
          PropertyActionList: {
            name: 'PropertyActionList',
            props: ['actions'],
            template: '<div />',
          },
        },
      },
    });

    const actionList = wrapper.findComponent({ name: 'PropertyActionList' });
    const labels = actionList.props('actions').map((action: { label: string }) => action.label);

    expect(labels).toContain('videoEditor.fileManager.actions.regenerateProxy');
    expect(labels).toContain('videoEditor.fileManager.actions.deleteProxy');
  });

  it('shows folder proxy action when directory has direct video children', async () => {
    const entry = { kind: 'directory', name: 'videos', path: 'videos' };
    mockSelectionStore.selectedEntity = {
      source: 'fileManager',
      kind: 'directory',
      name: entry.name,
      path: entry.path,
      entry,
    };
    mockReadDirectory.mockResolvedValue([{ kind: 'file', name: 'clip.mp4', path: 'videos/clip.mp4' }]);

    const wrapper = await mountSuspended(MobileFileBrowserDrawer, {
      props: {
        isOpen: true,
        isSelectionMode: false,
      },
      global: {
        stubs: {
          UiMobileDrawer: { template: '<div><slot /></div>' },
          MobileDrawerToolbar: { template: '<div><slot /></div>' },
          MobileDrawerToolbarButton: true,
          FileProperties: true,
          MultiFileProperties: true,
          PropertyActionList: {
            name: 'PropertyActionList',
            props: ['actions'],
            template: '<div />',
          },
        },
      },
    });

    const actionList = wrapper.findComponent({ name: 'PropertyActionList' });
    const labels = actionList.props('actions').map((action: { label: string }) => action.label);

    expect(labels).toContain('videoEditor.fileManager.actions.createProxyForAll');
  });
});
