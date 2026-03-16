import { ref, computed } from 'vue';
import { useUiStore } from '~/stores/ui.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { useProjectStore } from '~/stores/project.store';
import type { FsEntry } from '~/types/fs';
import type { ProxyThumbnailService } from '~/media-cache/application/proxyThumbnailService';
import { generateUniqueFsEntryName } from '~/utils/fs';
import { createMarkdownCommand } from '~/file-manager/application/fileManagerCommands';
import { useProjectTabsStore } from '~/stores/tabs.store';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';

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
  createFolder: (name: string, parentPath?: string) => Promise<void>;
  renameEntry: (target: FsEntry, newName: string) => Promise<void>;
  deleteEntry: (target: FsEntry) => Promise<void>;
  loadProjectDirectory: (params?: { fullRefresh?: boolean }) => Promise<void>;
  handleFiles: (files: File[], targetDirPath?: string) => Promise<void>;
  mediaCache: Pick<ProxyThumbnailService, 'ensureProxy' | 'cancelProxy' | 'removeProxy'>;
  vfs: IFileSystemAdapter;
  findEntryByPath: (path: string) => FsEntry | null;
  readDirectory: (path?: string) => Promise<FsEntry[]>;
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
  const workspaceStore = useWorkspaceStore();
  const { removeFileTabByPath } = useProjectTabsStore();

  const isDeleteConfirmModalOpen = ref(false);
  const deleteTargets = ref<FsEntry[]>([]);

  const directoryUploadTarget = ref<FsEntry | null>(null);
  const directoryUploadInput = ref<HTMLInputElement | null>(null);

  const editingEntryPath = ref<string | null>(null);

  const timelinesUsingDeleteTarget = computed(() => {
    return deleteTargets.value.flatMap((entry) => {
      if (entry.kind !== 'file' || !entry.path) return [];
      return timelineMediaUsageStore.mediaPathToTimelines[entry.path] ?? [];
    });
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

  async function handleCreateAutoFolder(targetDirPath: string, existingNames: string[]) {
    const usedNames = new Set(existingNames);

    const baseName = t('common.folderBaseName', 'Folder');
    let index = 1;
    let newName = '';
    do {
      newName = `${baseName}_${index.toString().padStart(3, '0')}`;
      index++;
    } while (usedNames.has(newName));

    await actions.createFolder(newName, targetDirPath);

    const createdPath = targetDirPath ? `${targetDirPath}/${newName}` : newName;

    const createdEntry = actions.findEntryByPath(createdPath);
    if (createdEntry) {
      uiStore.selectedFsEntry = {
        kind: createdEntry.kind,
        name: createdEntry.name,
        path: createdEntry.path,
      };
      selectionStore.selectFsEntry(createdEntry);
      actions.onFileSelect?.(createdEntry);
    }

    // Set editing path so it opens rename mode automatically
    editingEntryPath.value = createdPath;
  }

  async function createOtioVersion(entry: FsEntry) {
    if (entry.kind !== 'file') return;
    if (!entry.name.toLowerCase().endsWith('.otio')) return;

    const parentPath = entry.parentPath ?? entry.path.split('/').slice(0, -1).join('/');

    const existingNames = await actions.vfs.listEntryNames(parentPath);

    const match = entry.name.slice(0, -'.otio'.length).match(/^(.*)_([0-9]{3})$/);
    const prefix = match ? match[1] : entry.name.slice(0, -'.otio'.length);
    const start = match ? Number(match[2]) + 1 : 1;

    const nextName = await generateUniqueFsEntryName({
      vfs: actions.vfs,
      dirPath: parentPath,
      baseName: prefix + '_',
      extension: '.otio',
      existingNames,
      startIndex: start,
    });

    const nextPath = parentPath ? `${parentPath}/${nextName}` : nextName;
    await actions.vfs.copyFile(entry.path, nextPath);

    await actions.loadProjectDirectory();

    const newEntry = actions.findEntryByPath(nextPath);
    if (newEntry) {
      uiStore.selectedFsEntry = {
        kind: newEntry.kind,
        name: newEntry.name,
        path: newEntry.path,
      };
      selectionStore.selectFsEntry(newEntry);
    }
  }

  async function createMarkdownInDirectory(entry: FsEntry) {
    if (entry.path) {
      actions.setFileTreePathExpanded?.(entry.path, true);
    }

    const existingInFolder = await actions.readDirectory(entry.path);
    const existingNames = existingInFolder.map((e) => e.name);

    const createdFileName = await createMarkdownCommand({
      vfs: actions.vfs,
      dirPath: entry.path,
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
      };
      selectionStore.selectFsEntry(newEntry);
      if (newEntry.kind === 'directory') {
        actions.onFileSelect?.(newEntry);
      }
    }
  }

  async function openDeleteConfirmModal(entries: FsEntry[]) {
    if (workspaceStore.userSettings.deleteWithoutConfirmation) {
      deleteTargets.value = entries;
      await handleDeleteConfirm();
      return;
    }
    deleteTargets.value = entries;
    isDeleteConfirmModalOpen.value = true;
  }

  async function handleDeleteConfirm() {
    if (deleteTargets.value.length === 0) return;

    const pathsToDelete = new Set(deleteTargets.value.map((t) => t.path).filter(Boolean));
    const namesToDelete = new Set(deleteTargets.value.map((t) => t.name));

    for (const target of deleteTargets.value) {
      await actions.deleteEntry(target);
    }

    if (uiStore.selectedFsEntry?.path && pathsToDelete.has(uiStore.selectedFsEntry.path)) {
      uiStore.selectedFsEntry = null;
    }

    const sel = selectionStore.selectedEntity;
    if (sel?.source === 'fileManager') {
      let shouldClear = false;
      if (sel.kind === 'multiple') {
        shouldClear = sel.entries.some((e) =>
          e.path ? pathsToDelete.has(e.path) : namesToDelete.has(e.name),
        );
      } else {
        shouldClear = sel.path ? pathsToDelete.has(sel.path) : namesToDelete.has(sel.name);
      }
      if (shouldClear) {
        selectionStore.clearSelection();
      }
    }

    for (const path of pathsToDelete) {
      if (path?.toLowerCase().endsWith('.otio')) {
        if (projectStore.currentTimelinePath === path) {
          await projectStore.closeTimelineFile(path);
        }
        removeFileTabByPath(path);
      }
    }

    actions.onAfterDelete?.();

    setTimeout(() => {
      isDeleteConfirmModalOpen.value = false;
      setTimeout(() => {
        deleteTargets.value = [];
      }, 300);
    }, 0);
  }

  const fileActionHandlers: Record<
    string,
    (entry: FsEntry | FsEntry[], getExistingNames?: () => string[]) => void | Promise<void>
  > = {
    createFolder: async (entry, getExistingNames) => {
      const e = Array.isArray(entry) ? entry[0] : entry;
      if (!e) return;
      const existingNames = getExistingNames
        ? getExistingNames()
        : e.children?.map((c) => c.name) || [];
      await handleCreateAutoFolder(e.path, existingNames);
    },
    upload: (entry) => {
      const e = Array.isArray(entry) ? entry[0] : entry;
      if (!e || e.kind !== 'directory') return;
      directoryUploadTarget.value = e;
      directoryUploadInput.value?.click();
    },
    rename: (entry) => {
      const e = Array.isArray(entry) ? entry[0] : entry;
      if (e) startRename(e);
    },
    delete: (entry) => {
      const entries = Array.isArray(entry) ? entry : [entry];
      void openDeleteConfirmModal(entries);
    },
    createProxy: async (entry) => {
      const entries = Array.isArray(entry) ? entry : [entry];
      for (const e of entries) {
        if (e.kind !== 'file' || !e.path) continue;
        const file = await actions.vfs.getFile(e.path);
        if (!file) continue;
        await actions.mediaCache.ensureProxy({
          file,
          projectRelativePath: e.path,
        });
      }
    },
    cancelProxy: async (entry) => {
      const entries = Array.isArray(entry) ? entry : [entry];
      for (const e of entries) {
        if (e.kind === 'file' && e.path) {
          await actions.mediaCache.cancelProxy(e.path);
        }
      }
    },
    deleteProxy: async (entry) => {
      const entries = Array.isArray(entry) ? entry : [entry];
      for (const e of entries) {
        if (e.kind === 'file' && e.path) {
          await actions.mediaCache.removeProxy(e.path);
        }
      }
    },
    createOtioVersion: async (entry) => {
      const e = Array.isArray(entry) ? entry[0] : entry;
      if (e) await createOtioVersion(e);
    },
    createMarkdown: async (entry) => {
      const e = Array.isArray(entry) ? entry[0] : entry;
      if (e && e.kind === 'directory') {
        await createMarkdownInDirectory(e);
      }
    },
  };

  async function onFileAction(
    action: FileAction,
    entry: FsEntry | FsEntry[],
    getExistingNames?: () => string[],
  ) {
    const handler = fileActionHandlers[action];
    if (handler) {
      await handler(entry, getExistingNames);
    } else {
      console.warn(`[useFileManagerActions] Unhandled file action: ${action}`);
    }
  }

  return {
    isDeleteConfirmModalOpen,
    deleteTargets,
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
