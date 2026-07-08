import type { FsEntry } from '~/types/fs';
import { useSelectionStore } from '~/stores/selection.store';
import { useUiStore } from '~/stores/ui.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import {
  createTimelineCommand,
  createMarkdownCommand,
} from '~/file-manager/application/fileManagerCommands';
import { createTimelineFormatFromProjectDefaults } from '~/timeline/format';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';

export interface FileBrowserCreateActionsOptions {
  vfs: IFileSystemAdapter;
  readDirectory: (path?: string) => Promise<FsEntry[]>;
  reloadDirectory: (path: string) => Promise<void>;
  loadFolderContent: () => Promise<void>;
  findEntryByPath: (path: string) => FsEntry | null;
  instanceId?: string | null;
  onFileSelect?: (entry: FsEntry) => void;
}

export function useFileBrowserCreateActions({
  vfs,
  readDirectory,
  reloadDirectory,
  loadFolderContent,
  findEntryByPath,
  instanceId,
  onFileSelect,
}: FileBrowserCreateActionsOptions) {
  const selectionStore = useSelectionStore();
  const uiStore = useUiStore();
  const projectStore = useProjectStore();
  const timelineStore = useTimelineStore();
  const timelineMediaUsageStore = useTimelineMediaUsageStore();

  async function createTimelineInDirectory(entry: FsEntry) {
    if (entry.kind !== 'directory') return;
    const existingInFolder = await readDirectory(entry.path);
    const existingNames = existingInFolder.map((e) => e.name);
    const createdPath = await createTimelineCommand({
      vfs,
      timelinesDirName: entry.path || undefined,
      existingNames,
      format: createTimelineFormatFromProjectDefaults(projectStore.projectSettings.project),
    });
    await reloadDirectory(entry.path || '');
    uiStore.notifyFileManagerUpdate();
    await loadFolderContent();
    const createdEntry = createdPath ? findEntryByPath(createdPath) : null;
    if (createdEntry) {
      if (onFileSelect) onFileSelect(createdEntry);
      else selectionStore.selectFsEntry(createdEntry, instanceId ?? undefined);
    }
    await projectStore.openTimelineFile(createdPath);
    await timelineStore.loadTimeline();
    void timelineMediaUsageStore.refreshUsage();
    void timelineStore.loadTimelineMetadata();
  }

  async function createMarkdownInDirectory(entry: FsEntry) {
    if (entry.kind !== 'directory') return;
    if (entry.path) {
      uiStore.setFileTreePathExpanded(entry.path, true);
    }
    const existingInFolder = await readDirectory(entry.path);
    const existingNames = existingInFolder.map((e) => e.name);
    const createdPath = await createMarkdownCommand({
      vfs,
      dirPath: entry.path,
      existingNames,
    });
    await reloadDirectory(entry.path || '');
    uiStore.notifyFileManagerUpdate();
    await loadFolderContent();
    const createdEntry = createdPath ? findEntryByPath(createdPath) : null;
    if (createdEntry) {
      if (onFileSelect) onFileSelect(createdEntry);
      else selectionStore.selectFsEntry(createdEntry, instanceId ?? undefined);
    }
  }

  return {
    createTimelineInDirectory,
    createMarkdownInDirectory,
  };
}
