import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive } from 'vue';
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

const mockProjectStore = reactive({
  currentTimelinePath: null as string | null,
});

const mockFileManagerStore = reactive({});

vi.mock('~/stores/files-page.store', () => ({ useFilesPageStore: () => mockFilesPageStore }));
vi.mock('~/stores/file-manager.store', () => ({
  useFileManagerStore: () => mockFileManagerStore,
}));
vi.mock('~/stores/selection.store', () => ({ useSelectionStore: () => mockSelectionStore }));
vi.mock('~/stores/proxy.store', () => ({ useProxyStore: () => mockProxyStore }));
vi.mock('~/stores/timeline-media-usage.store', () => ({
  useTimelineMediaUsageStore: () => mockTimelineMediaUsageStore,
}));
vi.mock('~/stores/project.store', () => ({ useProjectStore: () => mockProjectStore }));
vi.mock('~/stores/media.store', () => ({ useMediaStore: () => ({}) }));
vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: () => mockFileManager,
}));
vi.mock('~/composables/file-manager/useClipboardIndicator', () => ({
  useClipboardPaths: () => ({ value: new Set() }),
}));

describe('FileBrowserViewGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectionStore.selectedEntity = null;
  });

  afterEach(() => {
    vi.useRealTimers();
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
        currentGridCardSize: 130,
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
        currentGridCardSize: 130,
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

  it('starts rename on single click on selected entry name', async () => {
    vi.useFakeTimers();

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
        dragOverEntryPath: null,
        currentDragOperation: null,
        currentGridSizeName: 'm',
        currentGridCardSize: 130,
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

    await wrapper.find('span[title="test.mp4"]').trigger('click', { detail: 1 });
    vi.advanceTimersByTime(250);

    expect(wrapper.emitted('fileAction')).toEqual([[ 'rename', entry ]]);
  });

  it('does not start rename on double click on selected entry name', async () => {
    vi.useFakeTimers();

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
        dragOverEntryPath: null,
        currentDragOperation: null,
        currentGridSizeName: 'm',
        currentGridCardSize: 130,
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

    const name = wrapper.find('span[title="test.mp4"]');
    await name.trigger('click', { detail: 1 });
    await name.trigger('dblclick');
    vi.advanceTimersByTime(250);

    expect(wrapper.emitted('fileAction')).toBeUndefined();
  });
});
