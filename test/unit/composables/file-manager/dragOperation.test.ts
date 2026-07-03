/** @vitest-environment node */
import { describe, expect, it } from 'vitest';

import {
  hasInternalFileManagerDragType,
  getDraggedFileManagerItems,
  isFileManagerDropCancellationTarget,
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

  it('detects cancellation target when dragging back onto the source entry', () => {
    expect(
      isFileManagerDropCancellationTarget({
        event: {
          dataTransfer: {
            getData: (type: string) =>
              type === 'application/fastcat-file-manager-move'
                ? JSON.stringify([{ path: '_video/clip.mp4', kind: 'file' }])
                : '',
          },
        } as unknown as DragEvent,
        targetEntryPath: '_video/clip.mp4',
      }),
    ).toBe(true);

    expect(
      isFileManagerDropCancellationTarget({
        event: {
          dataTransfer: {
            getData: (type: string) =>
              type === 'application/fastcat-file-manager-move'
                ? JSON.stringify([{ path: '_video/clip.mp4', kind: 'file' }])
                : '',
          },
        } as unknown as DragEvent,
        targetEntryPath: '_video',
      }),
    ).toBe(false);
  });

  it('detects cancellation target when dragging back into the same directory', () => {
    expect(
      isFileManagerDropCancellationTarget({
        event: {
          dataTransfer: {
            getData: (type: string) =>
              type === 'application/fastcat-file-manager-move'
                ? JSON.stringify([{ path: '_video/clip.mp4', kind: 'file' }])
                : '',
          },
        } as unknown as DragEvent,
        targetDirPath: '_video',
      }),
    ).toBe(true);

    expect(
      isFileManagerDropCancellationTarget({
        event: {
          dataTransfer: {
            getData: (type: string) =>
              type === 'application/fastcat-file-manager-move'
                ? JSON.stringify([{ path: '_video/clip.mp4', kind: 'file' }])
                : '',
          },
        } as unknown as DragEvent,
        targetDirPath: '_audio',
      }),
    ).toBe(false);
  });

  it('detects internal file-manager drag types even when Files is present', () => {
    expect(
      hasInternalFileManagerDragType(['Files', 'application/fastcat-file-manager-items']),
    ).toBe(true);

    expect(hasInternalFileManagerDragType(['Files'])).toBe(false);
  });

  it('reads neutral file-manager item payload before legacy operation payloads', () => {
    expect(
      getDraggedFileManagerItems({
        dataTransfer: {
          getData: (type: string) =>
            type === 'application/fastcat-file-manager-items'
              ? JSON.stringify([{ path: '_video/clip.mp4', kind: 'file', name: 'clip.mp4' }])
              : '',
        },
      } as unknown as DragEvent),
    ).toEqual([{ path: '_video/clip.mp4', kind: 'file', name: 'clip.mp4' }]);
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
