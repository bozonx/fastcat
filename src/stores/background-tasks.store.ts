import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export type BackgroundTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type BackgroundTaskType = 'proxy' | 'conversion' | 'other';

export interface BackgroundTask {
  id: string;
  type: BackgroundTaskType;
  title: string;
  status: BackgroundTaskStatus;
  progress: number; // 0 to 1
  createdAt: number;
  error?: string;
  cancel?: () => void | Promise<void>;
}

export const useBackgroundTasksStore = defineStore('background-tasks', () => {
  const tasks = ref<BackgroundTask[]>([]);

  const activeTasks = computed(() =>
    tasks.value.filter((t) => t.status === 'running' || t.status === 'pending'),
  );
  const completedTasks = computed(() =>
    tasks.value.filter(
      (t) => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled',
    ),
  );

  const hasActiveTasks = computed(() => activeTasks.value.length > 0);

  const globalProgress = computed(() => {
    if (activeTasks.value.length === 0) return 0;
    const total = activeTasks.value.reduce((acc, t) => acc + t.progress, 0);
    return total / activeTasks.value.length;
  });

  const sortedTasks = computed(() => {
    return [...tasks.value].sort((a, b) => b.createdAt - a.createdAt);
  });

  function addTask(
    task: Omit<BackgroundTask, 'id' | 'createdAt' | 'status' | 'progress'> &
      Partial<Pick<BackgroundTask, 'status' | 'progress'>>,
  ) {
    const id = Date.now().toString() + Math.random().toString(36).substring(2);
    const newTask: BackgroundTask = {
      ...task,
      id,
      createdAt: Date.now(),
      status: task.status || 'running',
      progress: task.progress || 0,
    };
    tasks.value.push(newTask);
    return id;
  }

  function updateTaskProgress(id: string, progress: number) {
    tasks.value = tasks.value.map((task) => {
      if (task.id !== id || task.status !== 'running') return task;
      return {
        ...task,
        progress: Math.max(0, Math.min(1, progress)),
      };
    });
  }

  function updateTaskStatus(id: string, status: BackgroundTaskStatus, error?: string) {
    tasks.value = tasks.value.map((task) => {
      if (task.id !== id) return task;
      return {
        ...task,
        status,
        error: error ?? task.error,
        progress: status === 'completed' ? 1 : task.progress,
      };
    });
  }

  async function cancelTask(id: string) {
    const task = tasks.value.find((t) => t.id === id);
    if (task && (task.status === 'running' || task.status === 'pending')) {
      try {
        if (task.cancel) {
          await task.cancel();
        }
        updateTaskStatus(id, 'cancelled');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateTaskStatus(id, 'failed', message);
      }
    }
  }

  function removeTask(id: string) {
    const index = tasks.value.findIndex((t) => t.id === id);
    if (index !== -1) {
      tasks.value.splice(index, 1);
    }
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
  };
});
