import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive, ref } from 'vue';
import { useMobileFileBrowserNavigation } from '~/composables/file-manager/useMobileFileBrowserNavigation';
import { WORKSPACE_COMMON_DIR_NAME, WORKSPACE_COMMON_PATH_PREFIX } from '~/utils/workspace-common';

// --- Mocks ---

vi.mock('vue', async () => {
  const actual = await vi.importActual('vue');
  return {
    ...actual as any,
    onMounted: vi.fn(),
    onBeforeUnmount: vi.fn(),
  };
});

const mockFilesPageStore = reactive({
  selectedFolder: null as any,
  selectFolder: vi.fn((f) => {
    mockFilesPageStore.selectedFolder = f;
  }),
});

const mockProjectStore = reactive({
  currentProjectName: 'TestProject',
});

const mockUiStore = reactive({
  showHiddenFiles: false,
});

vi.mock('~/stores/files-page.store', () => ({ useFilesPageStore: () => mockFilesPageStore }));
vi.mock('~/stores/project.store', () => ({ useProjectStore: () => mockProjectStore }));
vi.mock('~/stores/ui.store', () => ({ useUiStore: () => mockUiStore }));

describe('useMobileFileBrowserNavigation', () => {
  const mockReadDirectory = vi.fn();
  const mockVfs = {
    getMetadata: vi.fn(),
  };
  const mockFindEntryByPath = vi.fn();

  const deps = {
    readDirectory: mockReadDirectory,
    vfs: mockVfs as any,
    findEntryByPath: mockFindEntryByPath,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFilesPageStore.selectedFolder = null;
    mockProjectStore.currentProjectName = 'TestProject';
    mockUiStore.showHiddenFiles = false;
  });

  it('navigates to root correctly', () => {
    const { navigateToRoot } = useMobileFileBrowserNavigation(deps);
    navigateToRoot();

    expect(mockFilesPageStore.selectFolder).toHaveBeenCalledWith({
      kind: 'directory',
      name: 'TestProject',
      path: '',
    });
  });

  it('navigates to workspace common correctly', () => {
    const { navigateToWorkspaceCommonRoot } = useMobileFileBrowserNavigation(deps);
    navigateToWorkspaceCommonRoot();

    expect(mockFilesPageStore.selectFolder).toHaveBeenCalledWith({
      kind: 'directory',
      name: WORKSPACE_COMMON_DIR_NAME,
      path: WORKSPACE_COMMON_PATH_PREFIX,
    });
  });

  it('generates breadcrumbs correctly for root', () => {
    mockFilesPageStore.selectedFolder = { name: 'Root', kind: 'directory', path: '' };
    const { breadcrumbs } = useMobileFileBrowserNavigation(deps);
    expect(breadcrumbs.value).toEqual([]);
  });

  it('generates breadcrumbs correctly for deep path', () => {
    mockFilesPageStore.selectedFolder = { name: 'bar', kind: 'directory', path: 'foo/bar' };
    const { breadcrumbs } = useMobileFileBrowserNavigation(deps);
    expect(breadcrumbs.value).toEqual([
      { name: 'foo', path: 'foo' },
      { name: 'bar', path: 'foo/bar' },
    ]);
  });

  it('loads folder content and filters hidden files', async () => {
    mockFilesPageStore.selectedFolder = { name: 'Root', kind: 'directory', path: '' };
    mockReadDirectory.mockResolvedValue([
      { name: 'visible.txt', kind: 'file', path: 'visible.txt' },
      { name: '.hidden', kind: 'file', path: '.hidden' },
    ]);
    mockVfs.getMetadata.mockResolvedValue({ kind: 'file', size: 100, lastModified: 1000 });

    const { entries, loadFolderContent } = useMobileFileBrowserNavigation(deps);
    await loadFolderContent();

    expect(entries.value).toHaveLength(1);
    expect(entries.value[0].name).toBe('visible.txt');
    expect(entries.value[0].size).toBe(100);
  });

  it('shows hidden files when enabled', async () => {
    mockFilesPageStore.selectedFolder = { name: 'Root', kind: 'directory', path: '' };
    mockUiStore.showHiddenFiles = true;
    mockReadDirectory.mockResolvedValue([
      { name: 'visible.txt', kind: 'file', path: 'visible.txt' },
      { name: '.hidden', kind: 'file', path: '.hidden' },
    ]);
    mockVfs.getMetadata.mockResolvedValue({ kind: 'file', size: 100, lastModified: 1000 });

    const { entries, loadFolderContent } = useMobileFileBrowserNavigation(deps);
    await loadFolderContent();

    expect(entries.value).toHaveLength(2);
  });

  it('handles goBack correctly from subfolder', () => {
    mockFilesPageStore.selectedFolder = { name: 'bar', kind: 'directory', path: 'foo/bar' };
    const { goBack } = useMobileFileBrowserNavigation(deps);
    goBack();

    expect(mockFilesPageStore.selectFolder).toHaveBeenCalledWith({
      kind: 'directory',
      name: 'foo',
      path: 'foo',
    });
  });

  it('handles goBack to root correctly', () => {
    mockFilesPageStore.selectedFolder = { name: 'foo', kind: 'directory', path: 'foo' };
    const { goBack } = useMobileFileBrowserNavigation(deps);
    goBack();

    expect(mockFilesPageStore.selectFolder).toHaveBeenCalledWith({
      kind: 'directory',
      name: 'TestProject',
      path: '',
    });
  });
});
