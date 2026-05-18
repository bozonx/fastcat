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
}));

function createMockDir(entries: Record<string, any> = {}) {
  const map = new Map<string, any>(Object.entries(entries));
  return {
    getFileHandle: vi.fn(async (name: string, options?: { create?: boolean }) => {
      if (map.has(name)) return map.get(name);
      if (options?.create) {
        const handle = { getFile: vi.fn(async () => ({ size: 0 })), removeEntry: vi.fn() };
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
    add: vi.fn(
      (fn: () => Promise<void>, _options?: { priority: number; signal: AbortSignal }) => fn(),
    ),
  };

  const mockDir = createMockDir();

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
    ensureProjectProxiesDir: vi.fn(async () => mockDir as unknown as FileSystemDirectoryHandle),
    getProxyFileName: vi.fn(async (path) => `${path}.proxy.mp4`),
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
      await service.generateProxy(file, 'video/test.mp4');

      expect(mockWorkerClient.client.extractMetadata).toHaveBeenCalledWith(file);
      expect(mockWorkerClient.client.exportTimeline).toHaveBeenCalled();
      expect(existingProxies.value.has('video/test.mp4')).toBe(true);
      expect(activeWorkerPaths.value.has('video/test.mp4')).toBe(false);
      expect(proxyProgress.value.has('video/test.mp4')).toBe(false);
      expect(updateTaskStatus).toHaveBeenCalledWith(expect.any(String), 'completed');
    });

    it('skips if already generating for the same path', async () => {
      const { service, generatingProxies } = createService();
      generatingProxies.value.add('video/test.mp4');

      await service.generateProxy(new File([], 'test.mp4'), 'video/test.mp4');

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
        service.generateProxy(new File([], 'test.mp4'), 'video/test.mp4'),
      ).rejects.toThrow('encode failed');

      expect(existingProxies.value.has('video/test.mp4')).toBe(false);
      expect(updateTaskStatus).toHaveBeenCalledWith(
        expect.any(String),
        'failed',
        expect.stringContaining('encode failed'),
      );
      expect(mockDir.removeEntry).toHaveBeenCalledWith('video/test.mp4.proxy.mp4');
    });

    it('cancels when external signal is already aborted', async () => {
      const { service, updateTaskStatus } = createService();
      const controller = new AbortController();
      controller.abort();

      mockWorkerClient.client.extractMetadata.mockResolvedValue({
        video: { width: 1920, height: 1080 },
        duration: 5,
      });

      await service.generateProxy(new File([], 'test.mp4'), 'video/test.mp4', {
        signal: controller.signal,
      });

      expect(updateTaskStatus).toHaveBeenCalledWith(expect.any(String), 'cancelled', expect.any(String));
    });

    it('computes scale when source exceeds max pixels', async () => {
      const { service } = createService();
      mockWorkerClient.client.extractMetadata.mockResolvedValue({
        video: { width: 3840, height: 2160, fps: 30 },
        duration: 1,
      });
      mockWorkerClient.client.exportTimeline.mockResolvedValue(undefined);

      await service.generateProxy(new File([], 'test.mp4'), 'video/test.mp4');

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

      await service.generateProxy(new File([], 'test.mp4'), 'video/test.mp4');

      const call = mockWorkerClient.client.exportTimeline.mock.calls[0];
      expect(call[1].audioPassthrough).toBe(true);
    });
  });

  describe('cancelProxyGeneration', () => {
    it('aborts controller and cancels worker export when active', async () => {
      const { service, proxyAbortControllers, activeWorkerPaths, proxyTaskIds } = createService();
      const controller = new AbortController();
      proxyAbortControllers.value.set('video/test.mp4', controller);
      proxyTaskIds.value.set('video/test.mp4', 'task-123');
      activeWorkerPaths.value.add('video/test.mp4');

      await service.cancelProxyGeneration('video/test.mp4');

      expect(controller.signal.aborted).toBe(true);
      expect(mockWorkerClient.client.cancelExport).toHaveBeenCalledWith('task-123');
    });

    it('only aborts controller when not active in worker', async () => {
      const { service, proxyAbortControllers, proxyTaskIds } = createService();
      const controller = new AbortController();
      proxyAbortControllers.value.set('video/test.mp4', controller);
      proxyTaskIds.value.set('video/test.mp4', 'task-123');

      await service.cancelProxyGeneration('video/test.mp4');

      expect(controller.signal.aborted).toBe(true);
      expect(mockWorkerClient.client.cancelExport).not.toHaveBeenCalled();
    });
  });

  describe('checkExistingProxies', () => {
    it('adds paths with non-empty proxy files', async () => {
      const { service, existingProxies, mockDir } = createService();
      mockDir._map.set(
        'video/a.mp4.proxy.mp4',
        { getFile: vi.fn(async () => ({ size: 1024 })) },
      );
      mockDir._map.set(
        'video/b.mp4.proxy.mp4',
        { getFile: vi.fn(async () => ({ size: 0 })) },
      );

      await service.checkExistingProxies(['video/a.mp4', 'video/b.mp4', 'audio/track.mp3']);

      expect(existingProxies.value.has('video/a.mp4')).toBe(true);
      expect(existingProxies.value.has('video/b.mp4')).toBe(false);
      expect(existingProxies.value.has('audio/track.mp3')).toBe(false);
    });

    it('removes paths when proxy file is missing', async () => {
      const { service, existingProxies } = createService();
      existingProxies.value.add('video/old.mp4');

      await service.checkExistingProxies(['video/old.mp4']);

      expect(existingProxies.value.has('video/old.mp4')).toBe(false);
    });
  });

  describe('deleteProxy', () => {
    it('removes proxy file and state', async () => {
      const { service, existingProxies, mockDir } = createService();
      existingProxies.value.add('video/test.mp4');

      await service.deleteProxy('video/test.mp4');

      expect(mockDir.removeEntry).toHaveBeenCalledWith('video/test.mp4.proxy.mp4');
      expect(existingProxies.value.has('video/test.mp4')).toBe(false);
    });

    it('ignores NotFoundError silently', async () => {
      const { service, existingProxies } = createService();
      existingProxies.value.add('video/missing.mp4');

      await service.deleteProxy('video/missing.mp4');

      expect(existingProxies.value.has('video/missing.mp4')).toBe(false);
    });
  });

  describe('renameProxy', () => {
    it('uses native move when available', async () => {
      const { service, existingProxies, mockDir } = createService();
      existingProxies.value.add('video/old.mp4');
      const handle = { move: vi.fn().mockResolvedValue(undefined) };
      mockDir._map.set('video/old.mp4.proxy.mp4', handle);

      await service.renameProxy({ oldPath: 'video/old.mp4', newPath: 'video/new.mp4' });

      expect(handle.move).toHaveBeenCalledWith(expect.anything(), 'video/new.mp4.proxy.mp4');
      expect(existingProxies.value.has('video/old.mp4')).toBe(false);
      expect(existingProxies.value.has('video/new.mp4')).toBe(true);
    });

    it('falls back to copy+delete when native move is missing', async () => {
      const { service, existingProxies, mockDir } = createService();
      existingProxies.value.add('video/old.mp4');
      const oldHandle = {
        getFile: vi.fn(async () => new File(['data'], 'proxy.mp4')),
        createWritable: vi.fn(async () => {
          const chunks: Uint8Array[] = [];
          return {
            write: vi.fn(async (chunk: any) => {
              if (chunk instanceof Uint8Array) chunks.push(chunk);
              else if (typeof chunk === 'string')
                chunks.push(new TextEncoder().encode(chunk));
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
      mockDir._map.set('video/old.mp4.proxy.mp4', oldHandle);

      await service.renameProxy({ oldPath: 'video/old.mp4', newPath: 'video/new.mp4' });

      expect(mockDir.removeEntry).toHaveBeenCalledWith('video/old.mp4.proxy.mp4');
      expect(existingProxies.value.has('video/old.mp4')).toBe(false);
      expect(existingProxies.value.has('video/new.mp4')).toBe(true);
    });
  });

  describe('renameProxyDir', () => {
    it('cancels active tasks and renames affected proxies', async () => {
      const { service, proxyAbortControllers, existingProxies, mockDir } = createService();
      const controller = new AbortController();
      proxyAbortControllers.value.set('video/old/sub1.mp4', controller);
      existingProxies.value.add('video/old/sub1.mp4');
      existingProxies.value.add('video/old/sub2.mp4');
      const handle = { move: vi.fn().mockResolvedValue(undefined) };
      mockDir._map.set('video/old/sub1.mp4.proxy.mp4', handle);
      mockDir._map.set('video/old/sub2.mp4.proxy.mp4', handle);

      await service.renameProxyDir({ oldPath: 'video/old', newPath: 'video/new' });

      expect(controller.signal.aborted).toBe(true);
      expect(existingProxies.value.has('video/new/sub1.mp4')).toBe(true);
      expect(existingProxies.value.has('video/new/sub2.mp4')).toBe(true);
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
      const service = createProxyService({
        videoExtensions: new Set(['mp4']),
        generatingProxies: ref(new Set<string>()),
        existingProxies: ref(new Set<string>()),
        proxyProgress: ref(new Map<string, number>()),
        proxyAbortControllers: ref(new Map<string, AbortController>()),
        activeWorkerPaths: ref(new Set<string>()),
        proxyTaskIds: ref(new Map<string, string>()),
        taskIdToPath: ref(new Map<string, string>()),
        bgTaskIdsByPath: ref(new Map<string, string>()),
        proxyQueue: ref(queue as any),
        ensureProjectProxiesDir: vi.fn(async () => ({}) as FileSystemDirectoryHandle),
        getProxyFileName: vi.fn(async (path) => `${path}.proxy.mp4`),
        getFileHandleByPath: vi.fn(),
        getFileByPath: vi.fn(),
        getOptimizationSettings: () => ({
          proxyMaxPixels: 640 * 360,
          proxyVideoBitrateMbps: 1,
          proxyAudioBitrateKbps: 96,
          proxyVideoCodec: 'h264',
          proxyCopyOpusAudio: false,
        }),
        getProxyTaskTitle: ({ fileName }) => `Generating proxy: ${fileName}`,
        backgroundTasksStore: {
          addTask: vi.fn(() => 'bg-task'),
          updateTaskStatus: vi.fn(),
          updateTaskProgress: vi.fn(),
        } as any,
      });

      const dirHandle = {
        async *values() {
          yield { kind: 'file', name: 'a.mp4' };
          yield { kind: 'file', name: 'b.mp4' };
        },
      };

      const folderPromise = service.generateProxiesForFolder({
        dirHandle: dirHandle as any,
        dirPath: 'video',
      });

      await vi.waitFor(() => {
        expect(queue.add).toHaveBeenCalledTimes(2);
      });

      resolvers.forEach((resolve) => resolve());
      await folderPromise;
    });

    it('skips non-video files and already existing proxies', async () => {
      const { service, existingProxies, queue } = createService();
      existingProxies.value.add('video/b.mp4');

      const dirHandle = {
        async *values() {
          yield { kind: 'file', name: 'a.mp4' };
          yield { kind: 'file', name: 'b.mp4' };
          yield { kind: 'file', name: 'c.txt' };
        },
      };

      await service.generateProxiesForFolder({
        dirHandle: dirHandle as any,
        dirPath: 'video',
      });

      expect(queue.add).toHaveBeenCalledTimes(1);
    });
  });
});
