// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { useBatchConversion } from '~/composables/file-conversion/useBatchConversion';
import { executeMediaConversion } from '~/utils/conversion/media-conversion';
import { convertImageFile } from '~/utils/conversion/image-conversion';

const mockProjectStore = {
  getFileByPath: vi.fn(),
  getDirectoryHandleByPath: vi.fn(),
};

const mockFileManager = {
  vfs: {
    getFile: vi.fn(),
    writeFile: vi.fn(),
    deleteEntry: vi.fn(),
    exists: vi.fn(),
  },
  reloadDirectory: vi.fn(),
};

const mockUiStore = {
  notifyFileManagerUpdate: vi.fn(),
};

const mockBackgroundTasksStore = {
  addTask: vi.fn(() => 'task-1'),
  updateTaskStatus: vi.fn(),
  updateTaskProgress: vi.fn(),
  tasks: [],
};

const mockToast = {
  add: vi.fn(),
};
const cancelExportMock = vi.fn().mockResolvedValue(undefined);

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => mockProjectStore,
}));

vi.mock('~/stores/background-tasks.store', () => ({
  useBackgroundTasksStore: () => mockBackgroundTasksStore,
}));

vi.mock('~/stores/ui.store', () => ({
  useUiStore: () => mockUiStore,
}));

vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: () => mockFileManager,
}));

vi.mock('~/utils/conversion/media-conversion', () => ({
  executeMediaConversion: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('~/utils/conversion/image-conversion', () => ({
  convertImageFile: vi.fn().mockResolvedValue(new Blob(['converted'], { type: 'image/webp' })),
}));

vi.mock('~/utils/video-editor/worker-client', () => ({
  getExportWorkerClient: vi.fn(() => ({
    client: {
      cancelExport: cancelExportMock,
    },
  })),
}));

vi.mock('~/utils/runtime', () => ({
  isTauriRuntime: vi.fn(() => false),
}));

describe('useBatchConversion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProjectStore.getFileByPath.mockReset();
    mockProjectStore.getDirectoryHandleByPath.mockReset();
    mockFileManager.vfs.getFile
      .mockReset()
      .mockResolvedValue(new File(['x'], 'test.png', { type: 'image/png' }));
    mockFileManager.vfs.writeFile.mockReset();
    mockFileManager.vfs.exists.mockReset();
    mockBackgroundTasksStore.addTask.mockReturnValue('task-1');
    cancelExportMock.mockReset();
    cancelExportMock.mockResolvedValue(undefined);
  });

  it('opens modal with filtered entries for the given type', () => {
    const batch = useBatchConversion();
    const entries = [
      { kind: 'file', name: 'a.mp4', path: '/a.mp4' },
      { kind: 'file', name: 'b.mp3', path: '/b.mp3' },
      { kind: 'file', name: 'c.jpg', path: '/c.jpg' },
    ] as any[];

    batch.openModal('video', entries, false);

    expect(batch.state.isModalOpen).toBe(true);
    expect(batch.state.conversionType).toBe('video');
    expect(batch.state.entries.length).toBe(1);
    expect(batch.state.entries[0].name).toBe('a.mp4');
    expect(batch.state.targetIsExternal).toBe(false);
  });

  it('creates a single background task for batch video conversion', async () => {
    const batch = useBatchConversion();
    const entries = [
      { kind: 'file', name: 'a.mp4', path: '/a.mp4' },
      { kind: 'file', name: 'b.mp4', path: '/b.mp4' },
    ] as any[];

    batch.openModal('video', entries, false);

    mockProjectStore.getDirectoryHandleByPath.mockResolvedValue({
      getFileHandle: vi.fn().mockResolvedValue({}),
    });

    await batch.startConversion();

    expect(mockBackgroundTasksStore.addTask).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'conversion',
        status: 'pending',
      }),
    );
  });

  it('updates progress for each completed file in batch', async () => {
    const batch = useBatchConversion();
    const entries = [
      { kind: 'file', name: 'a.mp4', path: '/a.mp4' },
      { kind: 'file', name: 'b.mp4', path: '/b.mp4' },
    ] as any[];

    batch.openModal('video', entries, false);

    mockProjectStore.getDirectoryHandleByPath.mockResolvedValue({
      getFileHandle: vi.fn().mockResolvedValue({}),
    });

    await batch.startConversion();

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockBackgroundTasksStore.updateTaskProgress).toHaveBeenCalledWith('task-1', 0.5);
    expect(mockBackgroundTasksStore.updateTaskProgress).toHaveBeenCalledWith('task-1', 1);
    expect(mockBackgroundTasksStore.updateTaskStatus).toHaveBeenCalledWith('task-1', 'completed');
  });

  it('writes converted image files via VFS for image batch', async () => {
    const batch = useBatchConversion();
    const entries = [
      { kind: 'file', name: 'a.png', path: '/a.png' },
      { kind: 'file', name: 'b.jpg', path: '/b.jpg' },
    ] as any[];

    batch.openModal('image', entries, false);

    mockFileManager.vfs.getFile.mockResolvedValue(
      new File(['x'], 'test.png', { type: 'image/png' }),
    );

    await batch.startConversion();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockFileManager.vfs.writeFile).toHaveBeenCalledWith(
      '/a_converted.webp',
      expect.any(Blob),
    );
    expect(mockFileManager.vfs.writeFile).toHaveBeenCalledWith(
      '/b_converted.webp',
      expect.any(Blob),
    );
  });

  it('does not start conversion when already converting', async () => {
    const batch = useBatchConversion();
    const entries = [{ kind: 'file', name: 'a.mp4', path: '/a.mp4' }] as any[];

    batch.openModal('video', entries, false);
    batch.state.isConverting = true;

    await batch.startConversion();

    expect(mockBackgroundTasksStore.addTask).not.toHaveBeenCalled();
  });

  it('uses custom reloadDirectory callback when provided', async () => {
    const batch = useBatchConversion();
    const entries = [{ kind: 'file', name: 'a.png', path: '/a.png' }] as any[];

    const customReload = vi.fn().mockResolvedValue(undefined);

    batch.openModal('image', entries, false, customReload);

    mockFileManager.vfs.getFile.mockResolvedValue(
      new File(['x'], 'test.png', { type: 'image/png' }),
    );

    await batch.startConversion();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(customReload).toHaveBeenCalledWith('');
    expect(mockFileManager.reloadDirectory).not.toHaveBeenCalled();
  });

  it('resets reloadDirectory in finally after batch conversion', async () => {
    const batch = useBatchConversion();
    const entries = [{ kind: 'file', name: 'a.png', path: '/a.png' }] as any[];

    const customReload = vi.fn().mockResolvedValue(undefined);

    batch.openModal('image', entries, false, customReload);
    await batch.startConversion();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(batch.state.reloadDirectory).toBeNull();
  });

  it('cancels the active web conversion task id', async () => {
    let cancelBackgroundTask!: () => Promise<void>;
    mockBackgroundTasksStore.addTask.mockImplementation(
      (input: { cancel: () => Promise<void> }) => {
        cancelBackgroundTask = input.cancel;
        return 'task-1';
      },
    );

    vi.mocked(executeMediaConversion).mockImplementationOnce(
      async (params: { signal?: AbortSignal }) => {
        await new Promise<void>((resolve) => {
          params.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        const err = new Error('Cancelled');
        err.name = 'AbortError';
        throw err;
      },
    );

    const batch = useBatchConversion();
    batch.openModal('video', [{ kind: 'file', name: 'a.mp4', path: '/a.mp4' }] as any[], false);

    mockProjectStore.getDirectoryHandleByPath.mockResolvedValue({
      getFileHandle: vi.fn().mockResolvedValue({}),
    });

    await batch.startConversion();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await cancelBackgroundTask();

    expect(cancelExportMock).toHaveBeenCalledWith(expect.stringMatching(/^file-conversion-/));
  });
});
