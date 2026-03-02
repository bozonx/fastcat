import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useProxyStore } from '../../../src/stores/proxy.store';
import { useWorkspaceStore } from '../../../src/stores/workspace.store';
import { useProjectStore } from '../../../src/stores/project.store';

vi.mock('../../../src/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(() => ({
    workspaceHandle: {},
    userSettings: { optimization: { proxyConcurrency: 2 } },
  })),
}));

vi.mock('../../../src/stores/project.store', () => ({
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
    expect(store.proxyProgress).toEqual({});
  });

  it('can have its internal proxy collections cleared manually', () => {
    const store = useProxyStore();
    store.generatingProxies.add('a');
    store.existingProxies.add('b');
    store.activeWorkerPaths.add('c');
    store.proxyProgress['a'] = 50;

    store.generatingProxies.clear();
    store.existingProxies.clear();
    store.activeWorkerPaths.clear();
    store.proxyProgress = {};

    expect(store.generatingProxies.size).toBe(0);
    expect(store.existingProxies.size).toBe(0);
    expect(store.activeWorkerPaths.size).toBe(0);
    expect(store.proxyProgress).toEqual({});
  });
});
