import { ref } from 'vue';
import { useUiStore } from '~/stores/ui.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';

const isDropInProgress = ref(false);

export function useGlobalDragAndDrop() {
  const uiStore = useUiStore();
  const workspaceStore = useWorkspaceStore();
  const projectStore = useProjectStore();
  const fm = useFileManager();

  function onGlobalDragOver(e: DragEvent) {
    const types = e.dataTransfer?.types;
    if (!types) return;

    const typesArr = Array.from(types);
    if (typesArr.includes('application/gran-internal-file')) return;

    if (typesArr.includes('Files')) {
      e.preventDefault();
      uiStore.isGlobalDragging = true;
    }
  }

  function onGlobalDragLeave(e: DragEvent) {
    if (!e.relatedTarget) {
      uiStore.isGlobalDragging = false;
    }
  }

  async function onGlobalDrop(e: DragEvent) {
    if (isDropInProgress.value) return;
    isDropInProgress.value = true;

    try {
      uiStore.isGlobalDragging = false;

      if (uiStore.isFileManagerDragging) return;

      const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
      if (files.length === 0) return;
      if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) return;

      await fm.handleFiles(files);
    } finally {
      isDropInProgress.value = false;
    }
  }

  return {
    onGlobalDragOver,
    onGlobalDragLeave,
    onGlobalDrop,
  };
}
