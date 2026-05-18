/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useProxyStore } from '~/stores/proxy.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(() => ({
    workspaceHandle: {},
    userSettings: { optimization: { proxyConcurrency: 2 } },
  })),
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: vi.fn(() => ({
    currentProjectId: 'test-project',
    getFileHandleByPath: vi.fn(),
  })),
}));

describe('ProxyStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('initializes with empty state', () => {
    const store = useProxyStore();
    expect(store.generatingProxies.size).toBe(0);
    expect(store.existingProxies.size).toBe(0);
    expect(store.activeWorkerPaths.size).toBe(0);
    expect(store.proxyProgress.size).toBe(0);
  });

  it('can have its internal proxy collections cleared manually', () => {
    const store = useProxyStore();
    store.generatingProxies.add('a');
    store.existingProxies.add('b');
    store.activeWorkerPaths.add('c');
    store.proxyProgress.set('a', 50);

    store.generatingProxies.clear();
    store.existingProxies.clear();
    store.activeWorkerPaths.clear();
    store.proxyProgress.clear();

    expect(store.generatingProxies.size).toBe(0);
    expect(store.existingProxies.size).toBe(0);
    expect(store.activeWorkerPaths.size).toBe(0);
    expect(store.proxyProgress.size).toBe(0);
  });

  it('exposes service actions as store methods', () => {
    const store = useProxyStore();
    expect(typeof store.generateProxy).toBe('function');
    expect(typeof store.generateProxiesForFolder).toBe('function');
    expect(typeof store.cancelProxyGeneration).toBe('function');
    expect(typeof store.deleteProxy).toBe('function');
    expect(typeof store.renameProxy).toBe('function');
    expect(typeof store.renameProxyDir).toBe('function');
    expect(typeof store.checkExistingProxies).toBe('function');
    expect(typeof store.getProxyFileHandle).toBe('function');
    expect(typeof store.getProxyFile).toBe('function');
  });
});
