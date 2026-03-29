import type { FsEntry } from '~/types/fs';
import { useSelectionStore } from '~/stores/selection.store';
import { useUiStore } from '~/stores/ui.store';
import {
  createTimelineCommand,
  createMarkdownCommand,
} from '~/file-manager/application/fileManagerCommands';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';

export interface FileBrowserCreateActionsOptions {
  vfs: IFileSystemAdapter;
  readDirectory: (path?: string) => Promise<FsEntry[]>;
  reloadDirectory: (path: string) => Promise<void>;
  loadFolderContent: () => Promise<void>;
  findEntryByPath: (path: string) => FsEntry | null;
}

export function useFileBrowserCreateActions({
  vfs,
  readDirectory,
  reloadDirectory,
  loadFolderContent,
  findEntryByPath,
}: FileBrowserCreateActionsOptions) {
  const selectionStore = useSelectionStore();
  const uiStore = useUiStore();

  async function createTimelineInDirectory(entry: FsEntry) {
    if (entry.kind !== 'directory') return;
    const existingInFolder = await readDirectory(entry.path);
    const existingNames = existingInFolder.map((e) => e.name);
    const createdPath = await createTimelineCommand({
      vfs: vfs as any,
      timelinesDirName: entry.path || undefined,
      existingNames,
    });
    await reloadDirectory(entry.path || '');
    uiStore.notifyFileManagerUpdate();
    await loadFolderContent();
    const createdEntry = createdPath ? findEntryByPath(createdPath) : null;
    if (createdEntry) selectionStore.selectFsEntry(createdEntry);
  }

  async function createMarkdownInDirectory(entry: FsEntry) {
    if (entry.kind !== 'directory') return;
    if (entry.path) {
      uiStore.setFileTreePathExpanded(entry.path, true);
    }
    const existingInFolder = await readDirectory(entry.path);
    const existingNames = existingInFolder.map((e) => e.name);
    const createdFileName = await createMarkdownCommand({
      vfs,
      dirPath: entry.path,
      existingNames,
    });
    await reloadDirectory(entry.path || '');
    uiStore.notifyFileManagerUpdate();
    await loadFolderContent();
    const createdPath = entry.path ? `${entry.path}/${createdFileName}` : createdFileName;
    const createdEntry = createdPath ? findEntryByPath(createdPath) : null;
    if (createdEntry) selectionStore.selectFsEntry(createdEntry);
  }

  return {
    createTimelineInDirectory,
    createMarkdownInDirectory,
  };
}
