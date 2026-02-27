import { ref } from 'vue';

export interface DraggedFileData {
  name: string;
  path: string;
  kind: 'file' | 'timeline';
}

const draggedFile = ref<DraggedFileData | null>(null);

export const INTERNAL_DRAG_TYPE = 'application/gran-internal-file';

export const FILE_MANAGER_MOVE_DRAG_TYPE = 'application/gran-file-manager-move';

export function useDraggedFile() {
  function setDraggedFile(data: DraggedFileData) {
    draggedFile.value = data;
  }

  function clearDraggedFile() {
    draggedFile.value = null;
  }

  return {
    draggedFile,
    setDraggedFile,
    clearDraggedFile,
  };
}
