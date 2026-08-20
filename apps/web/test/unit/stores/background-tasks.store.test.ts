/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useBackgroundTasksStore } from '~/stores/background-tasks.store';

describe('background-tasks.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('drops the cancel handler when a task reaches a terminal status', () => {
    const store = useBackgroundTasksStore();
    const cancel = vi.fn();
    const taskId = store.addTask({
      type: 'other',
      title: 'Task',
      cancel,
    });

    store.updateTaskStatus(taskId, 'failed', 'Nope');

    expect(store.tasks[0]?.cancel).toBeUndefined();
    expect(store.tasks[0]?.status).toBe('failed');
    expect(store.tasks[0]?.error).toBe('Nope');
    expect(store.completedTasks).toHaveLength(1);
  });

  it('keeps completed tasks in the store until they are explicitly removed', () => {
    vi.useFakeTimers();
    try {
      const store = useBackgroundTasksStore();
      const taskId = store.addTask({ type: 'other', title: 'Task' });
      store.updateTaskStatus(taskId, 'completed');

      // Advance well past the previous auto-removal window to prove tasks
      // are no longer evicted on a timer.
      vi.advanceTimersByTime(60 * 60 * 1000);

      expect(store.tasks).toHaveLength(1);
      expect(store.tasks[0]?.status).toBe('completed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes only finished tasks via clearCompletedTasks', () => {
    const store = useBackgroundTasksStore();
    const completedId = store.addTask({ type: 'other', title: 'Done' });
    store.updateTaskStatus(completedId, 'completed');
    const runningId = store.addTask({ type: 'other', title: 'Running' });

    store.clearCompletedTasks();

    expect(store.tasks).toHaveLength(1);
    expect(store.tasks[0]?.id).toBe(runningId);
  });

  it('refuses to roll back a terminal task to an active status', () => {
    const store = useBackgroundTasksStore();
    const taskId = store.addTask({ type: 'other', title: 'Task' });
    store.updateTaskStatus(taskId, 'failed', 'oops');

    store.updateTaskStatus(taskId, 'running');

    expect(store.tasks[0]?.status).toBe('failed');
    expect(store.tasks[0]?.error).toBe('oops');
  });

  it('updates progress in place for running tasks', () => {
    const store = useBackgroundTasksStore();
    const taskId = store.addTask({ type: 'other', title: 'Task' });
    const taskRefBefore = store.tasks[0];

    store.updateTaskProgress(taskId, 0.42);

    expect(store.tasks[0]).toBe(taskRefBefore);
    expect(store.tasks[0]?.progress).toBe(0.42);
  });

  it('clamps invalid progress values', () => {
    const store = useBackgroundTasksStore();
    const taskId = store.addTask({ type: 'other', title: 'Task' });

    store.updateTaskProgress(taskId, Number.NaN);
    expect(store.tasks[0]?.progress).toBe(0);

    store.updateTaskProgress(taskId, -1);
    expect(store.tasks[0]?.progress).toBe(0);

    store.updateTaskProgress(taskId, 5);
    expect(store.tasks[0]?.progress).toBe(1);
  });

  it('auto-promotes pending tasks to running on the first progress event', () => {
    const store = useBackgroundTasksStore();
    const taskId = store.addTask({ type: 'proxy', title: 'Task', status: 'pending' });

    store.updateTaskProgress(taskId, 0.1);

    expect(store.tasks[0]?.status).toBe('running');
    expect(store.tasks[0]?.progress).toBeCloseTo(0.1);
  });

  it('ignores progress updates for terminal tasks', () => {
    const store = useBackgroundTasksStore();
    const taskId = store.addTask({ type: 'other', title: 'Task' });
    store.updateTaskStatus(taskId, 'completed');

    store.updateTaskProgress(taskId, 0.1);

    expect(store.tasks[0]?.progress).toBe(1);
  });

  it('marks the task as cancelled after a successful cancel handler', async () => {
    const store = useBackgroundTasksStore();
    const cancel = vi.fn(async () => {
      // simulate downstream code that has not yet observed the abort
    });
    const taskId = store.addTask({ type: 'other', title: 'Task', cancel });

    await store.cancelTask(taskId);

    expect(cancel).toHaveBeenCalledOnce();
    expect(store.tasks[0]?.status).toBe('cancelled');
  });

  it('marks the task as failed when the cancel handler throws', async () => {
    const store = useBackgroundTasksStore();
    const cancel = vi.fn(async () => {
      throw new Error('cleanup failure');
    });
    const taskId = store.addTask({ type: 'other', title: 'Task', cancel });

    await store.cancelTask(taskId);

    expect(store.tasks[0]?.status).toBe('failed');
    expect(store.tasks[0]?.error).toBe('cleanup failure');
  });

  it('does not overwrite a terminal status set by the cancel handler', async () => {
    // Models the conversion flow: the cancel handler aborts the worker,
    // the worker rejects with AbortError, and the .catch downstream marks
    // the task as 'cancelled' with custom diagnostics. cancelTask must not
    // clobber that information.
    const store = useBackgroundTasksStore();
    let cancelComplete!: () => void;
    const cancelPromise = new Promise<void>((resolve) => {
      cancelComplete = resolve;
    });
    const cancel = vi.fn(async () => {
      // Simulate the downstream catch handler firing in parallel.
      store.updateTaskStatus(taskId, 'cancelled', 'Aborted from worker');
      await cancelPromise;
    });
    const taskId = store.addTask({ type: 'conversion', title: 'Convert', cancel });

    const cancelTaskPromise = store.cancelTask(taskId);
    cancelComplete();
    await cancelTaskPromise;

    expect(store.tasks[0]?.status).toBe('cancelled');
    expect(store.tasks[0]?.error).toBe('Aborted from worker');
  });

  it('exposes globalProgress as the average of active tasks', () => {
    const store = useBackgroundTasksStore();
    const a = store.addTask({ type: 'other', title: 'A' });
    const b = store.addTask({ type: 'other', title: 'B' });

    store.updateTaskProgress(a, 0.4);
    store.updateTaskProgress(b, 0.6);

    expect(store.globalProgress).toBeCloseTo(0.5);
    expect(store.hasActiveTasks).toBe(true);
  });

  it('hasActiveTasks becomes false once every task reaches a terminal state', () => {
    const store = useBackgroundTasksStore();
    const a = store.addTask({ type: 'other', title: 'A' });
    const b = store.addTask({ type: 'other', title: 'B' });

    store.updateTaskStatus(a, 'completed');
    store.updateTaskStatus(b, 'failed');

    expect(store.hasActiveTasks).toBe(false);
    expect(store.globalProgress).toBe(0);
  });

  it('returns sortedTasks in descending createdAt order', () => {
    vi.useFakeTimers();
    try {
      const store = useBackgroundTasksStore();
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
      const first = store.addTask({ type: 'other', title: 'First' });
      vi.setSystemTime(new Date('2024-01-01T00:00:01Z'));
      const second = store.addTask({ type: 'other', title: 'Second' });

      const sorted = store.sortedTasks;
      expect(sorted[0]?.id).toBe(second);
      expect(sorted[1]?.id).toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });
});
