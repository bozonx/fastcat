import { createDevLogger } from '~/utils/dev-logger';
import { ref, computed, inject } from 'vue';
import { useUiStore } from '~/stores/ui.store';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useFileDrop } from '~/composables/file-manager/useFileDrop';
import { useDraggedFile } from '~/composables/useDraggedFile';
import type { FsEntry } from '~/types/fs';
import type { DraggedFileData } from '~/composables/useDraggedFile';
import { useAppClipboard } from '~/composables/useAppClipboard';
import type { FileManagerClipboardItem } from '~/stores/clipboard.store';
import { isLayer1Active } from '~/utils/hotkeys/layerUtils';
import {
  getDropTargetEntryPathFromEl,
  isCancellationZone,
  isCrossFileManagerDrag,
  resolveFileManagerDragOperation,
  resolveFileManagerDropOperation,
  shouldCancelFileManagerDrop,
} from '~/composables/file-manager/dragOperation';
import { armPointerDnd } from '~/composables/dnd/usePointerDnd';
import { useDndDropZone } from '~/composables/dnd/useDndDropZone';
import type { DndDragContext, DndPayload, DndPointer } from '~/composables/dnd/dndTypes';
import { crossVfsCopy, crossVfsMove } from '~/file-manager/core/vfs/crossVfs';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import {
  canPasteIntoBloggerDogEntry,
  canTransferClipboardItemToOrFromBloggerDog,
} from '~/utils/bloggerdog-file-manager';
const log = createDevLogger('useFileBrowserDragAndDrop');

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
  ) => Promise<unknown>;
  moveEntry: (params: { source: FsEntry; targetDirPath: string }) => Promise<unknown>;
  copyEntry: (params: { source: FsEntry; targetDirPath: string }) => Promise<unknown>;
  loadFolderContent: () => Promise<void>;
  notifyFileManagerUpdate: () => void;
  fileManagerInstanceId?: string | null;
  isExternal?: boolean;
  vfs: IFileSystemAdapter;
}

/** In-memory dragged item, carried via the pointer-DnD payload (no dataTransfer). */
interface DraggedItem {
  name: string;
  kind: string;
  path?: string;
}

export interface FileManagerDndPayloadData {
  items: DraggedItem[];
  sourceInstanceId: string | null;
  /** Full primary dragged entry — lets remote-aware drop targets (e.g. the tree's
   *  download-to-local) reconstruct the source without a dataTransfer channel. */
  primaryEntry?: FsEntry;
}

/** Resolved drop target derived from the hit element under the pointer. */
interface ResolvedDropTarget {
  targetEntry: FsEntry | null;
  /** The entry path directly under the pointer (file or dir), for self-drop cancellation. */
  hoveredEntryPath: string | null;
  /** Where items would actually land: a hovered directory, else the current folder. */
  targetDirPath: string;
}

export function useFileBrowserDragAndDrop(options: UseFileBrowserDragAndDropOptions) {
  const uiStore = useUiStore();
  const workspaceStore = useWorkspaceStore();
  const fileManagerStore =
    (inject('fileManagerStore', null) as ReturnType<typeof useFileManagerStore> | null) ||
    useFileManagerStore();

  const { t } = useI18n();
  const toast = useToast();

  const { setDraggedFile, clearDraggedFile } = useDraggedFile();
  const appClipboard = useAppClipboard();

  const isDragOverPanel = ref(false);
  const dragOverEntryPath = ref<string | null>(null);

  const {
    isRootDropOver,
    isRelevantDrag,
    onRootDragEnter,
    onRootDragOver,
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

  // --- modifier helpers (pointer snapshot replaces DragEvent) -----------------

  function isLayer1FromPointer(p: DndPointer): boolean {
    // isLayerActive only reads shift/ctrl/alt/meta booleans (plus a global
    // keycode set for the Left/Right variants), so a structural modifier object
    // is sufficient here.
    return isLayer1Active(
      {
        shiftKey: p.shiftKey,
        ctrlKey: p.ctrlKey,
        altKey: p.altKey,
        metaKey: p.metaKey,
      } as unknown as MouseEvent,
      workspaceStore.userSettings,
    );
  }

  function isSameFileSystemDrag(): boolean | null {
    return appClipboard.dragSourceVfs && options.vfs
      ? appClipboard.dragSourceVfs === options.vfs
      : null;
  }

  function isBloggerDogTransferAllowed(params: {
    items: Array<{ kind?: unknown; name?: unknown }>;
    targetEntry: FsEntry | null | undefined;
    sourceVfs: IFileSystemAdapter | null | undefined;
  }): boolean {
    const involvesBloggerDog =
      options.vfs?.id === 'bloggerdog' || params.sourceVfs?.id === 'bloggerdog';
    if (!involvesBloggerDog) return true;
    if (options.vfs?.id === 'bloggerdog' && !canPasteIntoBloggerDogEntry(params.targetEntry)) {
      return false;
    }

    return params.items.every((item) =>
      canTransferClipboardItemToOrFromBloggerDog(
        item as Pick<FileManagerClipboardItem, 'kind' | 'name'>,
        {
          sourceIsBloggerDog: params.sourceVfs?.id === 'bloggerdog',
          targetIsBloggerDog: options.vfs?.id === 'bloggerdog',
        },
      ),
    );
  }

  /** Bloggerdog forbids dragging files (only collections/items) within itself. */
  function isBloggerDogInternalFileDrag(items: DraggedItem[]): boolean {
    return (
      options.vfs.id === 'bloggerdog' &&
      appClipboard.dragSourceVfs?.id === 'bloggerdog' &&
      items.some((i) => i.kind === 'file')
    );
  }

  // --- source side ------------------------------------------------------------

  function startEntryDrag(e: PointerEvent, entry: FsEntry) {
    if (!entry.path) return;

    const selectionStore = useSelectionStore();
    const selected = selectionStore.selectedEntity;

    let entriesToMove: FsEntry[] = [entry];
    if (selected?.source === 'fileManager' && selected.kind === 'multiple') {
      const isSelected = selected.entries.some((s) => s.path === entry.path);
      if (isSelected) entriesToMove = selected.entries;
    }

    const operation: 'copy' | 'move' = isLayer1Active(e, workspaceStore.userSettings)
      ? 'copy'
      : 'move';

    const movePayload: DraggedItem[] = entriesToMove.map((it) => ({
      name: it.name,
      kind: it.kind,
      path: it.path,
    }));

    // IMPORTANT: set drag state eagerly here (on pointerdown), NOT in the engine's
    // onStart/commit callback. In the Tauri shell WebKitGTK can promote the press
    // to a native OS drag before our movement threshold, so `onStart` may never
    // fire; `isFileManagerDragging` / `draggedFile` must already be set by then so
    // Tauri's `onDragDropEvent` treats it as an internal drag and hides the OS drop
    // overlay. Cleared in `clearDragState` (the engine's onEnd, committed drags only).
    appClipboard.setDragSourceFileManagerInstanceId(options.fileManagerInstanceId ?? null);
    appClipboard.setDragSourceVfs(options.vfs);
    appClipboard.setDragTargetFileManagerInstanceId(options.fileManagerInstanceId ?? null);
    appClipboard.setCurrentDragOperation(operation);
    appClipboard.setDraggedItems(movePayload);
    uiStore.isFileManagerDragging = true;

    // Primary item drives the timeline-drop payload (`useDraggedFile`).
    if (entry.kind === 'file') {
      const isTimeline = entry.name.toLowerCase().endsWith('.otio');
      const data: DraggedFileData = {
        name: entry.name,
        kind: isTimeline ? 'timeline' : 'file',
        path: entry.path,
        operation,
        count: entriesToMove.length > 1 ? entriesToMove.length : undefined,
        items: movePayload,
        isExternal: options.isExternal,
      };
      setDraggedFile(data);
    }

    const payload: DndPayload<FileManagerDndPayloadData> = {
      source: 'file-manager',
      data: {
        items: movePayload,
        sourceInstanceId: options.fileManagerInstanceId ?? null,
        primaryEntry: entry,
      },
      preview: { label: entry.name, count: entriesToMove.length },
    };

    armPointerDnd(e, {
      payload,
      onEnd: () => clearDragState(),
    });
  }

  function clearDragState() {
    isDragOverPanel.value = false;
    dragOverEntryPath.value = null;
    uiStore.isFileManagerDragging = false;
    clearDraggedFile();
    appClipboard.setCurrentDragOperation(null);
    appClipboard.setDragSourceFileManagerInstanceId(null);
    appClipboard.setDragTargetFileManagerInstanceId(null);
    appClipboard.setDragSourceVfs(null);
    appClipboard.clearDraggedItems();
  }

  // --- drop zone (entry / folder / panel / root unified by hit-test) ----------

  function resolveDropTarget(targetEl: Element | null): ResolvedDropTarget {
    const hoveredEntryPath = getDropTargetEntryPathFromEl(targetEl);
    const hoveredEntry = hoveredEntryPath ? options.findEntryByPath(hoveredEntryPath) : null;
    const isDir = hoveredEntry?.kind === 'directory';
    const targetDirPath = isDir
      ? (hoveredEntry?.path ?? '')
      : (fileManagerStore.selectedFolder?.path ?? '');
    return {
      targetEntry: isDir ? hoveredEntry : (fileManagerStore.selectedFolder ?? null),
      hoveredEntryPath,
      targetDirPath,
    };
  }

  function handleInternalDragOver(ctx: DndDragContext) {
    const data = ctx.payload.data as FileManagerDndPayloadData;
    const items = data.items;
    const { targetEntry, hoveredEntryPath, targetDirPath } = resolveDropTarget(ctx.targetEl);

    isDragOverPanel.value = true;
    appClipboard.setDragTargetFileManagerInstanceId(options.fileManagerInstanceId ?? null);

    // Highlight a hovered directory; otherwise no specific entry is highlighted.
    dragOverEntryPath.value = targetEntry?.kind === 'directory' ? targetEntry.path : null;

    // Self-drop / already-in-folder → cancel.
    if (
      isCancellationZone({ items, targetEntryPath: hoveredEntryPath, targetDirPath }) ||
      !isBloggerDogTransferAllowed({ items, targetEntry, sourceVfs: appClipboard.dragSourceVfs }) ||
      isBloggerDogInternalFileDrag(items)
    ) {
      appClipboard.setCurrentDragOperation('cancel');
      ctx.setOperation('cancel');
      return;
    }

    const operation = resolveFileManagerDragOperation({
      dragSourceFileManagerInstanceId: appClipboard.dragSourceFileManagerInstanceId,
      isLayer1Active: isLayer1FromPointer(ctx.pointer),
      isSameFileSystem: isSameFileSystemDrag(),
      targetFileManagerInstanceId: options.fileManagerInstanceId ?? null,
    });
    appClipboard.setCurrentDragOperation(operation);
    ctx.setOperation(operation);
  }

  function handleInternalDragLeave() {
    isDragOverPanel.value = false;
    dragOverEntryPath.value = null;
    appClipboard.setDragTargetFileManagerInstanceId(null);
  }

  async function handleInternalDrop(ctx: DndDragContext) {
    const data = ctx.payload.data as FileManagerDndPayloadData;
    const itemsToMove = data.items;

    isDragOverPanel.value = false;
    dragOverEntryPath.value = null;

    const { targetEntry, hoveredEntryPath, targetDirPath } = resolveDropTarget(ctx.targetEl);

    if (itemsToMove.length === 0) return;
    if (shouldCancelFileManagerDrop({ items: itemsToMove, targetEntryPath: hoveredEntryPath })) {
      return;
    }
    if (
      isCancellationZone({ items: itemsToMove, targetEntryPath: hoveredEntryPath, targetDirPath })
    ) {
      return;
    }
    if (
      !isBloggerDogTransferAllowed({
        items: itemsToMove,
        targetEntry,
        sourceVfs: appClipboard.dragSourceVfs,
      })
    ) {
      return;
    }
    if (isBloggerDogInternalFileDrag(itemsToMove)) return;

    const isCrossManagerDrag = isCrossFileManagerDrag({
      dragSourceFileManagerInstanceId: appClipboard.dragSourceFileManagerInstanceId,
      targetFileManagerInstanceId: options.fileManagerInstanceId ?? null,
    });
    const shouldCopy =
      resolveFileManagerDropOperation({
        dragSourceFileManagerInstanceId: appClipboard.dragSourceFileManagerInstanceId,
        isLayer1Active: isLayer1FromPointer(ctx.pointer),
        isSameFileSystem: isSameFileSystemDrag(),
        targetFileManagerInstanceId: options.fileManagerInstanceId ?? null,
        currentDragOperation: appClipboard.currentDragOperation,
        fallbackRawOperation:
          appClipboard.currentDragOperation === 'copy'
            ? 'copy'
            : appClipboard.currentDragOperation === 'move'
              ? 'move'
              : null,
      }) === 'copy';

    let operationSucceeded = true;
    try {
      for (const item of itemsToMove) {
        const sourcePath = typeof item?.path === 'string' ? item.path : '';
        if (!sourcePath || sourcePath === targetDirPath) continue;

        if (isCrossManagerDrag && appClipboard.dragSourceVfs) {
          const sourceKind = item?.kind === 'directory' ? 'directory' : 'file';
          if (shouldCopy) {
            await crossVfsCopy({
              sourceVfs: appClipboard.dragSourceVfs,
              targetVfs: options.vfs,
              sourcePath,
              sourceKind,
              targetDirPath,
            });
          } else {
            await crossVfsMove({
              sourceVfs: appClipboard.dragSourceVfs,
              targetVfs: options.vfs,
              sourcePath,
              sourceKind,
              targetDirPath,
            });
          }
        } else {
          const source = await options.resolveEntryByPath(sourcePath);
          if (!source) continue;
          if (shouldCopy) {
            await options.copyEntry({ source, targetDirPath });
          } else {
            await options.moveEntry({ source, targetDirPath });
          }
        }
      }
    } catch (err) {
      operationSucceeded = false;
      log.error('D&D operation failed:', err);
      toast.add({
        color: 'error',
        title: t(
          isCrossManagerDrag
            ? 'videoEditor.fileManager.errors.crossVfsFailedTitle'
            : 'videoEditor.fileManager.errors.dragDropFailedTitle',
        ),
        description: err instanceof Error ? err.message : String(err),
      });
    }

    options.notifyFileManagerUpdate();
    await options.loadFolderContent();

    if (
      operationSucceeded &&
      targetDirPath &&
      targetDirPath !== fileManagerStore.selectedFolder?.path
    ) {
      const targetFolder =
        options.findEntryByPath(targetDirPath) ??
        ({
          kind: 'directory',
          name: targetDirPath.split('/').pop() || targetDirPath,
          path: targetDirPath,
        } as FsEntry);
      fileManagerStore.openFolder(targetFolder);
    }
  }

  // OS file drops (real `Files` from the OS) stay on the HTML5 root path.
  function onRootDrop(e: DragEvent) {
    const currentPath = fileManagerStore.selectedFolder?.path;
    return onRootDropBase(e, currentPath);
  }

  return {
    isDragOverPanel,
    dragOverEntryPath,
    currentDragOperation: computed(() => {
      const operation = appClipboard.currentDragOperation;
      return operation === 'copy' || operation === 'move' || operation === 'cancel'
        ? operation
        : null;
    }),
    isRootDropOver,
    isRelevantDrag,
    // pointer-DnD API
    startEntryDrag,
    clearDragState,
    handleInternalDragOver,
    handleInternalDragLeave,
    handleInternalDrop,
    // OS Files (HTML5)
    onRootDragEnter,
    onRootDragOver,
    onRootDragLeave,
    onRootDrop,
  };
}

/** Builds the drop-zone handlers + zone attrs for the file-manager panel. */
export function useFileBrowserDropZone(handlers: {
  canAccept: (payload: DndPayload) => boolean;
  onOver: (ctx: DndDragContext) => void;
  onLeave: (ctx: DndDragContext) => void;
  onDrop: (ctx: DndDragContext) => void | Promise<void>;
}) {
  return useDndDropZone(
    {
      canAccept: handlers.canAccept,
      onEnter: handlers.onOver,
      onOver: handlers.onOver,
      onLeave: handlers.onLeave,
      onDrop: handlers.onDrop,
    },
    'file-manager',
  );
}
