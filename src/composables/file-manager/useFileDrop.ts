import { ref, onMounted, onUnmounted, getCurrentInstance } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useUiStore } from '~/stores/ui.store';
import { isLayer1Active } from '~/utils/hotkeys/layerUtils';
import type { FsEntry } from '~/types/fs';
import { useAppClipboard } from '~/composables/useAppClipboard';
import {
  FILE_MANAGER_COPY_DRAG_TYPE,
  FILE_MANAGER_MOVE_DRAG_TYPE,
} from '~/composables/useDraggedFile';
import {
  getDropTargetEntryPath,
  isCrossFileManagerDrag,
  resolveFileManagerDragOperation,
  resolveFileManagerDropOperation,
  shouldCancelFileManagerDrop,
} from '~/composables/file-manager/dragOperation';
import {
  resetFileManagerDragCursor,
  syncFileManagerDragCursor,
} from '~/composables/file-manager/dragCursor';
import { crossVfsCopy, crossVfsMove } from '~/file-manager/core/vfs/crossVfs';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';

export interface UseFileDropOptions {
  resolveEntryByPath: (path: string) => Promise<FsEntry | null>;
  handleFiles: (
    files: FileList | File[],
    options?: {
      targetDirPath?: string;
      abortSignal?: AbortSignal;
      onProgress?: (params: {
        currentFileIndex: number;
        totalFiles: number;
        fileName: string;
      }) => void;
    },
  ) => Promise<void>;
  moveEntry: (params: { source: FsEntry; targetDirPath: string }) => Promise<void>;
  copyEntry: (params: { source: FsEntry; targetDirPath: string }) => Promise<unknown>;
  targetFileManagerInstanceId?: string | null;
  vfs: IFileSystemAdapter;
}

export function useFileDrop(options: UseFileDropOptions) {
  const workspaceStore = useWorkspaceStore();
  const uiStore = useUiStore();
  const {
    dragSourceFileManagerInstanceId,
    dragSourceVfs,
    currentDragOperation,
    setCurrentDragOperation,
  } = useAppClipboard();
  const appClipboard = useAppClipboard();
  const isRootDropOver = ref(false);
  let rootDragEnterCount = 0;

  function isCopyModifierActive(e: DragEvent): boolean {
    return isLayer1Active(e, workspaceStore.userSettings);
  }

  function resolveOperation(e: DragEvent): 'copy' | 'move' {
    return resolveFileManagerDragOperation({
      dragSourceFileManagerInstanceId,
      isLayer1Active: isCopyModifierActive(e),
      targetFileManagerInstanceId: options.targetFileManagerInstanceId ?? null,
    });
  }

  function resolveDropOperation(
    e: DragEvent,
    fallbackRawOperation: 'copy' | 'move' | null,
  ): 'copy' | 'move' {
    return resolveFileManagerDropOperation({
      dragSourceFileManagerInstanceId,
      isLayer1Active: isCopyModifierActive(e),
      targetFileManagerInstanceId: options.targetFileManagerInstanceId ?? null,
      currentDragOperation,
      fallbackRawOperation,
    });
  }

  function isRelevantDrag(e: DragEvent): boolean {
    const types = e.dataTransfer?.types;
    if (!types) return false;
    return (
      types.includes(FILE_MANAGER_MOVE_DRAG_TYPE) ||
      types.includes(FILE_MANAGER_COPY_DRAG_TYPE) ||
      types.includes('Files')
    );
  }

  function syncDragOperationFromKeyboard(event: KeyboardEvent) {
    if (!uiStore.isFileManagerDragging) return;
    if (appClipboard.currentDragOperation === 'cancel') return;

    const targetInstanceId = appClipboard.dragTargetFileManagerInstanceId;
    if (!targetInstanceId) return;

    const operation = resolveFileManagerDragOperation({
      dragSourceFileManagerInstanceId: appClipboard.dragSourceFileManagerInstanceId,
      isLayer1Active: isLayer1Active(event, workspaceStore.userSettings),
      targetFileManagerInstanceId: targetInstanceId,
    });

    setCurrentDragOperation(operation);
    syncFileManagerDragCursor({ isDragging: true, operation });
  }

  if (getCurrentInstance()) {
    onMounted(() => {
      window.addEventListener('keydown', syncDragOperationFromKeyboard, { capture: true });
      window.addEventListener('keyup', syncDragOperationFromKeyboard, { capture: true });
    });

    onUnmounted(() => {
      window.removeEventListener('keydown', syncDragOperationFromKeyboard, { capture: true });
      window.removeEventListener('keyup', syncDragOperationFromKeyboard, { capture: true });
    });
  }

  function onRootDragEnter(e: DragEvent) {
    if (!isRelevantDrag(e)) return;
    e.preventDefault();
    rootDragEnterCount++;
    isRootDropOver.value = true;
  }

  function onRootDragOver(e: DragEvent) {
    if (!isRelevantDrag(e)) return;

    e.stopPropagation();
    if (e.dataTransfer?.types.includes('Files')) {
      setCurrentDragOperation('copy');
      appClipboard.setDragTargetFileManagerInstanceId(options.targetFileManagerInstanceId ?? null);
      e.dataTransfer!.dropEffect = 'copy';
      syncFileManagerDragCursor({ isDragging: true, operation: 'copy' });
      return;
    }

    const operation = resolveOperation(e);
    setCurrentDragOperation(operation);
    appClipboard.setDragTargetFileManagerInstanceId(options.targetFileManagerInstanceId ?? null);
    e.dataTransfer!.dropEffect = operation === 'copy' ? 'copy' : 'move';
    syncFileManagerDragCursor({ isDragging: true, operation });
  }

  function onRootDragLeave(e: DragEvent) {
    if (!isRelevantDrag(e)) return;
    rootDragEnterCount--;
    if (rootDragEnterCount <= 0) {
      rootDragEnterCount = 0;
      isRootDropOver.value = false;
      setCurrentDragOperation(null);
      appClipboard.setDragTargetFileManagerInstanceId(null);
      resetFileManagerDragCursor();
    }
  }

  async function onRootDrop(e: DragEvent, targetDirPath?: string) {
    e.stopPropagation();
    rootDragEnterCount = 0;
    isRootDropOver.value = false;
    setCurrentDragOperation(null);
    appClipboard.setDragTargetFileManagerInstanceId(null);
    resetFileManagerDragCursor();

    const droppedFiles = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
    const hasFiles = e.dataTransfer?.types.includes('Files') ?? false;
    const copyRaw = e.dataTransfer?.getData(FILE_MANAGER_COPY_DRAG_TYPE);
    const moveRaw = e.dataTransfer?.getData(FILE_MANAGER_MOVE_DRAG_TYPE);

    if (hasFiles && droppedFiles.length > 0) {
      await options.handleFiles(droppedFiles, { targetDirPath });
      return;
    }

    const internalRaw = copyRaw || moveRaw;
    if (!internalRaw) return;

    const isCrossManagerDrag = isCrossFileManagerDrag({
      dragSourceFileManagerInstanceId,
      targetFileManagerInstanceId: options.targetFileManagerInstanceId ?? null,
    });
    const shouldCopy =
      resolveDropOperation(e, copyRaw ? 'copy' : moveRaw ? 'move' : null) === 'copy';

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(internalRaw);
    } catch (err) {
      console.warn('[useFileDrop] Failed to parse internal drag data:', err);
      return;
    }

    const itemsToMove = Array.isArray(parsed) ? parsed : [parsed];
    if (
      shouldCancelFileManagerDrop({
        items: itemsToMove,
        targetEntryPath: getDropTargetEntryPath(e),
      })
    ) {
      return;
    }

    if (isCrossManagerDrag && dragSourceVfs) {
      try {
        for (const item of itemsToMove) {
          const sourcePath = typeof item?.path === 'string' ? item.path : '';
          if (!sourcePath) continue;

          const sourceKind = item?.kind === 'directory' ? 'directory' : 'file';
          if (shouldCopy) {
            await crossVfsCopy({
              sourceVfs: dragSourceVfs,
              targetVfs: options.vfs,
              sourcePath,
              sourceKind,
              targetDirPath: targetDirPath ?? '',
            });
          } else {
            await crossVfsMove({
              sourceVfs: dragSourceVfs,
              targetVfs: options.vfs,
              sourcePath,
              sourceKind,
              targetDirPath: targetDirPath ?? '',
            });
          }
        }
        uiStore.notifyFileManagerUpdate();
      } catch (err) {
        console.error('[useFileDrop] Cross-VFS operation failed:', err);
      }
    } else {
      for (const item of itemsToMove) {
        const sourcePath = typeof item?.path === 'string' ? item.path : '';
        if (!sourcePath) continue;

        const source = await options.resolveEntryByPath(sourcePath);
        if (!source) continue;

        if (shouldCopy) {
          await options.copyEntry({
            source,
            targetDirPath: targetDirPath ?? '',
          });
        } else {
          await options.moveEntry({
            source,
            targetDirPath: targetDirPath ?? '',
          });
        }
      }
    }
  }

  return {
    isRootDropOver,
    isRelevantDrag,
    onRootDragEnter,
    onRootDragOver,
    onRootDragLeave,
    onRootDrop,
  };
}
