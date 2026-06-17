import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive, ref, nextTick } from 'vue';
import MobileFileBrowser from '~/components/file-manager/MobileFileBrowser.vue';

// --- Store Mocks ---

const mockFileManagerStore = reactive({
  selectedFolder: { name: 'Root', path: '' } as any,
  openFolder: vi.fn(),
  folderSizes: {},
  sortFields: [
    { labelKey: 'common.name', value: 'name' },
    { labelKey: 'common.type', value: 'type' },
  ],
  sortOption: { field: 'name', order: 'asc' },
  setShowHiddenFiles: vi.fn(),
  showHiddenFiles: false,
});

const mockProjectStore = reactive({
  currentProjectName: 'MyProject',
  setView: vi.fn(),
  getDirectoryHandleByPath: vi.fn(async () => null),
  openTimelineFile: vi.fn(),
});

const mockSelectionStore = reactive({
  selectedEntity: null as any,
  selectFsEntry: vi.fn(),
  selectFsEntries: vi.fn(),
  clearSelection: vi.fn(),
});

const mockClipboardStore = reactive({
  hasFileManagerPayload: false,
  clearClipboardPayload: vi.fn(),
});

const mockTimelineMediaUsageStore = reactive({
  mediaPathToTimelines: {},
  refreshUsage: vi.fn(async () => {}),
  setLiveUsage: vi.fn(),
});

vi.mock('~/stores/file-manager.store', () => ({
  useFileManagerStore: () => mockFileManagerStore,
}));
vi.mock('~/stores/project.store', () => ({ useProjectStore: () => mockProjectStore }));
vi.mock('~/stores/selection.store', () => ({ useSelectionStore: () => mockSelectionStore }));
vi.mock('~/stores/clipboard.store', () => ({ useClipboardStore: () => mockClipboardStore }));
vi.mock('~/stores/timeline-media-usage.store', () => ({
  useTimelineMediaUsageStore: () => mockTimelineMediaUsageStore,
}));

// --- Composable Mocks ---

const mockEntries = ref<any[]>([]);
const mockIsLoading = ref(false);
const mockError = ref<string | null>(null);
const mockBreadcrumbs = ref<any[]>([]);
const mockLoadFolderContent = vi.fn(async () => {});
const mockIsSelectionMode = ref(false);
const mockIsDrawerOpen = ref(false);
const mockSelectedEntries = ref<any[]>([]);
const mockFolderSizes = ref<Record<string, number>>({});
const mockIsCreateMenuOpen = ref(false);

vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: vi.fn(() => ({
    readDirectory: vi.fn(async () => []),
    getFileIcon: vi.fn(() => 'i-heroicons-document'),
    findEntryByPath: vi.fn(),
    mediaCache: {},
    vfs: { getMetadata: vi.fn(async () => null) },
    handleFiles: vi.fn(),
    createFolder: vi.fn(),
    createTimeline: vi.fn(),
    createMarkdown: vi.fn(),
    reloadDirectory: vi.fn(),
    deleteEntry: vi.fn(),
    renameEntry: vi.fn(),
    copyEntry: vi.fn(),
    moveEntry: vi.fn(),
  })),
}));

vi.mock('~/composables/file-manager/useMobileFileBrowserNavigation', () => ({
  useMobileFileBrowserNavigation: vi.fn(() => ({
    entries: mockEntries,
    isLoading: mockIsLoading,
    error: mockError,
    breadcrumbs: mockBreadcrumbs,
    loadFolderContent: mockLoadFolderContent,
    navigateToRoot: vi.fn(),
    goBack: vi.fn(),
  })),
}));

vi.mock('~/composables/file-manager/useMobileFileBrowserSelection', () => ({
  useMobileFileBrowserSelection: vi.fn(() => ({
    isSelectionMode: mockIsSelectionMode,
    isDrawerOpen: mockIsDrawerOpen,
    selectedEntries: mockSelectedEntries,
    folderSizes: mockFolderSizes,
    totalSelectedSize: ref(0),
    calculateFolderSize: vi.fn(),
    toggleSelectionMode: vi.fn(() => {
      mockIsSelectionMode.value = !mockIsSelectionMode.value;
    }),
    handleLongPress: vi.fn(),
    handleToggleSelection: vi.fn(),
    handleEntryClick: vi.fn(),
    closeAllUI: vi.fn(),
  })),
}));

vi.mock('~/composables/file-manager/useMobileFileBrowserCreate', () => ({
  useMobileFileBrowserCreate: vi.fn(() => ({
    fileInput: ref(null),
    isCreateMenuOpen: mockIsCreateMenuOpen,
    triggerFileUpload: vi.fn(),
    onFileSelect: vi.fn(),
    onCreateFolder: vi.fn(),
    onCreateTimeline: vi.fn(),
    onCreateTextFile: vi.fn(),
  })),
}));

vi.mock('~/composables/file-manager/useFileManagerActions', () => ({
  useFileManagerActions: vi.fn(() => ({
    onFileAction: vi.fn(),
    isDeleteConfirmModalOpen: ref(false),
    deleteTargets: ref([]),
    handleDeleteConfirm: vi.fn(),
  })),
}));

vi.mock('~/composables/file-manager/useSttTranscription', () => ({
  useSttTranscription: vi.fn(() => ({
    modalOpen: ref(false),
    language: ref('en'),
    errorMessage: ref(null),
    isTranscribing: ref(false),
    isModelReady: ref(true),
    pendingEntry: ref(null),
    openModal: vi.fn(),
    submitTranscription: vi.fn(),
  })),
}));

vi.mock('~/composables/file-manager/useFileBrowserFileActions', () => ({
  useFileBrowserFileActions: vi.fn(() => ({ onFileAction: vi.fn() })),
}));

vi.mock('~/composables/file-manager/useAudioExtraction', () => ({
  useAudioExtraction: vi.fn(() => ({ extractAudio: vi.fn() })),
}));

vi.mock('~/composables/file-manager/useFileConversionStore', () => ({
  useFileConversionStore: vi.fn(() => ({ openConversionModal: vi.fn() })),
}));

vi.mock('~/composables/ui/useTeleportTarget', () => ({
  useTeleportTarget: vi.fn(() => ({ target: ref('body') })),
}));

vi.mock('~/composables/useHotkeyLabel', () => ({
  useHotkeyLabel: vi.fn(() => ({ getHotkeyLabel: vi.fn(() => '') })),
}));

vi.mock('~/composables/file-manager/useFileManagerThumbnails', () => ({
  useFileManagerThumbnails: vi.fn(() => ({ thumbnails: ref({}) })),
}));

vi.mock('~/composables/file-manager/useFileManagerCompatibility', () => ({
  useFileManagerCompatibility: vi.fn(() => ({ compatibility: ref({}) })),
}));

vi.mock('~/composables/file-manager/useFileSorting', () => ({
  useFileSorting: vi.fn((entries: any) => ({ sortedEntries: entries })),
}));

vi.mock('~/composables/file-manager/useFileBrowserBulkSelection', () => ({
  useFileBrowserBulkSelection: vi.fn(() => ({
    selectAll: vi.fn(),
    selectUnused: vi.fn(),
    invertSelection: vi.fn(),
  })),
}));

describe('MobileFileBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectionStore.selectedEntity = null;
    mockEntries.value = [];
    mockIsLoading.value = false;
    mockError.value = null;
    mockBreadcrumbs.value = [];
    mockIsSelectionMode.value = false;
    mockIsDrawerOpen.value = false;
    mockSelectedEntries.value = [];
    mockFolderSizes.value = {};
    mockIsCreateMenuOpen.value = false;
  });

  it('renders navbar and grid', async () => {
    const wrapper = await mountSuspended(MobileFileBrowser, {
      global: {
        stubs: {
          MobileFileBrowserNavbar: { template: '<div id="navbar-mock" />' },
          MobileFileBrowserGrid: { template: '<div id="grid-mock" />' },
          Teleport: true,
        },
      },
    });

    expect(wrapper.find('#navbar-mock').exists()).toBe(true);
    expect(wrapper.find('#grid-mock').exists()).toBe(true);
  });

  it('displays pull-to-refresh indicator while pulling', async () => {
    const wrapper = await mountSuspended(MobileFileBrowser, {
      global: {
        stubs: {
          MobileFileBrowserNavbar: { template: '<div />' },
          MobileFileBrowserGrid: { template: '<div id="grid-mock" />' },
          Teleport: true,
        },
      },
    });

    const gridContainer = wrapper.find('.overflow-y-auto');
    expect(gridContainer.exists()).toBe(true);

    await gridContainer.trigger('touchstart', {
      touches: [{ clientY: 100 }],
    });

    await gridContainer.trigger('touchmove', {
      touches: [{ clientY: 180 }],
    });

    const indicator = wrapper.find('.absolute.top-0');
    expect(indicator.exists()).toBe(true);

    await gridContainer.trigger('touchend');
  });

  it('shows error state in grid when folder loading fails', async () => {
    mockError.value = 'Network error';

    const wrapper = await mountSuspended(MobileFileBrowser, {
      global: {
        stubs: {
          MobileFileBrowserNavbar: { template: '<div />' },
          MobileFileBrowserGrid: {
            name: 'MobileFileBrowserGrid',
            props: ['error'],
            template: '<div id="grid-mock">{{ error }}</div>',
          },
          Teleport: true,
        },
      },
    });

    const grid = wrapper.findComponent({ name: 'MobileFileBrowserGrid' });
    expect(grid.exists()).toBe(true);
    expect(grid.props('error')).toBe('Network error');
    expect(grid.text()).toContain('Network error');
  });

  it('shows selection toolbar when in selection mode', async () => {
    mockIsSelectionMode.value = true;
    mockSelectedEntries.value = [{ name: 'a.txt', kind: 'file', path: 'a.txt' }];

    const wrapper = await mountSuspended(MobileFileBrowser, {
      global: {
        stubs: {
          MobileFileBrowserNavbar: { template: '<div />' },
          MobileFileBrowserGrid: { template: '<div />' },
          MobileFileBrowserDrawer: { template: '<div />' },
          MobileFileBrowserSelectionToolbar: {
            name: 'MobileFileBrowserSelectionToolbar',
            props: ['selectedEntries'],
            template: '<div id="toolbar-mock" />',
          },
          Teleport: true,
        },
      },
    });

    const toolbar = wrapper.findComponent({ name: 'MobileFileBrowserSelectionToolbar' });
    expect(toolbar.exists()).toBe(true);
    expect(toolbar.props('selectedEntries')).toEqual(mockSelectedEntries.value);
  });

  it('hides create FAB when in selection mode', async () => {
    mockIsSelectionMode.value = true;

    const wrapper = await mountSuspended(MobileFileBrowser, {
      global: {
        stubs: {
          MobileFileBrowserNavbar: { template: '<div />' },
          MobileFileBrowserGrid: { template: '<div />' },
          MobileFileBrowserDrawer: { template: '<div />' },
          MobileFileBrowserSelectionToolbar: { template: '<div />' },
          Teleport: false,
        },
      },
    });

    const fabContainer = wrapper.find('.fixed.bottom-20');
    expect(fabContainer.exists()).toBe(false);
  });

  it('shows create FAB when not in selection or paste mode', async () => {
    mockIsSelectionMode.value = false;
    mockClipboardStore.hasFileManagerPayload = false;

    const wrapper = await mountSuspended(MobileFileBrowser, {
      global: {
        stubs: {
          MobileFileBrowserNavbar: { template: '<div />' },
          MobileFileBrowserGrid: { template: '<div />' },
          MobileFileBrowserDrawer: { template: '<div />' },
          Teleport: { template: '<div class="teleport-stub"><slot /></div>' },
        },
      },
    });

    const fabContainer = wrapper.find('.fixed.bottom-20');
    expect(fabContainer.exists()).toBe(true);
    expect(fabContainer.find('button').exists()).toBe(true);
  });

  it('passes bulk selection actions to the navbar menu', async () => {
    const wrapper = await mountSuspended(MobileFileBrowser, {
      global: {
        stubs: {
          MobileFileBrowserNavbar: {
            name: 'MobileFileBrowserNavbar',
            props: ['menuItems'],
            template: '<div id="navbar-mock" />',
          },
          MobileFileBrowserGrid: { template: '<div id="grid-mock" />' },
          Teleport: true,
        },
      },
    });

    const navbar = wrapper.findComponent({ name: 'MobileFileBrowserNavbar' });
    const menuItems = navbar.props('menuItems') as Array<Array<{ label: string }>>;

    expect(menuItems[1]?.map((item) => item.label)).toEqual([
      'common.selectAll',
      'common.selectUnused',
      'common.invertSelection',
    ]);
  });

  it('closes create folder modal after folder creation', async () => {
    const wrapper = await mountSuspended(MobileFileBrowser, {
      global: {
        stubs: {
          MobileFileBrowserNavbar: { template: '<div />' },
          MobileFileBrowserGrid: { template: '<div />' },
          Teleport: true,
        },
      },
    });

    const modal = wrapper.findComponent({ name: 'UiEntityCreationModal' });
    expect(modal.exists()).toBe(true);

    await modal.setValue(true, 'open');
    expect(modal.props('open')).toBe(true);

    await modal.vm.$emit('confirm', 'New Folder');
    await nextTick();

    expect(modal.props('open')).toBe(false);
  });
});
