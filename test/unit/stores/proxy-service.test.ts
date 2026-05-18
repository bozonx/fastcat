/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { createProxyService } from '~/stores/proxy/proxyService';

vi.mock('~/utils/video-editor/worker-client', () => ({
  getProxyWorkerClient: () => ({
    client: {
      cancelExport: vi.fn(),
    },
  }),
  setProxyHostApi: vi.fn(),
}));

vi.mock('~/utils/video-editor/createVideoCoreHostApi', () => ({
  createVideoCoreHostApi: (params: unknown) => params,
}));

describe('createProxyService', () => {
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
});
