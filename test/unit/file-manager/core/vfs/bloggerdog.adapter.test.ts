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

  it('reads media file with bearer auth and uses nested media id from relation', async () => {
    const adapter = new BloggerDogVfsAdapter(() => ({
      baseUrl: 'http://localhost:8080/api/v1/external/content-library',
      bearerToken: 'token',
    }));

    const item: RemoteVfsFileEntry = {
      id: 'item-1',
      type: 'file',
      name: 'Item',
      path: '/personal/item-1',
      scope: 'personal',
      media: [
        {
          id: 'rel-uuid',
          mediaId: 'media-uuid',
          order: 0,
          media: {
            id: 'media-uuid',
            type: 'IMAGE',
            filename: 'image.webp',
            mimeType: 'image/webp',
            sizeBytes: 42,
          },
        },
      ],
    };

    const cache = (adapter as unknown as { idCache: Map<string, unknown> }).idCache;
    cache.set('/personal/item-1', {
      id: item.id,
      type: 'file',
      path: '/personal/item-1',
      scope: 'personal',
      item,
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(new Blob(['ok'], { type: 'image/webp' })),
    });
    vi.stubGlobal('fetch', fetchMock);

    const [mediaEntry] = await adapter.readDirectory('/personal/item-1');
    const blob = await adapter.readFile(mediaEntry.path);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/external/content-library/media/media-uuid/file?download=1',
      {
        signal: undefined,
        headers: {
          Authorization: 'Bearer token',
        },
      },
    );
    expect(blob.type).toBe('image/webp');
  });

  it('rejects creating folders inside a content item', async () => {
    const adapter = new BloggerDogVfsAdapter(() => ({
      baseUrl: 'https://example.com/api',
      bearerToken: 'token',
    }));

    const item: RemoteVfsFileEntry = {
      id: 'item-1',
      type: 'file',
      name: 'Item',
      title: 'Item',
      path: '/personal/item-1',
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

    await expect(adapter.createDirectory('/personal/item-1/New Folder')).rejects.toThrow(
      'Creating folders inside content items is not supported',
    );
  });
});
