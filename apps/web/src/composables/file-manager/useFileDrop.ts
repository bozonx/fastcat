import { ref } from 'vue';
import type { FsEntry } from '~/types/fs';
import {
  resetFileManagerDragCursor,
  syncFileManagerDragCursor,
} from '~/composables/file-manager/dragCursor';
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
  const isRootDropOver = ref(false);
  let rootDragEnterCount = 0;

  function isRelevantDrag(e: DragEvent): boolean {
    return Array.from(e.dataTransfer?.types ?? []).includes('Files');
  }

  function onRootDragEnter(e: DragEvent) {
    if (!isRelevantDrag(e)) return;
    e.preventDefault();
    rootDragEnterCount++;
    isRootDropOver.value = true;
  }

  function onRootDragOver(e: DragEvent) {
    if (!isRelevantDrag(e)) return;

    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer!.dropEffect = 'copy';
    syncFileManagerDragCursor({ isDragging: true, operation: 'copy' });
  }

  function onRootDragLeave(e: DragEvent) {
    if (!isRelevantDrag(e)) return;
    rootDragEnterCount--;
    if (rootDragEnterCount <= 0) {
      rootDragEnterCount = 0;
      isRootDropOver.value = false;
      resetFileManagerDragCursor();
    }
  }

  async function onRootDrop(e: DragEvent, targetDirPath?: string) {
    e.stopPropagation();
    rootDragEnterCount = 0;
    isRootDropOver.value = false;
    resetFileManagerDragCursor();

    const droppedFiles = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
    const hasFiles = Array.from(e.dataTransfer?.types ?? []).includes('Files');

    if (hasFiles && droppedFiles.length > 0) {
      await options.handleFiles(droppedFiles, { targetDirPath });
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
