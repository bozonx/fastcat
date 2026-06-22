/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { createProxyService } from '~/stores/proxy/proxyService';
import { getProxyWorkerClient } from '~/utils/video-editor/worker-client';

const mockWorkerClient = {
  client: {
    extractMetadata: vi.fn(),
    exportTimeline: vi.fn(),
    cancelExport: vi.fn(),
  },
};

vi.mock('~/utils/video-editor/worker-client', () => ({
  getProxyWorkerClient: () => mockWorkerClient,
  setProxyHostApi: vi.fn(),
}));

vi.mock('~/utils/video-editor/createVideoCoreHostApi', () => ({
  createVideoCoreHostApi: (params: unknown) => params,
  createProjectHostApi: vi.fn(() => ({})),
}));

function createMockWritable() {
  return {
    write: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockDir(entries: Record<string, any> = {}) {
  const map = new Map<string, any>(Object.entries(entries));
  return {
    getFileHandle: vi.fn(async (name: string, options?: { create?: boolean }) => {
      if (map.has(name)) return map.get(name);
      if (options?.create) {
        const handle = {
          getFile: vi.fn(async () => ({ size: 0 })),
          removeEntry: vi.fn(),
          createWritable: vi.fn(async () => createMockWritable()),
        };
        map.set(name, handle);
        return handle;
      }
      const err = new Error('Not found');
      (err as any).name = 'NotFoundError';
      throw err;
    }),
    removeEntry: vi.fn(async (name: string) => {
      if (!map.has(name)) {
        const err = new Error('Not found');
        (err as any).name = 'NotFoundError';
        throw err;
      }
      map.delete(name);
    }),
    _map: map,
  };
}

function createService(overrides: Partial<Parameters<typeof createProxyService>[0]> = {}) {
  const generatingProxies = ref(new Set<string>());
  const existingProxies = ref(new Set<string>());
  const proxyProgress = ref(new Map<string, number>());
  const proxyAbortControllers = ref(new Map<string, AbortController>());
  const activeWorkerPaths = ref(new Set<string>());
  const proxyTaskIds = ref(new Map<string, string>());
  const taskIdToPath = ref(new Map<string, string>());
  const bgTaskIdsByPath = ref(new Map<string, string>());

  const addTask = vi.fn(() => `bg-task-${addTask.mock.calls.length}`);
  const updateTaskStatus = vi.fn();
  const updateTaskProgress = vi.fn();

  const queue = {
    add: vi.fn((fn: () => Promise<void>, _options?: { priority: number; signal: AbortSignal }) =>
      fn(),
    ),
  };

  const mockDir = createMockDir();

  const mockVfs = {
    createDirectory: vi.fn(async () => {}),
    writeFile: vi.fn(async (vfsPath: string, data: any) => {
      const key = vfsPath.replace('@ptemp/projects/p1/proxies/', '');
      const handle = {
        getFile: vi.fn(async () => ({ size: data?.length ?? 0 })),
        removeEntry: vi.fn(),
        createWritable: vi.fn(async () => createMockWritable()),
      };
      mockDir._map.set(key, handle);
    }),
    deleteEntry: vi.fn(async (vfsPath: string) => {
      const key = vfsPath.replace('@ptemp/projects/p1/proxies/', '');
      await mockDir.removeEntry(key);
    }),
    moveEntry: vi.fn(async (srcPath: string, destPath: string) => {
      const srcKey = srcPath.replace('@ptemp/projects/p1/proxies/', '');
      const destKey = destPath.replace('@ptemp/projects/p1/proxies/', '');
      const handle = mockDir._map.get(srcKey);
      if (!handle) {
        const err = new Error('Not found');
        err.name = 'NotFoundError';
        throw err;
      }
      if (handle.move) {
        await handle.move(destKey);
      } else {
        throw new Error('move is not supported');
      }
      mockDir._map.set(destKey, handle);
      mockDir._map.delete(srcKey);
    }),
    copyFile: vi.fn(async (srcPath: string, destPath: string) => {
      const srcKey = srcPath.replace('@ptemp/projects/p1/proxies/', '');
      const destKey = destPath.replace('@ptemp/projects/p1/proxies/', '');
      const handle = mockDir._map.get(srcKey);
      if (!handle) {
        const err = new Error('Not found');
        err.name = 'NotFoundError';
        throw err;
      }
      const newHandle = {
        ...handle,
        getFile: vi.fn(async () => {
          const file = await handle.getFile();
          return file;
        }),
      };
      mockDir._map.set(destKey, newHandle);
    }),
    getFile: vi.fn(async (vfsPath: string) => {
      const key = vfsPath.replace('@ptemp/projects/p1/proxies/', '');
      const handle = mockDir._map.get(key);
      if (!handle) return null;
      const file = await handle.getFile();
      return {
        ...file,
        size: file.size ?? 0,
      };
    }),
  };

  const service = createProxyService({
    videoExtensions: new Set(['mp4', 'mov']),
    generatingProxies,
    existingProxies,
    proxyProgress,
    proxyAbortControllers,
    activeWorkerPaths,
    proxyTaskIds,
    taskIdToPath,
    bgTaskIdsByPath,
    proxyQueue: ref(queue as any),
    getProjectProxiesVfsPath: vi.fn(() => '@ptemp/projects/p1/proxies'),
    getProxyFileName: vi.fn(async (path) => `${path}.proxy.mp4`),
    getProxyFilePath: vi.fn(async (path) => `@ptemp/projects/p1/proxies/${path}.proxy.mp4`),
    getVfs: () => mockVfs as any,
    getWriteFileHandle: vi.fn(async (vfsPath: string) => {
      const key = vfsPath.replace('@ptemp/projects/p1/proxies/', '');
      return mockDir.getFileHandle(key, { create: true }) as any;
    }),
    getFileHandleByPath: vi.fn(),
    getFileByPath: vi.fn(),
    getOptimizationSettings: () => ({
      proxyMaxPixels: 640 * 360,
      proxyVideoBitrateMbps: 1,
      proxyAudioBitrateKbps: 96,
      proxyVideoCodec: 'h264' as const,
      proxyCopyOpusAudio: false,
    }),
    getProxyTaskTitle: ({ fileName }) => `Generating proxy: ${fileName}`,
    backgroundTasksStore: {
      addTask,
      updateTaskStatus,
      updateTaskProgress,
    } as any,
    ...overrides,
  });

  return {
    service,
    generatingProxies,
    existingProxies,
    proxyProgress,
    proxyAbortControllers,
    activeWorkerPaths,
    proxyTaskIds,
    taskIdToPath,
    bgTaskIdsByPath,
    queue,
    mockDir,
    addTask,
    updateTaskStatus,
    updateTaskProgress,
  };
}

describe('createProxyService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkerClient.client.extractMetadata.mockReset();
    mockWorkerClient.client.exportTimeline.mockReset();
    mockWorkerClient.client.cancelExport.mockReset();
  });

  describe('generateProxy', () => {
    it('completes successfully and updates state', async () => {
      const { service, existingProxies, activeWorkerPaths, proxyProgress, updateTaskStatus } =
        createService();

      mockWorkerClient.client.extractMetadata.mockResolvedValue({
        video: { width: 1920, height: 1080, fps: 30 },
        audio: { codec: 'aac' },
        duration: 10,
      });
      mockWorkerClient.client.exportTimeline.mockResolvedValue(undefined);

      const file = new File([], 'test.mp4');
      await service.generateProxy(file, '_video/test.mp4');

      expect(mockWorkerClient.client.extractMetadata).toHaveBeenCalledWith(file);
      expect(mockWorkerClient.client.exportTimeline).toHaveBeenCalled();
      expect(existingProxies.value.has('_video/test.mp4')).toBe(true);
      expect(activeWorkerPaths.value.has('_video/test.mp4')).toBe(false);
      expect(proxyProgress.value.has('_video/test.mp4')).toBe(false);
      expect(updateTaskStatus).toHaveBeenCalledWith(expect.any(String), 'completed');
    });

    it('skips if already generating for the same path', async () => {
      const { service, generatingProxies } = createService();
      generatingProxies.value.add('_video/test.mp4');

      await service.generateProxy(new File([], 'test.mp4'), '_video/test.mp4');

      expect(mockWorkerClient.client.extractMetadata).not.toHaveBeenCalled();
    });

    it('marks task failed and cleans up on export error', async () => {
      const { service, existingProxies, updateTaskStatus, mockDir } = createService();

      mockWorkerClient.client.extractMetadata.mockResolvedValue({
        video: { width: 1920, height: 1080, fps: 30 },
        duration: 10,
      });
      mockWorkerClient.client.exportTimeline.mockRejectedValue(new Error('encode failed'));

      await expect(
        service.generateProxy(new File([], 'test.mp4'), '_video/test.mp4'),
      ).rejects.toThrow('encode failed');

      expect(existingProxies.value.has('_video/test.mp4')).toBe(false);
      expect(updateTaskStatus).toHaveBeenCalledWith(
        expect.any(String),
        'failed',
        expect.stringContaining('encode failed'),
      );
      expect(mockDir.removeEntry).toHaveBeenCalledWith('_video/test.mp4.proxy.mp4');
    });

    it('cancels when external signal is already aborted', async () => {
      const { service, updateTaskStatus } = createService();
      const controller = new AbortController();
      controller.abort();

      mockWorkerClient.client.extractMetadata.mockResolvedValue({
        video: { width: 1920, height: 1080 },
        duration: 5,
      });

      await service.generateProxy(new File([], 'test.mp4'), '_video/test.mp4', {
        signal: controller.signal,
      });

      expect(updateTaskStatus).toHaveBeenCalledWith(
        expect.any(String),
        'cancelled',
        expect.any(String),
      );
    });

    it('computes scale when source exceeds max pixels', async () => {
      const { service } = createService();
      mockWorkerClient.client.extractMetadata.mockResolvedValue({
        video: { width: 3840, height: 2160, fps: 30 },
        duration: 1,
      });
      mockWorkerClient.client.exportTimeline.mockResolvedValue(undefined);

      await service.generateProxy(new File([], 'test.mp4'), '_video/test.mp4');

      const call = mockWorkerClient.client.exportTimeline.mock.calls[0];
      const options = call[1];
      expect(options.width).toBeLessThanOrEqual(1280);
      expect(options.height).toBeLessThanOrEqual(720);
      expect(options.width % 2).toBe(0);
      expect(options.height % 2).toBe(0);
    });

    it('sets audioPassthrough when source is opus and copy is enabled', async () => {
      const { service } = createService({
        getOptimizationSettings: () => ({
          proxyMaxPixels: 640 * 360,
          proxyVideoBitrateMbps: 1,
          proxyAudioBitrateKbps: 96,
          proxyVideoCodec: 'h264' as const,
          proxyCopyOpusAudio: true,
        }),
      });
      mockWorkerClient.client.extractMetadata.mockResolvedValue({
        video: { width: 1920, height: 1080, fps: 30 },
        audio: { codec: 'Opus' },
        duration: 1,
      });
      mockWorkerClient.client.exportTimeline.mockResolvedValue(undefined);

      await service.generateProxy(new File([], 'test.mp4'), '_video/test.mp4');

      const call = mockWorkerClient.client.exportTimeline.mock.calls[0];
      expect(call[1].audioPassthrough).toBe(true);
    });
  });

  describe('cancelProxyGeneration', () => {
    it('aborts controller and cancels worker export when active', async () => {
      const { service, proxyAbortControllers, activeWorkerPaths, proxyTaskIds } = createService();
      const controller = new AbortController();
      proxyAbortControllers.value.set('_video/test.mp4', controller);
      proxyTaskIds.value.set('_video/test.mp4', 'task-123');
      activeWorkerPaths.value.add('_video/test.mp4');

      await service.cancelProxyGeneration('_video/test.mp4');

      expect(controller.signal.aborted).toBe(true);
      expect(mockWorkerClient.client.cancelExport).toHaveBeenCalledWith('task-123');
    });

    it('only aborts controller when not active in worker', async () => {
      const { service, proxyAbortControllers, proxyTaskIds } = createService();
      const controller = new AbortController();
      proxyAbortControllers.value.set('_video/test.mp4', controller);
      proxyTaskIds.value.set('_video/test.mp4', 'task-123');

      await service.cancelProxyGeneration('_video/test.mp4');

      expect(controller.signal.aborted).toBe(true);
      expect(mockWorkerClient.client.cancelExport).not.toHaveBeenCalled();
    });
  });

  describe('checkExistingProxies', () => {
    it('adds paths with non-empty proxy files', async () => {
      const { service, existingProxies, mockDir } = createService();
      mockDir._map.set('_video/a.mp4.proxy.mp4', { getFile: vi.fn(async () => ({ size: 1024 })) });
      mockDir._map.set('_video/b.mp4.proxy.mp4', { getFile: vi.fn(async () => ({ size: 0 })) });

      await service.checkExistingProxies(['_video/a.mp4', '_video/b.mp4', '_audio/track.mp3']);

      expect(existingProxies.value.has('_video/a.mp4')).toBe(true);
      expect(existingProxies.value.has('_video/b.mp4')).toBe(false);
      expect(existingProxies.value.has('_audio/track.mp3')).toBe(false);
    });

    it('normalizes paths before checking existing proxy files', async () => {
      const { service, existingProxies, mockDir } = createService();
      mockDir._map.set('_video/a.mp4.proxy.mp4', { getFile: vi.fn(async () => ({ size: 1024 })) });

      await service.checkExistingProxies(['./_video/./a.mp4']);

      expect(existingProxies.value.has('_video/a.mp4')).toBe(true);
      expect(existingProxies.value.has('./_video/./a.mp4')).toBe(false);
    });

    it('removes paths when proxy file is missing', async () => {
      const { service, existingProxies } = createService();
      existingProxies.value.add('_video/old.mp4');

      await service.checkExistingProxies(['_video/old.mp4']);

      expect(existingProxies.value.has('_video/old.mp4')).toBe(false);
    });
  });

  describe('deleteProxy', () => {
    it('removes proxy file and state', async () => {
      const { service, existingProxies, mockDir } = createService();
      existingProxies.value.add('_video/test.mp4');

      await service.deleteProxy('_video/test.mp4');

      expect(mockDir.removeEntry).toHaveBeenCalledWith('_video/test.mp4.proxy.mp4');
      expect(existingProxies.value.has('_video/test.mp4')).toBe(false);
    });

    it('normalizes paths before deleting proxy files and state', async () => {
      const { service, existingProxies, mockDir } = createService();
      existingProxies.value.add('_video/test.mp4');

      await service.deleteProxy('./_video/./test.mp4');

      expect(mockDir.removeEntry).toHaveBeenCalledWith('_video/test.mp4.proxy.mp4');
      expect(existingProxies.value.has('_video/test.mp4')).toBe(false);
    });

    it('ignores NotFoundError silently', async () => {
      const { service, existingProxies } = createService();
      existingProxies.value.add('_video/missing.mp4');

      await service.deleteProxy('_video/missing.mp4');

      expect(existingProxies.value.has('_video/missing.mp4')).toBe(false);
    });
  });

  describe('renameProxy', () => {
    it('uses native move when available', async () => {
      const { service, existingProxies, mockDir } = createService();
      existingProxies.value.add('_video/old.mp4');
      const handle = { move: vi.fn().mockResolvedValue(undefined) };
      mockDir._map.set('_video/old.mp4.proxy.mp4', handle);

      await service.renameProxy({ oldPath: '_video/old.mp4', newPath: '_video/new.mp4' });

      expect(handle.move).toHaveBeenCalledWith('_video/new.mp4.proxy.mp4');
      expect(existingProxies.value.has('_video/old.mp4')).toBe(false);
      expect(existingProxies.value.has('_video/new.mp4')).toBe(true);
    });

    it('falls back to copy+delete when native move is missing', async () => {
      const { service, existingProxies, mockDir } = createService();
      existingProxies.value.add('_video/old.mp4');
      const oldHandle = {
        getFile: vi.fn(async () => new File(['data'], 'proxy.mp4')),
        createWritable: vi.fn(async () => {
          const chunks: Uint8Array[] = [];
          return {
            write: vi.fn(async (chunk: any) => {
              if (chunk instanceof Uint8Array) chunks.push(chunk);
              else if (typeof chunk === 'string') chunks.push(new TextEncoder().encode(chunk));
              else if (ArrayBuffer.isView(chunk))
                chunks.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
            }),
            close: vi.fn(async () => {
              const total = chunks.reduce((s, c) => s + c.length, 0);
              const merged = new Uint8Array(total);
              let off = 0;
              for (const c of chunks) {
                merged.set(c, off);
                off += c.length;
              }
            }),
          };
        }),
      };
      mockDir._map.set('_video/old.mp4.proxy.mp4', oldHandle);

      await service.renameProxy({ oldPath: '_video/old.mp4', newPath: '_video/new.mp4' });

      expect(mockDir.removeEntry).toHaveBeenCalledWith('_video/old.mp4.proxy.mp4');
      expect(existingProxies.value.has('_video/old.mp4')).toBe(false);
      expect(existingProxies.value.has('_video/new.mp4')).toBe(true);
    });
  });

  describe('renameProxyDir', () => {
    it('cancels active tasks and renames affected proxies', async () => {
      const { service, proxyAbortControllers, existingProxies, mockDir } = createService();
      const controller = new AbortController();
      proxyAbortControllers.value.set('_video/old/sub1.mp4', controller);
      existingProxies.value.add('_video/old/sub1.mp4');
      existingProxies.value.add('_video/old/sub2.mp4');
      const handle = { move: vi.fn().mockResolvedValue(undefined) };
      mockDir._map.set('_video/old/sub1.mp4.proxy.mp4', handle);
      mockDir._map.set('_video/old/sub2.mp4.proxy.mp4', handle);

      await service.renameProxyDir({ oldPath: '_video/old', newPath: '_video/new' });

      expect(controller.signal.aborted).toBe(true);
      expect(existingProxies.value.has('_video/new/sub1.mp4')).toBe(true);
      expect(existingProxies.value.has('_video/new/sub2.mp4')).toBe(true);
    });
  });

  describe('generateProxiesForFolder', () => {
    it('schedules folder proxy jobs without serially waiting for each job to finish', async () => {
      const resolvers: Array<() => void> = [];
      const queue = {
        add: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              resolvers.push(resolve);
            }),
        ),
      };
      const { service } = createService({
        proxyQueue: ref(queue as any),
      });

      const dirHandle = {
        async *values() {
          yield { kind: 'file', name: 'a.mp4' };
          yield { kind: 'file', name: 'b.mp4' };
        },
      };

      const folderPromise = service.generateProxiesForFolder({
        dirHandle: dirHandle as any,
        dirPath: '_video',
      });

      await vi.waitFor(() => {
        expect(queue.add).toHaveBeenCalledTimes(2);
      });

      resolvers.forEach((resolve) => resolve());
      await folderPromise;
    });

    it('skips non-video files and already existing proxies', async () => {
      const { service, existingProxies, queue } = createService();
      existingProxies.value.add('_video/b.mp4');

      const dirHandle = {
        async *values() {
          yield { kind: 'file', name: 'a.mp4' };
          yield { kind: 'file', name: 'b.mp4' };
          yield { kind: 'file', name: 'c.txt' };
        },
      };

      await service.generateProxiesForFolder({
        dirHandle: dirHandle as any,
        dirPath: '_video',
      });

      expect(queue.add).toHaveBeenCalledTimes(1);
    });
  });

  describe('generateProxiesBatch', () => {
    it('creates a single background task for multiple files', async () => {
      const { service, addTask, updateTaskStatus, updateTaskProgress } = createService();

      mockWorkerClient.client.extractMetadata.mockResolvedValue({
        video: { width: 1920, height: 1080, fps: 30 },
        audio: { codec: 'aac' },
        duration: 10,
      });
      mockWorkerClient.client.exportTimeline.mockResolvedValue(undefined);

      const entries = [
        { file: new File([], 'a.mp4'), projectRelativePath: '_video/a.mp4' },
        { file: new File([], 'b.mp4'), projectRelativePath: '_video/b.mp4' },
      ];

      await service.generateProxiesBatch(entries);

      expect(addTask).toHaveBeenCalledTimes(1);
      expect(updateTaskStatus).toHaveBeenCalledWith(expect.any(String), 'running');
      expect(updateTaskStatus).toHaveBeenCalledWith(expect.any(String), 'completed');
      expect(updateTaskProgress).toHaveBeenCalledWith(expect.any(String), 1);
    });

    it('suppresses individual bg tasks when batching', async () => {
      const { service, addTask } = createService();

      mockWorkerClient.client.extractMetadata.mockResolvedValue({
        video: { width: 1920, height: 1080, fps: 30 },
        audio: { codec: 'aac' },
        duration: 10,
      });
      mockWorkerClient.client.exportTimeline.mockResolvedValue(undefined);

      const entries = [
        { file: new File([], 'a.mp4'), projectRelativePath: '_video/a.mp4' },
        { file: new File([], 'b.mp4'), projectRelativePath: '_video/b.mp4' },
      ];

      await service.generateProxiesBatch(entries);

      // Only one task (the batch task)
      expect(addTask).toHaveBeenCalledTimes(1);
    });

    it('marks batch failed when all entries fail', async () => {
      const { service, updateTaskStatus } = createService();

      mockWorkerClient.client.extractMetadata.mockRejectedValue(new Error('metadata failed'));

      const entries = [
        { file: new File([], 'a.mp4'), projectRelativePath: '_video/a.mp4' },
        { file: new File([], 'b.mp4'), projectRelativePath: '_video/b.mp4' },
      ];

      await service.generateProxiesBatch(entries);

      expect(updateTaskStatus).toHaveBeenCalledWith(
        expect.any(String),
        'failed',
        expect.stringContaining('All proxy generations failed'),
      );
    });

    it('marks batch completed with warnings when some entries fail', async () => {
      const { service, updateTaskStatus } = createService();

      mockWorkerClient.client.extractMetadata
        .mockRejectedValueOnce(new Error('metadata failed'))
        .mockResolvedValueOnce({
          video: { width: 1920, height: 1080, fps: 30 },
          audio: { codec: 'aac' },
          duration: 10,
        });
      mockWorkerClient.client.exportTimeline.mockResolvedValue(undefined);

      const entries = [
        { file: new File([], 'a.mp4'), projectRelativePath: '_video/a.mp4' },
        { file: new File([], 'b.mp4'), projectRelativePath: '_video/b.mp4' },
      ];

      await service.generateProxiesBatch(entries);

      expect(updateTaskStatus).toHaveBeenCalledWith(
        expect.any(String),
        'completed',
        expect.stringContaining('failed'),
      );
    });

    it('delegates to single generateProxy for one entry', async () => {
      const { service, addTask } = createService();

      mockWorkerClient.client.extractMetadata.mockResolvedValue({
        video: { width: 1920, height: 1080, fps: 30 },
        audio: { codec: 'aac' },
        duration: 10,
      });
      mockWorkerClient.client.exportTimeline.mockResolvedValue(undefined);

      const entries = [{ file: new File([], 'a.mp4'), projectRelativePath: '_video/a.mp4' }];

      await service.generateProxiesBatch(entries);

      // Should create the single-file bg task (not a batch task)
      expect(addTask).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteProxiesBatch', () => {
    it('creates a single background task and deletes all proxies', async () => {
      const { service, addTask, updateTaskStatus, mockDir } = createService();

      await service.deleteProxiesBatch(['_video/a.mp4', '_video/b.mp4']);

      expect(addTask).toHaveBeenCalledTimes(1);
      expect(mockDir.removeEntry).toHaveBeenCalledWith('_video/a.mp4.proxy.mp4');
      expect(mockDir.removeEntry).toHaveBeenCalledWith('_video/b.mp4.proxy.mp4');
      expect(updateTaskStatus).toHaveBeenCalledWith(expect.any(String), 'completed');
    });

    it('delegates to single deleteProxy for one path', async () => {
      const { service, addTask, mockDir } = createService();

      await service.deleteProxiesBatch(['_video/a.mp4']);

      expect(addTask).not.toHaveBeenCalled();
      expect(mockDir.removeEntry).toHaveBeenCalledWith('_video/a.mp4.proxy.mp4');
    });
  });
});
