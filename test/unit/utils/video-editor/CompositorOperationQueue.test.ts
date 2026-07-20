/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CompositorOperationQueue } from '~/utils/video-editor/compositor/CompositorOperationQueue';

const flush = () => new Promise((r) => setTimeout(r, 0));

function defer<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('CompositorOperationQueue', () => {
  it('runs operations sequentially', async () => {
    const queue = new CompositorOperationQueue();
    const order: string[] = [];

    const p1 = queue.run(async () => {
      order.push('op1-start');
      await flush();
      order.push('op1-end');
      return 1;
    }, 'op1');

    const p2 = queue.run(async () => {
      order.push('op2-start');
      order.push('op2-end');
      return 2;
    }, 'op2');

    await Promise.all([p1, p2]);
    expect(order).toEqual(['op1-start', 'op1-end', 'op2-start', 'op2-end']);
  });

  it('runs an interactive operation before queued background work', async () => {
    const queue = new CompositorOperationQueue();
    const order: string[] = [];
    const first = defer();

    const firstPromise = queue.run(async () => {
      order.push('first');
      await first.promise;
    }, 'first');
    const warmPromise = queue.run(() => order.push('prewarm'), 'prewarm', 'background');
    const renderPromise = queue.run(() => order.push('render'), 'render');

    first.resolve();
    await Promise.all([firstPromise, warmPromise, renderPromise]);

    expect(order).toEqual(['first', 'render', 'prewarm']);
  });

  it('aborts a running background operation when an interactive operation arrives', async () => {
    const queue = new CompositorOperationQueue();
    const backgroundStarted = defer();
    const background = queue.run(
      async (signal) => {
        backgroundStarted.resolve();
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', resolve, { once: true }),
        );
      },
      'prewarm',
      'background',
    );

    await backgroundStarted.promise;
    const render = queue.run(() => 'rendered', 'render');

    await expect(background).resolves.toBeUndefined();
    await expect(render).resolves.toBe('rendered');
  });

  it('passes an AbortSignal to the operation', async () => {
    const queue = new CompositorOperationQueue();
    const handler = vi.fn((signal: AbortSignal) => {
      expect(signal).toBeInstanceOf(AbortSignal);
      return 'ok';
    });
    await queue.run(handler, 'op');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('aborts a stalled operation via watchdog signal', async () => {
    // Use a short timeout to keep the test fast — the watchdog uses
    // setTimeout internally, so we can stub it to fire immediately.
    const queue = new CompositorOperationQueue();

    const resultPromise = queue.run(async (signal: AbortSignal) => {
      return await new Promise<string>((_res, rej) => {
        signal.addEventListener('abort', () => rej(new Error('aborted')));
      });
    }, 'stalled');

    // The watchdog timer fires after OP_QUEUE_WATCHDOG_MS (15s by default).
    // We don't wait that long — instead, advance fake timers.
    vi.useFakeTimers();
    vi.advanceTimersByTime(20_000);
    vi.useRealTimers();

    await expect(resultPromise).rejects.toThrow('aborted');
  });

  it('allows a queued operation to run after the stalled one is aborted', async () => {
    const queue = new CompositorOperationQueue();

    const stalledPromise = queue.run(async (signal: AbortSignal) => {
      return await new Promise<string>((_res, rej) => {
        signal.addEventListener('abort', () => rej(new Error('aborted')));
      });
    }, 'stalled');

    // Queue a second op while the first is still running
    const secondPromise = queue.run(async () => 'second-ok', 'second');

    // Fire the watchdog to abort the stalled op
    vi.useFakeTimers();
    vi.advanceTimersByTime(20_000);
    vi.useRealTimers();

    await expect(stalledPromise).rejects.toThrow('aborted');
    // The second op should now run and succeed
    await expect(secondPromise).resolves.toBe('second-ok');
  });

  it('propagates errors without breaking the queue', async () => {
    const queue = new CompositorOperationQueue();

    await expect(
      queue.run(async () => {
        throw new Error('op-failed');
      }, 'failing'),
    ).rejects.toThrow('op-failed');

    // Next op should still work
    await expect(queue.run(async () => 'ok', 'after-fail')).resolves.toBe('ok');
  });

  it('drain resolves after all queued operations complete', async () => {
    const queue = new CompositorOperationQueue();
    let resolved = false;

    queue.run(async () => {
      await flush();
      resolved = true;
    }, 'op');

    await queue.drain();
    expect(resolved).toBe(true);
  });

  it('drain resolves even if an operation rejected', async () => {
    const queue = new CompositorOperationQueue();

    queue
      .run(async () => {
        throw new Error('fail');
      }, 'failing')
      .catch(() => undefined);

    // drain should not reject
    await expect(queue.drain()).resolves.toBeUndefined();
  });

  it('handles synchronous operations', async () => {
    const queue = new CompositorOperationQueue();
    const result = await queue.run(() => 42, 'sync-op');
    expect(result).toBe(42);
  });
});
