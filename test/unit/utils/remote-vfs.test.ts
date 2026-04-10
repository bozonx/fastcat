// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { RemoteVfsFileEntry } from '~/types/remote-vfs';
import {
  createRemoteMediaFsEntry,
  getRemoteFileDownloadUrl,
  isRemoteFsEntry,
  toRemoteFsEntry,
} from '~/utils/remote-vfs';

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
          mimeType: 'video/mp4',
          size: 4096,
        },
      ],
      updatedAt: '2024-01-02T03:04:05.000Z',
      createdAt: '2024-01-02T03:04:05.000Z',
    };

    const entry = toRemoteFsEntry(remoteFile);

    expect(isRemoteFsEntry(entry)).toBe(true);
    expect(entry).toMatchObject({
      name: 'clip.mp4',
      kind: 'directory',
      path: '/clips/clip.mp4',
      source: 'remote',
      remoteId: 'file-1',
      remotePath: '/clips/clip.mp4',
      remoteType: 'directory',
      size: 4096,
      mimeType: 'video/mp4',
      isContentItem: true,
    });
    expect(entry.created).toBe(Date.parse('2024-01-02T03:04:05.000Z'));
  });

  it('builds download url from media id when the api returns no direct url', () => {
    const remoteFile: RemoteVfsFileEntry = {
      id: 'file-1',
      name: 'clip.mp4',
      type: 'file',
      path: '/clips/clip.mp4',
      media: [
        {
          id: 'media-1',
          type: 'original',
        },
      ],
    };

    expect(
      getRemoteFileDownloadUrl({
        baseUrl: 'https://fastcat.example.com/api/v1/external/content-library',
        entry: remoteFile,
      }),
    ).toBe('https://fastcat.example.com/api/v1/external/content-library/media/media-1/file');
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
        baseUrl: 'https://fastcat.example.com/api/v1/external/content-library',
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
          mimeType: 'video/mp4',
          size: 2048,
        },
        {
          id: 'media-2',
          title: 'Narration',
          type: 'original',
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
    const payload = mediaEntry.adapterPayload;
    expect((payload.remoteData as RemoteVfsFileEntry).media).toHaveLength(1);
    expect((payload.remoteData as RemoteVfsFileEntry).media?.[0]?.id).toBe('media-2');
  });
});
