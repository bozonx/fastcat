/** @vitest-environment happy-dom */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref } from 'vue';
import { createProxyService } from '~/stores/proxy/proxyService';
import { createProxyFsModule } from '~/stores/proxy/proxyFs';
import {
  removeProxyCommand,
  cleanupVideoCachesCommand,
  onVideoPathMovedCommand,
} from '~/media-cache/application/proxyThumbnailCommands';

function createMockVfs() {
  const files = new Map<string, any>();
  return {
    createDirectory: vi.fn(async () => undefined),
    writeFile: vi.fn(async (path: string, data: any) => {
      files.set(path, data);
    }),
    deleteEntry: vi.fn(async (path: string) => {
      files.delete(path);
    }),
    moveEntry: vi.fn(async (src: string, dest: string) => {
      const data = files.get(src);
      files.set(dest, data);
      files.delete(src);
    }),
    getFile: vi.fn(async (path: string) => {
      if (files.has(path)) return { size: 1024 };
      return null;
    }),
    _files: files,
  };
}

describe('Proxy Workflow Integration', () => {
  let mockVfs: ReturnType<typeof createMockVfs>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockVfs = createMockVfs();
  });

  it('orchestrates end-to-end proxy path calculation, creation check, and deletion cleanup', async () => {
    const fsModule = createProxyFsModule({
      getProjectId: () => 'proj-integration',
      getResolvedStorageTopology: () => ({
        projectsRoot: 'projects',
        commonRoot: 'common',
        dataRoot: 'data',
        tempRoot: 'vardata',
        proxiesRoot: '',
        ephemeralTmpRoot: '',
      }),
    });

    const vfsPath = fsModule.getProjectProxiesVfsPath();
    expect(vfsPath).toBe('@ptemp/projects/proj-integration/proxies');

    const fileName = await fsModule.getProxyFileName('_video/clip.mp4');
    expect(fileName).toMatch(/^[0-9a-f]{64}\.mp4$/);

    const fullFilePath = await fsModule.getProxyFilePath('_video/clip.mp4');
    expect(fullFilePath).toBe(`@ptemp/projects/proj-integration/proxies/${fileName}`);

    // Simulate proxy file creation in VFS
    mockVfs._files.set(fullFilePath, new Uint8Array([0, 1, 2, 3]));

    const existingProxies = ref(new Set<string>());
    const generatingProxies = ref(new Set<string>());
    const proxyProgress = ref(new Map<string, number>());

    const bgTasks: Array<{ id: string; status: string }> = [];
    const bgTasksStore = {
      addTask: vi.fn(() => {
        const id = `bg-${bgTasks.length + 1}`;
        bgTasks.push({ id, status: 'pending' });
        return id;
      }),
      updateTaskStatus: vi.fn((id, status) => {
        const t = bgTasks.find((x) => x.id === id);
        if (t) t.status = status;
      }),
      updateTaskProgress: vi.fn(),
    };

    const service = createProxyService({
      videoExtensions: new Set(['mp4', 'mov']),
      generatingProxies,
      existingProxies,
      proxyProgress,
      proxyAbortControllers: ref(new Map()),
      activeWorkerPaths: ref(new Set()),
      proxyTaskIds: ref(new Map()),
      taskIdToPath: ref(new Map()),
      bgTaskIdsByPath: ref(new Map()),
      proxyQueue: ref({ add: async (fn: () => Promise<void>) => fn() } as any),
      getProjectProxiesVfsPath: fsModule.getProjectProxiesVfsPath,
      getProxyFileName: fsModule.getProxyFileName,
      getProxyFilePath: fsModule.getProxyFilePath,
      getVfs: () => mockVfs as any,
      getWriteFileHandle: vi.fn(
        async () =>
          ({
            createWritable: vi.fn(async () => ({ write: vi.fn(), close: vi.fn() })),
          }) as any,
      ),
      getFileHandleByPath: vi.fn(),
      getFileByPath: vi.fn(),
      getOptimizationSettings: () => ({
        proxyMaxPixels: 640 * 360,
        proxyVideoBitrateMbps: 1,
        proxyAudioBitrateKbps: 96,
        proxyCopyOpusAudio: false,
      }),
      getProxyTaskTitle: ({ fileName }) => `Generating: ${fileName}`,
      backgroundTasksStore: bgTasksStore as any,
    });

    // Check existing proxies in VFS
    await service.checkExistingProxies(['_video/clip.mp4']);
    expect(existingProxies.value.has('_video/clip.mp4')).toBe(true);

    // Run media-cache proxy removal command integration
    const thumbnailServiceMock = {
      checkExistingProxies: service.checkExistingProxies,
      removeProxy: service.deleteProxy,
      renameProxy: service.renameProxy,
      clearExistingProxies: vi.fn(),
      clearVideoThumbnails: vi.fn(async () => undefined),
      clearWaveforms: vi.fn(async () => undefined),
    };

    await removeProxyCommand({
      service: thumbnailServiceMock,
      projectRelativePath: '_video/clip.mp4',
    });

    expect(existingProxies.value.has('_video/clip.mp4')).toBe(false);
    expect(mockVfs.deleteEntry).toHaveBeenCalledWith(fullFilePath);
  });

  it('handles video path rename command updating proxy mappings and cache', async () => {
    const serviceMock = {
      checkExistingProxies: vi.fn(async () => undefined),
      removeProxy: vi.fn(async () => undefined),
      renameProxy: vi.fn(async () => undefined),
      clearExistingProxies: vi.fn(() => undefined),
      clearVideoThumbnails: vi.fn(async () => undefined),
      clearWaveforms: vi.fn(async () => undefined),
    };

    await onVideoPathMovedCommand({
      service: serviceMock,
      projectId: 'proj-1',
      oldPath: '_video/old_clip.mp4',
      newPath: '_video/new_clip.mp4',
    });

    expect(serviceMock.renameProxy).toHaveBeenCalledWith({
      oldPath: '_video/old_clip.mp4',
      newPath: '_video/new_clip.mp4',
    });
    expect(serviceMock.clearExistingProxies).toHaveBeenCalled();
    expect(serviceMock.clearVideoThumbnails).toHaveBeenCalledWith({
      projectId: 'proj-1',
      projectRelativePath: '_video/old_clip.mp4',
    });
    expect(serviceMock.checkExistingProxies).toHaveBeenCalledWith(['_video/new_clip.mp4']);
  });
});
