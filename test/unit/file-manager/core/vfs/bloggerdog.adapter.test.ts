/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BloggerDogVfsAdapter } from '~/file-manager/core/vfs/bloggerdog.adapter';
import type { RemoteVfsFileEntry } from '~/types/remote-vfs';

const { updateRemoteItem } = vi.hoisted(() => ({
  updateRemoteItem: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('~/utils/remote-vfs', async () => {
  const actual = await vi.importActual<typeof import('~/utils/remote-vfs')>('~/utils/remote-vfs');
  return {
    ...actual,
    updateRemoteItem,
  };
});

describe('BloggerDogVfsAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears content item text when deleting its virtual txt file', async () => {
    const adapter = new BloggerDogVfsAdapter(() => ({
      baseUrl: 'https://example.com/api',
      bearerToken: 'token',
    }));

    const item: RemoteVfsFileEntry = {
      id: 'item-1',
      type: 'file',
      name: 'Sunset',
      title: 'Sunset',
      path: '/personal/item-1',
      text: 'Hello world',
      scope: 'personal',
    };

    const cache = (adapter as unknown as { idCache: Map<string, unknown> }).idCache;
    cache.set('/personal/item-1', {
      id: item.id,
      type: 'file',
      path: '/personal/item-1',
      scope: 'personal',
      item,
    });

    const [textEntry] = await adapter.readDirectory('/personal/item-1');
    await adapter.deleteEntry(textEntry.path);

    expect(updateRemoteItem).toHaveBeenCalledWith({
      config: {
        baseUrl: 'https://example.com/api',
        bearerToken: 'token',
      },
      id: 'item-1',
      text: '',
    });
    expect(item.text).toBe('');
  });
});
