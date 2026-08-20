/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addTask: vi.fn(() => 'task-1'),
  updateTaskProgress: vi.fn(),
  updateTaskStatus: vi.fn(),
  transcribeAudioFile: vi.fn(),
  saveTranscriptionSidecar: vi.fn(),
}));

vi.mock('~/stores/background-tasks.store', () => ({
  useBackgroundTasksStore: () => ({
    addTask: mocks.addTask,
    updateTaskProgress: mocks.updateTaskProgress,
    updateTaskStatus: mocks.updateTaskStatus,
  }),
}));

vi.mock('~/utils/transcription/engine', () => ({
  transcribeAudioFile: mocks.transcribeAudioFile,
}));

vi.mock('~/utils/transcription/persistence', () => ({
  saveTranscriptionSidecar: mocks.saveTranscriptionSidecar,
}));

describe('runTranscriptionTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards progress events to the background tasks store', async () => {
    mocks.transcribeAudioFile.mockImplementation(async ({ onProgress }) => {
      onProgress?.(0.25);
      onProgress?.(0.75);
      return { record: null };
    });

    const { runTranscriptionTask } = await import('~/utils/transcription/task-wrapper');

    await runTranscriptionTask({
      file: new File([], 'speech.mp3'),
      fileName: 'speech.mp3',
      filePath: '/speech.mp3',
      userSettings: {} as any,
      workspaceHandle: null as unknown as FileSystemDirectoryHandle,
    });

    expect(mocks.updateTaskProgress).toHaveBeenNthCalledWith(1, 'task-1', 0.25);
    expect(mocks.updateTaskProgress).toHaveBeenNthCalledWith(2, 'task-1', 0.75);
    expect(mocks.updateTaskStatus).toHaveBeenLastCalledWith('task-1', 'completed');
  });

  it('marks the task as cancelled when the abort signal fires, regardless of error shape', async () => {
    mocks.transcribeAudioFile.mockImplementation(async ({ signal }) => {
      // Simulate user cancellation triggered via store.cancelTask -> task.cancel().
      const firstCallArgs = mocks.addTask.mock.calls[0] as unknown as Array<{
        cancel?: () => void;
      }>;
      firstCallArgs[0]?.cancel?.();
      // The local-engine throws a plain Error('Transcription cancelled') which
      // historically slipped past the wrapper because it was not an AbortError.
      expect(signal?.aborted).toBe(true);
      throw new Error('Transcription cancelled');
    });

    const { runTranscriptionTask } = await import('~/utils/transcription/task-wrapper');

    await expect(
      runTranscriptionTask({
        file: new File([], 'speech.mp3'),
        fileName: 'speech.mp3',
        filePath: '/speech.mp3',
        userSettings: {} as any,
        workspaceHandle: null as unknown as FileSystemDirectoryHandle,
      }),
    ).rejects.toThrow('Transcription cancelled');

    expect(mocks.updateTaskStatus).toHaveBeenCalledWith('task-1', 'cancelled', 'Cancelled');
  });

  it('records the original error message when the task fails for a non-cancellation reason', async () => {
    mocks.transcribeAudioFile.mockRejectedValue(new Error('Network down'));

    const { runTranscriptionTask } = await import('~/utils/transcription/task-wrapper');

    await expect(
      runTranscriptionTask({
        file: new File([], 'speech.mp3'),
        fileName: 'speech.mp3',
        filePath: '/speech.mp3',
        userSettings: {} as any,
        workspaceHandle: null as unknown as FileSystemDirectoryHandle,
      }),
    ).rejects.toThrow('Network down');

    expect(mocks.updateTaskStatus).toHaveBeenCalledWith('task-1', 'failed', 'Network down');
  });
});
