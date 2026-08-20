import { useBackgroundTasksStore } from '~/stores/background-tasks.store';
import { transcribeAudioFile, type TranscriptionRequest, type TranscriptionResult } from './engine';
import { saveTranscriptionSidecar } from './persistence';

export interface TranscriptionTaskOptions extends Omit<
  TranscriptionRequest,
  'onProgress' | 'signal'
> {
  title?: string;
}

function isCancellation(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  return false;
}

/**
 * Runs transcription as a background task.
 */
export async function runTranscriptionTask(
  options: TranscriptionTaskOptions,
): Promise<TranscriptionResult> {
  const tasksStore = useBackgroundTasksStore();
  const abortController = new AbortController();

  const taskId = tasksStore.addTask({
    type: 'transcription',
    title: options.title || options.fileName,
    cancel: () => {
      abortController.abort();
    },
  });

  try {
    const result = await transcribeAudioFile({
      ...options,
      onProgress: (progress) => {
        tasksStore.updateTaskProgress(taskId, progress);
      },
      signal: abortController.signal,
    });

    if (options.workspaceHandle && result.record) {
      void saveTranscriptionSidecar(options.workspaceHandle, options.filePath, result.record);
    }

    tasksStore.updateTaskStatus(taskId, 'completed');
    return result;
  } catch (error: unknown) {
    const cancelled = isCancellation(error, abortController.signal);
    const fallbackMessage = error instanceof Error ? error.message : 'Transcription failed';
    const message = cancelled ? 'Cancelled' : fallbackMessage;

    tasksStore.updateTaskStatus(taskId, cancelled ? 'cancelled' : 'failed', message);
    throw error;
  }
}
