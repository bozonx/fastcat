/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useProxyStore } from '~/stores/proxy.store';

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(() => ({
    workspaceHandle: {},
    resolvedStorageTopology: { proxiesRoot: '' },
    userSettings: {
      optimization: {
        proxyMaxPixels: 640 * 360,
        proxyVideoBitrateMbps: 1,
        proxyAudioBitrateKbps: 96,
        proxyCopyOpusAudio: false,
      },
    },
  })),
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: vi.fn(() => ({
    currentProjectId: 'test-project',
    getFileHandleByPath: vi.fn(),
    getFileByPath: vi.fn(),
  })),
}));

vi.mock('~/stores/background-tasks.store', () => ({
  useBackgroundTasksStore: vi.fn(() => ({
    addTask: vi.fn(() => 'task-1'),
    updateTaskStatus: vi.fn(),
    updateTaskProgress: vi.fn(),
  })),
}));

vi.mock('nuxt/app', () => ({
  useNuxtApp: () => ({
    $i18nService: {
      t: (key: string, params?: Record<string, string>) => `${key}:${params?.fileName ?? ''}`,
    },
  }),
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

  it('maintains reactive state collections and updates reactively', () => {
    const store = useProxyStore();
    store.generatingProxies.add('_video/clip1.mp4');
    store.existingProxies.add('_video/clip2.mp4');
    store.proxyProgress.set('_video/clip1.mp4', 45);

    expect(store.generatingProxies.has('_video/clip1.mp4')).toBe(true);
    expect(store.existingProxies.has('_video/clip2.mp4')).toBe(true);
    expect(store.proxyProgress.get('_video/clip1.mp4')).toBe(45);

    store.generatingProxies.delete('_video/clip1.mp4');
    store.proxyProgress.delete('_video/clip1.mp4');

    expect(store.generatingProxies.size).toBe(0);
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

  it('returns null for getProxyNativePath in web runtime environment', async () => {
    const store = useProxyStore();
    store.existingProxies.add('_video/clip.mp4');

    const nativePath = await store.getProxyNativePath('_video/clip.mp4');
    expect(nativePath).toBeNull();
  });

  it('exposes all expected service actions as store methods', () => {
    const store = useProxyStore();
    expect(typeof store.generateProxy).toBe('function');
    expect(typeof store.generateProxiesForFolder).toBe('function');
    expect(typeof store.generateProxiesBatch).toBe('function');
    expect(typeof store.cancelProxyGeneration).toBe('function');
    expect(typeof store.deleteProxy).toBe('function');
    expect(typeof store.deleteProxiesBatch).toBe('function');
    expect(typeof store.renameProxy).toBe('function');
    expect(typeof store.renameProxyDir).toBe('function');
    expect(typeof store.checkExistingProxies).toBe('function');
    expect(typeof store.getProxyFileHandle).toBe('function');
    expect(typeof store.getProxyFile).toBe('function');
    expect(typeof store.getProxyNativePath).toBe('function');
  });
});
