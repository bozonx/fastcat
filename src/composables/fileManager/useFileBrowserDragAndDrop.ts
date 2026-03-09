import { ref } from 'vue';
import { useUiStore } from '~/stores/ui.store';
import { useFilesPageStore } from '~/stores/filesPage.store';
import { useFileDrop } from '~/composables/fileManager/useFileDrop';
import {
  useDraggedFile,
  FILE_MANAGER_MOVE_DRAG_TYPE,
  INTERNAL_DRAG_TYPE,
} from '~/composables/useDraggedFile';
import type { FsEntry } from '~/types/fs';
import type { DraggedFileData } from '~/composables/useDraggedFile';
import { useFileManager } from '~/composables/fileManager/useFileManager';

interface UseFileBrowserDragAndDropOptions {
  findEntryByPath: (path: string) => FsEntry | null;
  resolveEntryByPath: (path: string) => Promise<FsEntry | null>;
  handleFiles: (files: File[] | FileList, targetDirPath?: string) => Promise<void>;
  moveEntry: (params: { source: FsEntry; targetDirPath: string }) => Promise<void>;
  loadFolderContent: () => Promise<void>;
  notifyFileManagerUpdate: () => void;
}

export function useFileBrowserDragAndDrop(options: UseFileBrowserDragAndDropOptions) {
  const uiStore = useUiStore();
  const filesPageStore = useFilesPageStore();
  const fileManager = useFileManager();
  const { setDraggedFile, clearDraggedFile } = useDraggedFile();

  const isDragOverPanel = ref(false);
  const dragOverEntryPath = ref<string | null>(null);

  const { isRootDropOver, isRelevantDrag, onRootDragOver, onRootDragLeave, onRootDrop } =
    useFileDrop({
      resolveEntryByPath: options.resolveEntryByPath,
      handleFiles: options.handleFiles,
      moveEntry: options.moveEntry,
    });

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

    const movePayload = entriesToMove.map((e) => ({ name: e.name, kind: e.kind, path: e.path }));
    e.dataTransfer.setData(FILE_MANAGER_MOVE_DRAG_TYPE, JSON.stringify(movePayload));
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
      count: entriesToMove.length > 1 ? entriesToMove.length : undefined,
      items: movePayload,
    };
    setDraggedFile(data);
    e.dataTransfer?.setData('application/json', JSON.stringify(data));
  }

  function onEntryDragEnd() {
    clearDraggedFile();
    dragOverEntryPath.value = null;
  }

  function isDropTargetDir(entry: FsEntry): boolean {
    return entry.kind === 'directory';
  }

  function onEntryDragOver(e: DragEvent, entry: FsEntry) {
    if (!isDropTargetDir(entry)) return;
    const types = e.dataTransfer?.types;
    if (!types) return;
    if (!types.includes(FILE_MANAGER_MOVE_DRAG_TYPE) && !types.includes('Files')) return;
    dragOverEntryPath.value = entry.path ?? null;
    e.dataTransfer!.dropEffect = types.includes('Files') ? 'copy' : 'move';
  }

  function onEntryDragLeave(e: DragEvent, entry: FsEntry) {
    if (dragOverEntryPath.value !== (entry.path ?? null)) return;
    const currentTarget = e.currentTarget as HTMLElement | null;
    if (!currentTarget?.contains(e.relatedTarget as Node | null)) {
      dragOverEntryPath.value = null;
    }
  }

  async function onEntryDrop(e: DragEvent, entry: FsEntry) {
    if (!isDropTargetDir(entry)) return;
    e.stopPropagation();
    dragOverEntryPath.value = null;

    const droppedFiles = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
    const hasFiles = e.dataTransfer?.types.includes('Files') ?? false;
    const moveRaw = e.dataTransfer?.getData(FILE_MANAGER_MOVE_DRAG_TYPE);

    const targetPath = entry.path;

    if (moveRaw) {
      let parsed: any = null;
      try {
        parsed = JSON.parse(moveRaw);
      } catch {
        return;
      }

      const itemsToMove = Array.isArray(parsed) ? parsed : [parsed];

      for (const item of itemsToMove) {
        const sourcePath = typeof item?.path === 'string' ? item.path : '';
        if (!sourcePath || sourcePath === targetPath) continue;

        const source = await options.resolveEntryByPath(sourcePath);
        if (!source) continue;

        await options.moveEntry({
          source,
          targetDirPath: targetPath,
        });
      }

      options.notifyFileManagerUpdate();
      await options.loadFolderContent();
      return;
    }

    if (!hasFiles || droppedFiles.length === 0) return;

    await options.handleFiles(droppedFiles, targetPath);
    options.notifyFileManagerUpdate();
    await options.loadFolderContent();
  }

  function onPanelDragOver(e: DragEvent) {
    const types = e.dataTransfer?.types;
    if (!types) return;
    if (types.includes('Files') || types.includes(FILE_MANAGER_MOVE_DRAG_TYPE)) {
      isDragOverPanel.value = true;
      uiStore.isFileManagerDragging = true;
      e.dataTransfer!.dropEffect = types.includes('Files') ? 'copy' : 'move';
    }
  }

  function onPanelDragLeave(e: DragEvent) {
    const currentTarget = e.currentTarget as HTMLElement | null;
    if (!currentTarget?.contains(e.relatedTarget as Node | null)) {
      isDragOverPanel.value = false;
      uiStore.isFileManagerDragging = false;
    }
  }

  async function onPanelDrop(e: DragEvent) {
    isDragOverPanel.value = false;
    uiStore.isFileManagerDragging = false;
    uiStore.isGlobalDragging = false;

    const targetFolder = filesPageStore.selectedFolder;
    const targetPath = targetFolder?.path ?? '';

    const moveRaw = e.dataTransfer?.getData(FILE_MANAGER_MOVE_DRAG_TYPE);
    if (moveRaw) {
      let parsed: any = null;
      try {
        parsed = JSON.parse(moveRaw);
      } catch {
        return;
      }

      const itemsToMove = Array.isArray(parsed) ? parsed : [parsed];

      for (const item of itemsToMove) {
        const sourcePath = typeof item?.path === 'string' ? item.path : '';
        if (!sourcePath) continue;

        const source = await options.resolveEntryByPath(sourcePath);
        if (!source) continue;

        await options.moveEntry({
          source,
          targetDirPath: targetPath,
        });
      }

      options.notifyFileManagerUpdate();
      await options.loadFolderContent();
      return;
    }

    const droppedFiles = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
    if (droppedFiles.length === 0) return;

    await options.handleFiles(droppedFiles, targetPath || undefined);
    options.notifyFileManagerUpdate();
    await options.loadFolderContent();
  }

  return {
    isDragOverPanel,
    dragOverEntryPath,
    isRootDropOver,
    isRelevantDrag,
    onEntryDragStart,
    onEntryDragEnd,
    onEntryDragOver,
    onEntryDragLeave,
    onEntryDrop,
    onRootDragOver,
    onRootDragLeave,
    onRootDrop,
    onPanelDragOver,
    onPanelDragLeave,
    onPanelDrop,
  };
}
