import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive, ref } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MobileMediaPickerDrawer from '~/components/timeline/MobileMediaPickerDrawer.vue';

const loadAllMock = vi.fn(async () => {});
const addClipToTimelineFromPathMock = vi.fn();
const addTimelineClipToTimelineFromPathMock = vi.fn();
const resolveMobileTargetTrackIdMock = vi.fn(() => 'track-1');
const getOrFetchMetadataByPathMock = vi.fn(async () => ({ duration: 10 }));

const mockTimelineStore = reactive({
  timelineDoc: { tracks: [{ id: 'track-1', kind: 'video', items: [] }] },
  resolveMobileTargetTrackId: resolveMobileTargetTrackIdMock,
  addClipToTimelineFromPath: addClipToTimelineFromPathMock,
  addTimelineClipToTimelineFromPath: addTimelineClipToTimelineFromPathMock,
  currentTime: 1_000_000,
  currentTimelinePath: '/project/Timeline.otio',
});

const mockProjectStore = reactive({
  currentTimelinePath: '/project/Timeline.otio',
});

const mockMediaStore = reactive({
  metadataLoadFailed: {} as Record<string, boolean>,
  getCachedMetadata: vi.fn(() => null),
  getOrFetchMetadataByPath: getOrFetchMetadataByPathMock,
});

const mockWorkspaceStore = reactive({
  userSettings: {
    timeline: { defaultStaticClipDurationTicks: 5_000_000 },
  },
});

const mockFileManager = reactive({
  readDirectory: vi.fn(async (): Promise<any[]> => []),
  vfs: {},
});
const assetEntries = ref<any[]>([]);
const assetCategories = [
  {
    id: 'video',
    labelKey: 'common.video',
    icon: 'lucide:clapperboard',
    sortedEntries: assetEntries,
    thumbnails: ref({}),
    fileCompatibility: ref({}),
    isLoading: ref(false),
    error: ref(null),
    load: vi.fn(async () => {}),
  },
];
const mockAssetStore = reactive({
  sortOption: { field: 'modified', order: 'desc' },
});
const mockUiStore = reactive({
  mediaReplaceTarget: null as null | {
    trackId: string;
    itemId: string;
    expectedType: string[];
  },
  isMediaReplaceModalOpen: false,
});

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => mockTimelineStore,
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => mockProjectStore,
}));

vi.mock('~/stores/media.store', () => ({
  useMediaStore: () => mockMediaStore,
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));
vi.mock('~/stores/ui.store', () => ({
  useUiStore: () => mockUiStore,
}));

vi.mock('~/composables/file-manager/useFileManager', () => ({
  FILE_MANAGER_INJECTION_KEY: Symbol('FILE_MANAGER_INJECTION_KEY'),
  useFileManager: () => mockFileManager,
}));

vi.mock('~/composables/file-manager/useMobileAssetCategories', () => ({
  useMobileAssetCategories: () => ({
    categories: assetCategories,
    loadAll: loadAllMock,
    toggleCollapse: vi.fn(),
    isCollapsed: vi.fn(() => false),
  }),
}));

vi.mock('~/stores/file-manager.store', () => ({
  useMobileMediaPickerStore: () => mockAssetStore,
}));

vi.mock('~/composables/timeline/useMediaTrackRedirectToast', () => ({
  useMediaTrackRedirectToast: () => ({
    captureSelectionKind: vi.fn(() => 'video'),
    notifyRedirect: vi.fn(),
  }),
}));

const globalOptions = {
  stubs: {
    UiMobileDrawer: {
      props: ['open', 'showClose', 'title'],
      emits: ['update:open'],
      template: '<div class="drawer"><slot name="header" /><slot /></div>',
    },
    MobileAssetCategoryList: {
      props: ['categories', 'selectedEntries', 'isSelectionMode'],
      emits: ['entry-click', 'toggle-selection'],
      template:
        '<div class="grid"><button v-for="entry in categories.flatMap((category) => category.sortedEntries.value)" :key="entry.path" class="entry" @click="$emit(\'toggle-selection\', entry)">{{ entry.name }}</button></div>',
    },
    UiButtonGroup: true,
    UButton: {
      props: ['loading'],
      emits: ['click'],
      template:
        '<button class="add-button" :disabled="loading" @click="$emit(\'click\')"><slot /></button>',
    },
    UIcon: { props: ['name'], template: '<i :data-icon="name" />' },
  },
};

describe('MobileMediaPickerDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assetEntries.value = [];
    mockUiStore.mediaReplaceTarget = null;
  });

  it('renders the drawer when open', async () => {
    const wrapper = await mountSuspended(MobileMediaPickerDrawer, {
      props: { isOpen: true },
      global: globalOptions,
    });
    expect(wrapper.find('.drawer').exists()).toBe(true);
  });

  it('loads entries when opened', async () => {
    const wrapper = await mountSuspended(MobileMediaPickerDrawer, {
      props: { isOpen: false },
      global: globalOptions,
    });
    await wrapper.setProps({ isOpen: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(loadAllMock).toHaveBeenCalledWith(true);
  });

  it('toggles file selection from the grid', async () => {
    const entry = { name: 'clip.mp4', kind: 'file', path: 'clip.mp4' } as any;
    assetEntries.value = [entry];
    const wrapper = await mountSuspended(MobileMediaPickerDrawer, {
      props: { isOpen: false },
      global: globalOptions,
    });
    await wrapper.setProps({ isOpen: true });
    await new Promise((r) => setTimeout(r, 10));

    await wrapper.find('.entry').trigger('click');
    expect(wrapper.find('.add-button').exists()).toBe(true);
  });

  it('filters non-media assets from the shared category list', async () => {
    assetEntries.value = [
      { name: 'clip.mp4', kind: 'file', path: 'clip.mp4' },
      { name: 'notes.md', kind: 'file', path: 'notes.md' },
    ];
    const wrapper = await mountSuspended(MobileMediaPickerDrawer, {
      props: { isOpen: false },
      global: globalOptions,
    });
    await wrapper.setProps({ isOpen: true });
    await new Promise((r) => setTimeout(r, 10));

    expect(wrapper.findAll('.entry').map((entry) => entry.text())).toEqual(['clip.mp4']);
  });

  it('shows only compatible assets in replace mode', async () => {
    mockUiStore.mediaReplaceTarget = {
      trackId: 'track-1',
      itemId: 'clip-1',
      expectedType: ['image'],
    };
    assetEntries.value = [
      { name: 'clip.mp4', kind: 'file', path: 'clip.mp4' },
      { name: 'cover.png', kind: 'file', path: 'cover.png' },
    ];

    const wrapper = await mountSuspended(MobileMediaPickerDrawer, {
      props: { isOpen: true, isReplaceMode: true },
      global: globalOptions,
    });

    expect(wrapper.findAll('.entry').map((entry) => entry.text())).toEqual(['cover.png']);
  });

  it('hides the currently installed clip source file in replace mode', async () => {
    mockTimelineStore.timelineDoc = {
      tracks: [
        {
          id: 'track-1',
          kind: 'video',
          items: [{ id: 'clip-1', source: { path: 'current.mp4' } }],
        },
      ],
    } as any;
    mockUiStore.mediaReplaceTarget = {
      trackId: 'track-1',
      itemId: 'clip-1',
      expectedType: ['video'],
    };
    assetEntries.value = [
      { name: 'current.mp4', kind: 'file', path: 'current.mp4' },
      { name: 'replacement.mp4', kind: 'file', path: 'replacement.mp4' },
    ];

    const wrapper = await mountSuspended(MobileMediaPickerDrawer, {
      props: { isOpen: true, isReplaceMode: true },
      global: globalOptions,
    });

    const entryNames = wrapper.findAll('.entry').map((entry) => entry.text());
    expect(entryNames).not.toContain('current.mp4');
    expect(entryNames).toEqual(['replacement.mp4']);
  });
});
