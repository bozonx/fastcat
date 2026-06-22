/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { effectScope, nextTick, reactive, ref } from 'vue';
import { useFileManagerThumbnails } from '~/composables/file-manager/useFileManagerThumbnails';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useMediaStore } from '~/stores/media.store';
import { fileThumbnailGenerator } from '~/utils/file-thumbnail-generator';
import type { FsEntry } from '~/types/fs';

vi.mock('~/stores/project.store', () => ({
  useProjectStore: vi.fn(),
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(),
}));

vi.mock('~/stores/media.store', () => ({
  useMediaStore: vi.fn(),
}));

vi.mock('~/utils/file-thumbnail-generator', () => ({
  getFileThumbnailHash: vi.fn(
    (input: { projectId: string; projectRelativePath: string; source?: unknown }) =>
      JSON.stringify(input),
  ),
  fileThumbnailGenerator: {
    addTask: vi.fn(),
    cancelTask: vi.fn(),
  },
}));

async function flushAsyncState() {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
    await nextTick();
  }
}

describe('useFileManagerThumbnails', () => {
  let mediaMetadata: Record<string, any>;
  let metadataLoadFailed: Record<string, boolean>;
  let metadataLoading: Record<string, boolean>;
  let getOrFetchMetadata: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mediaMetadata = reactive({});
    metadataLoadFailed = reactive({});
    metadataLoading = reactive({});
    getOrFetchMetadata = vi.fn(async (_file: File, cacheKey: string) => {
      const metadata = {
        source: { size: 1, lastModified: 1 },
        duration: 0,
        error: true,
      };
      mediaMetadata[cacheKey] = metadata;
      metadataLoadFailed[cacheKey] = true;
      return metadata;
    });

    vi.mocked(useProjectStore).mockReturnValue({
      currentProjectId: 'p1',
    } as any);
    vi.mocked(useWorkspaceStore).mockReturnValue({
      workspaceHandle: {},
      hasPersistentStorage: true,
    } as any);
    vi.mocked(useMediaStore).mockReturnValue({
      mediaMetadata,
      metadataLoadFailed,
      metadataLoading,
      getOrFetchMetadata,
      getCachedMetadata: (path: string) => mediaMetadata[path],
    } as any);

    global.URL.createObjectURL = vi.fn(() => 'blob:image');
    global.URL.revokeObjectURL = vi.fn();
  });

  it('uses metadata cache for corrupt image thumbnails and does not revalidate after failure', async () => {
    metadataLoadFailed['broken.png'] = true;

    const entries = ref<FsEntry[]>([
      { kind: 'file', name: 'broken.png', path: 'broken.png', source: 'local' },
    ]);

    const scope = effectScope();
    scope.run(() => useFileManagerThumbnails(entries, { getFile: vi.fn() } as any));
    await flushAsyncState();

    expect(fileThumbnailGenerator.addTask).not.toHaveBeenCalled();

    scope.stop();
  });

  it('includes file fingerprint in video thumbnail tasks when entry metadata is available', async () => {
    const entries = ref<FsEntry[]>([
      {
        kind: 'file',
        name: 'clip.mp4',
        path: 'clip.mp4',
        source: 'local',
        size: 100,
        lastModified: 200,
      },
    ]);

    const scope = effectScope();
    scope.run(() => useFileManagerThumbnails(entries, { getFile: vi.fn() } as any));
    await flushAsyncState();

    expect(fileThumbnailGenerator.addTask).toHaveBeenCalledWith(
      expect.objectContaining({
        id: JSON.stringify({
          projectId: 'p1',
          projectRelativePath: 'clip.mp4',
          source: { size: 100, lastModified: 200 },
        }),
      }),
    );

    scope.stop();
  });
});
