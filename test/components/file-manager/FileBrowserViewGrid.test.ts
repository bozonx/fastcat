import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive, ref } from 'vue';
import FileBrowserViewGrid from '~/components/file-manager/FileBrowserViewGrid.vue';

const mockFilesPageStore = reactive({
  viewMode: 'grid',
  gridCardSize: 130,
});

const mockSelectionStore = reactive({
  selectedEntity: null as any,
});

const mockProxyStore = reactive({
  generatingProxies: new Set<string>(),
  proxyProgress: new Map<string, number>(),
});

const mockTimelineMediaUsageStore = reactive({
  mediaPathToTimelines: {},
});

const mockFileManager = {
  getFileIcon: vi.fn((e) =>
    e.kind === 'directory' ? 'i-heroicons-folder' : 'i-heroicons-document',
  ),
  mediaCache: { hasProxy: vi.fn(() => false) },
};

vi.mock('~/stores/files-page.store', () => ({ useFilesPageStore: () => mockFilesPageStore }));
vi.mock('~/stores/selection.store', () => ({ useSelectionStore: () => mockSelectionStore }));
vi.mock('~/stores/proxy.store', () => ({ useProxyStore: () => mockProxyStore }));
vi.mock('~/stores/timeline-media-usage.store', () => ({
  useTimelineMediaUsageStore: () => mockTimelineMediaUsageStore,
}));
vi.mock('~/composables/fileManager/useFileManager', () => ({
  useFileManager: () => mockFileManager,
}));
vi.mock('~/composables/fileManager/useClipboardIndicator', () => ({
  useClipboardPaths: () => ({ value: new Set() }),
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

describe('FileBrowserViewGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectionStore.selectedEntity = null;
  });

  it('renders entries in a grid', () => {
    const entry = { name: 'test.mp4', kind: 'file', path: 'test.mp4', size: 1024 };

    const wrapper = mount(FileBrowserViewGrid, {
      props: {
        entries: [entry] as any,
        isRootDropOver: false,
        dragOverEntryPath: null,
        currentDragOperation: null,
        currentGridSizeName: 'm',
        editingEntryPath: null,
        folderEntriesNames: [],
        getContextMenuItems: () => [],
        isGeneratingProxyInDirectory: () => false,
      },
      global: {
        stubs: {
          UContextMenu: { template: '<div><slot /></div>' },
          UIcon: true,
          UiProgressSpinner: true,
          InlineNameEditor: true,
        },
      },
    });

    expect(wrapper.text()).toContain('test.mp4');
    expect(wrapper.find('[data-entry-path="test.mp4"]').exists()).toBe(true);
  });

  it('highlights selected entry', () => {
    const entry = { name: 'test.mp4', kind: 'file', path: 'test.mp4', size: 1024 };
    mockSelectionStore.selectedEntity = {
      source: 'fileManager',
      kind: 'file',
      path: 'test.mp4',
      entry,
    };

    const wrapper = mount(FileBrowserViewGrid, {
      props: {
        entries: [entry] as any,
        isRootDropOver: false,
        dragOverEntryPath: null,
        currentDragOperation: null,
        currentGridSizeName: 'm',
        editingEntryPath: null,
        folderEntriesNames: [],
        getContextMenuItems: () => [],
        isGeneratingProxyInDirectory: () => false,
      },
      global: {
        stubs: {
          UContextMenu: { template: '<div><slot /></div>' },
          UIcon: true,
          UiProgressSpinner: true,
          InlineNameEditor: true,
        },
      },
    });

    const el = wrapper.find('[data-entry-path="test.mp4"]');
    expect(el.classes()).toContain('ring-1');
  });
});
