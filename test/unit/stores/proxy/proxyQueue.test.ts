/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { createProxyQueueModule } from '~/stores/proxy/proxyQueue';

describe('createProxyQueueModule', () => {
  it('returns a proxyQueue ref wrapping shared PQueue', () => {
    const mod = createProxyQueueModule();
    expect(mod.proxyQueue).toBeDefined();
    expect(mod.proxyQueue.value).toBeDefined();
    expect(typeof mod.proxyQueue.value.add).toBe('function');
    expect(typeof mod.proxyQueue.value.clear).toBe('function');
  });

  it('shares queue instance across module calls', () => {
    const mod1 = createProxyQueueModule();
    const mod2 = createProxyQueueModule();
    expect(mod1.proxyQueue.value).toBe(mod2.proxyQueue.value);
  });

  it('queues and executes tasks sequentially or concurrently based on queue configuration', async () => {
    const mod = createProxyQueueModule();
    const executed: number[] = [];

    const task1 = mod.proxyQueue.value.add(async () => {
      executed.push(1);
      return 1;
    });

    const task2 = mod.proxyQueue.value.add(async () => {
      executed.push(2);
      return 2;
    });

    const results = await Promise.all([task1, task2]);

    expect(results).toEqual([1, 2]);
    expect(executed).toContain(1);
    expect(executed).toContain(2);
  });
});
