// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { ResourceManager } from '~/utils/video-editor/compositor/ResourceManager';
import { VIDEO_CORE_LIMITS } from '~/utils/constants';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('ResourceManager.withVideoSampleSlot', () => {
  it('resolves with the task value and releases the slot on success', async () => {
    const rm = new ResourceManager();
    await expect(rm.withVideoSampleSlot(async () => 'frame')).resolves.toBe('frame');
  });

  it('holds the slot until the real decode settles, even when the caller aborts', async () => {
    const max = VIDEO_CORE_LIMITS.MAX_CONCURRENT_VIDEO_SAMPLE_REQUESTS;
    const rm = new ResourceManager();

    let started = 0;
    const decodes = Array.from({ length: max + 1 }, () => deferred<{ close: () => void }>());

    const callers = decodes.map((decode, index) => {
      const controller = new AbortController();
      const settled = rm
        .withVideoSampleSlot(() => {
          started += 1;
          return decode.promise;
        }, controller.signal)
        .then(
          (value) => ({ status: 'fulfilled' as const, value }),
          (reason) => ({ status: 'rejected' as const, reason }),
        );
      return { controller, settled, index };
    });

    await flush();
    // The slot caps how many decodes can be in flight; the extra one is queued.
    expect(started).toBe(max);

    // The caller of the first decode bails out...
    callers[0].controller.abort();
    await expect(callers[0].settled).resolves.toMatchObject({ status: 'rejected' });
    await flush();
    // ...but the decode is not cancellable, so its slot must stay occupied and
    // the queued decode must NOT start yet.
    expect(started).toBe(max);

    // Once the orphaned decode actually finishes, its slot frees up, the queued
    // decode starts, and the abandoned sample is disposed.
    const closeSpy = vi.fn();
    decodes[0].resolve({ close: closeSpy });
    await flush();
    expect(started).toBe(max + 1);
    expect(closeSpy).toHaveBeenCalledTimes(1);

    // Drain the rest so no decode is left dangling.
    decodes.slice(1).forEach((decode) => decode.resolve({ close: () => {} }));
    await Promise.all(callers.map((caller) => caller.settled));
  });
});
