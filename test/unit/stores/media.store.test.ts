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
});
