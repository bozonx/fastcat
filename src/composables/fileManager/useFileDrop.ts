import { ref } from 'vue';
import type { FsEntry } from '~/types/fs';
import {
  FILE_MANAGER_COPY_DRAG_TYPE,
  FILE_MANAGER_MOVE_DRAG_TYPE,
} from '~/composables/useDraggedFile';

export interface UseFileDropOptions {
  resolveEntryByPath: (path: string) => Promise<FsEntry | null>;
  handleFiles: (files: FileList | File[], targetDirPath?: string) => Promise<void>;
  moveEntry: (params: { source: FsEntry; targetDirPath: string }) => Promise<void>;
  copyEntry: (params: { source: FsEntry; targetDirPath: string }) => Promise<unknown>;
}

export function useFileDrop(options: UseFileDropOptions) {
  const isRootDropOver = ref(false);

  function isRelevantDrag(e: DragEvent): boolean {
    const types = e.dataTransfer?.types;
    if (!types) return false;
    return (
      types.includes(FILE_MANAGER_MOVE_DRAG_TYPE) ||
      types.includes(FILE_MANAGER_COPY_DRAG_TYPE) ||
      types.includes('Files')
    );
  }

  function onRootDragOver(e: DragEvent) {
    if (!isRelevantDrag(e)) return;

    e.stopPropagation();

    isRootDropOver.value = true;
    e.dataTransfer!.dropEffect =
      e.dataTransfer?.types.includes('Files') ||
      e.dataTransfer?.types.includes(FILE_MANAGER_COPY_DRAG_TYPE) ||
      e.shiftKey
        ? 'copy'
        : 'move';
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
    const copyRaw = e.dataTransfer?.getData(FILE_MANAGER_COPY_DRAG_TYPE);
    const moveRaw = e.dataTransfer?.getData(FILE_MANAGER_MOVE_DRAG_TYPE);

    if (hasFiles && droppedFiles.length > 0) {
      await options.handleFiles(droppedFiles, '');
      return;
    }

    const internalRaw = copyRaw || moveRaw;
    if (!internalRaw) return;

    const shouldCopy = !!copyRaw || e.shiftKey;

    let parsed: any = null;
    try {
      parsed = JSON.parse(internalRaw);
    } catch {
      return;
    }

    const itemsToMove = Array.isArray(parsed) ? parsed : [parsed];

    for (const item of itemsToMove) {
      const sourcePath = typeof item?.path === 'string' ? item.path : '';
      if (!sourcePath) continue;

      const source = await options.resolveEntryByPath(sourcePath);
      if (!source) continue;

      if (shouldCopy) {
        await options.copyEntry({
          source,
          targetDirPath: '',
        });
      } else {
        await options.moveEntry({
          source,
          targetDirPath: '',
        });
      }
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
