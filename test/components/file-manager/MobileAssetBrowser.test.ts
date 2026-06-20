import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime';
import { reactive, ref } from 'vue';
import MobileAssetBrowser from '~/components/file-manager/MobileAssetBrowser.vue';

mockNuxtImport('useI18n', () => () => ({
  t: (key: string) => key,
}));

mockNuxtImport('useToast', () => () => ({
  add: vi.fn(),
}));

const videoEntries = ref([
  { kind: 'file', name: 'shared.mp4', path: '_video/shared.mp4', parentPath: '_video' },
]);
const audioEntries = ref([
  { kind: 'file', name: 'shared.mp4', path: '_audio/shared.mp4', parentPath: '_audio' },
  { kind: 'file', name: 'taken.mp3', path: '_audio/taken.mp3', parentPath: '_audio' },
]);
const imagesEntries = ref([]);

const categories = [
  {
    id: 'video',
    labelKey: 'common.video',
    icon: 'lucide:clapperboard',
    sortedEntries: videoEntries,
    thumbnails: ref({}),
    fileCompatibility: ref({}),
    isLoading: ref(false),
    error: ref(null),
    load: vi.fn(),
  },
  {
    id: 'audio',
    labelKey: 'common.audio',
    icon: 'lucide:music',
    sortedEntries: audioEntries,
    thumbnails: ref({}),
    fileCompatibility: ref({}),
    isLoading: ref(false),
    error: ref(null),
    load: vi.fn(),
  },
  {
    id: 'images',
    labelKey: 'common.images',
    icon: 'lucide:image',
    sortedEntries: imagesEntries,
    thumbnails: ref({}),
    fileCompatibility: ref({}),
    isLoading: ref(false),
    error: ref(null),
    load: vi.fn(),
  },
];

const loadAll = vi.fn(async () => {});
const onTouchStart = vi.fn();
const onTouchMove = vi.fn();
const onTouchEnd = vi.fn();
const mockSelectionMode = ref(false);
const mockSelectedEntries = ref<typeof audioEntries.value>([]);
const mockSelectionStore = reactive({
  selectedEntity: null as any,
});
const mockUiStore = reactive({
  fileManagerUpdateCounter: 0,
});

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => ({ setView: vi.fn() }),
}));
vi.mock('~/stores/selection.store', () => ({
  useSelectionStore: () => mockSelectionStore,
}));
vi.mock('~/stores/timeline-media-usage.store', () => ({
  useTimelineMediaUsageStore: () => ({
    mediaPathToTimelines: {},
    refreshUsage: vi.fn(async () => {}),
    setLiveUsage: vi.fn(),
  }),
}));
vi.mock('~/stores/ui.store', () => ({
  useUiStore: () => mockUiStore,
}));

vi.mock('~/composables/file-manager/useFileManager', () => ({
  FILE_MANAGER_INJECTION_KEY: Symbol('FILE_MANAGER_INJECTION_KEY'),
  useFileManager: () => ({
    findEntryByPath: vi.fn(),
    mediaCache: {},
    vfs: {},
    handleFiles: vi.fn(async () => {}),
    createFolder: vi.fn(async () => {}),
    createMarkdown: vi.fn(async () => null),
    reloadDirectory: vi.fn(async () => {}),
    deleteEntry: vi.fn(async () => {}),
    renameEntry: vi.fn(async () => {}),
    copyEntry: vi.fn(async () => {}),
    moveEntry: vi.fn(async () => {}),
    readDirectory: vi.fn(async () => []),
  }),
}));
vi.mock('~/composables/file-manager/useMobileAssetCategories', () => ({
  useMobileAssetCategories: () => ({
    categories,
    loadAll,
    toggleCollapse: vi.fn(),
    isCollapsed: vi.fn(() => false),
  }),
}));
vi.mock('~/composables/file-manager/useMobileFileBrowserSelection', () => ({
  useMobileFileBrowserSelection: () => ({
    isSelectionMode: mockSelectionMode,
    isDrawerOpen: ref(false),
    selectedEntries: mockSelectedEntries,
    toggleSelectionMode: vi.fn(),
    handleLongPress: vi.fn(),
    handleToggleSelection: vi.fn(),
    handleEntryClick: vi.fn(),
    closeAllUI: vi.fn(),
  }),
}));
vi.mock('~/composables/file-manager/useMobileFileBrowserCreate', () => ({
  useMobileFileBrowserCreate: () => ({
    fileInput: ref(null),
    triggerGlobalFileUpload: vi.fn(),
    onFileSelect: vi.fn(),
  }),
}));
vi.mock('~/composables/file-manager/useFileBrowserShared', () => ({
  useFileBrowserShared: () => ({
    onFileAction: vi.fn(),
    isDeleteConfirmModalOpen: ref(false),
    deleteTargets: ref([]),
    handleDeleteConfirm: vi.fn(),
    modalOpen: ref(false),
    language: ref('en'),
    errorMessage: ref(null),
    isTranscribing: ref(false),
    isModelReady: ref(true),
    pendingEntry: ref(null),
    openModal: vi.fn(),
    submitTranscription: vi.fn(),
  }),
}));
vi.mock('~/composables/file-manager/usePullToRefresh', () => ({
  usePullToRefresh: () => ({
    isPulling: ref(false),
    pullDistance: ref(0),
    isRefreshing: ref(false),
    onTouchStart,
    onTouchMove,
    onTouchEnd,
  }),
}));
vi.mock('~/composables/ui/useTeleportTarget', () => ({
  useTeleportTarget: () => ({ target: ref('body') }),
}));

describe('MobileAssetBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectionStore.selectedEntity = null;
    mockSelectionMode.value = false;
    mockSelectedEntries.value = [];
  });

  it('hides clipboard actions in asset toolbars', async () => {
    mockSelectionMode.value = true;
    const wrapper = await mountSuspended(MobileAssetBrowser, {
      global: {
        stubs: {
          MobileFileBrowserGrid: true,
          MobileFileBrowserList: true,
          UiButtonGroup: true,
          MobileFileBrowserDrawer: {
            name: 'MobileFileBrowserDrawer',
            props: {
              hideClipboardActions: Boolean,
            },
            template: '<div />',
          },
          MobileFileBrowserSelectionToolbar: {
            name: 'MobileFileBrowserSelectionToolbar',
            props: {
              hideClipboardActions: Boolean,
            },
            template: '<div />',
          },
          MobilePullToRefreshIndicator: true,
          FileDeleteConfirmModal: true,
          FileSttTranscriptionModal: true,
          UiRenameModal: true,
          MobileAddToTimelineModal: true,
          Teleport: true,
        },
      },
    });

    expect(
      wrapper.findComponent({ name: 'MobileFileBrowserDrawer' }).props('hideClipboardActions'),
    ).toBe(true);
    expect(
      wrapper
        .findComponent({ name: 'MobileFileBrowserSelectionToolbar' })
        .props('hideClipboardActions'),
    ).toBe(true);
  });

  it('validates rename conflicts only inside the current asset directory', async () => {
    const wrapper = await mountSuspended(MobileAssetBrowser, {
      global: {
        stubs: {
          MobileFileBrowserGrid: true,
          MobileFileBrowserList: true,
          UiButtonGroup: true,
          MobileFileBrowserDrawer: {
            name: 'MobileFileBrowserDrawer',
            props: ['onAction'],
            template: '<div />',
          },
          MobileFileBrowserSelectionToolbar: true,
          MobilePullToRefreshIndicator: true,
          FileDeleteConfirmModal: true,
          FileSttTranscriptionModal: true,
          MobileAddToTimelineModal: true,
          Teleport: true,
        },
      },
    });

    const drawer = wrapper.findComponent({ name: 'MobileFileBrowserDrawer' });
    await drawer.props('onAction')('rename', audioEntries.value[0]);

    const renameModal = wrapper.findComponent({ name: 'UiRenameModal' });
    expect(renameModal.props('selectWithoutExtension')).toBe(true);

    const validate = renameModal.props('validate') as (name: string) => string | boolean | null;
    expect(validate('taken.mp3')).toBe('common.validation.exists');
    expect(validate('shared.mp4')).toBe(true);
  });

  it('connects the asset list to pull-to-refresh handlers', async () => {
    const wrapper = await mountSuspended(MobileAssetBrowser, {
      global: {
        stubs: {
          MobileFileBrowserGrid: true,
          MobileFileBrowserList: true,
          UiButtonGroup: true,
          MobileFileBrowserDrawer: true,
          MobileFileBrowserSelectionToolbar: true,
          MobilePullToRefreshIndicator: {
            name: 'MobilePullToRefreshIndicator',
            template: '<div />',
          },
          FileDeleteConfirmModal: true,
          FileSttTranscriptionModal: true,
          UiRenameModal: true,
          MobileAddToTimelineModal: true,
          Teleport: true,
        },
      },
    });

    const scrollContainer = wrapper.find('.overflow-y-auto');
    await scrollContainer.trigger('touchstart');
    await scrollContainer.trigger('touchmove');
    await scrollContainer.trigger('touchend');

    expect(onTouchStart).toHaveBeenCalledOnce();
    expect(onTouchMove).toHaveBeenCalledOnce();
    expect(onTouchEnd).toHaveBeenCalledOnce();
    expect(wrapper.findComponent({ name: 'MobilePullToRefreshIndicator' }).exists()).toBe(true);
  });

  it('hides categories that have no files and are not loading or in error state', async () => {
    const wrapper = await mountSuspended(MobileAssetBrowser, {
      global: {
        stubs: {
          MobileFileBrowserGrid: true,
          MobileFileBrowserList: true,
          UiButtonGroup: true,
          MobileFileBrowserDrawer: true,
          MobileFileBrowserSelectionToolbar: true,
          MobilePullToRefreshIndicator: true,
          FileDeleteConfirmModal: true,
          FileSttTranscriptionModal: true,
          UiRenameModal: true,
          MobileAddToTimelineModal: true,
          Teleport: true,
        },
      },
    });

    const sections = wrapper.findAll('section');
    expect(sections).toHaveLength(3);

    // video and audio should be visible (they have mock files)
    expect(sections[0].attributes('style') || '').not.toContain('display: none');
    expect(sections[1].attributes('style') || '').not.toContain('display: none');
    // images should be hidden (no files)
    expect(sections[2].attributes('style') || '').toContain('display: none');
  });

  it('keeps the sorting toolbar visible during selection mode', async () => {
    const wrapper = await mountSuspended(MobileAssetBrowser, {
      global: {
        stubs: {
          MobileFileBrowserGrid: true,
          MobileFileBrowserList: true,
          MobileAssetCategoryList: true,
          UiButtonGroup: {
            name: 'UiButtonGroup',
            template: '<div />',
          },
          MobileFileBrowserDrawer: true,
          MobileFileBrowserSelectionToolbar: true,
          MobilePullToRefreshIndicator: true,
          FileDeleteConfirmModal: true,
          FileSttTranscriptionModal: true,
          UiRenameModal: true,
          MobileAddToTimelineModal: true,
          Teleport: true,
        },
      },
    });

    // Visible when not in selection mode
    expect(wrapper.findComponent({ name: 'UiButtonGroup' }).exists()).toBe(true);

    // Visible when a single entry is selected
    mockSelectionMode.value = true;
    mockSelectedEntries.value = [audioEntries.value[0]];
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent({ name: 'UiButtonGroup' }).exists()).toBe(true);

    // Visible when multiple entries are selected
    mockSelectedEntries.value = [audioEntries.value[0], audioEntries.value[1]];
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent({ name: 'UiButtonGroup' }).exists()).toBe(true);
  });
});
