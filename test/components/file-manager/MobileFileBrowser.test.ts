import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive, ref } from 'vue';
import MobileFileBrowser from '~/components/file-manager/MobileFileBrowser.vue';

// --- Mocks ---

const mockFilesPageStore = reactive({
  selectedFolder: null as any,
  selectFolder: vi.fn((f) => {
    mockFilesPageStore.selectedFolder = f;
  }),
  openFolder: vi.fn(),
  selectFile: vi.fn(),
});

const mockProjectStore = reactive({
  currentProjectName: 'MyProject',
});

const mockSelectionStore = reactive({
  selectedEntity: null as any,
});

const mockUiStore = reactive({
  showHiddenFiles: false,
});

const mockTimelineStore = reactive({
  currentTime: 0,
  timelineDoc: { tracks: [{ id: 'v1', kind: 'video' }] },
  addClipToTimelineFromPath: vi.fn(),
  requestTimelineSave: vi.fn(),
});

const mockFileManager = {
  readDirectory: vi.fn(async () => []),
  getFileIcon: vi.fn(() => 'i-heroicons-document'),
  findEntryByPath: vi.fn(),
  mediaCache: { hasProxy: vi.fn(() => false) },
  vfs: { getMetadata: vi.fn() },
};

vi.mock('~/stores/files-page.store', () => ({ useFilesPageStore: () => mockFilesPageStore }));
vi.mock('~/stores/project.store', () => ({ useProjectStore: () => mockProjectStore }));
vi.mock('~/stores/selection.store', () => ({ useSelectionStore: () => mockSelectionStore }));
vi.mock('~/stores/ui.store', () => ({ useUiStore: () => mockUiStore }));
vi.mock('~/stores/proxy.store', () => ({
  useProxyStore: () => ({ generatingProxies: new Set() }),
}));
vi.mock('~/stores/timeline.store', () => ({ useTimelineStore: () => mockTimelineStore }));

vi.mock('~/composables/fileManager/useFileManager', () => ({
  useFileManager: () => mockFileManager,
}));

describe('MobileFileBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFilesPageStore.selectedFolder = null;
    mockFilesPageStore.selectedFolder = { name: 'Root', kind: 'directory', path: '' };
    mockFileManager.readDirectory.mockResolvedValue([]);
  });

  it('renders project name and breadcrumbs', async () => {
    const wrapper = await mountSuspended(MobileFileBrowser, {
      global: {
        stubs: {
          Icon: true,
          UButton: true,
        },
      },
    });
    expect(wrapper.text()).toContain('MyProject');
  });

  it('loads and renders entries', async () => {
    const entry = { name: 'movie.mp4', kind: 'file', path: 'movie.mp4', size: 1024 } as any;
    mockFileManager.readDirectory.mockResolvedValue([entry]);

    const wrapper = await mountSuspended(MobileFileBrowser, {
      global: {
        stubs: {
          Icon: true,
          UButton: true,
        },
      },
    });

    // Wait for the mock promise to resolve in the component
    await new Promise((resolve) => setTimeout(resolve, 10));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('movie.mp4');
  });

  it('navigates to folder on click', async () => {
    const folder = { name: 'Videos', kind: 'directory', path: 'videos' } as any;
    mockFileManager.readDirectory.mockResolvedValue([folder]);

    const wrapper = await mountSuspended(MobileFileBrowser, {
      global: {
        stubs: {
          Icon: true,
          UButton: true,
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    await wrapper.vm.$nextTick();

    const folderButton = wrapper.find('button');
    await folderButton.trigger('click');

    expect(mockFilesPageStore.openFolder).toHaveBeenCalledWith(folder);
  });
});
