import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive, ref } from 'vue';
import FileBrowserViewList from '~/components/file-manager/FileBrowserViewList.vue';

const mockFilesPageStore = reactive({
  viewMode: 'list',
  columnWidths: { name: 200, type: 100, size: 80, created: 140, modified: 140 },
  sortOption: { field: 'name', order: 'asc' },
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
vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: () => mockFileManager,
}));
vi.mock('~/composables/file-manager/useClipboardIndicator', () => ({
  useClipboardPaths: () => ({ value: new Set() }),
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

describe('FileBrowserViewList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectionStore.selectedEntity = null;
    mockProxyStore.generatingProxies.clear();
    mockProxyStore.proxyProgress.clear();
  });

  it('renders entries in a table', () => {
    const entries = [
      { name: 'test.mp4', kind: 'file', path: 'test.mp4', size: 1024, mimeType: 'video/mp4' },
      { name: 'folder', kind: 'directory', path: 'folder', size: 0, mimeType: 'folder' },
    ];

    const wrapper = mount(FileBrowserViewList, {
      props: {
        entries: entries as any,
        isRootDropOver: false,
        dragOverEntryPath: null,
        currentDragOperation: null,
        folderSizesLoading: {},
        folderSizes: {},
        editingEntryPath: null,
        folderEntriesNames: ['folder'],
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
    expect(wrapper.text()).toContain('folder');
    expect(wrapper.text()).toContain('1 KB');
  });

  it('highlights selected entry', () => {
    const entry = { name: 'test.mp4', kind: 'file', path: 'test.mp4', size: 1024 };
    mockSelectionStore.selectedEntity = {
      source: 'fileManager',
      kind: 'file',
      path: 'test.mp4',
      entry,
    };

    const wrapper = mount(FileBrowserViewList, {
      props: {
        entries: [entry] as any,
        isRootDropOver: false,
        dragOverEntryPath: null,
        currentDragOperation: null,
        folderSizesLoading: {},
        folderSizes: {},
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

    const tr = wrapper.find('tr[data-entry-path="test.mp4"]');
    expect(tr.classes()).toContain('ring-1');
  });
});
