import { ref, onMounted, onUnmounted } from 'vue';
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

  // Web Drop
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

  /**
   * Handles auto-sorted file drop (no specific folder target).
   * The overlay intercepts drops to specific folders via events.
   */
  async function handleAutoFileDrop(files: File[]) {
    if (isDropInProgress.value) return;
    if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) return;

    isDropInProgress.value = true;
    try {
      await fm.handleFiles(files);
    } finally {
      isDropInProgress.value = false;
    }
  }

  /**
   * Handles file drop to specific folder.
   */
  async function handleFolderFileDrop(files: File[], targetDirPath: string) {
    if (isDropInProgress.value) return;
    if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) return;

    isDropInProgress.value = true;
    try {
      await fm.handleFiles(files, targetDirPath);
    } finally {
      isDropInProgress.value = false;
    }
  }

  async function onGlobalDrop(e: DragEvent) {
    // The overlay handles drops via its own events, so the global drop
    // is only for fallback when overlay is not shown
    if (isDropInProgress.value) return;
    isDropInProgress.value = true;

    try {
      uiStore.isGlobalDragging = false;

      const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
      if (files.length === 0) return;
      if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) return;

      await fm.handleFiles(files);
    } finally {
      isDropInProgress.value = false;
    }
  }

  // Tauri Drop
  let unlistenTauriDrop: (() => void) | undefined;

  onMounted(async () => {
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview');
        unlistenTauriDrop = await getCurrentWebview().onDragDropEvent(async (event) => {
          if (event.payload.type === 'over') {
            uiStore.isGlobalDragging = true;
          } else if (event.payload.type === 'leave') {
            uiStore.isGlobalDragging = false;
          } else if (event.payload.type === 'drop') {
            uiStore.isGlobalDragging = false;

            if (isDropInProgress.value) return;
            if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) return;

            isDropInProgress.value = true;
            try {
              const paths = event.payload.paths || [];
              if (paths.length === 0) return;

              const files: File[] = [];

              for (const path of paths) {
                const file = await fm.vfs.getFile(path);
                if (file) {
                  files.push(file);
                } else {
                  const { readFile, stat } = await import('@tauri-apps/plugin-fs');
                  const metadata = await stat(path);
                  const bytes = await readFile(path);
                  const filename = path.split(/[/\\]/).pop() || 'unknown';
                  files.push(
                    new File([bytes], filename, {
                      lastModified: metadata.mtime
                        ? new Date(metadata.mtime).getTime()
                        : Date.now(),
                    }),
                  );
                }
              }

              if (files.length > 0) {
                await fm.handleFiles(files);
              }
            } catch (err) {
              console.error('Failed to handle Tauri file drop:', err);
            } finally {
              isDropInProgress.value = false;
            }
          }
        });
      } catch (err) {
        console.error('Failed to setup Tauri drop listener:', err);
      }
    }
  });

  onUnmounted(() => {
    if (unlistenTauriDrop) {
      unlistenTauriDrop();
    }
  });

  return {
    onGlobalDragOver,
    onGlobalDragLeave,
    onGlobalDrop,
    handleAutoFileDrop,
    handleFolderFileDrop,
  };
}
