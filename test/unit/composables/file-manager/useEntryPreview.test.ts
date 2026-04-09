import { describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { useEntryPreview } from '~/composables/file-manager/useEntryPreview';
import type { FsEntry } from '~/types/fs';

function flushAsyncState() {
  return Promise.resolve().then(() => Promise.resolve()).then(() => nextTick());
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('useEntryPreview', () => {
  it('keeps the previous file info until the next entry is fully resolved', async () => {
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

      expect(preview.fileInfo.value?.name).toBe('old.txt');
      expect(preview.textContent.value).toContain('old content');

      nextFileDeferred.resolve(new File(['new content'], 'new.txt', { type: 'text/plain' }));
      await flushAsyncState();

      expect(preview.fileInfo.value?.name).toBe('new.txt');
      expect(preview.textContent.value).toContain('new content');
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });
});
