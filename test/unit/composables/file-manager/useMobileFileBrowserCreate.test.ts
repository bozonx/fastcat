/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive } from 'vue';
import { useMobileFileBrowserCreate } from '~/composables/file-manager/useMobileFileBrowserCreate';

// --- Mocks ---

const mockFileManagerStore = reactive({
  selectedFolder: { path: 'test' } as any,
});

vi.mock('~/stores/file-manager.store', () => ({ useFileManagerStore: () => mockFileManagerStore }));
vi.mock('#imports', () => ({
  useI18n: () => ({ t: (k: string) => k }),
}));

describe('useMobileFileBrowserCreate', () => {
  const deps = {
    createFolder: vi.fn(),
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

  it('triggers file upload', () => {
    const { triggerFileUpload, fileInput, pendingUploadPath } = useMobileFileBrowserCreate(deps);
    const mockInput = { click: vi.fn() } as any;
    fileInput.value = mockInput;

    triggerFileUpload('upload-path');

    expect(pendingUploadPath.value).toBe('upload-path');
    expect(mockInput.click).toHaveBeenCalled();
  });
});
