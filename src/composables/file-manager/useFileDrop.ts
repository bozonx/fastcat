import { ref } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { isLayer1Active } from '~/utils/hotkeys/layerUtils';
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
  const workspaceStore = useWorkspaceStore();
  const isRootDropOver = ref(false);
  let rootDragEnterCount = 0;

  function isCopyModifierActive(e: DragEvent): boolean {
    return !isLayer1Active(e, workspaceStore.userSettings);
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

  function onRootDragEnter(e: DragEvent) {
    if (!isRelevantDrag(e)) return;
    e.preventDefault();
    rootDragEnterCount++;
    isRootDropOver.value = true;
  }

  function onRootDragOver(e: DragEvent) {
    if (!isRelevantDrag(e)) return;

    e.stopPropagation();
    e.dataTransfer!.dropEffect =
      e.dataTransfer?.types.includes('Files') ||
      e.dataTransfer?.types.includes(FILE_MANAGER_COPY_DRAG_TYPE) ||
      isCopyModifierActive(e)
        ? 'copy'
        : 'move';
  }

  function onRootDragLeave(e: DragEvent) {
    if (!isRelevantDrag(e)) return;
    rootDragEnterCount--;
    if (rootDragEnterCount <= 0) {
      rootDragEnterCount = 0;
      isRootDropOver.value = false;
    }
  }

  async function onRootDrop(e: DragEvent) {
    e.stopPropagation();
    rootDragEnterCount = 0;
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

    const shouldCopy = !!copyRaw || isCopyModifierActive(e);

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(internalRaw);
    } catch (err) {
      console.warn('[useFileDrop] Failed to parse internal drag data:', err);
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
    onRootDragEnter,
    onRootDragOver,
    onRootDragLeave,
    onRootDrop,
  };
}
