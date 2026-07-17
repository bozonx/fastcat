/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { getClipThumbnailsHash, thumbnailGenerator } from '~/utils/thumbnail-generator';
import { getFileThumbnailHash, fileThumbnailGenerator } from '~/utils/file-thumbnail-generator';

const mockFile = new File([], 'test.mp4');
const mockVfs = vi.hoisted(() => ({
  readDirectory: vi.fn().mockResolvedValue([]),
  readFile: vi
    .fn()
    .mockRejectedValue(Object.assign(new Error('missing'), { name: 'VfsNotFoundError' })),
  writeFile: vi.fn().mockResolvedValue(undefined),
  deleteEntry: vi.fn().mockResolvedValue(undefined),
}));

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

let mockIsNative = false;
const mockMediaProcessor = vi.hoisted(() => ({
  id: 'web',
  extractVideoFrameBlob: vi.fn().mockResolvedValue(new Blob(['test'], { type: 'image/webp' })),
  extractVideoFrameBlobs: vi.fn().mockResolvedValue([new Blob(['test'], { type: 'image/webp' })]),
  extractTimelineFrameBlob: vi.fn().mockResolvedValue(new Blob(['test'], { type: 'image/webp' })),
  cancelVideoFrameExtraction: vi.fn().mockResolvedValue(undefined),
  releaseVideoFrameExtractor: vi.fn().mockResolvedValue(undefined),
  dispose: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('~/composables/useMediaProcessor', () => ({
  useMediaProcessor: vi.fn(() => ({
    ...mockMediaProcessor,
    id: mockIsNative ? 'native' : 'web',
  })),
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(),
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: vi.fn(),
}));

vi.mock('~/utils/media-task-queue', () => ({
  addMediaTask: vi.fn((task: () => Promise<void>) => task()),
  MEDIA_TASK_PRIORITIES: {
    timelineThumbnail: 2,
    markerThumbnail: 0,
    fileThumbnail: 1,
  },
}));

vi.mock('~/utils/io/io-governor', () => ({
  withFileIoSlot: vi.fn((fn: () => Promise<void>) => fn()),
}));

vi.mock('~/composables/useVfs', () => ({
  useVfs: () => mockVfs,
}));

// Mock URL.createObjectURL/revokeObjectURL
global.URL.createObjectURL = vi.fn(() => 'blob:url');
global.URL.revokeObjectURL = vi.fn();

describe('Thumbnail Generators', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockIsNative = false;

    // Both generators are module-level singletons; reset them so each spec
    // starts from a clean cache/queue instead of inheriting prior state.
    thumbnailGenerator.reset();
    fileThumbnailGenerator.reset();
    mockVfs.readDirectory.mockResolvedValue([]);
    mockVfs.readFile.mockRejectedValue(
      Object.assign(new Error('missing'), { name: 'VfsNotFoundError' }),
    );
    mockVfs.writeFile.mockResolvedValue(undefined);
    mockVfs.deleteEntry.mockResolvedValue(undefined);

    vi.mocked(useWorkspaceStore).mockReturnValue({
      workspaceHandle: (function () {
        const h = { getDirectoryHandle: vi.fn(), removeEntry: vi.fn() };
        h.getDirectoryHandle.mockResolvedValue(h);
        return h;
      })(),
      hasPersistentStorage: true,
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

    it('normalizes project paths before hashing clip thumbnails', () => {
      const base = getClipThumbnailsHash({
        projectId: 'p1',
        projectRelativePath: '_video/v1.mp4',
      });
      const normalized = getClipThumbnailsHash({
        projectId: 'p1',
        projectRelativePath: './_video/./v1.mp4',
      });

      expect(normalized).toBe(base);
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

    it('normalizes project paths before hashing file thumbnails', () => {
      const base = getFileThumbnailHash({
        projectId: 'p1',
        projectRelativePath: '_video/v1.mp4',
        source: { size: 100, lastModified: 100 },
      });
      const normalized = getFileThumbnailHash({
        projectId: 'p1',
        projectRelativePath: './_video/./v1.mp4',
        source: { size: 100, lastModified: 100 },
      });

      expect(normalized).toBe(base);
    });

    it('should include source fingerprint when provided', () => {
      const base = getFileThumbnailHash({
        projectId: 'p1',
        projectRelativePath: 'v1.mp4',
        source: { size: 100, lastModified: 100 },
      });
      const changed = getFileThumbnailHash({
        projectId: 'p1',
        projectRelativePath: 'v1.mp4',
        source: { size: 101, lastModified: 100 },
      });

      expect(base).not.toBe(changed);
    });

    it('should ignore source fingerprint for .otio files', () => {
      const base = getFileThumbnailHash({
        projectId: 'p1',
        projectRelativePath: 'timeline.otio',
        source: { size: 100, lastModified: 100 },
      });
      const noFingerprint = getFileThumbnailHash({
        projectId: 'p1',
        projectRelativePath: 'timeline.otio',
      });
      const changedFingerprint = getFileThumbnailHash({
        projectId: 'p1',
        projectRelativePath: 'timeline.otio',
        source: { size: 9999, lastModified: 9999 },
      });

      expect(base).toBe(noFingerprint);
      expect(base).toBe(changedFingerprint);
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

    it('should bypass resize and save SVG files directly with .svg extension', async () => {
      const complete = vi.fn();
      const svgFile = new File(['<svg></svg>'], 'image.svg', { type: 'image/svg+xml' });
      const projectStore = useProjectStore();
      vi.mocked(projectStore.getFileByPath).mockResolvedValueOnce(svgFile);

      fileThumbnailGenerator.addTask({
        id: 'svg-hash',
        projectId: 'test-project',
        projectRelativePath: 'image.svg',
        onComplete: complete,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(complete).toHaveBeenCalled();
      expect(mockVfs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('svg-hash.svg'),
        svgFile,
      );
    });

    it('should track pathHashes and clear them in clearThumbnail', async () => {
      const generator = fileThumbnailGenerator as any;
      generator.pathHashes.set('p1:test.mp4', 'real-taskId-hash');
      generator.cache.set('real-taskId-hash', 'blob-url');

      await fileThumbnailGenerator.clearThumbnail({
        projectId: 'p1',
        projectRelativePath: 'test.mp4',
      });

      expect(generator.cache.has('real-taskId-hash')).toBe(false);
      expect(generator.pathHashes.has('p1:test.mp4')).toBe(false);
      expect(mockVfs.deleteEntry).toHaveBeenCalledWith(
        expect.stringContaining('real-taskId-hash.webp'),
      );
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

    it('should merge requested times for the same task id', () => {
      const generator = thumbnailGenerator as unknown as {
        pendingRequestedTimes: Map<string, Set<number>>;
        addTask: (task: {
          id: string;
          projectId: string;
          projectRelativePath: string;
          duration: number;
          requestedTimesS?: number[];
        }) => void;
      };

      generator.pendingRequestedTimes.clear();

      generator.addTask({
        id: 'merge-test',
        projectId: 'p1',
        projectRelativePath: 'v1.mp4',
        duration: 20,
        requestedTimesS: [0, 4, 8],
      });

      generator.addTask({
        id: 'merge-test',
        projectId: 'p1',
        projectRelativePath: 'v1.mp4',
        duration: 20,
        requestedTimesS: [12, 16],
      });

      const pending = generator.pendingRequestedTimes.get('merge-test');
      expect(pending).toBeDefined();
      expect(Array.from(pending!).sort((a, b) => a - b)).toEqual([0, 4, 8, 12, 16]);
    });

    it('should cancelTask clear listeners, pending times and opfs checked times', () => {
      const generator = thumbnailGenerator as unknown as {
        listeners: Map<string, Map<string, unknown>>;
        pendingRequestedTimes: Map<string, Set<number>>;
        opfsCheckedTimes: Map<string, Set<number>>;
        cancelTask: (id: string) => void;
      };

      generator.listeners.set('cancel-test', new Map([['k1', {}]]));
      generator.pendingRequestedTimes.set('cancel-test', new Set([0, 4]));
      generator.opfsCheckedTimes.set('cancel-test', new Set([0, 4, 8]));

      generator.cancelTask('cancel-test');

      expect(generator.listeners.has('cancel-test')).toBe(false);
      expect(generator.pendingRequestedTimes.has('cancel-test')).toBe(false);
      expect(generator.opfsCheckedTimes.has('cancel-test')).toBe(false);
    });

    it('reset() revokes cached urls and drops all in-memory state', () => {
      const generator = thumbnailGenerator as unknown as {
        cache: Map<string, Map<number, string>>;
        listeners: Map<string, Map<string, unknown>>;
        pendingRequestedTimes: Map<string, Set<number>>;
        opfsCheckedTimes: Map<string, Set<number>>;
        reset: () => void;
      };

      generator.cache.set(
        'reset-test',
        new Map([
          [0, 'url-a'],
          [4, 'url-b'],
        ]),
      );
      generator.listeners.set('reset-test', new Map([['k1', {}]]));
      generator.pendingRequestedTimes.set('reset-test', new Set([0, 4]));
      generator.opfsCheckedTimes.set('reset-test', new Set([0]));

      generator.reset();

      expect(generator.cache.size).toBe(0);
      expect(generator.listeners.size).toBe(0);
      expect(generator.pendingRequestedTimes.size).toBe(0);
      expect(generator.opfsCheckedTimes.size).toBe(0);
      // Every cached blob URL must be revoked to avoid leaks.
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('url-a');
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('url-b');
    });

    it('isPinned reflects whether a mounted consumer is retaining the entry', () => {
      const generator = thumbnailGenerator as unknown as {
        isPinned: (id: string) => boolean;
        retain: (id: string, key: string) => void;
        releaseConsumer: (id: string, key: string) => void;
      };

      expect(generator.isPinned('pin-test')).toBe(false);
      generator.retain('pin-test', 'clip-a');
      expect(generator.isPinned('pin-test')).toBe(true);
      generator.releaseConsumer('pin-test', 'clip-a');
      expect(generator.isPinned('pin-test')).toBe(false);
    });

    it('does not evict or revoke a pinned entry, evicting the oldest unpinned one instead', () => {
      const generator = thumbnailGenerator as unknown as {
        cache: Map<string, Map<number, string>>;
        retain: (id: string, key: string) => void;
        evictCacheIfNeeded: () => void;
        maxCacheEntries: number;
      };

      const cap = generator.maxCacheEntries;
      // One over the entry cap so exactly one entry must be evicted.
      for (let i = 0; i <= cap; i++) {
        generator.cache.set(`hash-${i}`, new Map([[0, `blob-${i}`]]));
      }

      // A mounted clip is displaying the oldest entry (hash-0).
      generator.retain('hash-0', 'clip-a');

      generator.evictCacheIfNeeded();

      // The pinned oldest entry survives; the next-oldest unpinned one is evicted.
      expect(generator.cache.has('hash-0')).toBe(true);
      expect(generator.cache.has('hash-1')).toBe(false);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob-1');
      // The blob URL a live <img> still points at is never revoked.
      expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob-0');
    });

    it('stops shrinking when every remaining entry over the url cap is pinned', () => {
      const generator = thumbnailGenerator as unknown as {
        cache: Map<string, Map<number, string>>;
        retain: (id: string, key: string) => void;
        evictCacheIfNeeded: () => void;
        maxTotalCachedUrls: number;
      };

      // Two pinned entries whose combined url count exceeds the total-url cap.
      const perEntry = generator.maxTotalCachedUrls;
      const bigMap = (offset: number) =>
        new Map(Array.from({ length: perEntry }, (_, i) => [i, `blob-${offset}-${i}`]));
      generator.cache.set('pinned-a', bigMap(0));
      generator.cache.set('pinned-b', bigMap(1));
      generator.retain('pinned-a', 'clip-a');
      generator.retain('pinned-b', 'clip-b');
      // Ignore revokes from prior-test cache teardown in beforeEach's reset().
      vi.mocked(URL.revokeObjectURL).mockClear();

      generator.evictCacheIfNeeded();

      // Over the cap, but both entries are in use — nothing may be revoked.
      expect(generator.cache.has('pinned-a')).toBe(true);
      expect(generator.cache.has('pinned-b')).toBe(true);
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    });

    it('releaseConsumer keeps sibling clips of the same source working', () => {
      const generator = thumbnailGenerator as unknown as {
        listeners: Map<string, Map<string, unknown>>;
        consumers: Map<string, Set<string>>;
        retain: (id: string, key: string) => void;
        releaseConsumer: (id: string, key: string) => void;
      };

      // Two clips of the same source file share one cache entry / listener map.
      generator.retain('shared', 'clip-a');
      generator.retain('shared', 'clip-b');
      generator.listeners.set(
        'shared',
        new Map<string, unknown>([
          ['clip-a', {}],
          ['clip-b', {}],
        ]),
      );

      generator.releaseConsumer('shared', 'clip-a');

      // clip-b is still mounted: entry stays pinned and its listener is intact.
      expect(generator.consumers.get('shared')?.has('clip-b')).toBe(true);
      expect(generator.listeners.get('shared')?.has('clip-b')).toBe(true);
      // Only the unmounted clip's own listener is dropped.
      expect(generator.listeners.get('shared')?.has('clip-a')).toBe(false);

      generator.releaseConsumer('shared', 'clip-b');

      // Last consumer gone → fully released.
      expect(generator.consumers.has('shared')).toBe(false);
      expect(generator.listeners.has('shared')).toBe(false);
    });

    it('should clearThumbnails remove listeners along with cache and pending state', async () => {
      const generator = thumbnailGenerator as unknown as {
        cache: Map<string, unknown>;
        listeners: Map<string, Map<string, unknown>>;
        pendingRequestedTimes: Map<string, Set<number>>;
        opfsCheckedTimes: Map<string, Set<number>>;
        clearThumbnails: (input: { projectId: string; hash: string }) => Promise<void>;
      };

      generator.cache.set('clear-test', new Map([[0, 'url-0']]));
      generator.listeners.set('clear-test', new Map([['k1', {}]]));
      generator.pendingRequestedTimes.set('clear-test', new Set([0, 4]));
      generator.opfsCheckedTimes.set('clear-test', new Set([0, 4, 8]));

      await generator.clearThumbnails({ projectId: 'p1', hash: 'clear-test' });

      expect(generator.cache.has('clear-test')).toBe(false);
      expect(generator.listeners.has('clear-test')).toBe(false);
      expect(generator.pendingRequestedTimes.has('clear-test')).toBe(false);
      expect(generator.opfsCheckedTimes.has('clear-test')).toBe(false);
    });
  });

  describe('Tauri workspace-less support', () => {
    beforeEach(() => {
      mockIsNative = true;
      vi.mocked(useWorkspaceStore).mockReturnValue({
        workspaceHandle: null,
        hasPersistentStorage: true,
        resolvedStorageTopology: {
          tempRoot: '',
          proxiesRoot: '',
        },
      } as any);

      vi.mocked(useProjectStore).mockReturnValue({
        currentProjectId: 'test-project',
        getFileByPath: vi.fn().mockResolvedValue(mockFile),
        getFileHandleByPath: vi.fn().mockResolvedValue({ path: '/mock/video.mp4' }),
      } as any);
    });

    it('should generate clip thumbnails successfully when workspaceHandle is null in Tauri', async () => {
      const progress = vi.fn();
      const complete = vi.fn();

      thumbnailGenerator.addTask({
        id: 'tauri-clip-hash',
        projectId: 'p1',
        projectRelativePath: 'v1.mp4',
        duration: 8,
        requestedTimesS: [0, 4],
        onProgress: progress,
        onComplete: complete,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(complete).toHaveBeenCalled();
      expect(mockVfs.writeFile).toHaveBeenCalled();
    });

    it('should batch native clip thumbnails in larger chunks', async () => {
      const requestedTimesS = Array.from({ length: 130 }, (_, index) => index * 4);

      thumbnailGenerator.addTask({
        id: 'tauri-clip-large-batch',
        projectId: 'p1',
        projectRelativePath: 'v1.mp4',
        duration: 520,
        requestedTimesS,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockMediaProcessor.extractVideoFrameBlobs).toHaveBeenCalledTimes(2);
      expect(vi.mocked(mockMediaProcessor.extractVideoFrameBlobs).mock.calls[0]?.[0]).toMatchObject(
        {
          timesSec: requestedTimesS.slice(0, 128),
        },
      );
      expect(vi.mocked(mockMediaProcessor.extractVideoFrameBlobs).mock.calls[1]?.[0]).toMatchObject(
        {
          timesSec: requestedTimesS.slice(128),
        },
      );
    });

    it('keeps native-generated thumbnails pinned so eviction never revokes on-screen clips', async () => {
      // Generate real (native) thumbnails into the cache for a mounted clip.
      thumbnailGenerator.addTask({
        id: 'tauri-pinned-hash',
        projectId: 'p1',
        projectRelativePath: 'v1.mp4',
        duration: 8,
        requestedTimesS: [0, 4],
      });
      await new Promise((resolve) => setTimeout(resolve, 10));

      const generator = thumbnailGenerator as unknown as {
        cache: Map<string, Map<number, string>>;
        retain: (id: string, key: string) => void;
        evictCacheIfNeeded: () => void;
        maxCacheEntries: number;
      };

      expect(generator.cache.has('tauri-pinned-hash')).toBe(true);
      const pinnedUrls = Array.from(generator.cache.get('tauri-pinned-hash')!.values());
      expect(pinnedUrls.length).toBeGreaterThan(0);

      // A native clip component mounts and retains the entry.
      generator.retain('tauri-pinned-hash', 'native-clip');

      // Pile on enough other sources to exceed the entry cap and force eviction.
      for (let i = 0; i < generator.maxCacheEntries; i++) {
        generator.cache.set(`filler-${i}`, new Map([[0, `filler-blob-${i}`]]));
      }
      vi.mocked(URL.revokeObjectURL).mockClear();

      generator.evictCacheIfNeeded();

      // The mounted native clip's entry and its blob URLs survive untouched.
      expect(generator.cache.has('tauri-pinned-hash')).toBe(true);
      for (const url of pinnedUrls) {
        expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(url);
      }
    });

    it('should generate file thumbnails successfully when workspaceHandle is null in Tauri', async () => {
      const complete = vi.fn();

      fileThumbnailGenerator.addTask({
        id: 'tauri-file-hash',
        projectId: 'p1',
        projectRelativePath: 'v1.mp4',
        onComplete: complete,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(complete).toHaveBeenCalled();
      expect(mockVfs.writeFile).toHaveBeenCalled();
    });
  });
});
