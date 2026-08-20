/** @vitest-environment node */
import { describe, expect, it } from 'vitest';

import {
  isCrossFileManagerDrag,
  isCancellationZone,
  resolveFileManagerDragOperation,
} from '~/composables/file-manager/dragOperation';

describe('dragOperation', () => {
  it('detects cross-manager drag only when both instance ids exist and differ', () => {
    expect(
      isCrossFileManagerDrag({
        dragSourceFileManagerInstanceId: 'sidebar',
        targetFileManagerInstanceId: 'main',
      }),
    ).toBe(true);

    expect(
      isCrossFileManagerDrag({
        dragSourceFileManagerInstanceId: 'main',
        targetFileManagerInstanceId: 'main',
      }),
    ).toBe(false);

    expect(
      isCrossFileManagerDrag({
        dragSourceFileManagerInstanceId: null,
        targetFileManagerInstanceId: 'main',
      }),
    ).toBe(false);
  });

  it('uses move by default and copy with layer1 within the same manager', () => {
    expect(
      resolveFileManagerDragOperation({
        dragSourceFileManagerInstanceId: 'main',
        targetFileManagerInstanceId: 'main',
        isLayer1Active: false,
      }),
    ).toBe('move');

    expect(
      resolveFileManagerDragOperation({
        dragSourceFileManagerInstanceId: 'main',
        targetFileManagerInstanceId: 'main',
        isLayer1Active: true,
      }),
    ).toBe('copy');
  });

  it('uses move by default across different managers backed by the same file system', () => {
    expect(
      resolveFileManagerDragOperation({
        dragSourceFileManagerInstanceId: 'sidebar',
        targetFileManagerInstanceId: 'main',
        isSameFileSystem: true,
        isLayer1Active: false,
      }),
    ).toBe('move');

    expect(
      resolveFileManagerDragOperation({
        dragSourceFileManagerInstanceId: 'sidebar',
        targetFileManagerInstanceId: 'main',
        isSameFileSystem: true,
        isLayer1Active: true,
      }),
    ).toBe('copy');
  });

  it('uses copy by default and move with layer1 across different file systems', () => {
    expect(
      resolveFileManagerDragOperation({
        dragSourceFileManagerInstanceId: 'sidebar',
        targetFileManagerInstanceId: 'main',
        isSameFileSystem: false,
        isLayer1Active: false,
      }),
    ).toBe('copy');

    expect(
      resolveFileManagerDragOperation({
        dragSourceFileManagerInstanceId: 'sidebar',
        targetFileManagerInstanceId: 'main',
        isSameFileSystem: false,
        isLayer1Active: true,
      }),
    ).toBe('move');
  });

  describe('isCancellationZone', () => {
    it('cancels when dragging a file into its own parent directory', () => {
      expect(
        isCancellationZone({
          items: [{ path: '_video/clip.mp4', kind: 'file' }],
          targetEntryPath: null,
          targetDirPath: '_video',
        }),
      ).toBe(true);
    });

    it('cancels when dragging a file onto itself', () => {
      expect(
        isCancellationZone({
          items: [{ path: '_video/clip.mp4', kind: 'file' }],
          targetEntryPath: '_video/clip.mp4',
          targetDirPath: '_video',
        }),
      ).toBe(true);
    });

    it('does NOT cancel when dragging a file onto a subfolder of the current directory', () => {
      expect(
        isCancellationZone({
          items: [{ path: '_video/clip.mp4', kind: 'file' }],
          targetEntryPath: '_video/subfolder',
          targetDirPath: '_video/subfolder',
        }),
      ).toBe(false);
    });

    it('does NOT cancel when dragging a file onto a different directory', () => {
      expect(
        isCancellationZone({
          items: [{ path: '_video/clip.mp4', kind: 'file' }],
          targetEntryPath: '_audio',
          targetDirPath: '_audio',
        }),
      ).toBe(false);
    });

    it('does NOT cancel when items list is empty', () => {
      expect(
        isCancellationZone({
          items: [],
          targetEntryPath: '_video',
          targetDirPath: '_video',
        }),
      ).toBe(false);
    });
  });
});
