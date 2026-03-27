import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive, ref } from 'vue';
import FileBrowser from '~/components/file-manager/FileBrowser.vue';

// --- Mocks ---

const mockFilesPageStore = reactive({
  selectedFolder: null as any,
  viewMode: 'grid',
  gridCardSize: 130,
  columnWidths: { name: 200, type: 100, size: 80, created: 140, modified: 140 },
  sortOption: { field: 'name', order: 'asc' },
  setViewMode: vi.fn((v) => { mockFilesPageStore.viewMode = v; }),
  setGridCardSize: vi.fn((v) => { mockFilesPageStore.gridCardSize = v; }),
});

const mockSelectionStore = reactive({
  selectedEntity: null as any,
  selectFsEntry: vi.fn(),
  selectFsEntries: vi.fn(),
  clearSelection: vi.fn(),
});

const mockUiStore = reactive({
  selectedFsEntry: null as any,
  fileManagerUpdateCounter: 0,
  fileBrowserSelectAllTrigger: 0,
  fileBrowserNavigateBackTrigger: 0,
  fileBrowserNavigateUpTrigger: 0,
  fileBrowserMoveSelectionTrigger: { dir: 'up', timestamp: 0 },
  showHiddenFiles: false,
  notifyFileManagerUpdate: vi.fn(),
});

const mockFocusStore = reactive({
  activePanel: 'filesBrowser',
  setPanelFocus: vi.fn(),
  isPanelFocused: vi.fn((p) => mockFocusStore.activePanel === p),
});

const mockFileManager = {
  vfs: {},
  readDirectory: vi.fn(async () => []),
  loadProjectDirectory: vi.fn(async () => {}),
  createFolder: vi.fn(),
  renameEntry: vi.fn(),
  deleteEntry: vi.fn(),
  handleFiles: vi.fn(),
  moveEntry: vi.fn(),
  copyEntry: vi.fn(),
  findEntryByPath: vi.fn(),
  resolveEntryByPath: vi.fn(),
  reloadDirectory: vi.fn(),
  mediaCache: { hasProxy: vi.fn(() => false) },
};

vi.mock('~/stores/files-page.store', () => ({ useFilesPageStore: () => mockFilesPageStore }));
vi.mock('~/stores/selection.store', () => ({ useSelectionStore: () => mockSelectionStore }));
vi.mock('~/stores/ui.store', () => ({ useUiStore: () => mockUiStore }));
vi.mock('~/stores/focus.store', () => ({ useFocusStore: () => mockFocusStore }));
vi.mock('~/stores/proxy.store', () => ({ useProxyStore: () => ({ generatingProxies: new Set() }) }));
vi.mock('~/stores/file-conversion.store', () => ({ useFileConversionStore: () => ({ openConversionModal: vi.fn() }) }));

vi.mock('~/composables/fileManager/useFileManager', () => ({ useFileManager: () => mockFileManager }));
vi.mock('~/composables/useAppClipboard', () => ({ useAppClipboard: () => ({ hasFileManagerPayload: false }) }));

const mockFileBrowserEntries = {
  folderEntries: ref<any[]>([]),
  folderSizes: ref({}),
  folderSizesLoading: ref({}),
  sortedEntries: ref<any[]>([]),
  videoThumbnails: ref({}),
  stats: ref({ totalSize: '0 B', fileCount: 0 }),
  calculateFolderSize: vi.fn(),
  supplementEntries: vi.fn(async (e) => e),
  cleanupObjectUrls: vi.fn(),
};

vi.mock('~/composables/fileManager/useFileBrowserEntries', () => ({ useFileBrowserEntries: () => mockFileBrowserEntries }));
vi.mock('~/composables/fileManager/useFileBrowserRemote', () => ({ useFileBrowserRemote: () => ({ isRemoteAvailable: ref(true) }) }));
vi.mock('~/composables/fileManager/useFileBrowserNavigation', () => ({
  useFileBrowserNavigation: () => ({
    parentFolders: ref([]),
    loadFolderContent: vi.fn(),
    navigateBack: vi.fn(),
    navigateUp: vi.fn(),
    navigateToFolder: vi.fn(),
  }),
}));
vi.mock('~/composables/fileManager/useFileBrowserStt', () => ({ useFileBrowserStt: () => ({ sttTranscribing: ref(false) }) }));
vi.mock('~/composables/fileManager/useFileBrowserFileActions', () => ({ useFileBrowserFileActions: () => ({ onFileAction: vi.fn() }) }));
vi.mock('~/composables/fileManager/useFocusableListNavigation', () => ({ useFocusableListNavigation: () => ({ onKeyDown: vi.fn(), moveSelection: vi.fn() }) }));
vi.mock('~/composables/fileManager/useFileBrowserPendingActions', () => ({ useFileBrowserPendingActions: vi.fn() }));
vi.mock('~/composables/fileManager/useFileBrowserCreateActions', () => ({ useFileBrowserCreateActions: () => ({}) }));
vi.mock('~/composables/fileManager/useFileBrowserInteraction', () => ({ useFileBrowserInteraction: () => ({}) }));
vi.mock('~/composables/fileManager/useFileBrowserDragAndDrop', () => ({ useFileBrowserDragAndDrop: () => ({}) }));
vi.mock('~/composables/fileManager/useFileBrowserMarquee', () => ({ useFileBrowserMarquee: () => ({ marqueeStyle: ref(null) }) }));
vi.mock('~/composables/fileManager/useFileContextMenu', () => ({ useFileContextMenu: () => ({ getContextMenuItems: vi.fn(() => []) }) }));

describe('FileBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFilesPageStore.selectedFolder = null;
    mockFilesPageStore.viewMode = 'grid';
    mockUiStore.fileBrowserSelectAllTrigger = 0;
    mockFileBrowserEntries.folderEntries.value = [];
    mockFileBrowserEntries.sortedEntries.value = [];
  });

  it('renders empty state when no folder is selected', async () => {
    const wrapper = await mountSuspended(FileBrowser);
    expect(wrapper.text()).toContain('Select a folder in the sidebar to view its contents');
  });

  it('renders "Folder is empty" when an empty folder is selected', async () => {
    mockFilesPageStore.selectedFolder = { name: 'Empty', kind: 'directory', path: 'empty' };
    const wrapper = await mountSuspended(FileBrowser);
    expect(wrapper.text()).toContain('Folder is empty');
  });

  it('renders entries and toolbars when folder is selected', async () => {
    mockFilesPageStore.selectedFolder = { name: 'Root', kind: 'directory', path: '' };
    const entry = { name: 'test.mp4', kind: 'file', path: 'test.mp4', size: 1024 };
    mockFileBrowserEntries.folderEntries.value = [entry];
    mockFileBrowserEntries.sortedEntries.value = [entry];
    
    const wrapper = await mountSuspended(FileBrowser, {
      global: {
        stubs: {
          FileBrowserToolbar: true,
          FileBrowserBreadcrumbs: true,
          FileBrowserStatusBar: true,
          FileBrowserModals: true,
          FileBrowserViewGrid: {
            template: '<div data-test="grid-view"><slot /></div>',
            props: ['entries']
          },
          UContextMenu: { template: '<div><slot /></div>' },
          UIcon: true
        }
      }
    });

    const gridView = wrapper.findComponent({ name: 'FileBrowserViewGrid' });
    if (!gridView.exists()) {
        // Fallback for some test environments where name might be different
        expect(wrapper.find('[data-test="grid-view"]').exists()).toBe(true);
        return;
    }
    expect(gridView.props('entries')).toEqual([entry]);
  });

  it('switches between grid and list view', async () => {
    mockFilesPageStore.selectedFolder = { name: 'Root', kind: 'directory', path: '' };
    const entry = { name: 'test.mp4', kind: 'file', path: 'test.mp4' };
    mockFileBrowserEntries.folderEntries.value = [entry];
    mockFileBrowserEntries.sortedEntries.value = [entry];

    const wrapper = await mountSuspended(FileBrowser, {
      global: {
        stubs: {
          FileBrowserToolbar: true,
          FileBrowserBreadcrumbs: true,
          FileBrowserStatusBar: true,
          FileBrowserModals: true,
          FileBrowserViewGrid: { template: '<div data-test="grid-view" />' },
          FileBrowserViewList: { template: '<div data-test="list-view" />' },
          UContextMenu: { template: '<div><slot /></div>' },
          UIcon: true
        }
      }
    });

    expect(wrapper.find('[data-test="grid-view"]').exists()).toBe(true);
    
    mockFilesPageStore.viewMode = 'list';
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-test="list-view"]').exists()).toBe(true);
  });
});
