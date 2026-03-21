import { watch } from 'vue';
import type { FsEntry } from '~/types/fs';
import { useProjectStore } from '~/stores/project.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useUiStore } from '~/stores/ui.store';

export interface FileManagerPanelBootstrapOptions {
  loadProjectDirectory: () => Promise<void>;
  onRootEntrySelected: (entry: FsEntry) => void;
}

export function useFileManagerPanelBootstrap({
  loadProjectDirectory,
  onRootEntrySelected,
}: FileManagerPanelBootstrapOptions) {
  const projectStore = useProjectStore();
  const selectionStore = useSelectionStore();
  const uiStore = useUiStore();

  watch(
    () => projectStore.currentProjectId,
    async (id) => {
      const name = projectStore.currentProjectName;
      
      if (id) {
        uiStore.restoreFileTreeStateOnce();
      }

      await loadProjectDirectory();

      if (name) {
        const rootEntry: FsEntry = {
          kind: 'directory',
          name,
          path: '',
        };
        uiStore.selectedFsEntry = rootEntry;
        selectionStore.selectFsEntry(rootEntry);
        onRootEntrySelected(rootEntry);
      }
    },
    { immediate: true },
  );
}
