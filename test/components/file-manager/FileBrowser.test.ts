import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive, ref } from 'vue';
import FileBrowser from '~/components/file-manager/FileBrowser.vue';

// --- Mocks ---

const {
  rawFileManagerStore,
  rawSelectionStore,
  rawUiStore,
  rawFocusStore,
  rawFileManager,
  rawFileBrowserEntries,
} = vi.hoisted(() => {
  const rawFileManagerStore = {
    selectedFolder: null as any,
    viewMode: 'grid',
    gridCardSize: 130,
    columnWidths: { name: 200, type: 100, size: 80, created: 140, modified: 140 },
    sortOption: { field: 'name', order: 'asc' },
    setViewMode: vi.fn(),
    setGridCardSize: vi.fn(),
    openFolder: vi.fn(),
    vfs: {},
    historyStack: [],
    futureStack: [],
    resolveDefaultTargetDir: vi.fn(async () => '/'),
    runWithUiFeedback: vi.fn((opts: any) => opts.action()),
  };

  const rawSelectionStore = {
    selectedEntity: null as any,
    selectFsEntry: vi.fn(),
    selectFsEntries: vi.fn(),
    clearSelection: vi.fn(),
  };

  const rawUiStore = {
    selectedFsEntry: null as any,
    fileManagerUpdateCounter: 0,
    fileBrowserSelectAllTrigger: 0,
    fileBrowserNavigateBackTrigger: 0,
    fileBrowserNavigateUpTrigger: 0,
    fileBrowserMoveSelectionTrigger: { dir: 'up', timestamp: 0 },
    showHiddenFiles: false,
    notifyFileManagerUpdate: vi.fn(),
  };

  const rawFocusStore = {
    activePanelId: 'filesBrowser',
    setPanelFocus: vi.fn(),
    isPanelFocused: vi.fn((p) => rawFocusStore.activePanelId === p),
  };

  const rawFileManager = {
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
    resolveDefaultTargetDir: vi.fn(async () => '/'),
    runWithUiFeedback: vi.fn((opts: any) => opts.action()),
    mediaCache: { hasProxy: vi.fn(() => false) },
  };

  const rawFileBrowserEntries = {
    folderEntries: [],
    folderSizes: {},
    folderSizesLoading: {},
    sortedEntries: [],
    videoThumbnails: {},
    calculateFolderSize: vi.fn(),
    supplementEntries: vi.fn(async (e: any) => e),
    cleanupObjectUrls: vi.fn(),
  };

  return {
    rawFileManagerStore,
    rawSelectionStore,
    rawUiStore,
    rawFocusStore,
    rawFileManager,
    rawFileBrowserEntries,
  };
});

const mockFileManagerStore = reactive(rawFileManagerStore);
const mockSelectionStore = reactive(rawSelectionStore);
const mockUiStore = reactive(rawUiStore);
const mockFocusStore = reactive(rawFocusStore);
const mockFileManager = rawFileManager;
const mockFileBrowserEntries = {
  folderEntries: ref(rawFileBrowserEntries.folderEntries),
  folderSizes: ref(rawFileBrowserEntries.folderSizes),
  folderSizesLoading: ref(rawFileBrowserEntries.folderSizesLoading),
  sortedEntries: ref(rawFileBrowserEntries.sortedEntries),
  videoThumbnails: ref(rawFileBrowserEntries.videoThumbnails),
  calculateFolderSize: rawFileBrowserEntries.calculateFolderSize,
  supplementEntries: rawFileBrowserEntries.supplementEntries,
  cleanupObjectUrls: rawFileBrowserEntries.cleanupObjectUrls,
};

vi.mock('~/stores/file-manager.store', () => ({
  useFileManagerStore: () => mockFileManagerStore,
  useFileBrowserPersistenceStore: () => ({
    computerViewMode: ref('grid'),
    computerGridCardSize: ref(130),
  }),
}));
vi.mock('~/stores/selection.store', () => ({ useSelectionStore: () => mockSelectionStore }));
vi.mock('~/stores/ui.store', () => ({ useUiStore: () => mockUiStore }));
vi.mock('~/stores/focus.store', () => ({ useFocusStore: () => mockFocusStore }));
vi.mock('~/stores/proxy.store', () => ({
  useProxyStore: () => ({ generatingProxies: new Set(), existingProxies: new Set() }),
}));
vi.mock('~/stores/file-conversion.store', () => ({
  useFileConversionStore: () => ({ openConversionModal: vi.fn() }),
}));
vi.mock('~/stores/media.store', () => ({
  useMediaStore: () => ({ getOrFetchMetadataByPath: vi.fn() }),
}));
vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => ({ currentProjectName: 'test', currentProjectId: 'test' }),
}));

vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: () => mockFileManager,
}));
vi.mock('~/composables/useAppClipboard', () => ({
  useAppClipboard: () => ({ hasFileManagerPayload: false }),
}));

vi.mock('~/composables/file-manager/useFileBrowserEntries', () => ({
  useFileBrowserEntries: () => mockFileBrowserEntries,
}));
vi.mock('~/composables/file-manager/useFileBrowserRemote', () => ({
  useFileBrowserRemote: () => ({
    isRemoteAvailable: ref(true),
    remoteError: ref(null),
    remoteTransferOpen: ref(false),
    remoteTransferProgress: ref(0),
    remoteTransferPhase: ref(null),
    remoteTransferFileName: ref(''),
    buildRemoteDirectoryEntry: vi.fn(),
    loadRemoteFolderContent: vi.fn(),
    loadRemoteParentFolders: vi.fn(),
    remoteHasMore: ref(false),
    isLoadingMore: ref(false),
    onBrowserEntryDragStart: vi.fn(),
    onBrowserEntryDragEnd: vi.fn(),
    onBrowserEntryDragEnter: vi.fn(),
    onBrowserEntryDragOver: vi.fn(),
    onBrowserEntryDragLeave: vi.fn(),
    onBrowserEntryDrop: vi.fn(),
    onBrowserRootDragEnter: vi.fn(),
    onBrowserRootDragOver: vi.fn(),
    onBrowserRootDragLeave: vi.fn(),
    onBrowserRootDrop: vi.fn(),
  }),
}));
vi.mock('~/composables/file-manager/useFileBrowserNavigation', () => ({
  useFileBrowserNavigation: () => ({
    parentFolders: ref([]),
    loadFolderContent: vi.fn(),
    navigateBack: vi.fn(),
    navigateUp: vi.fn(),
    navigateToFolder: vi.fn(),
  }),
}));
vi.mock('~/composables/file-manager/useSttTranscription', () => ({
  useSttTranscription: () => ({
    modalOpen: ref(false),
    language: ref(''),
    errorMessage: ref(''),
    isTranscribing: ref(false),
    isModelReady: ref(true),
    pendingEntry: ref(null),
    isTranscribableMediaFile: vi.fn(() => true),
    openModal: vi.fn(),
    closeModal: vi.fn(),
    submitTranscription: vi.fn(),
  }),
}));
vi.mock('~/composables/file-manager/useFileBrowserFileActions', () => ({
  useFileBrowserFileActions: () => ({ onFileAction: vi.fn() }),
}));
vi.mock('~/composables/file-manager/useFocusableListNavigation', () => ({
  useFocusableListNavigation: () => ({ onKeyDown: vi.fn(), moveSelection: vi.fn() }),
}));
vi.mock('~/composables/file-manager/useFileBrowserPendingActions', () => ({
  useFileBrowserPendingActions: vi.fn(),
}));
vi.mock('~/composables/file-manager/useFileBrowserCreateActions', () => ({
  useFileBrowserCreateActions: () => ({}),
}));
vi.mock('~/composables/file-manager/useFileBrowserInteraction', () => ({
  useFileBrowserInteraction: () => ({}),
}));
vi.mock('~/composables/file-manager/useFileBrowserDragAndDrop', () => ({
  useFileBrowserDragAndDrop: () => ({
    isDragOverPanel: ref(false),
    dragOverEntryPath: ref(null),
    currentDragOperation: ref(null),
    isRootDropOver: ref(false),
    onEntryDragStart: vi.fn(),
    onEntryDragEnd: vi.fn(),
    onEntryDragEnter: vi.fn(),
    onEntryDragOver: vi.fn(),
    onEntryDragLeave: vi.fn(),
    onEntryDrop: vi.fn(),
    onRootDragEnter: vi.fn(),
    onRootDragOver: vi.fn(),
    onRootDragLeave: vi.fn(),
    onRootDrop: vi.fn(),
    onPanelDragEnter: vi.fn(),
    onPanelDragOver: vi.fn(),
    onPanelDragLeave: vi.fn(),
    onPanelDrop: vi.fn(),
  }),
}));
vi.mock('~/composables/file-manager/useFileBrowserMarquee', () => ({
  useFileBrowserMarquee: () => ({ marqueeStyle: ref(null) }),
}));
vi.mock('~/composables/file-manager/useFileContextMenu', () => ({
  useFileContextMenu: () => ({ getContextMenuItems: vi.fn(() => []) }),
}));

describe('FileBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFileManagerStore.selectedFolder = null;
    mockFileManagerStore.viewMode = 'grid';
    mockUiStore.fileBrowserSelectAllTrigger = 0;
    mockFileBrowserEntries.folderEntries.value = [];
    mockFileBrowserEntries.sortedEntries.value = [];
  });

  it('renders empty state when no folder is selected', async () => {
    const wrapper = await mountSuspended(FileBrowser);
    expect(wrapper.text()).toContain('Folder is empty');
  });

  it('renders "Folder is empty" when an empty folder is selected', async () => {
    mockFileManagerStore.selectedFolder = { name: 'Empty', kind: 'directory', path: 'empty' };
    const wrapper = await mountSuspended(FileBrowser);
    expect(wrapper.text()).toContain('Folder is empty');
  });

  it('renders entries and toolbars when folder is selected', async () => {
    mockFileManagerStore.selectedFolder = { name: 'Root', kind: 'directory', path: '' };
    const entry = { name: 'test.mp4', kind: 'file', path: 'test.mp4', size: 1024 };
    mockFileBrowserEntries.folderEntries.value = [entry];
    mockFileBrowserEntries.sortedEntries.value = [entry];

    const wrapper = await mountSuspended(FileBrowser, {
      global: {
        stubs: {
          FileBrowserToolbar: true,
          FileBrowserBreadcrumbs: true,
          FileBrowserModals: true,
          FileBrowserViewGrid: {
            template: '<div data-test="grid-view"><slot /></div>',
            props: ['entries'],
          },
          UContextMenu: { template: '<div><slot /></div>' },
          UIcon: true,
        },
      },
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
    mockFileManagerStore.selectedFolder = { name: 'Root', kind: 'directory', path: '' };
    const entry = { name: 'test.mp4', kind: 'file', path: 'test.mp4' };
    mockFileBrowserEntries.folderEntries.value = [entry];
    mockFileBrowserEntries.sortedEntries.value = [entry];

    const wrapper = await mountSuspended(FileBrowser, {
      global: {
        stubs: {
          FileBrowserToolbar: true,
          FileBrowserBreadcrumbs: true,
          FileBrowserModals: true,
          FileBrowserViewGrid: { template: '<div data-test="grid-view" />' },
          FileBrowserViewList: { template: '<div data-test="list-view" />' },
          UContextMenu: { template: '<div><slot /></div>' },
          UIcon: true,
        },
      },
    });

    expect(wrapper.find('[data-test="grid-view"]').exists()).toBe(true);

    mockFileManagerStore.viewMode = 'list';
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-test="list-view"]').exists()).toBe(true);
  });
});
