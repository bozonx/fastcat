import { ref, inject } from 'vue';
import type { Ref } from 'vue';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import type { FsEntry } from '~/types/fs';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import { WORKSPACE_COMMON_DIR_NAME, WORKSPACE_COMMON_PATH_PREFIX } from '~/utils/workspace-common';

export interface UseFileBrowserFolderLoaderOptions {
  vfs: IFileSystemAdapter;
  readDirectory: (path?: string) => Promise<FsEntry[]>;
  folderEntries: Ref<FsEntry[]>;
  supplementEntries: (entries: FsEntry[]) => Promise<FsEntry[]>;
}

export function useFileBrowserFolderLoader(options: UseFileBrowserFolderLoaderOptions) {
  const fileManagerStore =
    (inject('fileManagerStore', null) as ReturnType<typeof useFileManagerStore> | null) ||
    useFileManagerStore();
  const workspaceStore = useWorkspaceStore();

  const isLoading = ref(false);
  const error = ref<string | null>(null);

  async function loadFolderContent() {
    const folder = fileManagerStore.selectedFolder;
    if (!folder) {
      options.folderEntries.value = [];
      return;
    }

    isLoading.value = true;
    error.value = null;

    try {
      const path = folder.path || '';
      let entries = await options.readDirectory(path);

      if (!path && workspaceStore.userSettings.experimentalFeatures) {
        const commonMetadata = await options.vfs.getMetadata(WORKSPACE_COMMON_PATH_PREFIX);
        if (commonMetadata?.kind === 'directory') {
          const commonEntry: FsEntry = {
            kind: 'directory',
            name: WORKSPACE_COMMON_DIR_NAME,
            path: WORKSPACE_COMMON_PATH_PREFIX,
          };
          entries = [
            commonEntry,
            ...entries.filter((e) => e.path !== WORKSPACE_COMMON_PATH_PREFIX),
          ];
        }
      }

      const filtered = entries.filter(
        (e) => fileManagerStore.showHiddenFiles || !e.name.startsWith('.'),
      );
      options.folderEntries.value = await options.supplementEntries(filtered);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      error.value = message;
      options.folderEntries.value = [];
    } finally {
      isLoading.value = false;
    }
  }

  return {
    isLoading,
    error,
    loadFolderContent,
  };
}
