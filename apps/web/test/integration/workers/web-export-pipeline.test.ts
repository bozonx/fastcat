/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';
import {
  createCoalescedExportProgressReporter,
  runConcurrentExportWriters,
} from '~/workers/core/export';

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('web export pipeline orchestration', () => {
  it('starts audio and video writers without waiting for either branch to finish first', async () => {
    const audioDeferred = createDeferred();
    const videoDeferred = createDeferred();
    const events: string[] = [];
    const progressReporter = createCoalescedExportProgressReporter({
      onExportProgress: vi.fn().mockResolvedValue(undefined),
    });

    const runPromise = runConcurrentExportWriters({
      audioWriter: async () => {
        events.push('audio:start');
        await audioDeferred.promise;
        events.push('audio:end');
      },
      videoWriter: async () => {
        events.push('video:start');
        await videoDeferred.promise;
        events.push('video:end');
      },
      progressReporter,
      taskId: 'export-1',
    });

    await Promise.resolve();
    expect(events).toEqual(['audio:start', 'video:start']);

    videoDeferred.resolve();
    await Promise.resolve();
    expect(events).toEqual(['audio:start', 'video:start', 'video:end']);

    audioDeferred.resolve();
    await runPromise;
    expect(events).toEqual(['audio:start', 'video:start', 'video:end', 'audio:end']);
  });

  it('reports 99 only after every writer has settled', async () => {
    const audioDeferred = createDeferred();
    const onExportProgress = vi.fn().mockResolvedValue(undefined);
    const progressReporter = createCoalescedExportProgressReporter({ onExportProgress });

    const runPromise = runConcurrentExportWriters({
      audioWriter: async () => {
        await audioDeferred.promise;
      },
      videoWriter: async () => undefined,
      progressReporter,
      taskId: 'export-2',
    });

    await Promise.resolve();
    expect(onExportProgress).not.toHaveBeenCalled();

    audioDeferred.resolve();
    await runPromise;

    expect(onExportProgress).toHaveBeenCalledWith(99, 'export-2');
  });

  it('does not report completion progress when a writer fails', async () => {
    const onExportProgress = vi.fn().mockResolvedValue(undefined);
    const progressReporter = createCoalescedExportProgressReporter({ onExportProgress });

    await expect(
      runConcurrentExportWriters({
        audioWriter: async () => {
          throw new Error('audio failed');
        },
        videoWriter: async () => undefined,
        progressReporter,
        taskId: 'export-3',
      }),
    ).rejects.toThrow('audio failed');

    expect(onExportProgress).not.toHaveBeenCalled();
  });
});
