import { useBackgroundTasksStore } from '~/stores/background-tasks.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { downloadModel, WHISPER_MODEL_FILES } from './model-storage';

export interface ModelDownloadTaskOptions {
  workspaceHandle: FileSystemDirectoryHandle | null | undefined;
  modelName: string;
  title?: string;
  description?: string;
}

function isAbortError(error: unknown) {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  );
}

/**
 * Runs model download as a background task.
 */
export async function runModelDownloadTask(options: ModelDownloadTaskOptions): Promise<void> {
  const tasksStore = useBackgroundTasksStore();
  const workspaceStore = useWorkspaceStore();
  const abortController = new AbortController();
  const modelFiles = WHISPER_MODEL_FILES[options.modelName] ?? [];
  const fileProgress = new Map<string, number>();

  function updateAggregateProgress(taskId: string, file: string, progress: number) {
    fileProgress.set(file, Math.max(0, Math.min(1, progress)));

    if (modelFiles.length === 0) {
      tasksStore.updateTaskProgress(taskId, progress);
      return;
    }

    const totalProgress = modelFiles.reduce(
      (sum, fileName) => sum + (fileProgress.get(fileName) ?? 0),
      0,
    );
    tasksStore.updateTaskProgress(taskId, totalProgress / modelFiles.length);
  }

  const taskId = tasksStore.addTask({
    type: 'model-download',
    title: options.title || options.modelName,
    description: options.description,
    resourceId: options.modelName,
    cancel: () => {
      abortController.abort();
    },
  });

  try {
    await downloadModel(
      options.workspaceHandle,
      options.modelName,
      (progress) => {
        const normalized =
          progress.status === 'done'
            ? 1
            : progress.total > 0
              ? progress.loaded / progress.total
              : 0;
        updateAggregateProgress(taskId, progress.file, normalized);
      },
      abortController.signal,
    );

    tasksStore.updateTaskStatus(taskId, 'completed');
    await workspaceStore.checkSttModelStatus();
  } catch (error: unknown) {
    const aborted = isAbortError(error);
    const message = aborted
      ? 'Cancelled'
      : error instanceof Error
        ? error.message
        : 'Model download failed';

    tasksStore.updateTaskStatus(taskId, aborted ? 'cancelled' : 'failed', message);
    throw error;
  }
}
