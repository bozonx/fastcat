import { ref } from 'vue';

export interface DraggedFileData {
  name: string;
  path: string;
  kind: 'file';
}

const draggedFile = ref<DraggedFileData | null>(null);

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
