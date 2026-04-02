import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive, ref } from 'vue';
import { useMobileFileBrowserCreate } from '~/composables/file-manager/useMobileFileBrowserCreate';

// --- Mocks ---

const mockFileManagerStore = reactive({
  selectedFolder: { path: 'test' } as any,
});

const mockProjectStore = reactive({
  openTimelineFile: vi.fn(),
  setView: vi.fn(),
});

const mockToast = {
  add: vi.fn(),
};

vi.mock('~/stores/file-manager.store', () => ({ useFileManagerStore: () => mockFileManagerStore }));
vi.mock('~/stores/project.store', () => ({ useProjectStore: () => mockProjectStore }));
vi.mock('#imports', () => ({
  useI18n: () => ({ t: (k: string) => k }),
  useToast: () => mockToast,
}));

describe('useMobileFileBrowserCreate', () => {
  const deps = {
    createFolder: vi.fn(),
    createTimeline: vi.fn(),
    createMarkdown: vi.fn(),
    handleFiles: vi.fn().mockResolvedValue(undefined),
    loadFolderContent: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('triggers folder creation', async () => {
    const { onCreateFolder, isCreateMenuOpen } = useMobileFileBrowserCreate(deps);
    isCreateMenuOpen.value = true;

    await onCreateFolder('New Folder');

    expect(deps.createFolder).toHaveBeenCalledWith('New Folder', 'test');
    expect(deps.loadFolderContent).toHaveBeenCalled();
    expect(isCreateMenuOpen.value).toBe(false);
  });

  it('triggers timeline creation and navigates to editor', async () => {
    deps.createTimeline.mockResolvedValue('new-timeline.otio');
    const { onCreateTimeline, isCreateMenuOpen } = useMobileFileBrowserCreate(deps);
    isCreateMenuOpen.value = true;

    await onCreateTimeline();

    expect(deps.createTimeline).toHaveBeenCalled();
    expect(mockProjectStore.openTimelineFile).toHaveBeenCalledWith('new-timeline.otio');
    expect(mockProjectStore.setView).toHaveBeenCalledWith('cut');
    expect(isCreateMenuOpen.value).toBe(false);
  });

  it('triggers file upload', () => {
    const { triggerFileUpload, fileInput, pendingUploadPath } = useMobileFileBrowserCreate(deps);
    const mockInput = { click: vi.fn() } as any;
    fileInput.value = mockInput;

    triggerFileUpload('upload-path');

    expect(pendingUploadPath.value).toBe('upload-path');
    expect(mockInput.click).toHaveBeenCalled();
  });
});
