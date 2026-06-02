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

let mockIsTauri = false;
vi.mock('~/utils/runtime', () => ({
  isTauriRuntime: vi.fn(() => mockIsTauri),
}));

vi.mock('~/utils/tauri-media-processing', () => ({
  getNativeFileHandlePath: (handle: any) => handle?.path || null,
  nativeVideoFrameWebps: vi.fn(async () => [new Blob(['tauri-frame'], { type: 'image/webp' })]),
  nativeVideoFrameWebp: vi.fn(async () => new Blob(['tauri-frame'], { type: 'image/webp' })),
  nativeMediaMetadata: vi.fn(async () => ({ duration: 10 })),
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(),
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: vi.fn(),
}));

vi.mock('~/utils/video-editor/worker-client', () => ({
  getThumbnailWorkerClient: vi.fn(() => ({
    client: {
      extractVideoFrameBlobs: vi
        .fn()
        .mockResolvedValue([new Blob(['test'], { type: 'image/webp' })]),
      cancelExport: vi.fn().mockResolvedValue(undefined),
      releaseFrameExtractor: vi.fn().mockResolvedValue(undefined),
    },
  })),
  setThumbnailHostApi: vi.fn(),
}));

vi.mock('~/utils/video-editor/createVideoCoreHostApi', () => ({
  createVideoCoreHostApi: vi.fn().mockReturnValue({}),
}));

vi.mock('~/utils/media-task-queue', () => ({
  addMediaTask: vi.fn((task: () => Promise<void>) => task()),
  MEDIA_TASK_PRIORITIES: {
    timelineThumbnail: 3,
    timelineThumbnailLazy: 0,
    fileThumbnail: 2,
    proxy: 1,
    conversionBackground: 1,
  },
}));

vi.mock('~/utils/io/io-governor', () => ({
  withFileWriteSlot: vi.fn((fn: () => Promise<void>) => fn()),
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
    mockIsTauri = false;

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
      mockIsTauri = true;
      vi.mocked(useWorkspaceStore).mockReturnValue({
        workspaceHandle: null,
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
