/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addTask: vi.fn(() => 'task-1'),
  updateTaskProgress: vi.fn(),
  updateTaskStatus: vi.fn(),
  checkSttModelStatus: vi.fn(),
  downloadModel: vi.fn(),
}));

vi.mock('~/stores/background-tasks.store', () => ({
  useBackgroundTasksStore: () => ({
    addTask: mocks.addTask,
    updateTaskProgress: mocks.updateTaskProgress,
    updateTaskStatus: mocks.updateTaskStatus,
  }),
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => ({
    checkSttModelStatus: mocks.checkSttModelStatus,
  }),
}));

vi.mock('~/utils/transcription/model-storage', () => ({
  WHISPER_MODEL_FILES: {
    'test/model': ['config.json', 'onnx/encoder.onnx'],
  },
  downloadModel: mocks.downloadModel,
}));

describe('runModelDownloadTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers model download as a background task with model metadata', async () => {
    mocks.downloadModel.mockResolvedValue(undefined);

    const { runModelDownloadTask } = await import('~/utils/transcription/model-download-task');

    await runModelDownloadTask({
      workspaceHandle: {} as FileSystemDirectoryHandle,
      modelName: 'test/model',
      title: 'Downloading speech recognition model',
      description: 'Downloading local Whisper model test/model.',
    });

    expect(mocks.addTask).toHaveBeenCalledWith({
      type: 'model-download',
      title: 'Downloading speech recognition model',
      description: 'Downloading local Whisper model test/model.',
      resourceId: 'test/model',
      cancel: expect.any(Function),
    });
    expect(mocks.updateTaskStatus).toHaveBeenCalledWith('task-1', 'completed');
    expect(mocks.checkSttModelStatus).toHaveBeenCalledOnce();
  });

  it('reports aggregate progress across all model files', async () => {
    mocks.downloadModel.mockImplementation(async (_workspaceHandle, _modelName, onProgress) => {
      onProgress({
        model: 'test/model',
        file: 'config.json',
        loaded: 50,
        total: 100,
        status: 'downloading',
      });
      onProgress({
        model: 'test/model',
        file: 'config.json',
        loaded: 100,
        total: 100,
        status: 'done',
      });
      onProgress({
        model: 'test/model',
        file: 'onnx/encoder.onnx',
        loaded: 25,
        total: 100,
        status: 'downloading',
      });
    });

    const { runModelDownloadTask } = await import('~/utils/transcription/model-download-task');

    await runModelDownloadTask({
      workspaceHandle: {} as FileSystemDirectoryHandle,
      modelName: 'test/model',
    });

    expect(mocks.updateTaskProgress).toHaveBeenNthCalledWith(1, 'task-1', 0.25);
    expect(mocks.updateTaskProgress).toHaveBeenNthCalledWith(2, 'task-1', 0.5);
    expect(mocks.updateTaskProgress).toHaveBeenNthCalledWith(3, 'task-1', 0.625);
  });

  it('marks task as cancelled when the task cancel handler aborts the download', async () => {
    mocks.downloadModel.mockImplementation(
      async (_workspaceHandle, _modelName, _onProgress, signal) => {
        const cancel = mocks.addTask.mock.calls[0]?.[0]?.cancel;
        cancel();

        expect(signal.aborted).toBe(true);
        throw new DOMException('Download cancelled', 'AbortError');
      },
    );

    const { runModelDownloadTask } = await import('~/utils/transcription/model-download-task');

    await expect(
      runModelDownloadTask({
        workspaceHandle: {} as FileSystemDirectoryHandle,
        modelName: 'test/model',
      }),
    ).rejects.toThrow('Download cancelled');

    expect(mocks.updateTaskStatus).toHaveBeenCalledWith('task-1', 'cancelled', 'Cancelled');
    expect(mocks.checkSttModelStatus).not.toHaveBeenCalled();
  });
});
