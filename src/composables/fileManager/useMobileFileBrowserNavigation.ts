import { ref, computed, watch, onMounted } from 'vue';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import type { FsEntry } from '~/types/fs';
import { useFilesPageStore } from '~/stores/files-page.store';
import { useProjectStore } from '~/stores/project.store';
import { useUiStore } from '~/stores/ui.store';
import {
  getWorkspacePathParent,
  WORKSPACE_COMMON_DIR_NAME,
  WORKSPACE_COMMON_PATH_PREFIX,
} from '~/utils/workspace-common';

interface NavigationDeps {
  readDirectory: (path: string) => Promise<FsEntry[]>;
  vfs: IFileSystemAdapter;
  findEntryByPath: (path: string) => FsEntry | undefined;
}

export function useMobileFileBrowserNavigation({
  readDirectory,
  vfs,
  findEntryByPath,
}: NavigationDeps) {
  const filesPageStore = useFilesPageStore();
  const projectStore = useProjectStore();
  const uiStore = useUiStore();

  const entries = ref<FsEntry[]>([]);
  const isLoading = ref(false);

  function navigateToRoot() {
    filesPageStore.selectFolder({
      kind: 'directory',
      name: projectStore.currentProjectName || 'Root',
      path: '',
    });
  }

  function navigateToWorkspaceCommonRoot() {
    filesPageStore.selectFolder({
      kind: 'directory',
      name: WORKSPACE_COMMON_DIR_NAME,
      path: WORKSPACE_COMMON_PATH_PREFIX,
    });
  }

  async function loadFolderContent() {
    const folder = filesPageStore.selectedFolder;
    if (!folder) {
      navigateToRoot();
      return;
    }

    isLoading.value = true;
    try {
      let content = await readDirectory(folder.path);
      if (!folder.path) {
        const commonMetadata = await vfs.getMetadata(WORKSPACE_COMMON_PATH_PREFIX);
        if (commonMetadata?.kind === 'directory') {
          const commonEntry: FsEntry = {
            kind: 'directory',
            name: WORKSPACE_COMMON_DIR_NAME,
            path: WORKSPACE_COMMON_PATH_PREFIX,
          };
          content = [
            commonEntry,
            ...content.filter((entry) => entry.path !== WORKSPACE_COMMON_PATH_PREFIX),
          ];
        }
      }

      const filteredContent = content.filter(
        (e) => uiStore.showHiddenFiles || !e.name.startsWith('.'),
      );

      entries.value = await Promise.all(
        filteredContent.map(async (entry) => {
          if (entry.kind === 'file') {
            try {
              const metadata = await vfs.getMetadata(entry.path);
              if (metadata && metadata.kind === 'file') {
                return { ...entry, size: metadata.size, lastModified: metadata.lastModified };
              }
            } catch (e) {
              console.warn('Failed to get metadata for:', entry.path, e);
            }
          }
          return entry;
        }),
      );
    } catch (error) {
      console.error('Failed to load mobile folder content:', error);
    } finally {
      isLoading.value = false;
    }
  }

  const breadcrumbs = computed(() => {
    const folder = filesPageStore.selectedFolder;
    if (!folder || !folder.path) return [];

    const parts = folder.path.split('/').filter(Boolean);
    const result: Array<{ name: string; path: string }> = [];
    let currentPath = '';

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      result.push({
        name: part === WORKSPACE_COMMON_PATH_PREFIX ? WORKSPACE_COMMON_DIR_NAME : part,
        path: currentPath,
      });
    }

    return result;
  });

  async function goBack() {
    const folder = filesPageStore.selectedFolder;
    if (!folder || !folder.path) return;

    const parentPath = getWorkspacePathParent(folder.path);

    if (!parentPath) {
      navigateToRoot();
    } else if (parentPath === WORKSPACE_COMMON_PATH_PREFIX) {
      navigateToWorkspaceCommonRoot();
    } else {
      const parentEntry = findEntryByPath(parentPath);
      if (parentEntry) {
        filesPageStore.selectFolder(parentEntry);
      }
    }
  }

  watch(
    () => filesPageStore.selectedFolder?.path,
    () => {
      void loadFolderContent();
    },
    { immediate: true },
  );

  watch(
    () => uiStore.showHiddenFiles,
    () => {
      void loadFolderContent();
    },
  );

  onMounted(() => {
    if (!filesPageStore.selectedFolder) {
      void navigateToRoot();
    } else {
      void loadFolderContent();
    }
  });

  return {
    entries,
    isLoading,
    breadcrumbs,
    loadFolderContent,
    navigateToRoot,
    navigateToWorkspaceCommonRoot,
    goBack,
  };
}
