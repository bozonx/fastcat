/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useMediaStore } from '~/stores/media.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import {
  deserializeWaveformPeaks,
  isWaveformCacheEntry,
  readWaveformCacheEntry,
  serializeWaveformCacheEntry,
} from '~/utils/audio/waveform';
vi.mock('#app-manifest', () => ({}));

const { mockIsTauriState, mockNativeMediaMetadata, mockNativeMediaExtractPeaks } = vi.hoisted(
  () => ({
    mockIsTauriState: { value: false },
    mockNativeMediaMetadata: vi.fn(),
    mockNativeMediaExtractPeaks: vi.fn(),
  }),
);

vi.mock('~/utils/runtime', () => ({
  isTauriRuntime: () => mockIsTauriState.value,
}));

vi.mock('~/utils/tauri-media-processing', () => ({
  getNativeFileHandlePath: (handle: any) => handle?.path || null,
  nativeMediaMetadata: (...args: any[]) => mockNativeMediaMetadata(...args),
  nativeMediaExtractPeaks: (...args: any[]) => mockNativeMediaExtractPeaks(...args),
}));

const { clearThumbnailMock, clearThumbnailsMock } = vi.hoisted(() => ({
  clearThumbnailMock: vi.fn(),
  clearThumbnailsMock: vi.fn(),
}));

vi.mock('~/utils/file-thumbnail-generator', () => ({
  fileThumbnailGenerator: {
    clearThumbnail: clearThumbnailMock,
  },
}));

vi.mock('~/utils/thumbnail-generator', () => ({
  thumbnailGenerator: {
    clearThumbnails: clearThumbnailsMock,
  },
  getClipThumbnailsHash: (input: any) => `hash:${input.projectId}:${input.projectRelativePath}`,
}));

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

const mockVfs = {
  writeFile: vi.fn(async (path: string, data: any) => {
    const fileName = path.split('/').pop() || '';
    // Store as ArrayBuffer or Uint8Array depending on what was passed
    const buffer =
      typeof data === 'string' ? new TextEncoder().encode(data).buffer : data.buffer || data;
    if (path.includes('files-meta')) {
      mediaFsMock.metaFiles.set(fileName, buffer);
    } else if (path.includes('waveforms')) {
      mediaFsMock.waveformFiles.set(fileName, buffer);
    }
  }),
  deleteEntry: vi.fn(async (path: string) => {
    const fileName = path.split('/').pop() || '';
    if (path.includes('files-meta')) {
      mediaFsMock.metaFiles.delete(fileName);
    } else if (path.includes('waveforms')) {
      mediaFsMock.waveformFiles.delete(fileName);
    }
  }),
  getFile: vi.fn(async (path: string) => {
    const fileName = path.split('/').pop() || '';
    let val: any;
    if (path.includes('files-meta')) {
      val = mediaFsMock.metaFiles.get(fileName);
    } else if (path.includes('waveforms')) {
      val = mediaFsMock.waveformFiles.get(fileName);
    }
    if (val === undefined) return null;

    return {
      text: vi.fn(async () => {
        if (val instanceof ArrayBuffer || val instanceof Uint8Array || ArrayBuffer.isView(val)) {
          return new TextDecoder().decode(val);
        }
        return val ?? '{}';
      }),
      arrayBuffer: vi.fn(async () => {
        if (typeof val === 'string') {
          return new TextEncoder().encode(val).buffer;
        }
        if (val instanceof Uint8Array || ArrayBuffer.isView(val)) {
          return val.buffer;
        }
        return val ?? new ArrayBuffer(0);
      }),
    } as any;
  }),
};

vi.mock('~/composables/useVfs', () => ({
  useVfs: () => mockVfs,
}));

describe('MediaStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mediaFsMock.reset();
    clearThumbnailMock.mockReset();
    clearThumbnailsMock.mockReset();
    mockIsTauriState.value = false;
    mockNativeMediaMetadata.mockReset();
    mockNativeMediaExtractPeaks.mockReset();

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

  it('persists audio peaks in a fingerprinted envelope when metadata is known', async () => {
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
    expect(isWaveformCacheEntry(buffer)).toBe(true);
    const entry = readWaveformCacheEntry(buffer);
    expect(entry?.fingerprint).toEqual({ size: 100, lastModified: 100 });
    expect(Array.from(entry!.peaks[0])).toEqual([0.5, -0.25]);
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

  it('rejects a fingerprinted waveform blob that belongs to a different file', async () => {
    const store = useMediaStore();
    const cacheFileName = 'some%2Fpath.mp4.json';
    // Envelope generated for a previous file (size 999) now occupying this path.
    const stale = serializeWaveformCacheEntry([new Float32Array([0.5, -0.25])], {
      size: 999,
      lastModified: 999,
    });
    mediaFsMock.waveformFiles.set(cacheFileName, stale);

    const result = await store.getOrFetchMetadata(
      { size: 100, lastModified: 100, name: 'path.mp4' } as File,
      'some/path.mp4',
    );

    // The current file is size 100 → fingerprint mismatch → peaks not reused,
    // and the stale blob is dropped so a fresh extraction can replace it.
    expect(result?.audioPeaks).toBeUndefined();
    expect(mediaFsMock.waveformFiles.get(cacheFileName)).toBeUndefined();
  });

  it('reuses a fingerprinted waveform blob when it matches the current file', async () => {
    const store = useMediaStore();
    const cacheFileName = 'some%2Fpath.mp4.json';
    const fresh = serializeWaveformCacheEntry(
      [new Float32Array([0.5, -0.25]), new Float32Array([1, -1])],
      { size: 100, lastModified: 100 },
    );
    mediaFsMock.waveformFiles.set(cacheFileName, fresh);

    const result = await store.getOrFetchMetadata(
      { size: 100, lastModified: 100, name: 'path.mp4' } as File,
      'some/path.mp4',
    );

    expect(result?.audioPeaks?.[0]).toBeInstanceOf(Float32Array);
    expect(Array.from(result?.audioPeaks?.[0] ?? [])).toEqual([0.5, -0.25]);
    expect(Array.from(result?.audioPeaks?.[1] ?? [])).toEqual([1, -1]);
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

  it('loads cached audio peaks for already in-memory metadata without refetching metadata', async () => {
    const store = useMediaStore();
    const cacheFileName = 'some%2Fpath.mp4.json';
    store.mediaMetadata = {
      'some/path.mp4': {
        source: { size: 100, lastModified: 100 },
        duration: 10,
      },
    } as any;
    mediaFsMock.waveformFiles.set(cacheFileName, JSON.stringify([[0.5, -0.25], [1]]));

    const result = await store.getOrFetchMetadata(
      { size: 100, lastModified: 100, name: 'path.mp4' } as File,
      'some/path.mp4',
    );

    expect(extractMetadataMock).not.toHaveBeenCalled();
    expect(result?.audioPeaks?.[0]).toBeInstanceOf(Float32Array);
    expect(Array.from(result?.audioPeaks?.[0] ?? [])).toEqual([0.5, -0.25]);
    expect(Array.from(store.mediaMetadata['some/path.mp4'].audioPeaks?.[1] ?? [])).toEqual([1]);
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

  it('clears thumbnail caches when file is modified', async () => {
    const store = useMediaStore();
    const cacheFileName = 'video%2Fa.mp4.json';
    mediaFsMock.metaFiles.set(
      cacheFileName,
      JSON.stringify({
        source: { size: 100, lastModified: 100 },
        duration: 10,
      }),
    );

    // Call getOrFetchMetadata with a modified file (size/modified change)
    await store.getOrFetchMetadata(
      { size: 200, lastModified: 200, name: 'a.mp4' } as File,
      'video/a.mp4',
    );

    expect(clearThumbnailMock).toHaveBeenCalledWith({
      projectId: 'test-project',
      projectRelativePath: 'video/a.mp4',
    });
    expect(clearThumbnailsMock).toHaveBeenCalledWith({
      projectId: 'test-project',
      hash: 'hash:test-project:video/a.mp4',
    });
  });

  it('clears thumbnail caches in removeMediaCache', async () => {
    const store = useMediaStore();
    await store.removeMediaCache('video/a.mp4');

    expect(clearThumbnailMock).toHaveBeenCalledWith({
      projectId: 'test-project',
      projectRelativePath: 'video/a.mp4',
    });
    expect(clearThumbnailsMock).toHaveBeenCalledWith({
      projectId: 'test-project',
      hash: 'hash:test-project:video/a.mp4',
    });
  });

  it('removeMediaCacheForDirectory clears cache for all files in that directory', async () => {
    const store = useMediaStore();
    store.mediaMetadata = {
      'video/sub/a.mp4': { duration: 10 },
      'video/sub/b.mp4': { duration: 20 },
      'video/other.mp4': { duration: 30 },
    } as any;
    store.missingPaths = {
      'video/sub/a.mp4': true,
      'video/sub/b.mp4': true,
      'video/other.mp4': true,
    } as any;
    store.metadataLoadFailed = {
      'video/sub/a.mp4': true,
      'video/sub/b.mp4': true,
      'video/other.mp4': true,
    } as any;
    store.metadataLoading = {
      'video/sub/a.mp4': true,
      'video/sub/b.mp4': true,
      'video/other.mp4': true,
    } as any;

    await store.removeMediaCacheForDirectory('video/sub');

    expect(store.mediaMetadata['video/sub/a.mp4']).toBeUndefined();
    expect(store.mediaMetadata['video/sub/b.mp4']).toBeUndefined();
    expect(store.mediaMetadata['video/other.mp4']).toBeDefined();

    expect(store.missingPaths['video/sub/a.mp4']).toBeUndefined();
    expect(store.missingPaths['video/sub/b.mp4']).toBeUndefined();
    expect(store.missingPaths['video/other.mp4']).toBe(true);

    expect(store.metadataLoadFailed['video/sub/a.mp4']).toBeUndefined();
    expect(store.metadataLoadFailed['video/sub/b.mp4']).toBeUndefined();
    expect(store.metadataLoadFailed['video/other.mp4']).toBe(true);

    expect(store.metadataLoading['video/sub/a.mp4']).toBeUndefined();
    expect(store.metadataLoading['video/sub/b.mp4']).toBeUndefined();
    expect(store.metadataLoading['video/other.mp4']).toBe(true);
  });

  it('extracts metadata for image in Tauri environment correctly', async () => {
    mockIsTauriState.value = true;

    const mockFile = { size: 12345, lastModified: 98765, name: 'logo.svg' } as File;
    const mockHandle = { path: 'image/logo.svg' };

    vi.mocked(useProjectStore).mockReturnValue({
      currentProjectId: 'test-project',
      getFileHandleByPath: vi.fn().mockResolvedValue(mockHandle),
      getFileByPath: vi.fn().mockResolvedValue(mockFile),
    } as any);

    const store = useMediaStore();

    mockNativeMediaMetadata.mockResolvedValue({
      duration: 0.0,
      video: {
        width: 800,
        height: 600,
        fps: 25.0,
        codec: 'png',
      },
    });

    const result = await store.getOrFetchMetadata(mockFile, 'image/logo.svg');

    expect(result).toBeDefined();
    expect(result?.duration).toBe(0);
    expect(result?.image).toEqual({
      canDisplay: true,
      width: 800,
      height: 600,
    });
    expect(result?.video).toBeUndefined();
    expect(result?.audio).toBeUndefined();
  });

  it('extracts metadata for video in Tauri environment correctly', async () => {
    mockIsTauriState.value = true;

    const mockFile = { size: 12345, lastModified: 98765, name: 'movie.mp4' } as File;
    const mockHandle = { path: 'video/movie.mp4' };

    vi.mocked(useProjectStore).mockReturnValue({
      currentProjectId: 'test-project',
      getFileHandleByPath: vi.fn().mockResolvedValue(mockHandle),
      getFileByPath: vi.fn().mockResolvedValue(mockFile),
    } as any);

    const store = useMediaStore();

    mockNativeMediaMetadata.mockResolvedValue({
      duration: 12.34,
      video: {
        width: 1920,
        height: 1080,
        fps: 30.0,
        codec: 'h264',
      },
      audio: {
        codec: 'aac',
        sampleRate: 48000,
        channels: 2,
      },
    });

    const result = await store.getOrFetchMetadata(mockFile, 'video/movie.mp4');

    expect(result).toBeDefined();
    expect(result?.duration).toBe(12.34);
    expect(result?.video).toEqual({
      width: 1920,
      height: 1080,
      displayWidth: 1920,
      displayHeight: 1080,
      rotation: 0,
      codec: 'h264',
      parsedCodec: 'h264',
      fps: 30.0,
      bitrate: undefined,
      canDecode: true,
    });
    expect(result?.audio).toEqual({
      codec: 'aac',
      parsedCodec: 'aac',
      sampleRate: 48000,
      channels: 2,
      bitrate: undefined,
      canDecode: true,
    });
    expect(result?.image).toBeUndefined();
  });

  it('extracts metadata for video in Tauri environment with rotation correctly', async () => {
    mockIsTauriState.value = true;

    const mockFile = { size: 12345, lastModified: 98765, name: 'vertical.mp4' } as File;
    const mockHandle = { path: 'video/vertical.mp4' };

    vi.mocked(useProjectStore).mockReturnValue({
      currentProjectId: 'test-project',
      getFileHandleByPath: vi.fn().mockResolvedValue(mockHandle),
      getFileByPath: vi.fn().mockResolvedValue(mockFile),
    } as any);

    const store = useMediaStore();

    mockNativeMediaMetadata.mockResolvedValue({
      duration: 10.0,
      video: {
        width: 1920,
        height: 1080,
        fps: 30.0,
        codec: 'h264',
        rotation: 90,
      },
    });

    const result = await store.getOrFetchMetadata(mockFile, 'video/vertical.mp4');

    expect(result).toBeDefined();
    expect(result?.video).toMatchObject({
      width: 1920,
      height: 1080,
      displayWidth: 1080,
      displayHeight: 1920,
      rotation: 90,
    });
  });

  it('extracts peaks using Tauri native extraction in Tauri environment', async () => {
    mockIsTauriState.value = true;
    mockNativeMediaExtractPeaks.mockResolvedValue([
      new Float32Array([0.1, 0.2]),
      new Float32Array([0.3, 0.4]),
    ]);

    const mockFile = { size: 100, lastModified: 100, name: 'audio.mp3' } as any;
    const mockHandle = { path: 'audio/audio.mp3' };

    vi.mocked(useProjectStore).mockReturnValue({
      currentProjectId: 'test-project',
      getFileHandleByPath: vi.fn().mockResolvedValue(mockHandle),
      getFileByPath: vi.fn().mockResolvedValue(mockFile),
    } as any);

    const store = useMediaStore();
    const result = await store.extractPeaks(mockFile, 'audio/audio.mp3', { maxLength: 100 });

    expect(mockNativeMediaExtractPeaks).toHaveBeenCalledWith('audio/audio.mp3', 100, undefined);
    expect(result).toBeDefined();
    expect(result?.[0]).toBeInstanceOf(Float32Array);
    expect(result?.[0]?.[0]).toBeCloseTo(0.1);
    expect(result?.[0]?.[1]).toBeCloseTo(0.2);
    expect(result?.[1]?.[0]).toBeCloseTo(0.3);
    expect(result?.[1]?.[1]).toBeCloseTo(0.4);
  });
});
