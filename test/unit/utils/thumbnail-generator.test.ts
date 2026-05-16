/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { getClipThumbnailsHash, thumbnailGenerator } from '~/utils/thumbnail-generator';
import { getFileThumbnailHash, fileThumbnailGenerator } from '~/utils/file-thumbnail-generator';

const mockFile = new File([], 'test.mp4');

interface CacheBackedGenerator {
  cache: Map<string, unknown>;
}

interface TimelineThumbnailGeneratorInternals extends CacheBackedGenerator {
  onCacheHit: (
    task: {
      id: string;
      projectId: string;
      projectRelativePath: string;
      duration: number;
      onProgress?: (progress: number, url: string, time: number) => void;
      onComplete?: () => void;
    },
    urls: Map<number, string>,
  ) => void;
}

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(),
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: vi.fn(),
}));

// Mock URL.createObjectURL/revokeObjectURL
global.URL.createObjectURL = vi.fn(() => 'blob:url');
global.URL.revokeObjectURL = vi.fn();

describe('Thumbnail Generators', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    vi.mocked(useWorkspaceStore).mockReturnValue({
      workspaceHandle: (function () {
        const h = { getDirectoryHandle: vi.fn(), removeEntry: vi.fn() };
        h.getDirectoryHandle.mockResolvedValue(h);
        return h;
      })(),
      resolvedStorageTopology: {
        tempRoot: '',
        proxiesRoot: '',
      },
    });

    vi.mocked(useProjectStore).mockReturnValue({
      currentProjectId: 'test-project',
      getFileByPath: vi.fn().mockResolvedValue(mockFile),
      getFileHandleByPath: vi.fn().mockResolvedValue({}),
    });
  });

  describe('getClipThumbnailsHash', () => {
    it('should generate consistent hash for clip thumbnails', () => {
      const hash1 = getClipThumbnailsHash({
        projectId: 'p1',
        projectRelativePath: 'v1.mp4',
      });
      const hash2 = getClipThumbnailsHash({
        projectId: 'p1',
        projectRelativePath: 'v1.mp4',
      });
      const hash3 = getClipThumbnailsHash({
        projectId: 'p1',
        projectRelativePath: 'v2.mp4',
      });

      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(hash3);
    });
  });

  describe('getFileThumbnailHash', () => {
    it('should generate consistent hash for file thumbnails', () => {
      const hash1 = getFileThumbnailHash({
        projectId: 'p1',
        projectRelativePath: 'v1.mp4',
      });
      const hash2 = getFileThumbnailHash({
        projectId: 'p1',
        projectRelativePath: 'v1.mp4',
      });

      expect(hash1).toBe(hash2);
      expect(hash1.startsWith('file:')).toBe(false); // getFileThumbnailHash uses prefix "file:" but it's hashed
    });
  });

  describe('fileThumbnailGenerator', () => {
    it('should clear internal cache for a specific file', async () => {
      // Mocking internal cache for the purpose of the test
      const generator = fileThumbnailGenerator as unknown as CacheBackedGenerator;

      generator.cache.set('test-hash', 'test-url');
      expect(generator.cache.has('test-hash')).toBe(true);

      await fileThumbnailGenerator.clearThumbnail({
        projectId: 'p1',
        projectRelativePath: 'test.mp4',
      });

      // We need to know what the hash would be
      const hash = getFileThumbnailHash({
        projectId: 'p1',
        projectRelativePath: 'test.mp4',
      });

      expect(generator.cache.has(hash)).toBe(false);
    });
  });

  describe('thumbnailGenerator (timeline)', () => {
    it('should clear internal cache and folder for project hash', async () => {
      const generator = thumbnailGenerator as unknown as CacheBackedGenerator;

      generator.cache.set(
        'timeline-hash',
        new Map([
          [0, 'url1'],
          [4, 'url2'],
        ]),
      );
      expect(generator.cache.has('timeline-hash')).toBe(true);

      await thumbnailGenerator.clearThumbnails({
        projectId: 'p1',
        hash: 'timeline-hash',
      });

      expect(generator.cache.has('timeline-hash')).toBe(false);
    });

    it('should replay cached thumbnails sorted by capture time', () => {
      const progress = vi.fn();
      const complete = vi.fn();

      const generator = thumbnailGenerator as unknown as TimelineThumbnailGeneratorInternals;

      generator.onCacheHit(
        {
          id: 'timeline-hash',
          projectId: 'p1',
          projectRelativePath: 'test.mp4',
          duration: 12,
          onProgress: progress,
          onComplete: complete,
        },
        new Map([
          [8, 'url-8'],
          [0, 'url-0'],
          [4, 'url-4'],
        ]),
      );

      expect(progress.mock.calls.map((call) => [call[1], call[2]])).toEqual([
        ['url-0', 0],
        ['url-4', 4],
        ['url-8', 8],
      ]);
      expect(complete).toHaveBeenCalledOnce();
    });
  });
});
