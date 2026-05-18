import { useBackgroundTasksStore } from '~/stores/background-tasks.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { downloadModel } from './model-storage';

export interface ModelDownloadTaskOptions {
  workspaceHandle: FileSystemDirectoryHandle | null | undefined;
  modelName: string;
  title?: string;
}

/**
 * Runs model download as a background task.
 */
export async function runModelDownloadTask(options: ModelDownloadTaskOptions): Promise<void> {
  const tasksStore = useBackgroundTasksStore();
  const workspaceStore = useWorkspaceStore();
  const abortController = new AbortController();

  const taskId = tasksStore.addTask({
    type: 'model-download',
    title: options.title || options.modelName,
    cancel: () => {
      abortController.abort();
    },
  });

  try {
    await downloadModel(
      options.workspaceHandle,
      options.modelName,
      (progress) => {
        const normalized = progress.total > 0 ? progress.loaded / progress.total : 0;
        tasksStore.updateTaskProgress(taskId, Math.max(0, Math.min(1, normalized)));
      },
      abortController.signal,
    );

    tasksStore.updateTaskStatus(taskId, 'completed');
    await workspaceStore.checkSttModelStatus();
  } catch (error: any) {
    const message =
      error.name === 'AbortError'
        ? 'Cancelled'
        : error.message || 'Model download failed';

    tasksStore.updateTaskStatus(
      taskId,
      error.name === 'AbortError' ? 'cancelled' : 'failed',
      message,
    );
    throw error;
  }
}
