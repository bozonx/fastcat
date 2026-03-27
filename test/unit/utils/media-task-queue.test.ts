import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getMediaTaskQueue,
  addMediaTask,
  addLatestMediaTask,
  MEDIA_TASK_PRIORITIES,
} from '~/utils/media-task-queue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { ref } from 'vue';

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(),
}));

describe('media-task-queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports priorities', () => {
    expect(MEDIA_TASK_PRIORITIES.timelineThumbnailLazy).toBeDefined();
    expect(MEDIA_TASK_PRIORITIES.proxy).toBeDefined();
  });

  // Note: Since getting the queue is a singleton operation that initializes watchers
  // on a Vue store, full testing of the internal logic might require more complex mocks.
  // Here we just test that the functions are exported and don't crash when mocked.
  it('addMediaTask can be called (mocked store)', async () => {
    (useWorkspaceStore as any).mockReturnValue({
      userSettings: {
        optimization: {
          mediaTaskConcurrency: 4,
        },
      },
    });

    const task = vi.fn().mockResolvedValue('result');
    const promise = addMediaTask(task);

    // We expect the task to eventually run
    const result = await promise;
    expect(result).toBe('result');
    expect(task).toHaveBeenCalled();
  });

  it('addLatestMediaTask can be called', async () => {
    const task = vi.fn().mockResolvedValue(undefined);
    addLatestMediaTask({ key: 'test', task });

    // allow event loop to process
    await new Promise((r) => setTimeout(r, 0));
    expect(task).toHaveBeenCalled();
  });
});
