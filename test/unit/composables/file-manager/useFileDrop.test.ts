/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useFileDrop } from '~/composables/file-manager/useFileDrop';
import type { FsEntry } from '~/types/fs';

const workspaceStoreMock = {
  userSettings: {
    hotkeys: {
      layer1: 'Shift',
    },
  },
};

let dragSourceFileManagerInstanceIdMock: string | null = null;
const setCurrentDragOperationMock = vi.fn();

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => workspaceStoreMock,
}));

vi.mock('~/composables/useAppClipboard', () => ({
  useAppClipboard: () => ({
    dragSourceFileManagerInstanceId: dragSourceFileManagerInstanceIdMock,
    setCurrentDragOperation: setCurrentDragOperationMock,
  }),
}));

describe('useFileDrop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dragSourceFileManagerInstanceIdMock = null;
  });

  it('moves to root on internal drop within the same file manager by default', async () => {
    const source: FsEntry = {
      name: 'clip.mp4',
      kind: 'file',
      path: '_video/clip.mp4',
    };
    dragSourceFileManagerInstanceIdMock = 'main';
    const resolveEntryByPath = vi.fn(async () => source);
    const handleFiles = vi.fn();
    const moveEntry = vi.fn();
    const copyEntry = vi.fn();

    const { onRootDrop } = useFileDrop({
      resolveEntryByPath,
      handleFiles,
      moveEntry,
      copyEntry,
      targetFileManagerInstanceId: 'main',
    });

    const event = {
      stopPropagation: vi.fn(),
      shiftKey: false,
      dataTransfer: {
        files: [],
        types: ['application/fastcat-file-manager-move'],
        getData: vi.fn((type: string) => {
          if (type === 'application/fastcat-file-manager-move') {
            return JSON.stringify([{ path: '_video/clip.mp4' }]);
          }
          return '';
        }),
      },
    } as unknown as DragEvent;

    await onRootDrop(event);

    expect(moveEntry).toHaveBeenCalledWith({
      source,
      targetDirPath: '',
    });
    expect(copyEntry).not.toHaveBeenCalled();
    expect(handleFiles).not.toHaveBeenCalled();
  });
});
