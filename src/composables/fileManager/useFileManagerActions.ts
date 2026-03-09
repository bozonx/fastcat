import { ref, computed } from 'vue';
import { useUiStore } from '~/stores/ui.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { useProjectStore } from '~/stores/project.store';
import type { FsEntry } from '~/types/fs';
import type { ProxyThumbnailService } from '~/media-cache/application/proxyThumbnailService';
import { generateUniqueFsEntryName, type FsDirectoryHandleWithIteration } from '~/utils/fs';
import { isWorkspaceCommonPath, stripWorkspaceCommonPathPrefix } from '~/utils/workspace-common';
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
  getWorkspaceCommonDirHandle: (create?: boolean) => Promise<FileSystemDirectoryHandle | null>;
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

    const root = isWorkspaceCommonPath(entry.path)
      ? await actions.getWorkspaceCommonDirHandle(false)
      : await actions.getProjectRootDirHandle();
    if (!root) return null;

    const normalizedPath = isWorkspaceCommonPath(entry.path)
      ? stripWorkspaceCommonPathPrefix(entry.path)
      : entry.path;
    const parts = normalizedPath.split('/').slice(0, -1);
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
      if (newEntry.kind === 'directory') {
        actions.onFileSelect?.(newEntry);
      }
    }
  }

  function openDeleteConfirmModal(entries: FsEntry[]) {
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
      await handleCreateAutoFolder(
        e.kind === 'directory' ? (e.handle as FileSystemDirectoryHandle) : null,
        e.path ?? '',
        existingNames,
      );
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
      openDeleteConfirmModal(entries);
    },
    createProxy: async (entry) => {
      const entries = Array.isArray(entry) ? entry : [entry];
      for (const e of entries) {
        if (e.kind !== 'file' || !e.path) continue;
        await actions.mediaCache.ensureProxy({
          fileHandle: e.handle as FileSystemFileHandle,
          projectRelativePath: e.path!,
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
