import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export type BackgroundTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type BackgroundTaskType =
  | 'proxy'
  | 'conversion'
  | 'file-operation'
  | 'transcription'
  | 'model-download'
  | 'other';

export interface BackgroundTask {
  id: string;
  type: BackgroundTaskType;
  title: string;
  description?: string;
  resourceId?: string;
  status: BackgroundTaskStatus;
  progress: number; // 0 to 1
  createdAt: number;
  error?: string;
  cancel?: () => void | Promise<void>;
}

export type AddBackgroundTaskInput = Omit<
  BackgroundTask,
  'id' | 'createdAt' | 'status' | 'progress'
> &
  Partial<Pick<BackgroundTask, 'status' | 'progress'>>;

const TERMINAL_STATUSES: ReadonlySet<BackgroundTaskStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
]);
// Maximum number of finished tasks to keep in history; oldest are evicted past this point.
const MAX_COMPLETED_TASKS = 200;

function generateTaskId(): string {
  // crypto.randomUUID is available in modern browsers and Node 16+.
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(1, progress));
}

export const useBackgroundTasksStore = defineStore('background-tasks', () => {
  const tasks = ref<BackgroundTask[]>([]);

  function findTask(id: string): BackgroundTask | undefined {
    return tasks.value.find((task) => task.id === id);
  }

  const activeTasks = computed(() =>
    tasks.value.filter((task) => task.status === 'running' || task.status === 'pending'),
  );
  const completedTasks = computed(() =>
    tasks.value.filter((task) => TERMINAL_STATUSES.has(task.status)),
  );

  const hasActiveTasks = computed(() => activeTasks.value.length > 0);

  const globalProgress = computed(() => {
    if (activeTasks.value.length === 0) return 0;
    const total = activeTasks.value.reduce((acc, task) => acc + task.progress, 0);
    return total / activeTasks.value.length;
  });

  const sortedTasks = computed(() =>
    [...tasks.value].sort((a, b) => b.createdAt - a.createdAt),
  );

  function addTask(task: AddBackgroundTaskInput): string {
    const id = generateTaskId();
    const newTask: BackgroundTask = {
      ...task,
      id,
      createdAt: Date.now(),
      status: task.status ?? 'running',
      progress: task.progress ?? 0,
    };
    tasks.value.push(newTask);
    return id;
  }

  function updateTaskProgress(id: string, progress: number): void {
    const task = findTask(id);
    if (!task) return;
    if (TERMINAL_STATUSES.has(task.status)) return;
    // Auto-promote pending → running on first progress, so that early progress
    // events from queued workers are not silently swallowed.
    if (task.status === 'pending') {
      task.status = 'running';
    }
    task.progress = clampProgress(progress);
  }

  function updateTaskStatus(
    id: string,
    status: BackgroundTaskStatus,
    error?: string,
  ): void {
    const task = findTask(id);
    if (!task) return;
    // A task that already reached a terminal state must not be moved back
    // (prevents races when cancel() handler and downstream catch both fire).
    if (TERMINAL_STATUSES.has(task.status) && !TERMINAL_STATUSES.has(status)) return;

    task.status = status;
    if (error !== undefined) task.error = error;
    if (status === 'completed') task.progress = 1;
    if (TERMINAL_STATUSES.has(status)) {
      task.cancel = undefined;
      enforceCompletedLimit();
    }
  }

  async function cancelTask(id: string): Promise<void> {
    const task = findTask(id);
    if (!task) return;
    if (TERMINAL_STATUSES.has(task.status)) return;

    const cancel = task.cancel;
    try {
      if (cancel) await cancel();
      // The downstream code path (rejection handler) usually marks the task as
      // 'cancelled' itself. We only update status here if it is still active,
      // to avoid overwriting a more specific terminal state.
      const current = findTask(id);
      if (current && !TERMINAL_STATUSES.has(current.status)) {
        updateTaskStatus(id, 'cancelled');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const current = findTask(id);
      if (current && !TERMINAL_STATUSES.has(current.status)) {
        updateTaskStatus(id, 'failed', message);
      }
    }
  }

  function removeTask(id: string): void {
    const index = tasks.value.findIndex((task) => task.id === id);
    if (index !== -1) tasks.value.splice(index, 1);
  }

  function clearCompletedTasks(): void {
    tasks.value = tasks.value.filter((task) => !TERMINAL_STATUSES.has(task.status));
  }

  // Keep the history bounded; drop the oldest finished tasks first.
  function enforceCompletedLimit(): void {
    const finished = tasks.value
      .filter((task) => TERMINAL_STATUSES.has(task.status))
      .sort((a, b) => a.createdAt - b.createdAt);
    const overflow = finished.length - MAX_COMPLETED_TASKS;
    if (overflow <= 0) return;
    const idsToDrop = new Set(finished.slice(0, overflow).map((task) => task.id));
    tasks.value = tasks.value.filter((task) => !idsToDrop.has(task.id));
  }

  return {
    tasks,
    activeTasks,
    completedTasks,
    hasActiveTasks,
    globalProgress,
    sortedTasks,
    addTask,
    updateTaskProgress,
    updateTaskStatus,
    cancelTask,
    removeTask,
    clearCompletedTasks,
  };
});

export type BackgroundTasksStore = ReturnType<typeof useBackgroundTasksStore>;
