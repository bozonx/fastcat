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

  it('grants only one queued slot per freed slot (no over-subscription)', async () => {
    const max = VIDEO_CORE_LIMITS.MAX_CONCURRENT_VIDEO_SAMPLE_REQUESTS;
    const rm = new ResourceManager();

    let started = 0;
    // Fill every slot and queue two extra waiters behind the limit.
    const decodes = Array.from({ length: max + 2 }, () => deferred<{ close: () => void }>());
    const callers = decodes.map((decode) =>
      rm
        .withVideoSampleSlot(() => {
          started += 1;
          return decode.promise;
        })
        .then(
          (value) => ({ status: 'fulfilled' as const, value }),
          (reason) => ({ status: 'rejected' as const, reason }),
        ),
    );

    await flush();
    expect(started).toBe(max);

    // Freeing ONE slot must start exactly one queued decode — not drain the whole
    // queue. The in-flight count is incremented asynchronously by each waiter, so
    // a buggy queue would hand the single freed slot to both waiters at once.
    decodes[0].resolve({ close: () => {} });
    await flush();
    expect(started).toBe(max + 1);

    // Freeing the next slot releases the final queued decode.
    decodes[1].resolve({ close: () => {} });
    await flush();
    expect(started).toBe(max + 2);

    decodes.slice(2).forEach((decode) => decode.resolve({ close: () => {} }));
    await Promise.all(callers);
  });

  it('retries transient failures and eventually succeeds', async () => {
    const rm = new ResourceManager();
    let calls = 0;

    const result = await rm.withVideoSampleSlot(
      async () => {
        calls += 1;
        if (calls < 3) {
          throw Object.assign(new Error('Failed to create datapipe'), {
            name: 'InvalidStateError',
          });
        }
        return 'decoded-frame';
      },
      undefined,
      { attempts: 4, baseDelayMs: 1 },
    );

    expect(result).toBe('decoded-frame');
    expect(calls).toBe(3);
  });

  it('gives up after maximum attempts and propagates the last error', async () => {
    const rm = new ResourceManager();
    let calls = 0;

    await expect(
      rm.withVideoSampleSlot(
        async () => {
          calls += 1;
          throw Object.assign(new Error('Failed to create datapipe'), {
            name: 'InvalidStateError',
          });
        },
        undefined,
        { attempts: 3, baseDelayMs: 1 },
      ),
    ).rejects.toThrow('Failed to create datapipe');

    expect(calls).toBe(3);
  });

  it('does not retry non-transient errors', async () => {
    const rm = new ResourceManager();
    let calls = 0;

    await expect(
      rm.withVideoSampleSlot(
        async () => {
          calls += 1;
          throw new Error('Some decoder error');
        },
        undefined,
        { attempts: 3, baseDelayMs: 1 },
      ),
    ).rejects.toThrow('Some decoder error');

    expect(calls).toBe(1);
  });

  it('does not retry if signal is aborted', async () => {
    const rm = new ResourceManager();
    let calls = 0;
    const controller = new AbortController();

    const taskPromise = rm.withVideoSampleSlot(
      async () => {
        calls += 1;
        // Trigger abort before throwing the error
        controller.abort();
        throw Object.assign(new Error('Failed to create datapipe'), { name: 'InvalidStateError' });
      },
      controller.signal,
      { attempts: 3, baseDelayMs: 1 },
    );

    await expect(taskPromise).rejects.toThrow();
    // Should have only called the task once because it got aborted
    expect(calls).toBe(1);
  });
});
