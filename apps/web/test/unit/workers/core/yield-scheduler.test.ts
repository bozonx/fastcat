import { afterEach, describe, expect, it } from 'vitest';
import { resetYieldScheduler, yieldToEventLoop } from '~/workers/core/yield-scheduler';

describe('yieldToEventLoop', () => {
  afterEach(() => {
    resetYieldScheduler();
  });

  it('resolves on a later macrotask, letting queued work run first', async () => {
    const order: string[] = [];
    const settled = yieldToEventLoop().then(() => order.push('yield'));
    // A microtask scheduled now must run before the macrotask yield resolves.
    void Promise.resolve().then(() => order.push('microtask'));
    await settled;
    expect(order).toEqual(['microtask', 'yield']);
  });

  it('coalesces concurrent waiters and resolves them all', async () => {
    const results = await Promise.all([
      yieldToEventLoop().then(() => 'a'),
      yieldToEventLoop().then(() => 'b'),
      yieldToEventLoop().then(() => 'c'),
    ]);
    expect(results).toEqual(['a', 'b', 'c']);
  });

  it('keeps working after the scheduler is reset', async () => {
    await yieldToEventLoop();
    resetYieldScheduler();
    await expect(yieldToEventLoop()).resolves.toBeUndefined();
  });
});
