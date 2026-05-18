/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useBackgroundTasksStore } from '~/stores/background-tasks.store';

describe('background-tasks.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  it('schedules terminal tasks for removal and drops cancel handlers', () => {
    const store = useBackgroundTasksStore();
    const cancel = vi.fn();
    const taskId = store.addTask({
      type: 'other',
      title: 'Task',
      cancel,
    });

    store.updateTaskStatus(taskId, 'failed', 'Nope');

    expect(store.tasks[0]?.cancel).toBeUndefined();
    expect(store.completedTasks).toHaveLength(1);

    vi.advanceTimersByTime(5 * 60 * 1000);

    expect(store.tasks).toHaveLength(0);
  });

  it('cancels scheduled removal when a task becomes active again', () => {
    const store = useBackgroundTasksStore();
    const taskId = store.addTask({
      type: 'other',
      title: 'Retryable task',
    });

    store.updateTaskStatus(taskId, 'failed');
    store.updateTaskStatus(taskId, 'running');
    vi.advanceTimersByTime(5 * 60 * 1000);

    expect(store.tasks).toHaveLength(1);
    expect(store.tasks[0]?.status).toBe('running');
  });
});
