/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { isGeneratingProxyInDirectory, folderHasVideos } from '~/utils/fs-entry-utils';

describe('isGeneratingProxyInDirectory', () => {
  it('returns false for non-directory entries', () => {
    expect(isGeneratingProxyInDirectory({ kind: 'file', name: 'a.mp4', path: '/a.mp4' }, [])).toBe(
      false,
    );
  });

  it('returns true when proxy is in root directory', () => {
    expect(
      isGeneratingProxyInDirectory({ kind: 'directory', name: 'root', path: '' }, ['file.mp4']),
    ).toBe(true);
    expect(
      isGeneratingProxyInDirectory({ kind: 'directory', name: 'root', path: '' }, ['sub/file.mp4']),
    ).toBe(false);
  });

  it('returns true when proxy is direct child', () => {
    expect(
      isGeneratingProxyInDirectory({ kind: 'directory', name: 'media', path: '/media' }, [
        '/media/file.mp4',
      ]),
    ).toBe(true);
    expect(
      isGeneratingProxyInDirectory({ kind: 'directory', name: 'media', path: '/media' }, [
        '/media/sub/file.mp4',
      ]),
    ).toBe(false);
  });

  it('returns false when no proxies match', () => {
    expect(
      isGeneratingProxyInDirectory({ kind: 'directory', name: 'media', path: '/media' }, [
        '/other/file.mp4',
      ]),
    ).toBe(false);
  });
});

describe('folderHasVideos', () => {
  it('returns false for non-directory entries', () => {
    expect(folderHasVideos({ kind: 'file', name: 'a.mp4', path: '/a.mp4' })).toBe(false);
  });

  it('returns true when a direct child is a video', () => {
    expect(
      folderHasVideos({
        kind: 'directory',
        name: 'media',
        path: '/media',
        children: [
          { kind: 'file', name: 'clip.mp4', path: '/media/clip.mp4' },
          { kind: 'file', name: 'photo.jpg', path: '/media/photo.jpg' },
        ],
      }),
    ).toBe(true);
  });

  it('returns false when no video children', () => {
    expect(
      folderHasVideos({
        kind: 'directory',
        name: 'media',
        path: '/media',
        children: [
          { kind: 'file', name: 'photo.jpg', path: '/media/photo.jpg' },
          { kind: 'file', name: 'track.mp3', path: '/media/track.mp3' },
        ],
      }),
    ).toBe(false);
  });

  it('returns false for empty directory', () => {
    expect(
      folderHasVideos({ kind: 'directory', name: 'empty', path: '/empty', children: [] }),
    ).toBe(false);
  });
});
