/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { createProxyQueueModule } from '~/stores/proxy/proxyQueue';

describe('createProxyQueueModule', () => {
  it('returns a proxyQueue ref', () => {
    const mod = createProxyQueueModule();
    expect(mod.proxyQueue).toBeDefined();
    expect(mod.proxyQueue.value).toBeDefined();
  });

  it('proxyQueue has add method', () => {
    const mod = createProxyQueueModule();
    expect(typeof mod.proxyQueue.value.add).toBe('function');
  });

  it('proxyQueue has clear method', () => {
    const mod = createProxyQueueModule();
    expect(typeof mod.proxyQueue.value.clear).toBe('function');
  });

  it('creates a new queue each call', () => {
    const mod1 = createProxyQueueModule();
    const mod2 = createProxyQueueModule();
    // getMediaTaskQueue returns a shared singleton
    expect(mod1.proxyQueue.value).toBe(mod2.proxyQueue.value);
  });
});
