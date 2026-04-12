import { ref, computed, onMounted, onUnmounted, inject } from 'vue';
import { useUiStore } from '~/stores/ui.store';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { DEFAULT_HOTKEYS } from '~/utils/hotkeys/defaultHotkeys';
import { getEffectiveHotkeyBindings } from '~/utils/hotkeys/effectiveHotkeys';
import {
  createDefaultHotkeyLookup,
  createHotkeyLookup,
  isCommandMatched,
} from '~/utils/hotkeys/runtime';
import { useFileDrop } from '~/composables/file-manager/useFileDrop';
import {
  FILE_MANAGER_COPY_DRAG_TYPE,
  useDraggedFile,
  FILE_MANAGER_MOVE_DRAG_TYPE,
  INTERNAL_DRAG_TYPE,
} from '~/composables/useDraggedFile';
import type { FsEntry } from '~/types/fs';
import type { DraggedFileData } from '~/composables/useDraggedFile';
import { useAppClipboard } from '~/composables/useAppClipboard';
import { isLayer1Active } from '~/utils/hotkeys/layerUtils';
import {
  getDropTargetEntryPath,
  isFileManagerDropCancellationTarget,
  isCancellationZone,
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

interface UseFileBrowserDragAndDropOptions {
  findEntryByPath: (path: string) => FsEntry | null;
  resolveEntryByPath: (path: string) => Promise<FsEntry | null>;
  handleFiles: (
    files: File[] | FileList,
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
  loadFolderContent: () => Promise<void>;
  notifyFileManagerUpdate: () => void;
  fileManagerInstanceId?: string | null;
  isExternal?: boolean;
  vfs: IFileSystemAdapter;
}

export function useFileBrowserDragAndDrop(options: UseFileBrowserDragAndDropOptions) {
  const uiStore = useUiStore();
  const workspaceStore = useWorkspaceStore();
  const fileManagerStore =
    (inject('fileManagerStore', null) as ReturnType<typeof useFileManagerStore> | null) ||
    useFileManagerStore();

  const { t } = useI18n();
  const toast = useToast();

  const commandOrder = DEFAULT_HOTKEYS.commands.map((c) => c.id);
  const effectiveHotkeys = computed(() =>
    getEffectiveHotkeyBindings(workspaceStore.userSettings.hotkeys),
  );
  const hotkeyLookup = computed(() => createHotkeyLookup(effectiveHotkeys.value, commandOrder));
  const defaultHotkeyLookup = computed(() => createDefaultHotkeyLookup(commandOrder));

  function onGlobalKeyDown(e: KeyboardEvent) {
    if (!uiStore.isFileManagerDragging) return;

    const isCancel = isCommandMatched({
      event: e,
      cmdId: 'general.deselect',
      userSettings: workspaceStore.userSettings,
      hotkeyLookup: hotkeyLookup.value,
      defaultHotkeyLookup: defaultHotkeyLookup.value,
    });

    if (isCancel) {
      uiStore.isFileManagerDragging = false;
      resetFileManagerDragCursor();
      onEntryDragEnd();
      return;
    }

    syncDragOperationFromKeyboard(e);
  }

  function onGlobalKeyUp(e: KeyboardEvent) {
    if (!uiStore.isFileManagerDragging) return;
    syncDragOperationFromKeyboard(e);
  }

  onMounted(() => {
    window.addEventListener('keydown', onGlobalKeyDown, { capture: true });
    window.addEventListener('keyup', onGlobalKeyUp, { capture: true });
  });

  onUnmounted(() => {
    window.removeEventListener('keydown', onGlobalKeyDown, { capture: true });
    window.removeEventListener('keyup', onGlobalKeyUp, { capture: true });
  });
  const { setDraggedFile, clearDraggedFile } = useDraggedFile();
  const appClipboard = useAppClipboard();

  const isDragOverPanel = ref(false);
  const dragOverEntryPath = ref<string | null>(null);

  // Local drag counter per entry path to prevent flickering during dragover/dragleave
  const entryDragCounters = new Map<string, number>();
  // Local drag counter for the panel itself
  let panelDragEnterCount = 0;

  const {
    isRootDropOver,
    isRelevantDrag,
    onRootDragEnter,
    onRootDragOver: onRootDragOverBase,
    onRootDragLeave,
    onRootDrop: onRootDropBase,
  } = useFileDrop({
    resolveEntryByPath: options.resolveEntryByPath,
    handleFiles: options.handleFiles,
    moveEntry: options.moveEntry,
    copyEntry: options.copyEntry,
    targetFileManagerInstanceId: options.fileManagerInstanceId ?? null,
    vfs: options.vfs,
  });

  function isCopyModifierActive(event: DragEvent): boolean {
    return isLayer1Active(event, workspaceStore.userSettings);
  }

  function resolveDragOperation(event: DragEvent): 'copy' | 'move' {
    return resolveFileManagerDragOperation({
      dragSourceFileManagerInstanceId: appClipboard.dragSourceFileManagerInstanceId,
      isLayer1Active: isCopyModifierActive(event),
      targetFileManagerInstanceId: options.fileManagerInstanceId ?? null,
    });
  }

  function resolveDropOperation(
    event: DragEvent,
    fallbackRawOperation: 'copy' | 'move' | null,
  ): 'copy' | 'move' {
    return resolveFileManagerDropOperation({
      dragSourceFileManagerInstanceId: appClipboard.dragSourceFileManagerInstanceId,
      isLayer1Active: isCopyModifierActive(event),
      targetFileManagerInstanceId: options.fileManagerInstanceId ?? null,
      currentDragOperation: appClipboard.currentDragOperation,
      fallbackRawOperation,
    });
  }

  function resolveDragStartOperation(event: DragEvent): 'copy' | 'move' {
    return isCopyModifierActive(event) ? 'copy' : 'move';
  }

  function syncDragOperationFromKeyboard(event: KeyboardEvent) {
    if (appClipboard.currentDragOperation === 'cancel') return;

    const targetInstanceId = appClipboard.dragTargetFileManagerInstanceId;
    if (!targetInstanceId) return;

    const operation = resolveFileManagerDragOperation({
      dragSourceFileManagerInstanceId: appClipboard.dragSourceFileManagerInstanceId,
      isLayer1Active: isLayer1Active(event, workspaceStore.userSettings),
      targetFileManagerInstanceId: targetInstanceId,
    });

    appClipboard.setCurrentDragOperation(operation);
    syncFileManagerDragCursor({ isDragging: true, operation });
  }

  function onEntryDragStart(e: DragEvent, entry: FsEntry) {
    if (!entry.path) return;
    if (!e.dataTransfer) return;

    const selectionStore = useSelectionStore();
    const selected = selectionStore.selectedEntity;

    let entriesToMove: FsEntry[] = [entry];

    // If dragging an already selected item, move the whole selection
    if (selected?.source === 'fileManager') {
      if (selected.kind === 'multiple') {
        const isSelected = selected.entries.some((s) => s.path === entry.path);
        if (isSelected) {
          entriesToMove = selected.entries;
        }
      }
    }

    e.dataTransfer.effectAllowed = 'copyMove';

    const operation = resolveDragStartOperation(e);
    appClipboard.setDragSourceFileManagerInstanceId(options.fileManagerInstanceId ?? null);
    appClipboard.setDragSourceVfs(options.vfs);
    appClipboard.setDragTargetFileManagerInstanceId(options.fileManagerInstanceId ?? null);
    appClipboard.setCurrentDragOperation(operation);
    uiStore.isFileManagerDragging = true;
    syncFileManagerDragCursor({ isDragging: true, operation });

    const movePayload = entriesToMove.map((e) => ({ name: e.name, kind: e.kind, path: e.path }));
    e.dataTransfer.setData(
      operation === 'copy' ? FILE_MANAGER_COPY_DRAG_TYPE : FILE_MANAGER_MOVE_DRAG_TYPE,
      JSON.stringify(movePayload),
    );
    appClipboard.setDraggedItems(movePayload);
    // Mark as internal so the global overlay is not shown
    e.dataTransfer?.setData(INTERNAL_DRAG_TYPE, '1');

    if (entry.kind !== 'file') return;

    // Set preview for the primary dragged item
    const isTimeline = entry.name.toLowerCase().endsWith('.otio');
    const kind: DraggedFileData['kind'] = isTimeline ? 'timeline' : 'file';
    const data: DraggedFileData = {
      name: entry.name,
      kind,
      path: entry.path,
      operation,
      count: entriesToMove.length > 1 ? entriesToMove.length : undefined,
      items: movePayload,
      isExternal: options.isExternal,
    };
    setDraggedFile(data);
    e.dataTransfer?.setData('application/json', JSON.stringify(data));
  }

  function onEntryDragEnd() {
    entryDragCounters.clear();
    panelDragEnterCount = 0;
    isDragOverPanel.value = false;
    clearDraggedFile();
    uiStore.isFileManagerDragging = false;
    appClipboard.setCurrentDragOperation(null);
    appClipboard.setDragSourceFileManagerInstanceId(null);
    appClipboard.setDragTargetFileManagerInstanceId(null);
    appClipboard.setDragSourceVfs(null);
    appClipboard.clearDraggedItems();
    dragOverEntryPath.value = null;
    resetFileManagerDragCursor();
  }

  function cancelCurrentDrag() {
    onEntryDragEnd();
  }

  function isDropTargetDir(entry: FsEntry): boolean {
    return entry.kind === 'directory';
  }

  function onEntryDragEnter(e: DragEvent, entry: FsEntry) {
    if (!e.dataTransfer?.types) return;

    const types = e.dataTransfer.types;
    if (
      !types.includes(FILE_MANAGER_MOVE_DRAG_TYPE) &&
      !types.includes(FILE_MANAGER_COPY_DRAG_TYPE) &&
      !types.includes('Files')
    ) {
      return;
    }

    e.preventDefault();
    const path = entry.path ?? '';
    const count = (entryDragCounters.get(path) || 0) + 1;
    entryDragCounters.set(path, count);
    dragOverEntryPath.value = path;

    if (
      isCancellationZone({ items: appClipboard.draggedItems, targetEntryPath: path, targetDirPath: path })
    ) {
      appClipboard.setCurrentDragOperation('cancel');
      appClipboard.setDragTargetFileManagerInstanceId(options.fileManagerInstanceId ?? null);
      e.dataTransfer!.dropEffect = 'none';
      syncFileManagerDragCursor({ isDragging: true, operation: 'cancel' });
    }

    if (!isDropTargetDir(entry)) {
      if (!isCancellationZone({ items: appClipboard.draggedItems, targetEntryPath: path })) {
        entryDragCounters.delete(path);
        dragOverEntryPath.value = null;
      }
      return;
    }
  }

  function onEntryDragOver(e: DragEvent, entry: FsEntry) {
    const types = e.dataTransfer?.types;
    if (!types) return;
    if (
      !types.includes(FILE_MANAGER_MOVE_DRAG_TYPE) &&
      !types.includes(FILE_MANAGER_COPY_DRAG_TYPE) &&
      !types.includes('Files')
    ) {
      return;
    }
    const targetPath = entry.path ?? null;
    if (
      isCancellationZone({
        items: appClipboard.draggedItems,
        targetEntryPath: targetPath,
        targetDirPath: targetPath,
      })
    ) {
      dragOverEntryPath.value = targetPath;
      appClipboard.setCurrentDragOperation('cancel');
      appClipboard.setDragTargetFileManagerInstanceId(options.fileManagerInstanceId ?? null);
      e.dataTransfer!.dropEffect = 'none';
      syncFileManagerDragCursor({ isDragging: true, operation: 'cancel' });
      return;
    }

    if (!isDropTargetDir(entry)) return;

    if (
      types.includes(FILE_MANAGER_MOVE_DRAG_TYPE) ||
      types.includes(FILE_MANAGER_COPY_DRAG_TYPE)
    ) {
      const nextOperation = resolveDragOperation(e);
      appClipboard.setCurrentDragOperation(nextOperation);
      appClipboard.setDragTargetFileManagerInstanceId(options.fileManagerInstanceId ?? null);
      syncFileManagerDragCursor({ isDragging: true, operation: nextOperation });
    }
    dragOverEntryPath.value = entry.path ?? null;
    const operation = types.includes('Files') ? 'copy' : resolveDragOperation(e);
    e.dataTransfer!.dropEffect = operation === 'copy' ? 'copy' : 'move';
    syncFileManagerDragCursor({ isDragging: true, operation });
  }

  function onEntryDragLeave(e: DragEvent, entry: FsEntry) {
    const path = entry.path ?? '';
    if (dragOverEntryPath.value !== path) return;

    const count = (entryDragCounters.get(path) || 0) - 1;
    if (count <= 0) {
      entryDragCounters.delete(path);
      if (dragOverEntryPath.value === path) {
        dragOverEntryPath.value = null;
      }
    } else {
      entryDragCounters.set(path, count);
    }
  }

  async function onEntryDrop(e: DragEvent, entry: FsEntry) {
    e.stopPropagation();

    if (
      isFileManagerDropCancellationTarget({
        event: e,
        targetEntryPath: entry.path,
        targetDirPath: entry.path,
      })
    ) {
      cancelCurrentDrag();
      return;
    }

    if (!isDropTargetDir(entry)) return;

    const path = entry.path ?? '';
    entryDragCounters.delete(path);
    dragOverEntryPath.value = null;
    appClipboard.setDragTargetFileManagerInstanceId(null);
    resetFileManagerDragCursor();

    const droppedFiles = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
    const hasFiles = e.dataTransfer?.types.includes('Files') ?? false;
    const copyRaw = e.dataTransfer?.getData(FILE_MANAGER_COPY_DRAG_TYPE);
    const moveRaw = e.dataTransfer?.getData(FILE_MANAGER_MOVE_DRAG_TYPE);

    const targetPath = entry.path;

    const internalRaw = copyRaw || moveRaw;
    if (internalRaw) {
      const isCrossManagerDrag = isCrossFileManagerDrag({
        dragSourceFileManagerInstanceId: appClipboard.dragSourceFileManagerInstanceId,
        targetFileManagerInstanceId: options.fileManagerInstanceId ?? null,
      });
      const shouldCopy =
        resolveDropOperation(e, copyRaw ? 'copy' : moveRaw ? 'move' : null) === 'copy';
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(internalRaw);
      } catch (err) {
        console.warn(
          '[useFileBrowserDragAndDrop] Failed to parse internal drag data on entry:',
          err,
        );
        return;
      }

      const itemsToMove = Array.isArray(parsed) ? parsed : [parsed];
      if (shouldCancelFileManagerDrop({ items: itemsToMove, targetEntryPath: targetPath })) {
        return;
      }

      if (isCrossManagerDrag && appClipboard.dragSourceVfs) {
        try {
          for (const item of itemsToMove) {
            const sourcePath = typeof item?.path === 'string' ? item.path : '';
            if (!sourcePath || sourcePath === targetPath) continue;

            const sourceKind = item?.kind === 'directory' ? 'directory' : 'file';
            if (shouldCopy) {
              await crossVfsCopy({
                sourceVfs: appClipboard.dragSourceVfs,
                targetVfs: options.vfs,
                sourcePath,
                sourceKind,
                targetDirPath: targetPath,
              });
            } else {
              await crossVfsMove({
                sourceVfs: appClipboard.dragSourceVfs,
                targetVfs: options.vfs,
                sourcePath,
                sourceKind,
                targetDirPath: targetPath,
              });
            }
          }
        } catch (err) {
          console.error('[useFileBrowserDragAndDrop] Cross-VFS operation failed:', err);
          toast.add({
            color: 'error',
            title: t('videoEditor.fileManager.errors.crossVfsFailedTitle'),
            description: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        try {
          for (const item of itemsToMove) {
            const sourcePath = typeof item?.path === 'string' ? item.path : '';
            if (!sourcePath || sourcePath === targetPath) continue;

            const source = await options.resolveEntryByPath(sourcePath);
            if (!source) continue;

            if (shouldCopy) {
              await options.copyEntry({
                source,
                targetDirPath: targetPath,
              });
            } else {
              await options.moveEntry({
                source,
                targetDirPath: targetPath,
              });
            }
          }
        } catch (err) {
          console.error('[useFileBrowserDragAndDrop] D&D operation failed:', err);
          toast.add({
            color: 'error',
            title: t('videoEditor.fileManager.errors.dragDropFailedTitle'),
            description: err instanceof Error ? err.message : String(err),
          });
        }
      }

      options.notifyFileManagerUpdate();
      await options.loadFolderContent();
      return;
    }

    if (!hasFiles || droppedFiles.length === 0) return;

    await options.handleFiles(droppedFiles, { targetDirPath: targetPath });
    options.notifyFileManagerUpdate();
    await options.loadFolderContent();
  }

  function onPanelDragEnter(e: DragEvent) {
    const types = e.dataTransfer?.types;
    if (!types) return;
    if (
      types.includes('Files') ||
      types.includes(FILE_MANAGER_MOVE_DRAG_TYPE) ||
      types.includes(FILE_MANAGER_COPY_DRAG_TYPE)
    ) {
      e.preventDefault();
      panelDragEnterCount++;
      isDragOverPanel.value = true;
    }
  }

  function onPanelDragOver(e: DragEvent) {
    const types = e.dataTransfer?.types;
    if (!types) return;
    if (
      types.includes('Files') ||
      types.includes(FILE_MANAGER_MOVE_DRAG_TYPE) ||
      types.includes(FILE_MANAGER_COPY_DRAG_TYPE)
    ) {
      isDragOverPanel.value = true;
      const targetPath = fileManagerStore.selectedFolder?.path ?? '';
      if (
        isCancellationZone({
          items: appClipboard.draggedItems,
          targetDirPath: targetPath,
        })
      ) {
        appClipboard.setCurrentDragOperation('cancel');
        appClipboard.setDragTargetFileManagerInstanceId(options.fileManagerInstanceId ?? null);
        e.dataTransfer!.dropEffect = 'none';
        syncFileManagerDragCursor({ isDragging: true, operation: 'cancel' });
        return;
      }
      if (
        types.includes(FILE_MANAGER_MOVE_DRAG_TYPE) ||
        types.includes(FILE_MANAGER_COPY_DRAG_TYPE)
      ) {
        appClipboard.setCurrentDragOperation(resolveDragOperation(e));
        appClipboard.setDragTargetFileManagerInstanceId(options.fileManagerInstanceId ?? null);
      }
      const operation = types.includes('Files') ? 'copy' : resolveDragOperation(e);
      e.dataTransfer!.dropEffect = operation === 'copy' ? 'copy' : 'move';
      syncFileManagerDragCursor({ isDragging: true, operation });
    }
  }

  function onPanelDragLeave(e: DragEvent) {
    const types = e.dataTransfer?.types;
    if (!types) return;
    if (
      types.includes('Files') ||
      types.includes(FILE_MANAGER_MOVE_DRAG_TYPE) ||
      types.includes(FILE_MANAGER_COPY_DRAG_TYPE)
    ) {
      panelDragEnterCount--;
      if (panelDragEnterCount <= 0) {
        panelDragEnterCount = 0;
        isDragOverPanel.value = false;
      }
    }
  }

  async function onPanelDrop(e: DragEvent) {
    e.stopPropagation();
    panelDragEnterCount = 0;
    isDragOverPanel.value = false;
    appClipboard.setDragTargetFileManagerInstanceId(null);
    resetFileManagerDragCursor();

    const targetFolder = fileManagerStore.selectedFolder;
    const targetPath = targetFolder?.path ?? '';

    if (
      isFileManagerDropCancellationTarget({
        event: e,
        targetDirPath: targetPath,
      })
    ) {
      cancelCurrentDrag();
      return;
    }

    const copyRaw = e.dataTransfer?.getData(FILE_MANAGER_COPY_DRAG_TYPE);
    const moveRaw = e.dataTransfer?.getData(FILE_MANAGER_MOVE_DRAG_TYPE);
    const internalRaw = copyRaw || moveRaw;
    if (internalRaw) {
      const isCrossManagerDrag = isCrossFileManagerDrag({
        dragSourceFileManagerInstanceId: appClipboard.dragSourceFileManagerInstanceId,
        targetFileManagerInstanceId: options.fileManagerInstanceId ?? null,
      });
      const shouldCopy =
        resolveDropOperation(e, copyRaw ? 'copy' : moveRaw ? 'move' : null) === 'copy';
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(internalRaw);
      } catch (err) {
        console.warn(
          '[useFileBrowserDragAndDrop] Failed to parse internal drag data on panel:',
          err,
        );
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

      if (isCrossManagerDrag && appClipboard.dragSourceVfs) {
        try {
          for (const item of itemsToMove) {
            const sourcePath = typeof item?.path === 'string' ? item.path : '';
            if (!sourcePath) continue;

            const sourceKind = item?.kind === 'directory' ? 'directory' : 'file';
            if (shouldCopy) {
              await crossVfsCopy({
                sourceVfs: appClipboard.dragSourceVfs,
                targetVfs: options.vfs,
                sourcePath,
                sourceKind,
                targetDirPath: targetPath,
              });
            } else {
              await crossVfsMove({
                sourceVfs: appClipboard.dragSourceVfs,
                targetVfs: options.vfs,
                sourcePath,
                sourceKind,
                targetDirPath: targetPath,
              });
            }
          }
        } catch (err) {
          console.error('[useFileBrowserDragAndDrop] Cross-VFS panel operation failed:', err);
          toast.add({
            color: 'error',
            title: t('videoEditor.fileManager.errors.crossVfsFailedTitle'),
            description: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        try {
          for (const item of itemsToMove) {
            const sourcePath = typeof item?.path === 'string' ? item.path : '';
            if (!sourcePath) continue;

            const source = await options.resolveEntryByPath(sourcePath);
            if (!source) continue;

            if (shouldCopy) {
              await options.copyEntry({
                source,
                targetDirPath: targetFolder?.path ?? '',
              });
            } else {
              await options.moveEntry({
                source,
                targetDirPath: targetFolder?.path ?? '',
              });
            }
          }
        } catch (err) {
          console.error('[useFileBrowserDragAndDrop] D&D panel operation failed:', err);
          toast.add({
            color: 'error',
            title: t('videoEditor.fileManager.errors.dragDropFailedTitle'),
            description: err instanceof Error ? err.message : String(err),
          });
        }
      }

      options.notifyFileManagerUpdate();
      await options.loadFolderContent();
      return;
    }

    const droppedFiles = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
    if (droppedFiles.length === 0) return;

    await options.handleFiles(droppedFiles, { targetDirPath: targetPath });
    options.notifyFileManagerUpdate();
    await options.loadFolderContent();
  }

  function onRootDragOver(e: DragEvent) {
    const currentPath = fileManagerStore.selectedFolder?.path ?? '';
    if (
      isCancellationZone({
        items: appClipboard.draggedItems,
        targetDirPath: currentPath,
      })
    ) {
      appClipboard.setCurrentDragOperation('cancel');
      appClipboard.setDragTargetFileManagerInstanceId(options.fileManagerInstanceId ?? null);
      e.dataTransfer!.dropEffect = 'none';
      syncFileManagerDragCursor({ isDragging: true, operation: 'cancel' });
      return;
    }

    onRootDragOverBase(e);
  }

  function onRootDrop(e: DragEvent) {
    appClipboard.setDragTargetFileManagerInstanceId(null);
    resetFileManagerDragCursor();
    const currentPath = fileManagerStore.selectedFolder?.path;
    if (
      isFileManagerDropCancellationTarget({
        event: e,
        targetDirPath: currentPath,
      })
    ) {
      cancelCurrentDrag();
      return;
    }
    return onRootDropBase(e, currentPath);
  }

  return {
    isDragOverPanel,
    dragOverEntryPath,
    currentDragOperation: computed(() => appClipboard.currentDragOperation),
    isRootDropOver,
    isRelevantDrag,
    onEntryDragStart,
    onEntryDragEnd,
    onEntryDragEnter,
    onEntryDragOver,
    onEntryDragLeave,
    onEntryDrop,
    onRootDragEnter,
    onRootDragOver,
    onRootDragLeave,
    onRootDrop,
    onPanelDragEnter,
    onPanelDragOver,
    onPanelDragLeave,
    onPanelDrop,
  };
}
