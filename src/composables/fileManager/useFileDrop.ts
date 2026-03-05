import { ref } from 'vue';
import type { FsEntry } from '~/types/fs';
import { FILE_MANAGER_MOVE_DRAG_TYPE } from '~/composables/useDraggedFile';

export interface UseFileDropOptions {
  getProjectRootDirHandle: () => Promise<FileSystemDirectoryHandle | null>;
  findEntryByPath: (path: string) => FsEntry | null;
  handleFiles: (
    files: FileList | File[],
    targetDirHandle?: FileSystemDirectoryHandle,
    targetDirPath?: string,
  ) => Promise<void>;
  moveEntry: (params: {
    source: FsEntry;
    targetDirHandle: FileSystemDirectoryHandle;
    targetDirPath: string;
  }) => Promise<void>;
}

export function useFileDrop(options: UseFileDropOptions) {
  const isRootDropOver = ref(false);

  function isRelevantDrag(e: DragEvent): boolean {
    const types = e.dataTransfer?.types;
    if (!types) return false;
    return types.includes(FILE_MANAGER_MOVE_DRAG_TYPE) || types.includes('Files');
  }

  function onRootDragOver(e: DragEvent) {
    if (!isRelevantDrag(e)) return;

    e.stopPropagation();

    isRootDropOver.value = true;
    e.dataTransfer!.dropEffect = e.dataTransfer?.types.includes('Files') ? 'copy' : 'move';
  }

  function onRootDragLeave(e: DragEvent) {
    const currentTarget = e.currentTarget as HTMLElement | null;
    const relatedTarget = e.relatedTarget as Node | null;
    if (!currentTarget?.contains(relatedTarget)) {
      isRootDropOver.value = false;
    }
  }

  async function onRootDrop(e: DragEvent) {
    e.stopPropagation();
    isRootDropOver.value = false;

    // Snapshot data synchronously - dataTransfer becomes empty after any await
    const droppedFiles = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
    const hasFiles = e.dataTransfer?.types.includes('Files') ?? false;
    const moveRaw = e.dataTransfer?.getData(FILE_MANAGER_MOVE_DRAG_TYPE);

    const rootHandle = await options.getProjectRootDirHandle();
    if (!rootHandle) return;

    if (hasFiles && droppedFiles.length > 0) {
      await options.handleFiles(droppedFiles, rootHandle, '');
      return;
    }

    if (!moveRaw) return;

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

      const source = options.findEntryByPath(sourcePath);
      if (!source) continue;

      await options.moveEntry({
        source,
        targetDirHandle: rootHandle,
        targetDirPath: '',
      });
    }
  }

  return {
    isRootDropOver,
    isRelevantDrag,
    onRootDragOver,
    onRootDragLeave,
    onRootDrop,
  };
}
