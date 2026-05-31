import { describe, expect, it } from 'vitest';
import {
  createFileMediaIoSource,
  createTauriNativeMediaIoSource,
} from '~/utils/video-editor/media-io-source';

describe('media-io-source', () => {
  it('creates a File-backed media source', () => {
    const file = new File(['abc'], 'clip.mp4', { lastModified: 123 });

    expect(createFileMediaIoSource({ sourceKey: '_video/clip.mp4', file })).toEqual({
      kind: 'file',
      sourceKey: '_video/clip.mp4',
      name: 'clip.mp4',
      size: 3,
      lastModified: 123,
      file,
    });
  });

  it('creates a Tauri-native media source without requiring a File object', () => {
    expect(
      createTauriNativeMediaIoSource({
        sourceKey: '_video/clip.mp4',
        nativePath: '/workspace/project/_video/clip.mp4',
        name: 'clip.mp4',
        size: 1024,
        lastModified: 456,
      }),
    ).toEqual({
      kind: 'tauri-native',
      sourceKey: '_video/clip.mp4',
      nativePath: '/workspace/project/_video/clip.mp4',
      name: 'clip.mp4',
      size: 1024,
      lastModified: 456,
    });
  });
});

