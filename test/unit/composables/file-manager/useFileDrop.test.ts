/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useFileDrop } from '~/composables/file-manager/useFileDrop';
import type { FsEntry } from '~/types/fs';

const { crossVfsCopyMock, crossVfsMoveMock } = vi.hoisted(() => ({
  crossVfsCopyMock: vi.fn(),
  crossVfsMoveMock: vi.fn(),
}));

const workspaceStoreMock = {
  userSettings: {
    hotkeys: {
      layer1: 'Shift',
    },
  },
  workspaceState: {
    fileBrowser: {
      instances: {},
    },
  },
};

const uiStoreMock = {
  isFileManagerDragging: false,
  notifyFileManagerUpdate: vi.fn(),
};

let dragSourceFileManagerInstanceIdMock: string | null = null;
let dragSourceVfsMock: any = null;
let currentDragOperationMock: 'copy' | 'move' | null = null;
const setCurrentDragOperationMock = vi.fn();
const setDragTargetFileManagerInstanceIdMock = vi.fn();

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => workspaceStoreMock,
}));

vi.mock('~/stores/ui.store', () => ({
  useUiStore: () => uiStoreMock,
}));

vi.mock('~/composables/useAppClipboard', () => ({
  useAppClipboard: () => ({
    get dragSourceFileManagerInstanceId() {
      return dragSourceFileManagerInstanceIdMock;
    },
    get dragSourceVfs() {
      return dragSourceVfsMock;
    },
    get currentDragOperation() {
      return currentDragOperationMock;
    },
    setCurrentDragOperation: setCurrentDragOperationMock,
    setDragTargetFileManagerInstanceId: setDragTargetFileManagerInstanceIdMock,
  }),
}));

vi.mock('~/file-manager/core/vfs/crossVfs', () => ({
  crossVfsCopy: crossVfsCopyMock,
  crossVfsMove: crossVfsMoveMock,
}));

describe('useFileDrop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dragSourceFileManagerInstanceIdMock = null;
    dragSourceVfsMock = null;
    currentDragOperationMock = null;
    setDragTargetFileManagerInstanceIdMock.mockReset();
    uiStoreMock.notifyFileManagerUpdate.mockReset();
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

    expect(moveEntry).toHaveBeenCalledWith(
      {
        source,
        targetDirPath: '',
      },
      {
        skipReload: true,
        skipNotify: true,
      },
    );
    expect(copyEntry).not.toHaveBeenCalled();
    expect(handleFiles).not.toHaveBeenCalled();
  });

  it('uses current modifier state on drop within the same file manager', async () => {
    const source: FsEntry = {
      name: 'clip.mp4',
      kind: 'file',
      path: '_video/clip.mp4',
    };
    dragSourceFileManagerInstanceIdMock = 'main';
    currentDragOperationMock = 'move';

    const moveEntry = vi.fn();
    const copyEntry = vi.fn();

    const { onRootDrop } = useFileDrop({
      resolveEntryByPath: vi.fn(async () => source),
      handleFiles: vi.fn(),
      moveEntry,
      copyEntry,
      targetFileManagerInstanceId: 'main',
      vfs: {} as any,
    });

    await onRootDrop(
      {
        stopPropagation: vi.fn(),
        shiftKey: false,
        dataTransfer: {
          files: [],
          types: ['application/fastcat-file-manager-copy'],
          getData: vi.fn((type: string) =>
            type === 'application/fastcat-file-manager-copy'
              ? JSON.stringify([{ path: '_video/clip.mp4' }])
              : '',
          ),
        },
      } as unknown as DragEvent,
      '_video/sub',
    );

    expect(moveEntry).toHaveBeenCalledWith(
      {
        source,
        targetDirPath: '_video/sub',
      },
      {
        skipReload: true,
        skipNotify: true,
      },
    );
    expect(copyEntry).not.toHaveBeenCalled();
  });

  it('keeps targetDirPath for cross-file-manager drops', async () => {
    dragSourceFileManagerInstanceIdMock = 'sidebar';
    dragSourceVfsMock = { id: 'source' };
    currentDragOperationMock = 'copy';

    const { onRootDrop } = useFileDrop({
      resolveEntryByPath: vi.fn(),
      handleFiles: vi.fn(),
      moveEntry: vi.fn(),
      copyEntry: vi.fn(),
      targetFileManagerInstanceId: 'main',
      vfs: { id: 'target' } as any,
    });

    await onRootDrop(
      {
        stopPropagation: vi.fn(),
        shiftKey: false,
        dataTransfer: {
          files: [],
          types: ['application/fastcat-file-manager-move'],
          getData: vi.fn((type: string) =>
            type === 'application/fastcat-file-manager-move'
              ? JSON.stringify([{ path: 'workspace/clip.mp4', kind: 'file' }])
              : '',
          ),
        },
      } as unknown as DragEvent,
      '_video/sub',
    );

    expect(crossVfsCopyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourcePath: 'workspace/clip.mp4',
        targetDirPath: '_video/sub',
      }),
    );
    expect(crossVfsMoveMock).not.toHaveBeenCalled();
  });

  it('reads the drag source at drop time for cross-file-manager root drops', async () => {
    const { onRootDrop } = useFileDrop({
      resolveEntryByPath: vi.fn(),
      handleFiles: vi.fn(),
      moveEntry: vi.fn(),
      copyEntry: vi.fn(),
      targetFileManagerInstanceId: 'main',
      vfs: { id: 'target' } as any,
    });

    dragSourceFileManagerInstanceIdMock = 'computer';
    dragSourceVfsMock = { id: 'computer-vfs' };
    currentDragOperationMock = 'copy';

    await onRootDrop(
      {
        stopPropagation: vi.fn(),
        shiftKey: false,
        dataTransfer: {
          files: [],
          types: ['application/fastcat-file-manager-copy'],
          getData: vi.fn((type: string) =>
            type === 'application/fastcat-file-manager-copy'
              ? JSON.stringify([{ path: 'workspace/clip.mp4', kind: 'file' }])
              : '',
          ),
        },
      } as unknown as DragEvent,
      '_video',
    );

    expect(crossVfsCopyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceVfs: { id: 'computer-vfs' },
        targetVfs: { id: 'target' },
        sourcePath: 'workspace/clip.mp4',
        targetDirPath: '_video',
      }),
    );
  });

  it('allows copying BloggerDog virtual txt file into project file manager', async () => {
    dragSourceFileManagerInstanceIdMock = 'sidebar';
    dragSourceVfsMock = { id: 'bloggerdog' };
    currentDragOperationMock = 'copy';

    const { onRootDrop } = useFileDrop({
      resolveEntryByPath: vi.fn(),
      handleFiles: vi.fn(),
      moveEntry: vi.fn(),
      copyEntry: vi.fn(),
      targetFileManagerInstanceId: 'main',
      vfs: { id: 'target' } as any,
    });

    await onRootDrop(
      {
        stopPropagation: vi.fn(),
        shiftKey: false,
        dataTransfer: {
          files: [],
          types: ['application/fastcat-file-manager-copy'],
          getData: vi.fn((type: string) =>
            type === 'application/fastcat-file-manager-copy'
              ? JSON.stringify([
                  { path: '/personal/item-1/Item.txt', kind: 'file', name: 'Item.txt' },
                ])
              : '',
          ),
        },
      } as unknown as DragEvent,
      'documents',
    );

    expect(crossVfsCopyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceVfs: { id: 'bloggerdog' },
        sourcePath: '/personal/item-1/Item.txt',
        targetDirPath: 'documents',
      }),
    );
  });

  it('cancels drop when item is returned onto its own container', async () => {
    const source: FsEntry = {
      name: 'clip.mp4',
      kind: 'file',
      path: '_video/clip.mp4',
    };
    dragSourceFileManagerInstanceIdMock = 'main';

    const moveEntry = vi.fn();
    const copyEntry = vi.fn();

    const { onRootDrop } = useFileDrop({
      resolveEntryByPath: vi.fn(async () => source),
      handleFiles: vi.fn(),
      moveEntry,
      copyEntry,
      targetFileManagerInstanceId: 'main',
      vfs: {} as any,
    });

    await onRootDrop(
      {
        stopPropagation: vi.fn(),
        shiftKey: true,
        dataTransfer: {
          files: [],
          types: ['application/fastcat-file-manager-copy'],
          getData: vi.fn((type: string) =>
            type === 'application/fastcat-file-manager-copy'
              ? JSON.stringify([{ path: '_video/clip.mp4' }])
              : '',
          ),
        },
        target: {
          closest: () => ({
            dataset: { entryPath: '_video/clip.mp4' },
          }),
        },
      } as unknown as DragEvent,
      '_video',
    );

    expect(moveEntry).not.toHaveBeenCalled();
    expect(copyEntry).not.toHaveBeenCalled();
  });

  it('prioritizes internal file-manager payload over native Files on drop', async () => {
    const source: FsEntry = {
      name: 'clip.mp4',
      kind: 'file',
      path: '_video/clip.mp4',
    };
    dragSourceFileManagerInstanceIdMock = 'main';

    const handleFiles = vi.fn();
    const moveEntry = vi.fn();

    const { onRootDrop } = useFileDrop({
      resolveEntryByPath: vi.fn(async () => source),
      handleFiles,
      moveEntry,
      copyEntry: vi.fn(),
      targetFileManagerInstanceId: 'main',
      vfs: {} as any,
    });

    await onRootDrop({
      stopPropagation: vi.fn(),
      shiftKey: false,
      dataTransfer: {
        files: [{ name: 'clip.mp4' }],
        types: ['Files', 'application/fastcat-file-manager-move'],
        getData: vi.fn((type: string) =>
          type === 'application/fastcat-file-manager-move'
            ? JSON.stringify([{ path: '_video/clip.mp4' }])
            : '',
        ),
      },
    } as unknown as DragEvent);

    expect(moveEntry).toHaveBeenCalledWith(
      {
        source,
        targetDirPath: '',
      },
      {
        skipReload: true,
        skipNotify: true,
      },
    );
    expect(handleFiles).not.toHaveBeenCalled();
  });

  it('calls preventDefault on root dragover for relevant internal drags', () => {
    const { onRootDragOver } = useFileDrop({
      resolveEntryByPath: vi.fn(),
      handleFiles: vi.fn(),
      moveEntry: vi.fn(),
      copyEntry: vi.fn(),
      targetFileManagerInstanceId: 'main',
      vfs: {} as any,
    });

    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        types: ['application/fastcat-file-manager-move'],
        getData: vi.fn(),
      },
    } as unknown as DragEvent;

    onRootDragOver(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
  });

  it('does not call preventDefault on root dragover for irrelevant drags', () => {
    const { onRootDragOver } = useFileDrop({
      resolveEntryByPath: vi.fn(),
      handleFiles: vi.fn(),
      moveEntry: vi.fn(),
      copyEntry: vi.fn(),
      targetFileManagerInstanceId: 'main',
      vfs: {} as any,
    });

    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        types: ['text/plain'],
      },
    } as unknown as DragEvent;

    onRootDragOver(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  it('handles DOMStringList-like types (ArrayLike without includes)', () => {
    const { onRootDragOver } = useFileDrop({
      resolveEntryByPath: vi.fn(),
      handleFiles: vi.fn(),
      moveEntry: vi.fn(),
      copyEntry: vi.fn(),
      targetFileManagerInstanceId: 'main',
      vfs: {} as any,
    });

    const domStringListLike = {
      length: 1,
      0: 'application/fastcat-file-manager-move',
      item: (i: number) => (i === 0 ? 'application/fastcat-file-manager-move' : null),
    };

    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        types: domStringListLike,
        getData: vi.fn(),
      },
    } as unknown as DragEvent;

    onRootDragOver(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
  });
});
