vi.mock('#app-manifest', () => ({}));
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useMediaStore } from '../../../src/stores/media.store';
import { useWorkspaceStore } from '../../../src/stores/workspace.store';
import { useProjectStore } from '../../../src/stores/project.store';

vi.mock('../../../src/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(() => ({
    workspaceHandle: (() => {
      const mockDir: any = {
        getFileHandle: vi.fn().mockResolvedValue({
          createWritable: vi.fn().mockResolvedValue({
            write: vi.fn(),
            close: vi.fn(),
          }),
        }),
      };
      mockDir.getDirectoryHandle = vi.fn().mockResolvedValue(mockDir);
      return mockDir;
    })(),
    userSettings: { optimization: { proxyConcurrency: 2 } },
  })),
}));

vi.mock('../../../src/stores/project.store', () => ({
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
