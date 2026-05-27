/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive, ref } from 'vue';
import { useMobileFileBrowserNavigation } from '~/composables/file-manager/useMobileFileBrowserNavigation';
import { WORKSPACE_COMMON_DIR_NAME, WORKSPACE_COMMON_PATH_PREFIX } from '~/utils/workspace-common';

// --- Mocks ---

vi.mock('vue', async () => {
  const actual = await vi.importActual('vue');
  return {
    ...(actual as any),
    onMounted: vi.fn(),
    onBeforeUnmount: vi.fn(),
  };
});

const mockFileManagerStore = reactive({
  selectedFolder: null as any,
  showHiddenFiles: false,
  openFolder: vi.fn((f) => {
    mockFileManagerStore.selectedFolder = f;
  }),
});

const mockProjectStore = reactive({
  currentProjectName: 'TestProject',
});

const mockUiStore = reactive({
  showHiddenFiles: false,
});

vi.mock('~/stores/file-manager.store', () => ({ useFileManagerStore: () => mockFileManagerStore }));
vi.mock('~/stores/project.store', () => ({ useProjectStore: () => mockProjectStore }));
vi.mock('~/stores/ui.store', () => ({ useUiStore: () => mockUiStore }));
vi.mock('~/stores/timeline-media-usage.store', () => ({
  useTimelineMediaUsageStore: () => ({
    refreshUsage: vi.fn(),
    setLiveUsage: vi.fn(),
  }),
}));

describe('useMobileFileBrowserNavigation', () => {
  const mockReadDirectory = vi.fn();
  const mockVfs = {
    getMetadata: vi.fn(),
  };
  const mockFindEntryByPath = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockFileManagerStore.selectedFolder = null;
    mockFileManagerStore.showHiddenFiles = false;
    mockProjectStore.currentProjectName = 'TestProject';
    mockUiStore.showHiddenFiles = false;
  });

  function createDeps() {
    const folderEntries = ref<any[]>([]);
    const supplementEntries = async (entries: any[]) => entries;
    return {
      readDirectory: mockReadDirectory,
      vfs: mockVfs as any,
      findEntryByPath: mockFindEntryByPath,
      folderEntries,
      supplementEntries,
    };
  }

  it('navigates to root correctly', () => {
    const { navigateToRoot } = useMobileFileBrowserNavigation(createDeps());
    navigateToRoot();

    expect(mockFileManagerStore.openFolder).toHaveBeenCalledWith({
      kind: 'directory',
      name: 'TestProject',
      path: '',
    });
  });

  it('navigates to workspace common correctly', () => {
    const { navigateToWorkspaceCommonRoot } = useMobileFileBrowserNavigation(createDeps());
    navigateToWorkspaceCommonRoot();

    expect(mockFileManagerStore.openFolder).toHaveBeenCalledWith({
      kind: 'directory',
      name: WORKSPACE_COMMON_DIR_NAME,
      path: WORKSPACE_COMMON_PATH_PREFIX,
    });
  });

  it('generates breadcrumbs correctly for root', () => {
    mockFileManagerStore.selectedFolder = { name: 'Root', kind: 'directory', path: '' };
    const { breadcrumbs } = useMobileFileBrowserNavigation(createDeps());
    expect(breadcrumbs.value).toEqual([]);
  });

  it('generates breadcrumbs correctly for deep path', () => {
    mockFileManagerStore.selectedFolder = { name: 'bar', kind: 'directory', path: 'foo/bar' };
    const { breadcrumbs } = useMobileFileBrowserNavigation(createDeps());
    expect(breadcrumbs.value).toEqual([
      { name: 'foo', path: 'foo' },
      { name: 'bar', path: 'foo/bar' },
    ]);
  });

  it('loads folder content and filters hidden files', async () => {
    mockFileManagerStore.selectedFolder = { name: 'Root', kind: 'directory', path: '' };
    mockReadDirectory.mockResolvedValue([
      { name: 'visible.txt', kind: 'file', path: 'visible.txt' },
      { name: '.hidden', kind: 'file', path: '.hidden' },
    ]);

    const deps = createDeps();
    const { loadFolderContent } = useMobileFileBrowserNavigation(deps);
    await loadFolderContent();

    expect(deps.folderEntries.value).toHaveLength(1);
    expect(deps.folderEntries.value[0].name).toBe('visible.txt');
  });

  it('shows hidden files when enabled', async () => {
    mockFileManagerStore.selectedFolder = { name: 'Root', kind: 'directory', path: '' };
    mockFileManagerStore.showHiddenFiles = true;
    mockReadDirectory.mockResolvedValue([
      { name: 'visible.txt', kind: 'file', path: 'visible.txt' },
      { name: '.hidden', kind: 'file', path: '.hidden' },
    ]);

    const deps = createDeps();
    const { loadFolderContent } = useMobileFileBrowserNavigation(deps);
    await loadFolderContent();

    expect(deps.folderEntries.value).toHaveLength(2);
  });

  it('handles goBack correctly from subfolder', () => {
    mockFileManagerStore.selectedFolder = { name: 'bar', kind: 'directory', path: 'foo/bar' };
    const { goBack } = useMobileFileBrowserNavigation(createDeps());
    goBack();

    expect(mockFileManagerStore.openFolder).toHaveBeenCalledWith({
      kind: 'directory',
      name: 'foo',
      path: 'foo',
    });
  });

  it('handles goBack to root correctly', () => {
    mockFileManagerStore.selectedFolder = { name: 'foo', kind: 'directory', path: 'foo' };
    const { goBack } = useMobileFileBrowserNavigation(createDeps());
    goBack();

    expect(mockFileManagerStore.openFolder).toHaveBeenCalledWith({
      kind: 'directory',
      name: 'TestProject',
      path: '',
    });
  });

  it('exposes error when folder loading fails', async () => {
    mockFileManagerStore.selectedFolder = { name: 'Root', kind: 'directory', path: '' };
    mockReadDirectory.mockRejectedValue(new Error('Network error'));

    const { error, loadFolderContent } = useMobileFileBrowserNavigation(createDeps());
    await loadFolderContent();

    expect(error.value).toBe('Network error');
  });

  it('clears previous error on successful load', async () => {
    mockFileManagerStore.selectedFolder = { name: 'Root', kind: 'directory', path: '' };
    mockReadDirectory.mockRejectedValue(new Error('First error'));

    const deps = createDeps();
    const { error, loadFolderContent } = useMobileFileBrowserNavigation(deps);
    await loadFolderContent();
    expect(error.value).toBe('First error');

    mockReadDirectory.mockReset();
    mockReadDirectory.mockResolvedValue([{ name: 'ok.txt', kind: 'file', path: 'ok.txt' }]);
    await loadFolderContent();
    expect(error.value).toBeNull();
    expect(deps.folderEntries.value).toHaveLength(1);
  });
});
