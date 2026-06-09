import { describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { useEntryPreview } from '~/composables/file-manager/useEntryPreview';
import type { FsEntry } from '~/types/fs';

async function flushAsyncState() {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
    await nextTick();
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('useEntryPreview', () => {
  it('uses getObjectUrlByPath for video/audio instead of loading the full file', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const entry: FsEntry = {
        kind: 'file',
        name: 'video.mp4',
        path: 'video.mp4',
        source: 'local',
      };

      const selectedFsEntry = ref<FsEntry | null>(entry);
      const getFileByPath = vi
        .fn()
        .mockResolvedValue(new File([], 'video.mp4', { type: 'video/mp4' }));
      const getObjectUrlByPath = vi.fn().mockResolvedValue('asset://localhost/video.mp4');
      const getOrFetchMetadataByPath = vi.fn().mockResolvedValue(null);

      const preview = useEntryPreview({
        selectedFsEntry,
        previewMode: ref<'original' | 'proxy'>('original'),
        hasProxy: ref(false),
        mediaStore: {
          getOrFetchMetadataByPath,
        },
        proxyStore: {
          getProxyFile: async () => null,
        },
        getFileByPath,
        getObjectUrlByPath,
        onResetPreviewMode: () => {},
      });

      await flushAsyncState();

      expect(preview.mediaType.value).toBe('video');
      expect(preview.currentUrl.value).toBe('asset://localhost/video.mp4');
      expect(getObjectUrlByPath).toHaveBeenCalledWith('video.mp4');
      expect(getFileByPath).not.toHaveBeenCalled();
      expect(getOrFetchMetadataByPath).toHaveBeenCalledWith('video.mp4');
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('shows base info for the next entry while detailed properties are resolving', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const oldEntry: FsEntry = {
        kind: 'file',
        name: 'old.txt',
        path: 'old.txt',
        source: 'local',
      };
      const newEntry: FsEntry = {
        kind: 'file',
        name: 'new.txt',
        path: 'new.txt',
        source: 'local',
      };

      const selectedFsEntry = ref<FsEntry | null>(oldEntry);
      const nextFileDeferred = createDeferred<File | null>();

      const preview = useEntryPreview({
        selectedFsEntry,
        previewMode: ref<'original' | 'proxy'>('original'),
        hasProxy: ref(false),
        mediaStore: {
          getOrFetchMetadataByPath: async () => null,
        },
        proxyStore: {
          getProxyFile: async () => null,
        },
        getFileByPath: async (path) => {
          if (path === 'old.txt') {
            return new File(['old content'], 'old.txt', { type: 'text/plain' });
          }
          if (path === 'new.txt') {
            return await nextFileDeferred.promise;
          }
          return null;
        },
        onResetPreviewMode: () => {},
      });

      await flushAsyncState();

      expect(preview.fileInfo.value?.name).toBe('old.txt');
      expect(preview.textContent.value).toContain('old content');

      selectedFsEntry.value = newEntry;
      await nextTick();

      expect(preview.fileInfo.value?.name).toBe('new.txt');
      expect(preview.fileInfo.value?.path).toBe('new.txt');
      expect(preview.mediaType.value).toBe('text');
      expect(preview.textContent.value).toBe('');

      nextFileDeferred.resolve(new File(['new content'], 'new.txt', { type: 'text/plain' }));
      await flushAsyncState();

      expect(preview.fileInfo.value?.name).toBe('new.txt');
      expect(preview.textContent.value).toContain('new content');
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('fetches metadata via getMetadata when getObjectUrlByPath is available', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const entry: FsEntry = {
        kind: 'file',
        name: 'video.mp4',
        path: 'video.mp4',
        source: 'local',
      };

      const selectedFsEntry = ref<FsEntry | null>(entry);
      const getFileByPath = vi.fn().mockResolvedValue(null);
      const getObjectUrlByPath = vi.fn().mockResolvedValue('asset://localhost/video.mp4');
      const mockMetadata = {
        source: { size: 12345, lastModified: Date.now() },
        duration: 60,
        video: {
          width: 1920,
          height: 1080,
          displayWidth: 1920,
          displayHeight: 1080,
          rotation: 0,
          codec: 'avc1',
          parsedCodec: 'h264',
          fps: 25,
        },
      };
      const getMetadata = vi.fn().mockResolvedValue(mockMetadata);

      const preview = useEntryPreview({
        selectedFsEntry,
        previewMode: ref<'original' | 'proxy'>('original'),
        hasProxy: ref(false),
        mediaStore: {
          getOrFetchMetadataByPath: async () => null,
        },
        proxyStore: {
          getProxyFile: async () => null,
        },
        getFileByPath,
        getObjectUrlByPath,
        getMetadata,
        onResetPreviewMode: () => {},
      });

      await flushAsyncState();

      expect(preview.mediaType.value).toBe('video');
      expect(preview.currentUrl.value).toBe('asset://localhost/video.mp4');
      expect(getMetadata).toHaveBeenCalledWith({
        file: expect.any(File),
        entry,
        path: 'video.mp4',
      });
      expect(preview.fileInfo.value?.metadata).toEqual(mockMetadata);
      expect(preview.metadataYaml.value).toContain('duration: 60');
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('keeps resolving the selected entry when selection resets proxy preview mode', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const oldEntry: FsEntry = {
        kind: 'file',
        name: 'old.txt',
        path: 'old.txt',
        source: 'local',
      };
      const newEntry: FsEntry = {
        kind: 'file',
        name: 'new.txt',
        path: 'new.txt',
        source: 'local',
      };

      const selectedFsEntry = ref<FsEntry | null>(oldEntry);
      const previewMode = ref<'original' | 'proxy'>('proxy');
      const nextFileDeferred = createDeferred<File | null>();

      const preview = useEntryPreview({
        selectedFsEntry,
        previewMode,
        hasProxy: ref(false),
        mediaStore: {
          getOrFetchMetadataByPath: async () => null,
        },
        proxyStore: {
          getProxyFile: async () => null,
        },
        getFileByPath: async (path) => {
          if (path === 'old.txt') {
            return new File(['old content'], 'old.txt', { type: 'text/plain' });
          }
          if (path === 'new.txt') {
            return await nextFileDeferred.promise;
          }
          return null;
        },
        onResetPreviewMode: (mode) => {
          previewMode.value = mode;
        },
      });

      await flushAsyncState();

      selectedFsEntry.value = newEntry;
      await nextTick();

      nextFileDeferred.resolve(new File(['new content'], 'new.txt', { type: 'text/plain' }));
      await flushAsyncState();

      expect(preview.fileInfo.value?.name).toBe('new.txt');
      expect(preview.textContent.value).toContain('new content');
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('excludes audioPeaks from metadataYaml to prevent js-yaml error', async () => {
    const entry: FsEntry = {
      kind: 'file',
      name: 'video.mp4',
      path: 'video.mp4',
      source: 'local',
    };

    const selectedFsEntry = ref<FsEntry | null>(entry);
    const getFileByPath = vi.fn().mockResolvedValue(new File([], 'video.mp4', { type: 'video/mp4' }));
    const mockMetadata = {
      duration: 60,
      audioPeaks: [new Float32Array([0.5, -0.5])],
    };

    const preview = useEntryPreview({
      selectedFsEntry,
      previewMode: ref<'original' | 'proxy'>('original'),
      hasProxy: ref(false),
      mediaStore: {
        getOrFetchMetadataByPath: async () => mockMetadata as any,
      },
      proxyStore: {
        getProxyFile: async () => null,
      },
      getFileByPath,
      onResetPreviewMode: () => {},
    });

    await flushAsyncState();

    expect(preview.fileInfo.value?.metadata).toEqual(mockMetadata);
    expect(preview.metadataYaml.value).toContain('duration: 60');
    expect(preview.metadataYaml.value).not.toContain('audioPeaks');
  });
});
