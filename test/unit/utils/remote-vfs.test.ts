// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { RemoteVfsFileEntry } from '../../src/types/remote-vfs';
import {
  createRemoteMediaFsEntry,
  getRemoteFileDownloadUrl,
  isRemoteFsEntry,
  toRemoteFsEntry,
} from '../../src/utils/remote-vfs';

describe('remote-vfs utils', () => {
  it('converts remote file entry to FsEntry-compatible remote entry', () => {
    const remoteFile: RemoteVfsFileEntry = {
      id: 'file-1',
      name: 'clip.mp4',
      type: 'file',
      path: '/clips/clip.mp4',
      media: [
        {
          id: 'media-1',
          type: 'original',
          url: '/media/clip.mp4',
          mimeType: 'video/mp4',
          size: 4096,
        },
      ],
      meta: {
        updatedAt: '2024-01-02T03:04:05.000Z',
      },
    };

    const entry = toRemoteFsEntry(remoteFile);

    expect(isRemoteFsEntry(entry)).toBe(true);
    expect(entry).toMatchObject({
      name: 'clip.mp4',
      kind: 'file',
      path: '/clips/clip.mp4',
      source: 'remote',
      remoteId: 'file-1',
      remotePath: '/clips/clip.mp4',
      remoteType: 'file',
      size: 4096,
      mimeType: 'video/mp4',
    });
    expect(entry.created).toBe(Date.parse('2024-01-02T03:04:05.000Z'));
  });

  it('builds absolute download url from relative media url', () => {
    const remoteFile: RemoteVfsFileEntry = {
      id: 'file-1',
      name: 'clip.mp4',
      type: 'file',
      path: '/clips/clip.mp4',
      media: [
        {
          id: 'media-1',
          type: 'original',
          url: '/uploads/clip.mp4',
        },
      ],
    };

    expect(
      getRemoteFileDownloadUrl({
        baseUrl: 'https://fastcat.example.com/api/v1/external/vfs',
        entry: remoteFile,
      }),
    ).toBe('https://fastcat.example.com/uploads/clip.mp4');
  });

  it('returns original absolute media url unchanged', () => {
    const remoteFile: RemoteVfsFileEntry = {
      id: 'file-1',
      name: 'clip.mp4',
      type: 'file',
      path: '/clips/clip.mp4',
      media: [
        {
          id: 'media-1',
          type: 'original',
          url: 'https://cdn.example.com/uploads/clip.mp4',
        },
      ],
    };

    expect(
      getRemoteFileDownloadUrl({
        baseUrl: 'https://fastcat.example.com/api/v1/external/vfs',
        entry: remoteFile,
      }),
    ).toBe('https://cdn.example.com/uploads/clip.mp4');
  });

  it('prefers content item title and can create synthetic remote entry for a selected media', () => {
    const remoteItem: RemoteVfsFileEntry = {
      id: 'content-1',
      name: 'internal-name',
      title: 'News Package',
      type: 'file',
      path: '/virtual-all/content-1',
      text: 'Lead text',
      media: [
        {
          id: 'media-1',
          name: 'shot-a.mp4',
          type: 'original',
          url: '/media/shot-a.mp4',
          mimeType: 'video/mp4',
          size: 2048,
        },
        {
          id: 'media-2',
          title: 'Narration',
          type: 'original',
          url: '/media/narration.mp3',
          mimeType: 'audio/mpeg',
          size: 1024,
        },
      ],
    };

    const itemEntry = toRemoteFsEntry(remoteItem);
    const mediaEntry = createRemoteMediaFsEntry({
      item: remoteItem,
      media: remoteItem.media![1]!,
      mediaIndex: 1,
    });

    expect(itemEntry).toMatchObject({ name: 'News Package' });
    expect(isRemoteFsEntry(mediaEntry)).toBe(true);
    expect(mediaEntry).toMatchObject({
      name: 'Narration',
      source: 'remote',
      mimeType: 'audio/mpeg',
      size: 1024,
    });
    expect((mediaEntry.remoteData as RemoteVfsFileEntry).media).toHaveLength(1);
    expect((mediaEntry.remoteData as RemoteVfsFileEntry).media?.[0]?.id).toBe('media-2');
  });
});
