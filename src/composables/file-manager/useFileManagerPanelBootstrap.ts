import { watch } from 'vue';
import type { FsEntry } from '~/types/fs';
import { useProjectStore } from '~/stores/project.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useUiStore } from '~/stores/ui.store';

export interface FileManagerPanelBootstrapOptions {
  loadProjectDirectory: (options?: {
    fullRefresh?: boolean;
    suppressNotification?: boolean;
  }) => Promise<void>;
  onRootEntrySelected: (entry: FsEntry) => void;
  shouldSelectRoot?: () => boolean;
}

export function useFileManagerPanelBootstrap({
  loadProjectDirectory,
  onRootEntrySelected,
  shouldSelectRoot,
}: FileManagerPanelBootstrapOptions) {
  const projectStore = useProjectStore();
  const selectionStore = useSelectionStore();
  const uiStore = useUiStore();

  watch(
    () => uiStore.fileManagerUpdateCounter,
    async () => {
      await loadProjectDirectory({
        fullRefresh: true,
        suppressNotification: true,
      });
    },
  );

  watch(
    () => projectStore.currentProjectId,
    async (id) => {
      const name = projectStore.currentProjectName;

      if (id) {
        uiStore.restoreFileTreeStateOnce();
      }

      await loadProjectDirectory();

      if (name && (!uiStore.selectedFsEntry || (shouldSelectRoot && shouldSelectRoot()))) {
        const rootEntry: FsEntry = {
          kind: 'directory',
          name,
          path: '',
        };

        // Only proceed with root selection if explicitly allowed or if it's a "clean" state
        if (!shouldSelectRoot || shouldSelectRoot()) {
          uiStore.selectedFsEntry = rootEntry;
          selectionStore.selectFsEntry(rootEntry);
          onRootEntrySelected(rootEntry);
        }
      }
    },
    { immediate: true },
  );
}
