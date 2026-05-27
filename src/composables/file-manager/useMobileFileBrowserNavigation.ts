import { createDevLogger } from '~/utils/dev-logger';
import { ref, computed, watch, onMounted, inject } from 'vue';
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

const log = createDevLogger('useMobileFileBrowserNavigation');

interface NavigationDeps {
  readDirectory: (path: string) => Promise<FsEntry[]>;
  vfs: IFileSystemAdapter;
  findEntryByPath: (path: string) => FsEntry | undefined;
}

const METADATA_CONCURRENCY = 10;

async function mapEntriesWithMetadata(
  entries: FsEntry[],
  vfs: IFileSystemAdapter,
): Promise<FsEntry[]> {
  const queue = [...entries];
  const results: FsEntry[] = [];

  async function worker() {
    while (queue.length > 0) {
      const entry = queue.shift()!;
      if (entry.kind !== 'file') {
        results.push(entry);
        continue;
      }
      try {
        const metadata = await vfs.getMetadata(entry.path);
        if (metadata && metadata.kind === 'file') {
          results.push({ ...entry, size: metadata.size, lastModified: metadata.lastModified });
          continue;
        }
      } catch (e) {
        log.warn('Failed to get metadata for:', entry.path, e);
      }
      results.push(entry);
    }
  }

  const workers = Array.from({ length: Math.min(METADATA_CONCURRENCY, entries.length) }, worker);
  await Promise.all(workers);
  return results;
}

export function useMobileFileBrowserNavigation({
  readDirectory,
  vfs,
  findEntryByPath: _findEntryByPath,
}: NavigationDeps) {
  const fileManagerStore =
    (inject('fileManagerStore', null) as ReturnType<typeof useFileManagerStore> | null) ||
    useFileManagerStore();
  const timelineMediaUsageStore = useTimelineMediaUsageStore();
  const projectStore = useProjectStore();
  const toast = useToast();
  const { t } = useI18n();

  const entries = ref<FsEntry[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

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

  async function loadFolderContent() {
    const folder = fileManagerStore.selectedFolder;
    if (!folder) {
      navigateToRoot();
      return;
    }

    isLoading.value = true;
    error.value = null;
    try {
      let content = (await readDirectory(folder.path)) || [];
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
            ...content.filter((entry: FsEntry) => entry.path !== WORKSPACE_COMMON_PATH_PREFIX),
          ];
        }
      }

      const filteredContent = content.filter(
        (e) => fileManagerStore.showHiddenFiles || !e.name.startsWith('.'),
      );

      entries.value = await mapEntriesWithMetadata(filteredContent, vfs);
      error.value = null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('Failed to load mobile folder content:', err);
      error.value = message;
      toast.add({
        title: t('common.error'),
        description: t('videoEditor.fileManager.errors.loadFolderFailed', { message }),
        color: 'error',
      });
    } finally {
      isLoading.value = false;
    }
  }

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
      // Construction of a parent entry is more reliable than findEntryByPath,
      // as the tree might not be fully loaded on mobile.
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
      void loadFolderContent();
    },
    { immediate: true },
  );

  watch(
    () => fileManagerStore.showHiddenFiles,
    () => {
      void loadFolderContent();
    },
  );

  onMounted(() => {
    void timelineMediaUsageStore.refreshUsage();
    if (!fileManagerStore.selectedFolder) {
      void navigateToRoot();
    } else {
      void loadFolderContent();
    }
  });

  return {
    entries,
    isLoading,
    error,
    breadcrumbs,
    loadFolderContent,
    navigateToRoot,
    navigateToWorkspaceCommonRoot,
    goBack,
  };
}
