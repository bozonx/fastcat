import { defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { useFileBrowserDragAndDrop } from '~/composables/file-manager/useFileBrowserDragAndDrop';
import type { FsEntry } from '~/types/fs';

const uiStoreMock = {
  isFileManagerDragging: false,
};

const selectionStoreMock = {
  selectedEntity: null as any,
};

const appClipboardMock = {
  dragSourceFileManagerInstanceId: null as string | null,
  dragTargetFileManagerInstanceId: null as string | null,
  dragSourceVfs: null as any,
  currentDragOperation: null as 'copy' | 'move' | 'cancel' | null,
  setDragSourceFileManagerInstanceId: vi.fn((value: string | null) => {
    appClipboardMock.dragSourceFileManagerInstanceId = value;
  }),
  setDragTargetFileManagerInstanceId: vi.fn((value: string | null) => {
    appClipboardMock.dragTargetFileManagerInstanceId = value;
  }),
  setDragSourceVfs: vi.fn((value: any) => {
    appClipboardMock.dragSourceVfs = value;
  }),
  setCurrentDragOperation: vi.fn((value: 'copy' | 'move' | 'cancel' | null) => {
    appClipboardMock.currentDragOperation = value;
  }),
  setDraggedItems: vi.fn(),
  clearDraggedItems: vi.fn(),
};

const setDraggedFileMock = vi.fn();
const clearDraggedFileMock = vi.fn();

vi.mock('~/stores/ui.store', () => ({
  useUiStore: () => uiStoreMock,
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => ({
    userSettings: {
      hotkeys: {
        layer1: 'Shift',
      },
      timeline: {
        defaultStaticClipDurationUs: 5_000_000,
      },
    },
    workspaceState: {
      fileBrowser: {
        instances: {},
      },
    },
  }),
}));

vi.mock('~/stores/file-manager.store', () => ({
  useFileManagerStore: () => ({
    selectedFolder: null,
  }),
}));

vi.mock('~/stores/selection.store', () => ({
  useSelectionStore: () => selectionStoreMock,
}));

vi.mock('~/composables/useAppClipboard', () => ({
  useAppClipboard: () => appClipboardMock,
}));

vi.mock('~/composables/useDraggedFile', () => ({
  INTERNAL_DRAG_TYPE: 'application/fastcat-internal-file',
  FILE_MANAGER_ITEMS_DRAG_TYPE: 'application/fastcat-file-manager-items',
  FILE_MANAGER_COPY_DRAG_TYPE: 'application/fastcat-file-manager-copy',
  FILE_MANAGER_MOVE_DRAG_TYPE: 'application/fastcat-file-manager-move',
  useDraggedFile: () => ({
    setDraggedFile: setDraggedFileMock,
    clearDraggedFile: clearDraggedFileMock,
  }),
}));

vi.mock('~/composables/file-manager/useFileDrop', () => ({
  useFileDrop: () => ({
    isRootDropOver: { value: false },
    isRelevantDrag: vi.fn(() => true),
    onRootDragEnter: vi.fn(),
    onRootDragOver: vi.fn(),
    onRootDragLeave: vi.fn(),
    onRootDrop: vi.fn(),
  }),
}));

vi.mock('~/file-manager/core/vfs/crossVfs', () => ({
  crossVfsCopy: vi.fn(),
  crossVfsMove: vi.fn(),
}));

const armPointerDndMock = vi.fn();
vi.mock('~/composables/dnd/usePointerDnd', () => ({
  armPointerDnd: (...args: unknown[]) => armPointerDndMock(...args),
}));

vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }));
vi.stubGlobal('useToast', () => ({ add: vi.fn() }));

describe('useFileBrowserDragAndDrop', () => {
  beforeEach(() => {
    uiStoreMock.isFileManagerDragging = false;
    selectionStoreMock.selectedEntity = null;
    appClipboardMock.dragSourceFileManagerInstanceId = null;
    appClipboardMock.dragTargetFileManagerInstanceId = null;
    appClipboardMock.dragSourceVfs = null;
    appClipboardMock.currentDragOperation = null;
    appClipboardMock.setDragSourceFileManagerInstanceId.mockClear();
    appClipboardMock.setDragTargetFileManagerInstanceId.mockClear();
    appClipboardMock.setDragSourceVfs.mockClear();
    appClipboardMock.setCurrentDragOperation.mockClear();
    setDraggedFileMock.mockClear();
    clearDraggedFileMock.mockClear();
    armPointerDndMock.mockClear();
  });

  it('starts folder drag with active file-manager drag state and source target instance', () => {
    let api: ReturnType<typeof useFileBrowserDragAndDrop> | null = null;

    mount(
      defineComponent({
        setup() {
          api = useFileBrowserDragAndDrop({
            findEntryByPath: () => null,
            resolveEntryByPath: async () => null,
            handleFiles: async () => {},
            moveEntry: async () => {},
            copyEntry: async () => {},
            loadFolderContent: async () => {},
            notifyFileManagerUpdate: () => {},
            fileManagerInstanceId: 'main',
            vfs: {} as any,
          });

          return () => null;
        },
      }),
    );

    const entry: FsEntry = {
      name: '_video',
      kind: 'directory',
      path: '_video',
    };

    api!.startEntryDrag(
      {
        shiftKey: false,
        button: 0,
        pointerType: 'mouse',
        pointerId: 1,
        clientX: 0,
        clientY: 0,
        currentTarget: { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() },
      } as unknown as PointerEvent,
      entry,
    );

    // REGRESSION GUARD: drag state must be set SYNCHRONOUSLY in startEntryDrag
    // (on pointerdown), not deferred to the engine's onStart/commit callback —
    // armPointerDnd is mocked here so onStart never runs, yet the state is already
    // set. Tauri's native-drag takeover can fire before commit and relies on this.
    expect(uiStoreMock.isFileManagerDragging).toBe(true);
    expect(appClipboardMock.setDragSourceFileManagerInstanceId).toHaveBeenCalledWith('main');
    expect(appClipboardMock.setDragTargetFileManagerInstanceId).toHaveBeenCalledWith('main');
    expect(appClipboardMock.setCurrentDragOperation).toHaveBeenCalledWith('move');
    // Payload is now carried in-memory (no dataTransfer for internal drags).
    expect(appClipboardMock.setDraggedItems).toHaveBeenCalledWith([
      { name: '_video', kind: 'directory', path: '_video' },
    ]);
    // The pointer engine is armed with a file-manager payload + preview.
    expect(armPointerDndMock).toHaveBeenCalledTimes(1);
    const [, armOptions] = armPointerDndMock.mock.calls[0] as [PointerEvent, { payload: any }];
    expect(armOptions.payload.source).toBe('file-manager');
    expect(armOptions.payload.data.items).toEqual([
      { name: '_video', kind: 'directory', path: '_video' },
    ]);
    // Directories don't feed the timeline-drop payload.
    expect(setDraggedFileMock).not.toHaveBeenCalled();
  });
});
