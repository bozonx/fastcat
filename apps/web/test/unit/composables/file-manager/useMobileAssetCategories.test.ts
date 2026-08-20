import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { useMobileAssetCategories } from '~/composables/file-manager/useMobileAssetCategories';

const entryBuckets: Array<ReturnType<typeof createEntryBucket>> = [];

function createEntryBucket() {
  const folderEntries = ref<any[]>([]);
  return {
    folderEntries,
    sortedEntries: folderEntries,
    videoThumbnails: ref({}),
    fileCompatibility: ref({}),
    supplementEntries: vi.fn(async (entries) => entries),
  };
}

vi.mock('~/composables/file-manager/useFileBrowserEntries', () => ({
  useFileBrowserEntries: () => {
    const bucket = createEntryBucket();
    entryBuckets.push(bucket);
    return bucket;
  },
}));

describe('useMobileAssetCategories', () => {
  beforeEach(() => {
    entryBuckets.length = 0;
  });

  it('loads files from each fixed asset directory and ignores nested directories', async () => {
    const readDirectory = vi.fn(async (path: string) => [
      { kind: 'file', name: `${path}.mp4`, path: `${path}/${path}.mp4` },
      { kind: 'directory', name: 'nested', path: `${path}/nested` },
    ]);
    const vfs = {
      getMetadata: vi.fn(async () => ({ kind: 'directory' })),
    } as any;

    const { categories, loadAll } = useMobileAssetCategories({
      vfs,
      readDirectory,
    });

    await loadAll(true);

    expect(readDirectory.mock.calls.map(([path]) => path)).toEqual([
      '_export',
      '_video',
      '_images',
      '_audio',
      '_documents',
      '_files',
    ]);
    expect(categories.every((category) => category.sortedEntries.value.length === 1)).toBe(true);
  });

  it('returns an empty category when its directory does not exist', async () => {
    const vfs = {
      getMetadata: vi.fn(async () => null),
    } as any;
    const readDirectory = vi.fn(async () => []);

    const { categories, loadAll } = useMobileAssetCategories({
      vfs,
      readDirectory,
    });

    await loadAll();

    expect(readDirectory).not.toHaveBeenCalled();
    expect(categories.every((category) => category.sortedEntries.value.length === 0)).toBe(true);
  });

  it('deduplicates concurrent loads and preserves unchanged entry arrays', async () => {
    let resolveRead: ((entries: any[]) => void) | undefined;
    const readDirectory = vi.fn(
      async (path: string) =>
        await new Promise<any[]>((resolve) => {
          resolveRead = () =>
            resolve([{ kind: 'file', name: `${path}.mp4`, path: `${path}/${path}.mp4` }]);
        }),
    );
    const vfs = {
      getMetadata: vi.fn(async () => ({ kind: 'directory' })),
    } as any;

    const { categories } = useMobileAssetCategories({
      vfs,
      readDirectory,
    });
    const category = categories[0]!;

    const firstLoad = category.load();
    const concurrentLoad = category.load();
    await vi.waitFor(() => expect(readDirectory).toHaveBeenCalledOnce());
    resolveRead?.([]);
    await Promise.all([firstLoad, concurrentLoad]);

    const initialEntries = category.sortedEntries.value;
    readDirectory.mockImplementation(async (path: string) => [
      { kind: 'file', name: `${path}.mp4`, path: `${path}/${path}.mp4` },
    ]);

    await category.load();

    expect(category.sortedEntries.value).toBe(initialEntries);
    expect(readDirectory).toHaveBeenCalledTimes(2);
  });
});
