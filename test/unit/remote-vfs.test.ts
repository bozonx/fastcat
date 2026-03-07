// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { RemoteVfsFileEntry } from '../../src/types/remote-vfs';
import {
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
        baseUrl: 'https://gran.example.com/api/v1/external/vfs',
        entry: remoteFile,
      }),
    ).toBe('https://gran.example.com/uploads/clip.mp4');
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
        baseUrl: 'https://gran.example.com/api/v1/external/vfs',
        entry: remoteFile,
      }),
    ).toBe('https://cdn.example.com/uploads/clip.mp4');
  });
});
