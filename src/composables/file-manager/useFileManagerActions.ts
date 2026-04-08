import { ref, computed, inject } from 'vue';
import { useUiStore } from '~/stores/ui.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useFocusStore } from '~/stores/focus.store';
import { useAppClipboard } from '~/composables/useAppClipboard';
import type { FsEntry } from '~/types/fs';
import type { ProxyThumbnailService } from '~/media-cache/application/proxyThumbnailService';
import { generateUniqueFsEntryName } from '~/utils/fs';
import { createMarkdownCommand } from '~/file-manager/application/fileManagerCommands';
import { DOCUMENTS_DIR_NAME } from '~/utils/constants';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useProjectTabsStore } from '~/stores/project-tabs.store';
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
  | 'openAsProjectTab'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'transcribe';

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
  copyEntry?: (params: { source: FsEntry; targetDirPath: string }) => Promise<unknown>;
  moveEntry?: (params: { source: FsEntry; targetDirPath: string }) => Promise<unknown>;
}

export function useFileManagerActions(actions: FileManagerActions) {
  const fileManagerStore =
    (inject('fileManagerStore', null) as ReturnType<typeof useFileManagerStore> | null) ||
    useFileManagerStore();
  const { t } = useI18n();
  const toast = useToast();
  const uiStore = useUiStore();
  const selectionStore = useSelectionStore();
  const timelineMediaUsageStore = useTimelineMediaUsageStore();
  const projectStore = useProjectStore();
  const timelineStore = useTimelineStore();
  const workspaceStore = useWorkspaceStore();
  const focusStore = useFocusStore();
  const { removeFileTabByPath } = useProjectTabsStore();
  const clipboardStore = useAppClipboard();

  const isDeleteConfirmModalOpen = ref(false);
  const deleteTargets = ref<FsEntry[]>([]);

  const isCreateFolderModalOpen = ref(false);
  const pendingCreateFolderParent = ref<FsEntry | null>(null);
  const createFolderDefaultName = ref('');

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
    const parentPath = entry.parentPath ?? entry.path?.split('/').slice(0, -1).join('') ?? '';
    await actions.reloadDirectory(parentPath);
    stopRename();
    actions.onAfterRename?.();

    // Re-select renamed entry to update UI and property panel
    const newPath = parentPath ? `${parentPath}/${trimmed}` : trimmed;
    const newEntry = actions.findEntryByPath(newPath);
    if (newEntry) {
      actions.onFileSelect?.(newEntry);
    }
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

    createFolderDefaultName.value = newName;
    pendingCreateFolderParent.value = actions.findEntryByPath(targetDirPath) || {
      kind: 'directory',
      name: '',
      path: targetDirPath,
    } as FsEntry;
    isCreateFolderModalOpen.value = true;
  }

  async function confirmCreateFolder(name: string) {
    if (!pendingCreateFolderParent.value) return;
    
    const targetDirPath = pendingCreateFolderParent.value.path || '';
    const trimmed = name.trim();
    if (!trimmed) return;

    await actions.createFolder(trimmed, targetDirPath);
    
    const createdPath = targetDirPath ? `${targetDirPath}/${trimmed}` : trimmed;
    await actions.reloadDirectory(targetDirPath);
    
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

    isCreateFolderModalOpen.value = false;
    pendingCreateFolderParent.value = null;
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
    actions.notifyFileManagerUpdate?.();

    const newEntry = actions.findEntryByPath(nextPath);
    if (newEntry) {
      uiStore.selectedFsEntry = {
        kind: newEntry.kind,
        name: newEntry.name,
        path: newEntry.path,
      };
      selectionStore.selectFsEntry(newEntry);

      // Open the newly created version
      await projectStore.openTimelineFile(newEntry.path);
      focusStore.setActiveTimelinePath(newEntry.path);
      await timelineStore.loadTimeline();
      void timelineStore.loadTimelineMetadata();

      toast.add({
        title: t('videoEditor.timeline.versionCreated', { name: nextName }),
        color: 'success',
      });
    }
  }

  async function createMarkdownInDirectory(targetDir?: string) {
    const dirPath = targetDir ?? DOCUMENTS_DIR_NAME;
    if (dirPath) {
      await actions.vfs.createDirectory(dirPath);
      actions.setFileTreePathExpanded?.(dirPath, true);
    }

    const existingInFolder = await actions.readDirectory(dirPath);
    const existingNames = existingInFolder.map((e) => e.name);

    const fullPath = await createMarkdownCommand({
      vfs: actions.vfs,
      dirPath,
      existingNames,
    });

    await actions.reloadDirectory(dirPath);
    actions.notifyFileManagerUpdate?.();

    const newEntry = actions.findEntryByPath(fullPath);
    if (newEntry) {
      // Expand and open documents folder
      const dirEntry = actions.findEntryByPath(dirPath);
      if (dirEntry) {
        fileManagerStore.openFolder(dirEntry);
      }

      // Select and scroll to new file
      setTimeout(() => {
        uiStore.selectedFsEntry = {
          kind: newEntry.kind,
          name: newEntry.name,
          path: newEntry.path,
        };
        selectionStore.selectFsEntry(newEntry);
        uiStore.triggerScrollToFileTreeEntry(newEntry.path);
      }, 50);
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
      const currentFolder = fileManagerStore.selectedFolder;
      if (currentFolder) {
        actions.onFileSelect?.(currentFolder);
      } else {
        uiStore.selectedFsEntry = null;
        selectionStore.clearSelection();
      }
    } else {
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
          const currentFolder = fileManagerStore.selectedFolder;
          if (currentFolder) {
            actions.onFileSelect?.(currentFolder);
          } else {
            selectionStore.clearSelection();
          }
        }
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
      await createMarkdownInDirectory(e?.kind === 'directory' ? e.path : undefined);
    },
    copy: (entry) => {
      const entries = Array.isArray(entry) ? entry : [entry];
      const validEntries = entries.filter((e) => typeof e.path === 'string');
      if (validEntries.length === 0) return;
      clipboardStore.setClipboardPayload({
        source: 'fileManager',
        operation: 'copy',
        items: validEntries.map((e) => ({
          path: e.path!,
          kind: e.kind,
          name: e.name,
        })),
      });
    },
    cut: (entry) => {
      const entries = Array.isArray(entry) ? entry : [entry];
      const validEntries = entries.filter((e) => typeof e.path === 'string');
      if (validEntries.length === 0) return;
      clipboardStore.setClipboardPayload({
        source: 'fileManager',
        operation: 'cut',
        items: validEntries.map((e) => ({
          path: e.path!,
          kind: e.kind,
          name: e.name,
        })),
      });
    },
    paste: async (entry) => {
      const payload = clipboardStore.clipboardPayload;
      if (!payload || payload.source !== 'fileManager' || payload.items.length === 0) return;

      const e = Array.isArray(entry) ? entry[0] : entry;
      let targetDirPath = '';
      if (e) {
        if (e.kind === 'directory') {
          targetDirPath = e.path ?? '';
        } else {
          targetDirPath = e.parentPath ?? (e.path ? e.path.split('/').slice(0, -1).join('/') : '');
        }
      }

      if (targetDirPath) {
        actions.setFileTreePathExpanded?.(targetDirPath, true);
      }

      const pastedPaths: string[] = [];
      for (const item of payload.items) {
        let source = actions.findEntryByPath(item.path);
        if (!source) {
          source = {
            path: item.path,
            kind: item.kind,
            name: item.name,
          } as FsEntry;
        }

        if (payload.operation === 'copy') {
          await actions.copyEntry?.({ source, targetDirPath });
        } else {
          await actions.moveEntry?.({ source, targetDirPath });
        }
        pastedPaths.push(targetDirPath ? `${targetDirPath}/${item.name}` : item.name);
      }

      if (payload.operation === 'cut') {
        clipboardStore.setClipboardPayload(null);
      }

      if (targetDirPath !== undefined) {
        await actions.reloadDirectory(targetDirPath);
      } else {
        await actions.loadProjectDirectory();
      }

      actions.notifyFileManagerUpdate?.();

      // Select pasted entries after directory reload
      setTimeout(() => {
        const entries = pastedPaths
          .map((path) => actions.findEntryByPath(path))
          .filter((e): e is FsEntry => !!e);
        if (entries.length > 0) {
          if (entries.length === 1 && entries[0]) {
            actions.onFileSelect?.(entries[0]);
          } else {
            selectionStore.selectFsEntries(entries);
          }
        }
      }, 50);
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
    isCreateFolderModalOpen,
    createFolderDefaultName,
    confirmCreateFolder,
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
