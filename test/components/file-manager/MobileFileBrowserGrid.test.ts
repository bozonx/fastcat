import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MobileFileBrowserGrid from '~/components/file-manager/MobileFileBrowserGrid.vue';

// --- Mocks ---

const mockFileManager = {
  getFileIcon: vi.fn(() => 'i-heroicons-document'),
};

vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: () => mockFileManager,
}));

const mockTimelineMediaUsageStore = {
  mediaPathToTimelines: {} as Record<string, string[]>,
};

const mockProjectStore = {
  currentTimelinePath: null as string | null,
};

const mockProxyStore = {
  existingProxies: new Set<string>(),
  generatingProxies: new Set<string>(),
};

vi.mock('~/stores/timeline-media-usage.store', () => ({
  useTimelineMediaUsageStore: () => mockTimelineMediaUsageStore,
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => mockProjectStore,
}));

vi.mock('~/stores/proxy.store', () => ({
  useProxyStore: () => mockProxyStore,
}));

describe('MobileFileBrowserGrid', () => {
  const defaultProps = {
    entries: [
      { name: 'folder1', kind: 'directory', path: 'folder1' },
      { name: 'file1.txt', kind: 'file', path: 'file1.txt', size: 1024 },
    ] as any[],
    thumbnails: {},
    selectedEntryPath: null,
    selectedEntries: [],
    isSelectionMode: false,
    folderSizes: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockTimelineMediaUsageStore.mediaPathToTimelines = {};
    mockProjectStore.currentTimelinePath = null;
    mockProxyStore.existingProxies.clear();
    mockProxyStore.generatingProxies.clear();
  });

  it('renders entries correctly', async () => {
    const wrapper = await mountSuspended(MobileFileBrowserGrid, {
      props: defaultProps,
    });

    expect(wrapper.text()).toContain('folder1');
    expect(wrapper.text()).toContain('file1.txt');
    expect(wrapper.text()).toContain('1 KB');
  });

  it('emits entryClick on click', async () => {
    const wrapper = await mountSuspended(MobileFileBrowserGrid, {
      props: defaultProps,
    });

    const buttons = wrapper.findAll('button');
    await buttons[0].trigger('click');

    expect(wrapper.emitted('entryClick')).toBeTruthy();
    expect(wrapper.emitted('entryClick')?.[0]).toEqual([defaultProps.entries[0]]);
  });

  it('shows selection indicators in selection mode', async () => {
    const wrapper = await mountSuspended(MobileFileBrowserGrid, {
      props: {
        ...defaultProps,
        isSelectionMode: true,
        selectedEntries: [defaultProps.entries[0]],
      },
      global: {
        stubs: {
          Icon: true,
        },
      },
    });

    // We can't easily check for blue-500 class in text mode, but we can find the indicators
    expect(wrapper.find('.bg-selection-accent-500').exists()).toBe(true);
  });

  it('emits toggleSelection in selection mode on click', async () => {
    const wrapper = await mountSuspended(MobileFileBrowserGrid, {
      props: {
        ...defaultProps,
        isSelectionMode: true,
      },
    });

    const buttons = wrapper.findAll('button');
    await buttons[0].trigger('click');

    expect(wrapper.emitted('toggleSelection')).toBeTruthy();
    expect(wrapper.emitted('toggleSelection')?.[0]).toEqual([defaultProps.entries[0]]);
  });

  it('displays correct folder size from props', async () => {
    const wrapper = await mountSuspended(MobileFileBrowserGrid, {
      props: {
        ...defaultProps,
        folderSizes: { folder1: 2048 },
      },
    });

    expect(wrapper.text()).toContain('2 KB');
  });

  it('shows used indicator for files used in timeline', async () => {
    mockTimelineMediaUsageStore.mediaPathToTimelines = {
      'file1.txt': ['timeline-1'],
    };

    const wrapper = await mountSuspended(MobileFileBrowserGrid, {
      props: defaultProps,
    });

    expect(wrapper.find('.bg-red-500').exists()).toBe(true);
  });

  it('shows green file name when proxy exists', async () => {
    mockProxyStore.existingProxies.add('file1.txt');

    const wrapper = await mountSuspended(MobileFileBrowserGrid, {
      props: defaultProps,
    });

    const fileName = wrapper
      .findAll('div')
      .find((node) => node.text() === 'file1.txt');

    expect(fileName?.classes()).toContain('text-(--color-success)!');
  });

  it('shows yellow names for generating proxy file and parent folder', async () => {
    mockProxyStore.generatingProxies.add('folder1/video.mp4');
    mockProxyStore.generatingProxies.add('file1.txt');

    const wrapper = await mountSuspended(MobileFileBrowserGrid, {
      props: defaultProps,
    });

    const entryNames = wrapper.findAll('div').filter((node) => ['folder1', 'file1.txt'].includes(node.text()));
    expect(entryNames.every((node) => node.classes().includes('text-amber-400!'))).toBe(true);
  });
});
