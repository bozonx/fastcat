import { ref, computed } from 'vue';
import { useUiStore } from '~/stores/ui.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { useProjectStore } from '~/stores/project.store';
import type { FsEntry } from '~/types/fs';
import type { ProxyThumbnailService } from '~/media-cache/application/proxyThumbnailService';
import { generateUniqueFsEntryName, type FsDirectoryHandleWithIteration } from '~/utils/fs';
import { createMarkdownCommand } from '~/file-manager/application/fileManagerCommands';
import { useProjectTabs } from '~/composables/project/useProjectTabs';

export type FileAction =
  | 'createFolder'
  | 'upload'
  | 'rename'
  | 'delete'
  | 'deleteProxy'
  | 'createProxy'
  | 'cancelProxy'
  | 'openInNewTab'
  | 'createOtioVersion'
  | 'createMarkdown'
  | 'createProxyForFolder'
  | 'cancelProxyForFolder'
  | 'convertFile'
  | 'openAsPanel'
  | 'openAsProjectTab';

interface FileManagerActions {
  createFolder: (
    name: string,
    target?: FileSystemDirectoryHandle | null,
    parentPath?: string,
  ) => Promise<void>;
  renameEntry: (target: FsEntry, newName: string) => Promise<void>;
  deleteEntry: (target: FsEntry) => Promise<void>;
  loadProjectDirectory: () => Promise<void>;
  handleFiles: (
    files: File[],
    targetDirHandle?: FileSystemDirectoryHandle,
    targetDirPath?: string,
  ) => Promise<void>;
  mediaCache: Pick<ProxyThumbnailService, 'ensureProxy' | 'cancelProxy' | 'removeProxy'>;
  getProjectRootDirHandle: () => Promise<FileSystemDirectoryHandle | null>;
  findEntryByPath: (path: string) => FsEntry | null;
  readDirectory: (dirHandle: FileSystemDirectoryHandle, basePath?: string) => Promise<FsEntry[]>;
  reloadDirectory: (path: string) => Promise<void>;
  notifyFileManagerUpdate?: () => void;
  setFileTreePathExpanded?: (path: string, expanded: boolean) => void;
  onAfterRename?: () => void;
  onAfterDelete?: () => void;
  onFileSelect?: (entry: FsEntry) => void;
}

export function useFileManagerActions(actions: FileManagerActions) {
  const { t } = useI18n();
  const uiStore = useUiStore();
  const selectionStore = useSelectionStore();
  const timelineMediaUsageStore = useTimelineMediaUsageStore();
  const projectStore = useProjectStore();
  const { removeFileTabByPath } = useProjectTabs();

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
        const handleWithIter = targetDirHandle as FsDirectoryHandleWithIteration;
        const iterator = handleWithIter.values?.() ?? handleWithIter.entries?.();
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

    await actions.createFolder(newName, targetDirHandle, targetDirPath);

    const createdPath = targetDirPath ? `${targetDirPath}/${newName}` : newName;

    const createdEntry = actions.findEntryByPath(createdPath);
    if (createdEntry) {
      uiStore.selectedFsEntry = {
        kind: createdEntry.kind,
        name: createdEntry.name,
        path: createdEntry.path,
        handle: createdEntry.handle,
      };
      selectionStore.selectFsEntry(createdEntry);
      actions.onFileSelect?.(createdEntry);
    }

    // Set editing path so it opens rename mode automatically
    editingEntryPath.value = createdPath;
  }

  async function resolveParentDirHandleForEntry(
    entry: FsEntry,
  ): Promise<FileSystemDirectoryHandle | null> {
    if (entry.parentHandle) return entry.parentHandle;
    if (!entry.path) return null;

    const root = await actions.getProjectRootDirHandle();
    if (!root) return null;

    const parts = entry.path.split('/').slice(0, -1);
    let dir: FileSystemDirectoryHandle = root;
    for (const p of parts) {
      if (!p) continue;
      dir = await dir.getDirectoryHandle(p);
    }
    return dir;
  }

  async function createOtioVersion(entry: FsEntry) {
    if (entry.kind !== 'file') return;
    if (!entry.name.toLowerCase().endsWith('.otio')) return;

    const parentDir = await resolveParentDirHandleForEntry(entry);
    if (!parentDir) return;

    const existing = new Set<string>();
    try {
      const handleWithIter = parentDir as FsDirectoryHandleWithIteration;
      const iterator = handleWithIter.values?.() ?? handleWithIter.entries?.();
      if (iterator) {
        for await (const value of iterator) {
          const h = (Array.isArray(value) ? value[1] : value) as FileSystemHandle;
          existing.add(h.name);
        }
      }
    } catch {
      // ignore
    }

    const match = entry.name.slice(0, -'.otio'.length).match(/^(.*)_([0-9]{3})$/);
    const prefix = match ? match[1] : entry.name.slice(0, -'.otio'.length);
    const start = match ? Number(match[2]) + 1 : 1;

    const nextName = await generateUniqueFsEntryName({
      dirHandle: parentDir,
      baseName: prefix + '_',
      extension: '.otio',
      existingNames: Array.from(existing),
      startIndex: start,
    });

    const file = await (entry.handle as FileSystemFileHandle).getFile();
    const nextHandle = await parentDir.getFileHandle(nextName, { create: true });
    const createWritable = (nextHandle as FileSystemFileHandle).createWritable;
    if (typeof createWritable !== 'function') return;

    const writable = await (nextHandle as FileSystemFileHandle).createWritable();
    await writable.write(file);
    await writable.close();

    await actions.loadProjectDirectory();

    const parentPath = entry.path ? entry.path.split('/').slice(0, -1).join('/') : '';
    const nextPath = parentPath ? `${parentPath}/${nextName}` : nextName;
    const newEntry = actions.findEntryByPath(nextPath);
    if (newEntry) {
      uiStore.selectedFsEntry = {
        kind: newEntry.kind,
        name: newEntry.name,
        path: newEntry.path,
        handle: newEntry.handle,
      };
      selectionStore.selectFsEntry(newEntry);
    }
  }

  async function createMarkdownInDirectory(entry: FsEntry) {
    const dirHandle = entry.handle as FileSystemDirectoryHandle;

    if (entry.path) {
      actions.setFileTreePathExpanded?.(entry.path, true);
    }

    const existingInFolder = await actions.readDirectory(dirHandle, entry.path);
    const existingNames = existingInFolder.map((e) => e.name);

    const createdFileName = await createMarkdownCommand({
      dirHandle,
      existingNames,
    });

    await actions.reloadDirectory(entry.path ?? '');
    actions.notifyFileManagerUpdate?.();

    const newPath = entry.path ? `${entry.path}/${createdFileName}` : createdFileName;
    const newEntry = actions.findEntryByPath(newPath);
    if (newEntry) {
      uiStore.selectedFsEntry = {
        kind: newEntry.kind,
        name: newEntry.name,
        path: newEntry.path,
        handle: newEntry.handle,
      };
      selectionStore.selectFsEntry(newEntry);
      actions.onFileSelect?.(newEntry);
    }
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

    if (deletePath?.toLowerCase().endsWith('.otio')) {
      if (projectStore.currentTimelinePath === deletePath) {
        await projectStore.closeTimelineFile(deletePath);
      }
      removeFileTabByPath(deletePath);
    }

    actions.onAfterDelete?.();

    setTimeout(() => {
      isDeleteConfirmModalOpen.value = false;
      setTimeout(() => {
        deleteTarget.value = null;
      }, 300);
    }, 0);
  }

  const fileActionHandlers: Record<
    string,
    (entry: FsEntry, getExistingNames?: () => string[]) => void | Promise<void>
  > = {
    createFolder: (entry, getExistingNames) => {
      const existingNames = getExistingNames
        ? getExistingNames()
        : entry.children?.map((c) => c.name) || [];
      void handleCreateAutoFolder(
        entry.kind === 'directory' ? (entry.handle as FileSystemDirectoryHandle) : null,
        entry.path ?? '',
        existingNames,
      );
    },
    upload: (entry) => {
      if (entry.kind !== 'directory') return;
      directoryUploadTarget.value = entry;
      directoryUploadInput.value?.click();
    },
    rename: (entry) => startRename(entry),
    delete: (entry) => openDeleteConfirmModal(entry),
    createProxy: (entry) => {
      if (entry.kind !== 'file' || !entry.path) return;
      void actions.mediaCache.ensureProxy({
        fileHandle: entry.handle as FileSystemFileHandle,
        projectRelativePath: entry.path!,
      });
    },
    cancelProxy: (entry) => {
      if (entry.kind === 'file' && entry.path) {
        void actions.mediaCache.cancelProxy(entry.path);
      }
    },
    deleteProxy: (entry) => {
      if (entry.kind === 'file' && entry.path) {
        void actions.mediaCache.removeProxy(entry.path);
      }
    },
    createOtioVersion: (entry) => void createOtioVersion(entry),
    createMarkdown: (entry) => {
      if (entry.kind === 'directory') {
        void createMarkdownInDirectory(entry);
      }
    },
  };

  function onFileAction(action: FileAction, entry: FsEntry, getExistingNames?: () => string[]) {
    const handler = fileActionHandlers[action];
    if (handler) {
      void handler(entry, getExistingNames);
    } else {
      console.warn(`[useFileManagerActions] Unhandled file action: ${action}`);
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
