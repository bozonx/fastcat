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
    const reloadDirectory = vi.fn(async () => {});
    const vfs = {
      getMetadata: vi.fn(async () => ({ kind: 'directory' })),
    } as any;

    const { categories, loadAll } = useMobileAssetCategories({
      vfs,
      readDirectory,
      reloadDirectory,
    });

    await loadAll(true);

    expect(readDirectory.mock.calls.map(([path]) => path)).toEqual([
      '_video',
      '_audio',
      '_images',
      '_export',
      '_documents',
      '_files',
    ]);
    expect(reloadDirectory).toHaveBeenCalledTimes(6);
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
      reloadDirectory: vi.fn(async () => {}),
    });

    await loadAll();

    expect(readDirectory).not.toHaveBeenCalled();
    expect(categories.every((category) => category.sortedEntries.value.length === 0)).toBe(true);
  });
});
