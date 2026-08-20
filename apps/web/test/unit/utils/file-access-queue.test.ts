import { describe, expect, it } from 'vitest';
import { runQueuedFileAccess } from '~/utils/file-access-queue';

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('file-access-queue', () => {
  it('serializes operations with the same key', async () => {
    const events: string[] = [];
    const firstStarted = createDeferred();
    const releaseFirst = createDeferred();

    const first = runQueuedFileAccess({
      key: 'same',
      task: async () => {
        events.push('a:start');
        firstStarted.resolve();
        await releaseFirst.promise;
        events.push('a:end');
      },
    });
    await firstStarted.promise;

    const second = runQueuedFileAccess({
      key: 'same',
      task: async () => {
        events.push('b:start');
        events.push('b:end');
      },
    });

    expect(events).toEqual(['a:start']);
    releaseFirst.resolve();
    await Promise.all([first, second]);

    expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('allows operations with different keys to overlap', async () => {
    const events: string[] = [];
    const firstStarted = createDeferred();
    const releaseFirst = createDeferred();

    const first = runQueuedFileAccess({
      key: 'a',
      task: async () => {
        events.push('a:start');
        firstStarted.resolve();
        await releaseFirst.promise;
        events.push('a:end');
      },
    });
    await firstStarted.promise;

    const second = runQueuedFileAccess({
      key: 'b',
      task: async () => {
        events.push('b:start');
        events.push('b:end');
      },
    });

    await second;
    releaseFirst.resolve();
    await first;

    expect(events).toContain('a:start');
    expect(events).toContain('b:start');
    expect(events.indexOf('b:start')).toBeLessThan(events.indexOf('a:end'));
  });

  it('continues after a failed operation', async () => {
    const events: string[] = [];

    await Promise.allSettled([
      runQueuedFileAccess({
        key: 'failure',
        task: async () => {
          events.push('first');
          throw new Error('boom');
        },
      }),
      runQueuedFileAccess({
        key: 'failure',
        task: async () => {
          events.push('second');
        },
      }),
    ]);

    expect(events).toEqual(['first', 'second']);
  });
});
