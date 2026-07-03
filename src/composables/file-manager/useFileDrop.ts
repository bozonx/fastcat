import { createDevLogger } from '~/utils/dev-logger';
import { ref } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useUiStore } from '~/stores/ui.store';
import { isLayer1Active } from '~/utils/hotkeys/layerUtils';
import type { FsEntry } from '~/types/fs';
import { useAppClipboard } from '~/composables/useAppClipboard';
import type { FileManagerClipboardItem } from '~/stores/clipboard.store';
import {
  FILE_MANAGER_COPY_DRAG_TYPE,
  FILE_MANAGER_ITEMS_DRAG_TYPE,
  FILE_MANAGER_MOVE_DRAG_TYPE,
} from '~/composables/useDraggedFile';
import {
  getDropTargetEntryPath,
  hasInternalFileManagerDragType,
  isCrossFileManagerDrag,
  isFileManagerDropCancellationTarget,
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
import {
  canPasteIntoBloggerDogEntry,
  canTransferClipboardItemToOrFromBloggerDog,
} from '~/utils/bloggerdog-file-manager';
const log = createDevLogger('useFileDrop');

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
  ) => Promise<unknown>;
  moveEntry: (
    params: { source: FsEntry; targetDirPath: string },
    options?: { skipReload?: boolean; skipNotify?: boolean; skipIntegrityCheck?: boolean },
  ) => Promise<unknown>;
  copyEntry: (
    params: { source: FsEntry; targetDirPath: string },
    options?: { skipReload?: boolean; skipNotify?: boolean; skipIntegrityCheck?: boolean },
  ) => Promise<unknown>;
  reloadDirectory?: (path: string) => Promise<void>;
  notifyFileManagerUpdate?: () => void;
  targetFileManagerInstanceId?: string | null;
  vfs: IFileSystemAdapter;
}

export function useFileDrop(options: UseFileDropOptions) {
  const workspaceStore = useWorkspaceStore();
  const uiStore = useUiStore();
  const appClipboard = useAppClipboard();
  const isRootDropOver = ref(false);
  let rootDragEnterCount = 0;

  function isCopyModifierActive(e: DragEvent): boolean {
    return isLayer1Active(e, workspaceStore.userSettings);
  }

  function isSameFileSystemDrag(): boolean | null {
    return appClipboard.dragSourceVfs && options.vfs
      ? appClipboard.dragSourceVfs === options.vfs
      : null;
  }

  function resolveOperation(e: DragEvent): 'copy' | 'move' {
    return resolveFileManagerDragOperation({
      dragSourceFileManagerInstanceId: appClipboard.dragSourceFileManagerInstanceId,
      isLayer1Active: isCopyModifierActive(e),
      isSameFileSystem: isSameFileSystemDrag(),
      targetFileManagerInstanceId: options.targetFileManagerInstanceId ?? null,
    });
  }

  function isRelevantDrag(e: DragEvent): boolean {
    const types = e.dataTransfer?.types;
    if (!types) return false;
    const dragTypes = Array.from(types);
    return (
      dragTypes.includes(FILE_MANAGER_MOVE_DRAG_TYPE) ||
      dragTypes.includes(FILE_MANAGER_ITEMS_DRAG_TYPE) ||
      dragTypes.includes(FILE_MANAGER_COPY_DRAG_TYPE) ||
      dragTypes.includes('Files')
    );
  }

  async function isBloggerDogTransferAllowed(params: {
    items: Array<{ kind?: unknown; name?: unknown }>;
    targetDirPath?: string;
  }): Promise<boolean> {
    const involvesBloggerDog =
      options.vfs?.id === 'bloggerdog' || appClipboard.dragSourceVfs?.id === 'bloggerdog';
    if (!involvesBloggerDog) return true;

    if (options.vfs?.id === 'bloggerdog' && params.targetDirPath) {
      const targetEntry = params.targetDirPath
        ? await options.resolveEntryByPath(params.targetDirPath)
        : null;
      if (!canPasteIntoBloggerDogEntry(targetEntry)) {
        return false;
      }
    }

    return params.items.every((item) =>
      canTransferClipboardItemToOrFromBloggerDog(
        item as Pick<FileManagerClipboardItem, 'kind' | 'name'>,
        {
          sourceIsBloggerDog: appClipboard.dragSourceVfs?.id === 'bloggerdog',
          targetIsBloggerDog: options.vfs?.id === 'bloggerdog',
        },
      ),
    );
  }

  // NOTE: internal file-manager drags now run on the pointer-DnD engine, which
  // re-evaluates the copy/move modifier itself and drives the engine ghost.
  // The old window keydown/keyup → `syncFileManagerDragCursor` handler used to
  // fire for ANY active drag (gated only by `isFileManagerDragging`), so during
  // a pointer drag it would light up the legacy `dragCursor` overlay and never
  // reset it (the pointer path never calls `resetFileManagerDragCursor`) —
  // leaving a stuck "+" cursor + frozen badge. It has been removed; the legacy
  // overlay is only used by the OS-`Files` HTML5 root handlers below.

  function onRootDragEnter(e: DragEvent) {
    if (!isRelevantDrag(e)) return;
    e.preventDefault();
    rootDragEnterCount++;
    isRootDropOver.value = true;
  }

  async function onRootDragOver(e: DragEvent) {
    if (!isRelevantDrag(e)) return;

    e.preventDefault();
    e.stopPropagation();
    if (
      !hasInternalFileManagerDragType(e.dataTransfer?.types) &&
      Array.from(e.dataTransfer?.types ?? []).includes('Files')
    ) {
      appClipboard.setCurrentDragOperation('copy');
      appClipboard.setDragTargetFileManagerInstanceId(options.targetFileManagerInstanceId ?? null);
      e.dataTransfer!.dropEffect = 'copy';
      syncFileManagerDragCursor({ isDragging: true, operation: 'copy' });
      return;
    }

    if (isFileManagerDropCancellationTarget({ event: e, targetDirPath: undefined })) {
      appClipboard.setCurrentDragOperation('cancel');
      appClipboard.setDragTargetFileManagerInstanceId(options.targetFileManagerInstanceId ?? null);
      e.dataTransfer!.dropEffect = 'none';
      syncFileManagerDragCursor({ isDragging: true, operation: 'cancel' });
      return;
    }

    if (
      !(await isBloggerDogTransferAllowed({
        items: appClipboard.draggedItems,
      }))
    ) {
      appClipboard.setCurrentDragOperation('cancel');
      appClipboard.setDragTargetFileManagerInstanceId(options.targetFileManagerInstanceId ?? null);
      e.dataTransfer!.dropEffect = 'none';
      syncFileManagerDragCursor({ isDragging: true, operation: 'cancel' });
      return;
    }

    const operation = resolveOperation(e);
    appClipboard.setCurrentDragOperation(operation);
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
      appClipboard.setCurrentDragOperation(null);
      appClipboard.setDragTargetFileManagerInstanceId(null);
      resetFileManagerDragCursor();
    }
  }

  async function onRootDrop(e: DragEvent, targetDirPath?: string) {
    e.stopPropagation();
    const dragSourceFileManagerInstanceId = appClipboard.dragSourceFileManagerInstanceId;
    const dragSourceVfs = appClipboard.dragSourceVfs;
    const currentDragOperation = appClipboard.currentDragOperation;
    rootDragEnterCount = 0;
    isRootDropOver.value = false;
    appClipboard.setCurrentDragOperation(null);
    appClipboard.setDragTargetFileManagerInstanceId(null);
    resetFileManagerDragCursor();

    const droppedFiles = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
    const hasFiles = Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const itemsRaw = e.dataTransfer?.getData(FILE_MANAGER_ITEMS_DRAG_TYPE);
    const copyRaw = e.dataTransfer?.getData(FILE_MANAGER_COPY_DRAG_TYPE);
    const moveRaw = e.dataTransfer?.getData(FILE_MANAGER_MOVE_DRAG_TYPE);
    const hasInternalDrag = hasInternalFileManagerDragType(e.dataTransfer?.types);

    if (!hasInternalDrag && hasFiles && droppedFiles.length > 0) {
      await options.handleFiles(droppedFiles, { targetDirPath });
      return;
    }

    const internalRaw = itemsRaw || copyRaw || moveRaw;
    if (!internalRaw) return;

    const isCrossManagerDrag = isCrossFileManagerDrag({
      dragSourceFileManagerInstanceId,
      targetFileManagerInstanceId: options.targetFileManagerInstanceId ?? null,
    });
    const shouldCopy =
      resolveFileManagerDropOperation({
        dragSourceFileManagerInstanceId,
        isLayer1Active: isCopyModifierActive(e),
        isSameFileSystem: dragSourceVfs && options.vfs ? dragSourceVfs === options.vfs : null,
        targetFileManagerInstanceId: options.targetFileManagerInstanceId ?? null,
        currentDragOperation,
        fallbackRawOperation: copyRaw ? 'copy' : moveRaw ? 'move' : null,
      }) === 'copy';

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(internalRaw);
    } catch (err) {
      log.warn('Failed to parse internal drag data:', err);
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
    if (!(await isBloggerDogTransferAllowed({ items: itemsToMove, targetDirPath }))) {
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
        log.error('Cross-VFS operation failed:', err);
      }
    } else {
      const sourceParentPathsToReload = new Set<string>();
      for (const item of itemsToMove) {
        const sourcePath = typeof item?.path === 'string' ? item.path : '';
        if (!sourcePath) continue;

        const source = await options.resolveEntryByPath(sourcePath);
        if (!source) continue;
        if (!shouldCopy) {
          sourceParentPathsToReload.add(
            source.parentPath ?? sourcePath.split('/').slice(0, -1).join('/'),
          );
        }

        if (shouldCopy) {
          await options.copyEntry(
            {
              source,
              targetDirPath: targetDirPath ?? '',
            },
            {
              skipReload: true,
              skipNotify: true,
            },
          );
        } else {
          await options.moveEntry(
            {
              source,
              targetDirPath: targetDirPath ?? '',
            },
            {
              skipReload: true,
              skipNotify: true,
            },
          );
        }
      }

      const directoriesToReload = new Set<string>([targetDirPath ?? '']);
      for (const path of sourceParentPathsToReload) {
        directoriesToReload.add(path);
      }
      await Promise.all(
        [...directoriesToReload].map(async (path) => {
          await options.reloadDirectory?.(path);
        }),
      );
      options.notifyFileManagerUpdate?.();
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
