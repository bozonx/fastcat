import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MobileMediaPickerDrawer from '~/components/timeline/MobileMediaPickerDrawer.vue';

const readDirectoryMock = vi.fn(async (): Promise<any[]> => []);
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
    timeline: { defaultStaticClipDurationUs: 5_000_000 },
  },
});

const mockFileManager = reactive({
  readDirectory: readDirectoryMock,
  vfs: {},
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

vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: () => mockFileManager,
}));

vi.mock('~/composables/file-manager/useFileManagerThumbnails', () => ({
  useFileManagerThumbnails: () => ({ thumbnails: {} }),
}));

vi.mock('~/composables/timeline/useMediaTrackRedirectToast', () => ({
  useMediaTrackRedirectToast: () => ({ captureSelectionKind: vi.fn(() => 'video'), notifyRedirect: vi.fn() }),
}));

const globalOptions = {
  stubs: {
    UiMobileDrawer: {
      props: ['open', 'showClose'],
      emits: ['update:open'],
      template: '<div class="drawer"><slot name="header" /><slot /></div>',
    },
    MobileFileBrowserGrid: {
      props: ['entries', 'selectedEntries', 'isSelectionMode'],
      emits: ['toggle-selection'],
      template: '<div class="grid"><button v-for="entry in entries" :key="entry.path" class="entry" @click="$emit(\'toggle-selection\', entry)">{{ entry.name }}</button></div>',
    },
    UButton: { props: ['loading'], template: '<button class="add-button" :disabled="loading"><slot /></button>' },
    UIcon: { props: ['name'], template: '<i :data-icon="name" />' },
  },
};

describe('MobileMediaPickerDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readDirectoryMock.mockResolvedValue([]);
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
    expect(readDirectoryMock).toHaveBeenCalled();
  });

  it('toggles file selection from the grid', async () => {
    const entry = { name: 'clip.mp4', kind: 'file', path: 'clip.mp4' } as any;
    readDirectoryMock.mockResolvedValue([entry]);
    const wrapper = await mountSuspended(MobileMediaPickerDrawer, {
      props: { isOpen: false },
      global: globalOptions,
    });
    await wrapper.setProps({ isOpen: true });
    await new Promise((r) => setTimeout(r, 10));

    await wrapper.find('.entry').trigger('click');
    expect(wrapper.find('.add-button').exists()).toBe(true);
  });

  it('adds the selected clip to the timeline', async () => {
    const entry = { name: 'clip.mp4', kind: 'file', path: 'clip.mp4' } as any;
    readDirectoryMock.mockResolvedValue([entry]);
    const wrapper = await mountSuspended(MobileMediaPickerDrawer, {
      props: { isOpen: false },
      global: globalOptions,
    });
    await wrapper.setProps({ isOpen: true });
    await new Promise((r) => setTimeout(r, 10));

    await wrapper.find('.entry').trigger('click');
    await wrapper.find('.add-button').trigger('click');
    expect(addClipToTimelineFromPathMock).toHaveBeenCalled();
  });
});
