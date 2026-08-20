/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useExportFileSystem } from '~/composables/timeline/export/core/useExportFileSystem';

const mockProjectName = 'sls02';
const mockExportDir = { name: '_export' } as unknown as FileSystemDirectoryHandle;
const mockProjectDir = { name: 'sls02' } as unknown as FileSystemDirectoryHandle;

const projectStoreMock = {
  currentProjectName: mockProjectName,
  getProjectDirHandle: vi.fn(async () => mockProjectDir),
};

const workspaceStoreMock = {
  projectsHandle: null as FileSystemDirectoryHandle | null,
};

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => projectStoreMock,
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => workspaceStoreMock,
}));

describe('useExportFileSystem', () => {
  beforeEach(() => {
    projectStoreMock.currentProjectName = mockProjectName;
    projectStoreMock.getProjectDirHandle.mockReset();
    projectStoreMock.getProjectDirHandle.mockResolvedValue(mockProjectDir);
    workspaceStoreMock.projectsHandle = null;
  });

  it('создает директорию экспорта через getProjectDirHandle, даже без projectsHandle', async () => {
    const getDirectoryHandleMock = vi.fn(async (_name: string, options?: { create?: boolean }) => {
      if (_name === '_export' && options?.create) return mockExportDir;
      throw new Error('Not found');
    });

    projectStoreMock.getProjectDirHandle.mockResolvedValue({
      getDirectoryHandle: getDirectoryHandleMock,
    } as unknown as FileSystemDirectoryHandle);

    const fs = useExportFileSystem();
    const dir = await fs.ensureExportDir();

    expect(projectStoreMock.getProjectDirHandle).toHaveBeenCalledTimes(1);
    expect(getDirectoryHandleMock).toHaveBeenCalledWith('_export', { create: true });
    expect(dir).toBe(mockExportDir);
  });

  it('кидает ошибку, если проект не открыт', async () => {
    projectStoreMock.currentProjectName = null;

    const fs = useExportFileSystem();
    await expect(fs.ensureExportDir()).rejects.toThrow('Project is not opened');
  });

  it('кидает ошибку, если getProjectDirHandle возвращает null', async () => {
    projectStoreMock.getProjectDirHandle.mockResolvedValue(null);

    const fs = useExportFileSystem();
    await expect(fs.ensureExportDir()).rejects.toThrow('Project is not opened');
  });
});
