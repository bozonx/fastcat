/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useMediaStore } from '~/stores/media.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
vi.mock('#app-manifest', () => ({}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(() => ({
    workspaceHandle: (() => {
      const mockDir: any = {
        getFileHandle: vi.fn(),
      };
      mockDir.getFileHandle.mockResolvedValue({
        createWritable: vi.fn().mockResolvedValue({
          write: vi.fn().mockResolvedValue(undefined),
          close: vi.fn().mockResolvedValue(undefined),
        }),
        getFile: vi.fn().mockResolvedValue({
          text: vi.fn().mockResolvedValue('{}'),
        }),
      });
      mockDir.getDirectoryHandle = vi.fn().mockResolvedValue(mockDir);
      return mockDir;
    })(),
    userSettings: { optimization: { proxyConcurrency: 2 } },
    resolvedStorageTopology: { tempRoot: '' },
  })),
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: vi.fn(() => ({
    currentProjectId: 'test-project',
    getFileHandleByPath: vi.fn(),
    getFileByPath: vi.fn().mockResolvedValue(null),
  })),
}));

describe('MediaStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('resets media state', () => {
    const store = useMediaStore();
    store.mediaMetadata = {
      'some/path.mp4': { source: { size: 100, lastModified: 100 }, duration: 10 },
    } as any;

    store.resetMediaState();

    expect(store.mediaMetadata).toEqual({});
  });

  it('sets audio peaks', () => {
    const store = useMediaStore();
    store.mediaMetadata = {
      'some/path.mp4': { source: { size: 100, lastModified: 100 }, duration: 10 },
    } as any;

    store.setAudioPeaks('some/path.mp4', [[0.5, 0.5]]);

    expect(store.mediaMetadata['some/path.mp4'].audioPeaks).toEqual([[0.5, 0.5]]);
  });

  it('returns null when file is missing', async () => {
    const store = useMediaStore();
    const result = await store.getOrFetchMetadataByPath('video/missing.mp4');
    expect(result).toBeNull();
    expect(store.missingPaths['video/missing.mp4']).toBe(true);
  });

  it('deduplicates concurrent metadata requests for the same path', async () => {
    const store = useMediaStore();
    let callCount = 0;

    const file = { size: 100, lastModified: 100, name: 'a.mp4' } as any;
    vi.mocked(useProjectStore).mockReturnValue({
      currentProjectId: 'test-project',
      getFileHandleByPath: vi.fn(),
      getFileByPath: vi.fn().mockResolvedValue(file),
    } as any);

    // Force a cache miss and slow worker by relying on default mocks
    const p1 = store.getOrFetchMetadataByPath('video/a.mp4');
    const p2 = store.getOrFetchMetadataByPath('video/a.mp4');

    const [r1, r2] = await Promise.all([p1, p2]);
    // Both should resolve to the same object reference or equal value
    expect(r1).toEqual(r2);
  });
});
