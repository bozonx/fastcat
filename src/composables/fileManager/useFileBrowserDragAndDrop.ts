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
  handleFiles: (
    files: File[] | FileList,
    targetDirHandle?: FileSystemDirectoryHandle,
    targetDirPath?: string,
  ) => Promise<void>;
  moveEntry: (params: {
    source: FsEntry;
    targetDirHandle: FileSystemDirectoryHandle;
    targetDirPath: string;
  }) => Promise<void>;
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
      getProjectRootDirHandle: fileManager.getProjectRootDirHandle,
      findEntryByPath: options.findEntryByPath,
      handleFiles: options.handleFiles,
      moveEntry: options.moveEntry,
    });

  function onEntryDragStart(e: DragEvent, entry: FsEntry) {
    if (!entry.path) return;
    if (!e.dataTransfer) return;

    e.dataTransfer.effectAllowed = 'copyMove';
    const movePayload = { name: entry.name, kind: entry.kind, path: entry.path };
    e.dataTransfer.setData(FILE_MANAGER_MOVE_DRAG_TYPE, JSON.stringify(movePayload));
    // Mark as internal so the global overlay is not shown
    e.dataTransfer?.setData(INTERNAL_DRAG_TYPE, '1');

    if (entry.kind !== 'file') return;

    const isTimeline = entry.name.toLowerCase().endsWith('.otio');
    const kind: DraggedFileData['kind'] = isTimeline ? 'timeline' : 'file';
    const data: DraggedFileData = { name: entry.name, kind, path: entry.path };
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

    const targetHandle = entry.handle as FileSystemDirectoryHandle;
    const targetPath = entry.path ?? '';

    if (moveRaw) {
      let parsed: { path?: unknown } | null;
      try {
        parsed = JSON.parse(moveRaw);
      } catch {
        return;
      }

      const sourcePath = typeof parsed?.path === 'string' ? parsed.path : '';
      if (!sourcePath || sourcePath === targetPath) return;

      const source = options.findEntryByPath(sourcePath);
      if (!source) return;

      await options.moveEntry({ source, targetDirHandle: targetHandle, targetDirPath: targetPath });
      options.notifyFileManagerUpdate();
      await options.loadFolderContent();
      return;
    }

    if (!hasFiles || droppedFiles.length === 0) return;

    await options.handleFiles(droppedFiles, targetHandle, targetPath);
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
    const targetHandle = targetFolder?.handle as FileSystemDirectoryHandle | undefined;
    const targetPath = targetFolder?.path ?? '';

    const moveRaw = e.dataTransfer?.getData(FILE_MANAGER_MOVE_DRAG_TYPE);
    if (moveRaw) {
      let parsed: { path?: unknown } | null;
      try {
        parsed = JSON.parse(moveRaw);
      } catch {
        return;
      }
      const sourcePath = typeof parsed?.path === 'string' ? parsed.path : '';
      if (!sourcePath) return;

      const source = options.findEntryByPath(sourcePath);
      if (!source) return;

      if (targetHandle) {
        await options.moveEntry({
          source,
          targetDirHandle: targetHandle,
          targetDirPath: targetPath,
        });
      } else {
        const rootHandle = await fileManager.getProjectRootDirHandle();
        if (rootHandle) {
          await options.moveEntry({ source, targetDirHandle: rootHandle, targetDirPath: '' });
        }
      }
      options.notifyFileManagerUpdate();
      await options.loadFolderContent();
      return;
    }

    const droppedFiles = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
    if (droppedFiles.length === 0) return;

    if (targetHandle) {
      await options.handleFiles(droppedFiles, targetHandle, targetPath);
    } else {
      await options.handleFiles(droppedFiles);
    }
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
