import { ref, onMounted, onUnmounted } from 'vue';

export interface DraggedFileData {
  name: string;
  path: string;
  kind: 'file' | 'timeline' | 'adjustment' | 'background' | 'text' | 'shape' | 'hud';
  operation?: 'copy' | 'move';
  count?: number;
  items?: Array<{ name: string; path?: string; kind: string }>;
  isExternal?: boolean;
}

const draggedFile = ref<DraggedFileData | null>(null);

export function useDraggedFile(options: { enableUiEffects?: boolean } = {}) {
  const { enableUiEffects = true } = options;

  function setDraggedFile(data: DraggedFileData) {
    draggedFile.value = data;
  }

  function clearDraggedFile() {
    draggedFile.value = null;
  }

  if (enableUiEffects) {
    onMounted(() => {
      window.addEventListener('dragend', clearDraggedFile);
      window.addEventListener('drop', clearDraggedFile);
    });

    onUnmounted(() => {
      window.removeEventListener('dragend', clearDraggedFile);
      window.removeEventListener('drop', clearDraggedFile);
    });
  }

  return {
    draggedFile,
    setDraggedFile,
    clearDraggedFile,
  };
}
