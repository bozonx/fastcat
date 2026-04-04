import { ref, watch, nextTick, inject } from 'vue';
import type { Ref } from 'vue';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useProjectStore } from '~/stores/project.store';
import { useUiStore } from '~/stores/ui.store';
import type { FsEntry } from '~/types/fs';
import type { RemoteFsEntry } from '~/utils/remote-vfs';
import { isRemoteFsEntry } from '~/utils/remote-vfs';
import {
  stripWorkspaceCommonPathPrefix,
  WORKSPACE_COMMON_DIR_NAME,
  WORKSPACE_COMMON_PATH_PREFIX,
} from '~/utils/workspace-common';
import type { ExtendedFsEntry } from '~/composables/file-manager/useFileBrowserEntries';

export function useFileBrowserNavigation({
  rootContainer,
  isRemoteMode,
  remoteCurrentFolder,
  folderEntries,
  supplementEntries,
  buildRemoteDirectoryEntry,
  loadRemoteFolderContent,
  loadRemoteParentFolders,
  calculateFolderSize,
  pendingScrollToEntryPath,
  scrollToEntryPath,
  vfs,
  readDirectory,
}: {
  rootContainer: Ref<HTMLElement | null>;
  isRemoteMode: Ref<boolean>;
  remoteCurrentFolder: Ref<RemoteFsEntry | null>;
  folderEntries: Ref<FsEntry[]>;
  supplementEntries: (entries: FsEntry[]) => Promise<ExtendedFsEntry[]>;
  buildRemoteDirectoryEntry: (path: string) => RemoteFsEntry;
  loadRemoteFolderContent: () => Promise<boolean>;
  loadRemoteParentFolders: (parentFolders: Ref<FsEntry[]>) => boolean;
  calculateFolderSize: (path: string) => Promise<void>;
  pendingScrollToEntryPath: Ref<string | null>;
  scrollToEntryPath: (path: string) => boolean;
  vfs: {
    getMetadata: (path: string) => Promise<{ kind: string } | null | undefined>;
  };
  readDirectory: (path: string | undefined) => Promise<FsEntry[]>;
}) {
  const fileManagerStore = inject('fileManagerStore') as ReturnType<typeof useFileManagerStore> || useFileManagerStore();
  const projectStore = useProjectStore();
  const uiStore = useUiStore();

  const parentFolders = ref<FsEntry[]>([]);

  async function loadFolderContent() {
    const savedScrollTop = pendingScrollToEntryPath.value
      ? (rootContainer.value?.scrollTop ?? null)
      : null;

    if (await loadRemoteFolderContent()) {
      return;
    }

    if (!fileManagerStore.selectedFolder) {
      folderEntries.value = [];
      return;
    }

    try {
      const path = fileManagerStore.selectedFolder.path || '';
      let entries = await readDirectory(path);

      if (!path) {
        const commonMetadata = await vfs.getMetadata(WORKSPACE_COMMON_PATH_PREFIX);
        if (commonMetadata?.kind === 'directory') {
          const commonEntry: FsEntry = {
            kind: 'directory',
            name: WORKSPACE_COMMON_DIR_NAME,
            path: WORKSPACE_COMMON_PATH_PREFIX,
          };
          entries = [
            commonEntry,
            ...entries.filter((entry) => entry.path !== WORKSPACE_COMMON_PATH_PREFIX),
          ];
        }
      }

      const filteredEntries = entries.filter(
        (e) => uiStore.showHiddenFiles || !e.name.startsWith('.'),
      );
      folderEntries.value = await supplementEntries(filteredEntries);
    } catch (error) {
      console.error('Failed to load folder content:', error);
      folderEntries.value = [];
    }

    if (savedScrollTop !== null) {
      await nextTick();
      if (rootContainer.value && pendingScrollToEntryPath.value) {
        rootContainer.value.scrollTop = savedScrollTop;
      }
    }
  }

  async function loadParentFolders() {
    parentFolders.value = [];

    if (loadRemoteParentFolders(parentFolders)) return;

    const selectedFolderPath = fileManagerStore.selectedFolder?.path;

    // Add project root as the first breadcrumb if not in remote mode and not in common workspace
    const isInCommon = selectedFolderPath?.startsWith(WORKSPACE_COMMON_PATH_PREFIX);
    if (!isRemoteMode.value && !isInCommon) {
      parentFolders.value.push({
        kind: 'directory',
        name: projectStore.currentProjectName || 'Project',
        path: '',
      });
    }

    if (!selectedFolderPath) return;

    if (selectedFolderPath === WORKSPACE_COMMON_PATH_PREFIX) {
      parentFolders.value.push({
        kind: 'directory',
        name: WORKSPACE_COMMON_DIR_NAME,
        path: WORKSPACE_COMMON_PATH_PREFIX,
      });
      return;
    }

    if (selectedFolderPath.startsWith(`${WORKSPACE_COMMON_PATH_PREFIX}/`)) {
      let currentPath = WORKSPACE_COMMON_PATH_PREFIX;
      parentFolders.value.push({
        kind: 'directory',
        name: WORKSPACE_COMMON_DIR_NAME,
        path: WORKSPACE_COMMON_PATH_PREFIX,
      });
      const pathParts = stripWorkspaceCommonPathPrefix(selectedFolderPath)
        .split('/')
        .filter(Boolean);
      for (const part of pathParts) {
        currentPath = `${currentPath}/${part}`;
        parentFolders.value.push({ kind: 'directory', name: part, path: currentPath });
      }
      return;
    }

    const pathParts = selectedFolderPath.split('/').filter(Boolean);
    let currentPath = '';
    for (const part of pathParts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      parentFolders.value.push({ kind: 'directory', name: part, path: currentPath });
    }
  }

  function navigateToParentByIndex(parentIndex: number): void {
    const target = parentFolders.value[parentIndex];
    if (!target) return;

    if (isRemoteMode.value && isRemoteFsEntry(target)) {
      remoteCurrentFolder.value = target as RemoteFsEntry;
      void loadFolderContent();
      void loadParentFolders();
      return;
    }

    fileManagerStore.openFolder(target as FsEntry);
  }

  async function navigateToRoot() {
    if (isRemoteMode.value) {
      remoteCurrentFolder.value = buildRemoteDirectoryEntry('/');
      await loadFolderContent();
      await loadParentFolders();
      return;
    }
    const rootEntry: FsEntry = {
      kind: 'directory',
      name: projectStore.currentProjectName || '',
      path: '',
    };
    fileManagerStore.openFolder(rootEntry);
  }

  function navigateBack(): void {
    if (parentFolders.value.length > 1) {
      navigateToParentByIndex(parentFolders.value.length - 2);
    } else {
      void navigateToRoot();
    }
  }

  function navigateUp(): void {
    if (parentFolders.value.length > 1) {
      navigateToParentByIndex(parentFolders.value.length - 2);
    } else if (parentFolders.value.length === 1) {
      void navigateToRoot();
    }
  }

  function navigateToFolder(index: number): void {
    const targetFolder = parentFolders.value[index];
    if (!targetFolder) return;

    if (isRemoteMode.value && isRemoteFsEntry(targetFolder)) {
      remoteCurrentFolder.value = targetFolder as RemoteFsEntry;
      void loadFolderContent();
      void loadParentFolders();
      return;
    }

    fileManagerStore.openFolder(targetFolder as FsEntry);
  }

  function tryScrollToPendingEntry() {
    requestAnimationFrame(() => {
      if (!pendingScrollToEntryPath.value) return;
      if (!scrollToEntryPath(pendingScrollToEntryPath.value)) return;
      pendingScrollToEntryPath.value = null;
    });
  }

  // Reload on hidden files toggle
  watch(
    () => uiStore.showHiddenFiles,
    async () => {
      await loadFolderContent();
    },
  );

  // Reload on folder selection change
  watch(
    () => fileManagerStore.selectedFolder,
    async () => {
      if (isRemoteMode.value) return;
      await loadFolderContent();
      await loadParentFolders();

      if (!pendingScrollToEntryPath.value) return;

      const targetPath = pendingScrollToEntryPath.value;
      const selectedFolderPath = fileManagerStore.selectedFolder?.path ?? '';
      const targetParentPath = targetPath.split('/').slice(0, -1).join('/');

      if (targetParentPath !== selectedFolderPath) return;

      await nextTick();
      tryScrollToPendingEntry();
    },
    { immediate: true },
  );

  // Watch selected entry for folder size + scroll
  watch(
    () => uiStore.selectedFsEntry,
    (entry) => {
      if (isRemoteMode.value) {
        if (entry?.kind === 'file' && entry.path) {
          pendingScrollToEntryPath.value = entry.path;
        }
        return;
      }

      if (entry && entry.kind === 'directory' && entry.path) {
        void calculateFolderSize(entry.path);
      }

      if (entry?.kind === 'file' && entry.path) {
        pendingScrollToEntryPath.value = entry.path;

        const selectedFolderPath = fileManagerStore.selectedFolder?.path ?? '';
        const targetParentPath = entry.path.split('/').slice(0, -1).join('/');
        if (targetParentPath === selectedFolderPath) {
          requestAnimationFrame(() => {
            if (!pendingScrollToEntryPath.value) return;
            if (!scrollToEntryPath(pendingScrollToEntryPath.value)) return;
            pendingScrollToEntryPath.value = null;
          });
        }
      }
    },
    { immediate: true },
  );

  return {
    parentFolders,
    loadFolderContent,
    loadParentFolders,
    navigateBack,
    navigateUp,
    navigateToFolder,
    navigateToRoot,
    tryScrollToPendingEntry,
  };
}
