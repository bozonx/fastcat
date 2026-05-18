/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const workspaceStore = vi.hoisted(() => ({
  userSettings: {
    optimization: {
      mediaTaskConcurrency: 1,
    },
  },
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => workspaceStore,
}));

describe('media-task-queue', () => {
  beforeEach(() => {
    vi.resetModules();
    workspaceStore.userSettings.optimization.mediaTaskConcurrency = 1;
  });

  it('exports priorities', async () => {
    const { MEDIA_TASK_PRIORITIES } = await import('~/utils/media-task-queue');

    expect(MEDIA_TASK_PRIORITIES.timelineThumbnailLazy).toBeDefined();
    expect(MEDIA_TASK_PRIORITIES.proxy).toBeDefined();
  });

  it('runs queued tasks', async () => {
    const { addMediaTask } = await import('~/utils/media-task-queue');
    const task = vi.fn().mockResolvedValue('result');

    await expect(addMediaTask(task)).resolves.toBe('result');
    expect(task).toHaveBeenCalled();
  });

  it('does not start an aborted pending task', async () => {
    const { addMediaTask } = await import('~/utils/media-task-queue');
    let releaseFirstTask!: () => void;
    const controller = new AbortController();
    const pendingTask = vi.fn().mockResolvedValue(undefined);

    const firstTask = addMediaTask(
      () =>
        new Promise<void>((resolve) => {
          releaseFirstTask = resolve;
        }),
    );
    const secondTask = addMediaTask(pendingTask, { signal: controller.signal });

    controller.abort();
    releaseFirstTask();

    await firstTask;
    await expect(secondTask).rejects.toMatchObject({ name: 'AbortError' });
    expect(pendingTask).not.toHaveBeenCalled();
  });

  it('only runs the latest keyed task', async () => {
    const { addLatestMediaTask } = await import('~/utils/media-task-queue');
    let releaseFirstTask!: () => void;
    const first = vi.fn().mockResolvedValue(undefined);
    const second = vi.fn().mockResolvedValue(undefined);

    addLatestMediaTask({
      key: 'preview',
      task: () =>
        new Promise<void>((resolve) => {
          releaseFirstTask = resolve;
        }),
    });
    addLatestMediaTask({ key: 'preview', task: first });
    addLatestMediaTask({ key: 'preview', task: second });

    releaseFirstTask();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});
