import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { getClipThumbnailsHash, thumbnailGenerator } from '~/utils/thumbnail-generator';
import { getFileThumbnailHash, fileThumbnailGenerator } from '~/utils/file-thumbnail-generator';

const mockFile = new File([], 'test.mp4');

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

    (useWorkspaceStore as any).mockReturnValue({
      workspaceHandle: {
        getDirectoryHandle: vi.fn(),
      },
      resolvedStorageTopology: {},
    });

    (useProjectStore as any).mockReturnValue({
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
      (fileThumbnailGenerator as any).cache.set('test-hash', 'test-url');
      expect((fileThumbnailGenerator as any).cache.has('test-hash')).toBe(true);

      await fileThumbnailGenerator.clearThumbnail({
        projectId: 'p1',
        projectRelativePath: 'test.mp4',
      });

      // We need to know what the hash would be
      const hash = getFileThumbnailHash({
        projectId: 'p1',
        projectRelativePath: 'test.mp4',
      });

      expect((fileThumbnailGenerator as any).cache.has(hash)).toBe(false);
    });
  });

  describe('thumbnailGenerator (timeline)', () => {
    it('should clear internal cache and folder for project hash', async () => {
      (thumbnailGenerator as any).cache.set('timeline-hash', ['url1', 'url2']);
      expect((thumbnailGenerator as any).cache.has('timeline-hash')).toBe(true);

      await thumbnailGenerator.clearThumbnails({
        projectId: 'p1',
        hash: 'timeline-hash',
      });

      expect((thumbnailGenerator as any).cache.has('timeline-hash')).toBe(false);
    });
  });
});
