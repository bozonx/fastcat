import { useBackgroundTasksStore } from '~/stores/background-tasks.store';
import { transcribeAudioFile, type TranscriptionRequest, type TranscriptionResult } from './engine';

export interface TranscriptionTaskOptions extends Omit<TranscriptionRequest, 'onProgress' | 'signal'> {
  title?: string;
}

/**
 * Runs transcription as a background task.
 */
export async function runTranscriptionTask(options: TranscriptionTaskOptions): Promise<TranscriptionResult> {
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

    tasksStore.updateTaskStatus(taskId, 'completed');
    return result;
  } catch (error: any) {
    const message = error.name === 'AbortError' || error.message === 'Transcription cancelled'
      ? 'Cancelled'
      : error.message || 'Transcription failed';
    
    tasksStore.updateTaskStatus(taskId, error.name === 'AbortError' || error.message === 'Transcription cancelled' ? 'cancelled' : 'failed', message);
    throw error;
  }
}
