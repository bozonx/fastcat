/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useFileDrop } from '~/composables/file-manager/useFileDrop';

const { syncFileManagerDragCursorMock, resetFileManagerDragCursorMock } = vi.hoisted(() => ({
  syncFileManagerDragCursorMock: vi.fn(),
  resetFileManagerDragCursorMock: vi.fn(),
}));

vi.mock('~/composables/file-manager/dragCursor', () => ({
  syncFileManagerDragCursor: syncFileManagerDragCursorMock,
  resetFileManagerDragCursor: resetFileManagerDragCursorMock,
}));

describe('useFileDrop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createApi(handleFiles = vi.fn()) {
    return useFileDrop({
      resolveEntryByPath: vi.fn(),
      handleFiles,
      moveEntry: vi.fn(),
      copyEntry: vi.fn(),
      targetFileManagerInstanceId: 'main',
      vfs: { id: 'project' } as any,
    });
  }

  it('treats only OS Files drags as relevant', () => {
    const { isRelevantDrag } = createApi();

    expect(
      isRelevantDrag({
        dataTransfer: { types: ['Files'] },
      } as unknown as DragEvent),
    ).toBe(true);

    expect(
      isRelevantDrag({
        dataTransfer: { types: ['application/fastcat-file-manager-move'] },
      } as unknown as DragEvent),
    ).toBe(false);
  });

  it('sets copy feedback on OS file dragover', () => {
    const { onRootDragOver } = createApi();
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        types: ['Files'],
        dropEffect: 'none',
      },
    } as unknown as DragEvent;

    onRootDragOver(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(event.dataTransfer!.dropEffect).toBe('copy');
    expect(syncFileManagerDragCursorMock).toHaveBeenCalledWith({
      isDragging: true,
      operation: 'copy',
    });
  });

  it('ignores internal pointer-DnD MIME types on dragover', () => {
    const { onRootDragOver } = createApi();
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        types: ['application/fastcat-file-manager-items'],
        dropEffect: 'none',
      },
    } as unknown as DragEvent;

    onRootDragOver(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(syncFileManagerDragCursorMock).not.toHaveBeenCalled();
  });

  it('imports OS files into the target directory on drop', async () => {
    const handleFiles = vi.fn().mockResolvedValue(undefined);
    const { onRootDrop } = createApi(handleFiles);
    const file = { name: 'clip.mp4' } as File;
    const event = {
      stopPropagation: vi.fn(),
      dataTransfer: {
        files: [file],
        types: ['Files'],
      },
    } as unknown as DragEvent;

    await onRootDrop(event, '_video');

    expect(event.stopPropagation).toHaveBeenCalled();
    expect(resetFileManagerDragCursorMock).toHaveBeenCalled();
    expect(handleFiles).toHaveBeenCalledWith([file], { targetDirPath: '_video' });
  });

  it('does not import internal payloads even when legacy MIME types are present', async () => {
    const handleFiles = vi.fn();
    const { onRootDrop } = createApi(handleFiles);

    await onRootDrop({
      stopPropagation: vi.fn(),
      dataTransfer: {
        files: [],
        types: ['application/fastcat-file-manager-move'],
        getData: vi.fn(() => JSON.stringify([{ path: '_video/clip.mp4' }])),
      },
    } as unknown as DragEvent);

    expect(handleFiles).not.toHaveBeenCalled();
    expect(resetFileManagerDragCursorMock).toHaveBeenCalled();
  });
});
