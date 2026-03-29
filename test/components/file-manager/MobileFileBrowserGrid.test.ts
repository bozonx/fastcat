import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MobileFileBrowserGrid from '~/components/file-manager/MobileFileBrowserGrid.vue';

// --- Mocks ---

const mockFileManager = {
  getFileIcon: vi.fn(() => 'i-heroicons-document'),
};

vi.mock('~/composables/fileManager/useFileManager', () => ({
  useFileManager: () => mockFileManager,
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
    expect(wrapper.find('.bg-blue-500').exists()).toBe(true);
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
});
