import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive, ref } from 'vue';
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

vi.mock('~/composables/properties/useFilePropertiesActions', () => ({
  useFilePropertiesActions: vi.fn(() => ({
    directoryPrimaryActions: ref([]),
    directorySecondaryActions: ref([
      {
        id: 'createProxyForAll',
        label: 'videoEditor.fileManager.actions.createProxyForAll',
        icon: '',
        onClick: vi.fn(),
        hidden: false,
      },
    ]),
    filePrimaryActions: ref([]),
    fileSecondaryActions: ref([
      {
        id: 'regenerateProxy',
        label: 'videoEditor.fileManager.actions.regenerateProxy',
        icon: '',
        onClick: vi.fn(),
        hidden: false,
      },
      {
        id: 'deleteProxy',
        label: 'videoEditor.fileManager.actions.deleteProxy',
        icon: '',
        onClick: vi.fn(),
        hidden: false,
      },
    ]),
  })),
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
    getCachedMetadata: vi.fn(),
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

vi.mock('~/components/properties/FileProperties.vue', () => ({
  default: {
    name: 'FileProperties',
    props: ['selectedFsEntry', 'previewMode', 'hasProxy', 'mobileTextMode'],
    template: '<div data-testid="file-properties" />',
  },
}));

describe('MobileFileBrowserDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectionStore.selectedEntity = null;
    mockProxyStore.existingProxies.clear();
    mockProxyStore.generatingProxies.clear();
    mockReadDirectory.mockResolvedValue([]);
  });

  it('passes has-proxy=true to FileProperties for video with existing proxy', async () => {
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
          MultiFileProperties: true,
        },
      },
    });

    const fileProps = wrapper.findComponent({ name: 'FileProperties' });
    expect(fileProps.exists()).toBe(true);
    expect(fileProps.props('hasProxy')).toBe(true);
    expect(fileProps.props('selectedFsEntry')).toEqual(entry);
  });

  it('renders FileProperties for directory selection', async () => {
    const entry = { kind: 'directory', name: 'videos', path: 'videos' };
    mockSelectionStore.selectedEntity = {
      source: 'fileManager',
      kind: 'directory',
      name: entry.name,
      path: entry.path,
      entry,
    };
    mockReadDirectory.mockResolvedValue([
      { kind: 'file', name: 'clip.mp4', path: 'videos/clip.mp4' },
    ]);

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
          MultiFileProperties: true,
        },
      },
    });

    const fileProps = wrapper.findComponent({ name: 'FileProperties' });
    expect(fileProps.exists()).toBe(true);
    expect(fileProps.props('selectedFsEntry')).toEqual(entry);
  });
});
