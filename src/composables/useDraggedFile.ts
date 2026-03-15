import { ref, onMounted, onUnmounted } from 'vue';

export interface DraggedFileData {
  name: string;
  path: string;
  kind: 'file' | 'timeline' | 'adjustment' | 'background' | 'text' | 'shape' | 'hud';
  operation?: 'copy' | 'move';
  count?: number;
  items?: Array<{ name: string; path?: string; kind: string }>;
}

const draggedFile = ref<DraggedFileData | null>(null);

export const INTERNAL_DRAG_TYPE = 'application/fastcat-internal-file';

export const FILE_MANAGER_MOVE_DRAG_TYPE = 'application/fastcat-file-manager-move';

export const FILE_MANAGER_COPY_DRAG_TYPE = 'application/fastcat-file-manager-copy';

export const REMOTE_FILE_DRAG_TYPE = 'application/fastcat-remote-file';

export function useDraggedFile() {
  function setDraggedFile(data: DraggedFileData) {
    draggedFile.value = data;
  }

  function clearDraggedFile() {
    draggedFile.value = null;
  }

  onMounted(() => {
    window.addEventListener('dragend', clearDraggedFile);
    window.addEventListener('drop', clearDraggedFile);
  });

  onUnmounted(() => {
    window.removeEventListener('dragend', clearDraggedFile);
    window.removeEventListener('drop', clearDraggedFile);
  });

  return {
    draggedFile,
    setDraggedFile,
    clearDraggedFile,
  };
}
