/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useMediaStore } from '~/stores/media.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { deserializeWaveformPeaks } from '~/utils/audio/waveform';
vi.mock('#app-manifest', () => ({}));

const { mediaFsMock, extractMetadataMock } = vi.hoisted(() => {
  const metaFiles = new Map<string, any>();
  const waveformFiles = new Map<string, any>();

  function createFileHandle(files: Map<string, any>, name: string) {
    return {
      createWritable: vi.fn().mockResolvedValue({
        write: vi.fn().mockImplementation(async (value: any) => {
          files.set(name, value);
        }),
        close: vi.fn().mockResolvedValue(undefined),
      }),
      getFile: vi.fn().mockResolvedValue({
        text: vi.fn().mockImplementation(async () => {
          const val = files.get(name);
          if (val instanceof ArrayBuffer) {
            return new TextDecoder().decode(val);
          }
          return val ?? '{}';
        }),
        arrayBuffer: vi.fn().mockImplementation(async () => {
          const val = files.get(name);
          if (typeof val === 'string') {
            return new TextEncoder().encode(val).buffer;
          }
          return val ?? new ArrayBuffer(0);
        }),
      }),
    };
  }

  const filesMetaDir = {
    getFileHandle: vi
      .fn()
      .mockImplementation(async (name: string, options?: { create?: boolean }) => {
        if (!metaFiles.has(name) && !options?.create) throw new Error('Not found');
        return createFileHandle(metaFiles, name);
      }),
    removeEntry: vi.fn().mockImplementation(async (name: string) => {
      metaFiles.delete(name);
    }),
  };

  const waveformsDir = {
    getFileHandle: vi
      .fn()
      .mockImplementation(async (name: string, options?: { create?: boolean }) => {
        if (!waveformFiles.has(name) && !options?.create) throw new Error('Not found');
        return createFileHandle(waveformFiles, name);
      }),
    removeEntry: vi.fn().mockImplementation(async (name: string) => {
      waveformFiles.delete(name);
    }),
  };

  const workspaceHandle = {
    getDirectoryHandle: vi.fn(),
  };

  workspaceHandle.getDirectoryHandle.mockImplementation(async (segment: string) => {
    if (segment === 'files-meta') return filesMetaDir;
    if (segment === 'waveforms') return waveformsDir;
    return workspaceHandle;
  });

  return {
    extractMetadataMock: vi.fn(),
    mediaFsMock: {
      metaFiles,
      waveformFiles,
      filesMetaDir,
      waveformsDir,
      workspaceHandle,
      reset: () => {
        metaFiles.clear();
        waveformFiles.clear();
        vi.clearAllMocks();
        workspaceHandle.getDirectoryHandle.mockImplementation(async (segment: string) => {
          if (segment === 'files-meta') return filesMetaDir;
          if (segment === 'waveforms') return waveformsDir;
          return workspaceHandle;
        });
      },
    },
  };
});

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(() => ({
    workspaceHandle: mediaFsMock.workspaceHandle,
    userSettings: { optimization: { proxyConcurrency: 2 } },
    resolvedStorageTopology: { tempRoot: '' },
  })),
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: vi.fn(() => ({
    currentProjectId: 'test-project',
    getFileHandleByPath: vi.fn(),
    getFileByPath: vi.fn().mockResolvedValue(null),
  })),
}));

vi.mock('~/stores/media/media-worker', () => ({
  createMediaWorkerModule: () => ({
    extractMetadata: extractMetadataMock,
  }),
}));

describe('MediaStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mediaFsMock.reset();
    vi.mocked(useProjectStore).mockReturnValue({
      currentProjectId: 'test-project',
      getFileHandleByPath: vi.fn(),
      getFileByPath: vi.fn().mockResolvedValue(null),
    } as any);
    extractMetadataMock.mockResolvedValue({
      source: { size: 100, lastModified: 100 },
      duration: 10,
    });
  });

  it('resets media state', () => {
    const store = useMediaStore();
    store.mediaMetadata = {
      'some/path.mp4': { source: { size: 100, lastModified: 100 }, duration: 10 },
    } as any;
    store.metadataLoadFailed = { 'some/path.mp4': true } as any;
    store.metadataLoading = { 'some/path.mp4': true } as any;

    store.resetMediaState();

    expect(store.mediaMetadata).toEqual({});
    expect(store.metadataLoadFailed).toEqual({});
    expect(store.metadataLoading).toEqual({});
  });

  it('sets audio peaks', () => {
    const store = useMediaStore();
    store.mediaMetadata = {
      'some/path.mp4': { source: { size: 100, lastModified: 100 }, duration: 10 },
    } as any;

    store.setAudioPeaks('some/path.mp4', [new Float32Array([0.5, 0.5])]);

    expect(store.mediaMetadata['some/path.mp4'].audioPeaks).toEqual([new Float32Array([0.5, 0.5])]);
  });

  it('persists audio peaks as JSON while keeping Float32Array in memory', async () => {
    const store = useMediaStore();
    store.mediaMetadata = {
      'some/path.mp4': { source: { size: 100, lastModified: 100 }, duration: 10 },
    } as any;

    store.setAudioPeaks('some/path.mp4', [new Float32Array([0.5, -0.25])]);

    await vi.waitFor(() => {
      expect(mediaFsMock.waveformFiles.get('some%2Fpath.mp4.json')).toBeDefined();
    });
    const buffer = mediaFsMock.waveformFiles.get('some%2Fpath.mp4.json') as ArrayBuffer;
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    const peaks = deserializeWaveformPeaks(buffer);
    expect(peaks).toBeDefined();
    expect(Array.from(peaks![0])).toEqual([0.5, -0.25]);
    expect(store.mediaMetadata['some/path.mp4'].audioPeaks?.[0]).toBeInstanceOf(Float32Array);
  });

  it('persists audio peaks even when in-memory metadata is absent', async () => {
    const store = useMediaStore();
    // mediaMetadata is empty — simulate the race where peaks arrive before metadata
    store.setAudioPeaks('some/path.mp4', [new Float32Array([0.5, -0.25])]);

    await vi.waitFor(() => {
      expect(mediaFsMock.waveformFiles.get('some%2Fpath.mp4.json')).toBeDefined();
    });
    const buffer = mediaFsMock.waveformFiles.get('some%2Fpath.mp4.json') as ArrayBuffer;
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    const peaks = deserializeWaveformPeaks(buffer);
    expect(peaks).toBeDefined();
    expect(Array.from(peaks![0])).toEqual([0.5, -0.25]);
  });

  it('loads cached audio peaks even when metadata is extracted from worker', async () => {
    const store = useMediaStore();
    const cacheFileName = 'some%2Fpath.mp4.json';
    // No meta cache, but waveform cache exists (e.g. from a prior session)
    mediaFsMock.waveformFiles.set(cacheFileName, JSON.stringify([[0.5, -0.25], [1]]));

    const result = await store.getOrFetchMetadata(
      { size: 100, lastModified: 100, name: 'path.mp4' } as File,
      'some/path.mp4',
    );

    expect(extractMetadataMock).toHaveBeenCalled();
    expect(result?.audioPeaks?.[0]).toBeInstanceOf(Float32Array);
    expect(Array.from(result?.audioPeaks?.[0] ?? [])).toEqual([0.5, -0.25]);
    expect(Array.from(result?.audioPeaks?.[1] ?? [])).toEqual([1]);
  });

  it('loads cached audio peaks from JSON as Float32Array channels', async () => {
    const store = useMediaStore();
    const cacheFileName = 'some%2Fpath.mp4.json';
    mediaFsMock.metaFiles.set(
      cacheFileName,
      JSON.stringify({
        source: { size: 100, lastModified: 100 },
        duration: 10,
      }),
    );
    mediaFsMock.waveformFiles.set(cacheFileName, JSON.stringify([[0.5, -0.25], [1]]));

    const result = await store.getOrFetchMetadata(
      { size: 100, lastModified: 100, name: 'path.mp4' } as File,
      'some/path.mp4',
    );

    expect(result?.audioPeaks?.[0]).toBeInstanceOf(Float32Array);
    expect(Array.from(result?.audioPeaks?.[0] ?? [])).toEqual([0.5, -0.25]);
    expect(Array.from(result?.audioPeaks?.[1] ?? [])).toEqual([1]);
  });

  it('returns null when file is missing', async () => {
    const store = useMediaStore();
    const result = await store.getOrFetchMetadataByPath('video/missing.mp4');
    expect(result).toBeNull();
    expect(store.missingPaths['video/missing.mp4']).toBe(true);
  });

  it('deduplicates concurrent metadata requests for the same path', async () => {
    const store = useMediaStore();

    const file = { size: 100, lastModified: 100, name: 'a.mp4' } as any;
    vi.mocked(useProjectStore).mockReturnValue({
      currentProjectId: 'test-project',
      getFileHandleByPath: vi.fn(),
      getFileByPath: vi.fn().mockResolvedValue(file),
    } as any);

    // Force a cache miss and slow worker by relying on default mocks
    const p1 = store.getOrFetchMetadataByPath('video/a.mp4');
    const p2 = store.getOrFetchMetadataByPath('video/a.mp4');

    const [r1, r2] = await Promise.all([p1, p2]);
    // Both should resolve to the same object reference or equal value
    expect(r1).toEqual(r2);
  });

  it('returns in-memory cached metadata when file size and lastModified match', async () => {
    const store = useMediaStore();
    store.mediaMetadata = {
      'video/a.mp4': { source: { size: 100, lastModified: 100 }, duration: 42 },
    } as any;

    const file = { size: 100, lastModified: 100, name: 'a.mp4' } as any;

    const result = await store.getOrFetchMetadata(file, 'video/a.mp4');
    expect(result).toEqual({ source: { size: 100, lastModified: 100 }, duration: 42 });
  });

  it('returns cached failed metadata without refetching until force refresh', async () => {
    const store = useMediaStore();
    const errorMeta = {
      source: { size: 100, lastModified: 100 },
      duration: 0,
      error: true,
    };
    store.mediaMetadata = { 'video/a.mp4': errorMeta } as any;

    const file = { size: 100, lastModified: 100, name: 'a.mp4' } as any;

    const result = await store.getOrFetchMetadata(file, 'video/a.mp4');

    expect(result).toEqual(errorMeta);
    expect(store.metadataLoadFailed['video/a.mp4']).toBe(true);
    expect(extractMetadataMock).not.toHaveBeenCalled();
  });

  it('restores failed metadata state from OPFS cache', async () => {
    const store = useMediaStore();
    const cacheFileName = 'video%2Fa.mp4.json';
    mediaFsMock.metaFiles.set(
      cacheFileName,
      JSON.stringify({
        source: { size: 100, lastModified: 100 },
        duration: 0,
        error: true,
      }),
    );

    const result = await store.getOrFetchMetadata(
      { size: 100, lastModified: 100, name: 'a.mp4' } as File,
      'video/a.mp4',
    );

    expect(result?.error).toBe(true);
    expect(store.metadataLoadFailed['video/a.mp4']).toBe(true);
    expect(extractMetadataMock).not.toHaveBeenCalled();
  });

  it('restores failed metadata state from OPFS cache for images', async () => {
    const store = useMediaStore();
    const cacheFileName = 'image%2Fa.jpg.json';
    mediaFsMock.metaFiles.set(
      cacheFileName,
      JSON.stringify({
        source: { size: 100, lastModified: 100 },
        duration: 0,
        error: true,
      }),
    );

    const result = await store.getOrFetchMetadata(
      { size: 100, lastModified: 100, name: 'a.jpg' } as File,
      'image/a.jpg',
    );

    expect(result?.error).toBe(true);
    expect(store.metadataLoadFailed['image/a.jpg']).toBe(true);
    expect(extractMetadataMock).not.toHaveBeenCalled();
  });

  it('removeMediaCache clears metadata and related state', async () => {
    const store = useMediaStore();
    store.mediaMetadata = { 'video/a.mp4': { duration: 10 } } as any;
    store.missingPaths = { 'video/a.mp4': true } as any;
    store.metadataLoadFailed = { 'video/a.mp4': true } as any;
    store.metadataLoading = { 'video/a.mp4': true } as any;

    await store.removeMediaCache('video/a.mp4');

    expect(store.mediaMetadata['video/a.mp4']).toBeUndefined();
    expect(store.missingPaths['video/a.mp4']).toBeUndefined();
    expect(store.metadataLoadFailed['video/a.mp4']).toBeUndefined();
    expect(store.metadataLoading['video/a.mp4']).toBeUndefined();
  });

  it('revalidateMissingMedia updates missingPaths based on file existence', async () => {
    vi.mocked(useProjectStore).mockReturnValue({
      currentProjectId: 'test-project',
      getFileHandleByPath: vi.fn(),
      getFileByPath: vi.fn().mockImplementation(async (path: string) => {
        return path === 'video/exists.mp4' ? ({ size: 1 } as File) : null;
      }),
    } as any);
    const store = useMediaStore();

    await store.revalidateMissingMedia(['video/exists.mp4', 'video/missing.mp4']);

    expect(store.missingPaths['video/exists.mp4']).toBe(false);
    expect(store.missingPaths['video/missing.mp4']).toBe(true);
  });
});
