/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('media-task-queue', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('exports interactive + encode priorities on separate scales', async () => {
    const { MEDIA_TASK_PRIORITIES, ENCODE_TASK_PRIORITIES } =
      await import('~/utils/media-task-queue');

    // Interactive queue: visible timeline thumbnails outrank file thumbnails,
    // which outrank the lazy marker stills.
    expect(MEDIA_TASK_PRIORITIES.timelineThumbnail).toBeGreaterThan(
      MEDIA_TASK_PRIORITIES.fileThumbnail,
    );
    expect(MEDIA_TASK_PRIORITIES.fileThumbnail).toBeGreaterThan(
      MEDIA_TASK_PRIORITIES.markerThumbnail,
    );

    // Encodes live on their own scale; an explicit conversion is ordered ahead
    // of an automatic proxy.
    expect(ENCODE_TASK_PRIORITIES.conversion).toBeGreaterThan(ENCODE_TASK_PRIORITIES.proxy);
  });

  it('runs encodes on a pool isolated from the interactive queue', async () => {
    const { addMediaTask, addEncodeTask, __resetMediaTaskQueueForTesting } =
      await import('~/utils/media-task-queue');
    // Saturate the interactive queue with a task that never resolves.
    __resetMediaTaskQueueForTesting(1);
    let releaseInteractive!: () => void;
    void addMediaTask(
      () =>
        new Promise<void>((resolve) => {
          releaseInteractive = resolve;
        }),
    );

    // An encode must still run to completion even though the interactive queue
    // is fully occupied — proving encodes don't share those slots.
    const encode = vi.fn().mockResolvedValue('ok');
    await expect(addEncodeTask(encode)).resolves.toBe('ok');
    expect(encode).toHaveBeenCalledOnce();

    releaseInteractive();
  });

  it('runs queued tasks', async () => {
    const { addMediaTask } = await import('~/utils/media-task-queue');
    const task = vi.fn().mockResolvedValue('result');

    await expect(addMediaTask(task)).resolves.toBe('result');
    expect(task).toHaveBeenCalled();
  });

  it('does not start an aborted pending task', async () => {
    const { addMediaTask, __resetMediaTaskQueueForTesting } =
      await import('~/utils/media-task-queue');
    __resetMediaTaskQueueForTesting(1);
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
    const { addLatestMediaTask, __resetMediaTaskQueueForTesting } =
      await import('~/utils/media-task-queue');
    __resetMediaTaskQueueForTesting(1);
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
