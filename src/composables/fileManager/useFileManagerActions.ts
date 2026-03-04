import { ref, computed } from 'vue';
import { useUiStore } from '~/stores/ui.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import type { FsEntry } from '~/types/fs';
import type { ProxyThumbnailService } from '~/media-cache/application/proxyThumbnailService';
import {
  cancelProxyCommand,
  ensureProxyCommand,
  removeProxyCommand,
} from '~/media-cache/application/proxyThumbnailCommands';

export type FileAction =
  | 'createFolder'
  | 'upload'
  | 'rename'
  | 'delete'
  | 'deleteProxy'
  | 'createProxy'
  | 'cancelProxy'
  | 'openInNewTab';

interface FileManagerActions {
  createFolder: (name: string, target?: FileSystemDirectoryHandle | null) => Promise<void>;
  renameEntry: (target: FsEntry, newName: string) => Promise<void>;
  deleteEntry: (target: FsEntry) => Promise<void>;
  loadProjectDirectory: () => Promise<void>;
  handleFiles: (
    files: File[],
    targetDirHandle?: FileSystemDirectoryHandle,
    targetDirPath?: string,
  ) => Promise<void>;
  mediaCache: Pick<ProxyThumbnailService, 'ensureProxy' | 'cancelProxy' | 'removeProxy'>;
  onAfterRename?: () => void;
  onAfterDelete?: () => void;
}

export function useFileManagerActions(actions: FileManagerActions) {
  const { t } = useI18n();
  const uiStore = useUiStore();
  const selectionStore = useSelectionStore();
  const timelineMediaUsageStore = useTimelineMediaUsageStore();

  const isDeleteConfirmModalOpen = ref(false);
  const deleteTarget = ref<FsEntry | null>(null);

  const directoryUploadTarget = ref<FsEntry | null>(null);
  const directoryUploadInput = ref<HTMLInputElement | null>(null);

  const editingEntryPath = ref<string | null>(null);

  const timelinesUsingDeleteTarget = computed(() => {
    const entry = deleteTarget.value;
    if (!entry || entry.kind !== 'file' || !entry.path) return [];
    return timelineMediaUsageStore.mediaPathToTimelines[entry.path] ?? [];
  });

  function startRename(entry: FsEntry) {
    editingEntryPath.value = entry.path ?? null;
  }

  function stopRename() {
    editingEntryPath.value = null;
  }

  async function commitRename(entry: FsEntry, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === entry.name) {
      stopRename();
      return;
    }

    await actions.renameEntry(entry, trimmed);
    stopRename();
    actions.onAfterRename?.();
  }

  async function handleCreateAutoFolder(
    targetDirHandle: FileSystemDirectoryHandle | null,
    targetDirPath: string,
    existingNames: string[],
  ) {
    const usedNames = new Set(existingNames);
    if (targetDirHandle) {
      try {
        const iterator =
          (targetDirHandle as any).values?.() ?? (targetDirHandle as any).entries?.();
        if (iterator) {
          for await (const value of iterator) {
            const handle = (Array.isArray(value) ? value[1] : value) as FileSystemHandle;
            usedNames.add(handle.name);
          }
        }
      } catch {
        // ignore and fallback to existing names snapshot
      }
    }

    const baseName = t('common.folderBaseName', 'Папка');
    let index = 1;
    let newName = '';
    do {
      newName = `${baseName}_${index.toString().padStart(3, '0')}`;
      index++;
    } while (usedNames.has(newName));

    await actions.createFolder(newName, targetDirHandle);

    const createdPath = targetDirPath ? `${targetDirPath}/${newName}` : newName;

    // Set editing path so it opens rename mode automatically
    editingEntryPath.value = createdPath;
  }

  function openDeleteConfirmModal(entry: FsEntry) {
    deleteTarget.value = entry;
    isDeleteConfirmModalOpen.value = true;
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget.value) return;
    const deletePath = deleteTarget.value.path;
    await actions.deleteEntry(deleteTarget.value);

    if (deletePath && uiStore.selectedFsEntry?.path === deletePath) {
      uiStore.selectedFsEntry = null;
    }

    if (
      selectionStore.selectedEntity?.source === 'fileManager' &&
      (selectionStore.selectedEntity.path
        ? selectionStore.selectedEntity.path === deletePath
        : selectionStore.selectedEntity.name === deleteTarget.value.name)
    ) {
      selectionStore.clearSelection();
    }

    actions.onAfterDelete?.();

    setTimeout(() => {
      isDeleteConfirmModalOpen.value = false;
      setTimeout(() => {
        deleteTarget.value = null;
      }, 300);
    }, 0);
  }

  function onFileAction(action: FileAction, entry: FsEntry, getExistingNames?: () => string[]) {
    if (action === 'createFolder') {
      const existingNames = getExistingNames
        ? getExistingNames()
        : entry.children?.map((c) => c.name) || [];
      void handleCreateAutoFolder(
        entry.kind === 'directory' ? (entry.handle as FileSystemDirectoryHandle) : null,
        entry.path ?? '',
        existingNames,
      );
    } else if (action === 'upload') {
      if (entry.kind !== 'directory') return;
      directoryUploadTarget.value = entry;
      directoryUploadInput.value?.click();
    } else if (action === 'rename') {
      startRename(entry);
    } else if (action === 'delete') {
      openDeleteConfirmModal(entry);
    } else if (action === 'createProxy') {
      if (entry.kind !== 'file' || !entry.path) return;
      void ensureProxyCommand({
        service: actions.mediaCache,
        fileHandle: entry.handle as FileSystemFileHandle,
        projectRelativePath: entry.path!,
      });
    } else if (action === 'cancelProxy') {
      if (entry.kind === 'file' && entry.path) {
        void cancelProxyCommand({ service: actions.mediaCache, projectRelativePath: entry.path });
      }
    } else if (action === 'deleteProxy') {
      if (entry.kind === 'file' && entry.path) {
        void removeProxyCommand({ service: actions.mediaCache, projectRelativePath: entry.path });
      }
    }
  }

  return {
    isDeleteConfirmModalOpen,
    deleteTarget,
    timelinesUsingDeleteTarget,
    directoryUploadTarget,
    directoryUploadInput,
    editingEntryPath,
    startRename,
    stopRename,
    commitRename,
    handleCreateAutoFolder,
    openDeleteConfirmModal,
    handleDeleteConfirm,
    onFileAction,
  };
}
