import { computed, watch, onMounted, inject } from 'vue';
import type { Ref } from 'vue';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import type { FsEntry } from '~/types/fs';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { useProjectStore } from '~/stores/project.store';
import {
  getWorkspacePathParent,
  getWorkspacePathFileName,
  WORKSPACE_COMMON_DIR_NAME,
  WORKSPACE_COMMON_PATH_PREFIX,
} from '~/utils/workspace-common';
import { useFileBrowserFolderLoader } from '~/composables/file-manager/useFileBrowserFolderLoader';

interface NavigationDeps {
  readDirectory: (path?: string) => Promise<FsEntry[]>;
  vfs: IFileSystemAdapter;
  findEntryByPath: (path: string) => FsEntry | undefined;
  folderEntries: Ref<FsEntry[]>;
  supplementEntries: (entries: FsEntry[]) => Promise<FsEntry[]>;
}

export function useMobileFileBrowserNavigation({
  readDirectory,
  vfs,
  findEntryByPath: _findEntryByPath,
  folderEntries,
  supplementEntries,
}: NavigationDeps) {
  const fileManagerStore =
    (inject('fileManagerStore', null) as ReturnType<typeof useFileManagerStore> | null) ||
    useFileManagerStore();
  const timelineMediaUsageStore = useTimelineMediaUsageStore();
  const projectStore = useProjectStore();
  const toast = useToast();
  const { t } = useI18n();

  function navigateToRoot() {
    fileManagerStore.openFolder({
      kind: 'directory',
      name: projectStore.currentProjectName || 'Root',
      path: '',
    });
  }

  function navigateToWorkspaceCommonRoot() {
    fileManagerStore.openFolder({
      kind: 'directory',
      name: WORKSPACE_COMMON_DIR_NAME,
      path: WORKSPACE_COMMON_PATH_PREFIX,
    });
  }

  const { isLoading, error, loadFolderContent } = useFileBrowserFolderLoader({
    vfs,
    readDirectory,
    folderEntries,
    supplementEntries,
  });

  // Mobile-specific: show toast on load error
  const wrappedLoadFolderContent = async () => {
    await loadFolderContent();
    if (error.value) {
      toast.add({
        title: t('common.error'),
        description: t('videoEditor.fileManager.errors.loadFolderFailed', {
          message: error.value,
        }),
        color: 'error',
      });
    }
  };

  const breadcrumbs = computed(() => {
    const folder = fileManagerStore.selectedFolder;
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
    const folder = fileManagerStore.selectedFolder;
    if (!folder || !folder.path) return;

    const parentPath = getWorkspacePathParent(folder.path);

    if (!parentPath) {
      navigateToRoot();
    } else if (parentPath === WORKSPACE_COMMON_PATH_PREFIX) {
      navigateToWorkspaceCommonRoot();
    } else {
      const parentName = getWorkspacePathFileName(parentPath) || parentPath;
      fileManagerStore.openFolder({
        kind: 'directory',
        name: parentName,
        path: parentPath,
      });
    }
  }

  watch(
    () => fileManagerStore.selectedFolder?.path,
    () => {
      void wrappedLoadFolderContent();
    },
    { immediate: true },
  );

  watch(
    () => fileManagerStore.showHiddenFiles,
    () => {
      void wrappedLoadFolderContent();
    },
  );

  onMounted(() => {
    void timelineMediaUsageStore.refreshUsage();
    if (!fileManagerStore.selectedFolder) {
      void navigateToRoot();
    }
  });

  return {
    isLoading,
    error,
    breadcrumbs,
    loadFolderContent: wrappedLoadFolderContent,
    navigateToRoot,
    navigateToWorkspaceCommonRoot,
    goBack,
  };
}
