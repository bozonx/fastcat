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
        onResetPreviewMode: () => {},
      });

      await flushAsyncState();

      expect(preview.mediaType.value).toBe('video');
      expect(preview.currentUrl.value).toBe('asset://localhost/video.mp4');
      expect(getObjectUrlByPath).toHaveBeenCalledWith('video.mp4');
      expect(getFileByPath).not.toHaveBeenCalled();
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
});
