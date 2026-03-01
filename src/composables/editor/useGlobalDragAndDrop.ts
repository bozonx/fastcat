import { useUiStore } from '~/stores/ui.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';

export function useGlobalDragAndDrop() {
  const uiStore = useUiStore();
  const workspaceStore = useWorkspaceStore();
  const projectStore = useProjectStore();

  function onGlobalDragOver(e: DragEvent) {
    const types = e.dataTransfer?.types;
    if (!types) return;

    const typesArr = Array.from(types);
    // Ignore internal drags (files dragged within the app from the file manager)
    if (typesArr.includes('application/gran-internal-file')) return;

    if (typesArr.includes('Files')) {
      uiStore.isGlobalDragging = true;
    }
  }

  function onGlobalDragLeave(e: DragEvent) {
    if (!e.relatedTarget) {
      uiStore.isGlobalDragging = false;
    }
  }

  async function onGlobalDrop(e: DragEvent) {
    uiStore.isGlobalDragging = false;

    // if uiStore.isFileManagerDragging is true, filemanager itself will handle the drop
    if (uiStore.isFileManagerDragging) return;

    // Snapshot files synchronously — dataTransfer.files becomes empty after any await
    const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
    if (files.length === 0) return;
    if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) return;

    const { useFileManager } = await import('~/composables/fileManager/useFileManager');
    const fm = useFileManager();
    await fm.handleFiles(files);
  }

  return {
    onGlobalDragOver,
    onGlobalDragLeave,
    onGlobalDrop,
  };
}
