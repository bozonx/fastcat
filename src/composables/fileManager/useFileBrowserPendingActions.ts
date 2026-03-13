import { watch } from 'vue';
import type { Ref } from 'vue';
import type { FsEntry } from '~/types/fs';
import { useUiStore } from '~/stores/ui.store';

export interface FileBrowserPendingActionsOptions {
  folderEntries: Ref<FsEntry[]>;
  startRename: (entry: FsEntry) => void;
  createTimelineInDirectory: (entry: FsEntry) => Promise<void>;
  createMarkdownInDirectory: (entry: FsEntry) => Promise<void>;
  handlePendingRemoteDownloadRequest: () => Promise<void>;
}

export function useFileBrowserPendingActions({
  folderEntries,
  startRename,
  createTimelineInDirectory,
  createMarkdownInDirectory,
  handlePendingRemoteDownloadRequest,
}: FileBrowserPendingActionsOptions) {
  const uiStore = useUiStore();

  watch(
    () => uiStore.pendingFsEntryRename,
    (value) => {
      const entry = value as FsEntry | null;
      if (!entry) return;
      const inCurrentFolder = folderEntries.value.some((e) => e.path === entry.path);
      if (!inCurrentFolder) return;
      startRename(entry);
      uiStore.pendingFsEntryRename = null;
    },
  );

  watch(
    () => uiStore.pendingFsEntryCreateTimeline,
    async (value) => {
      const entry = value as FsEntry | null;
      if (!entry || entry.kind !== 'directory') return;
      try {
        await createTimelineInDirectory(entry);
      } finally {
        uiStore.pendingFsEntryCreateTimeline = null;
      }
    },
  );

  watch(
    () => uiStore.pendingFsEntryCreateMarkdown,
    async (value) => {
      const entry = value as FsEntry | null;
      if (!entry || entry.kind !== 'directory') return;
      try {
        await createMarkdownInDirectory(entry);
      } finally {
        uiStore.pendingFsEntryCreateMarkdown = null;
      }
    },
  );

  watch(
    () => uiStore.pendingRemoteDownloadRequest,
    async (request) => {
      if (!request) return;
      try {
        await handlePendingRemoteDownloadRequest();
      } finally {
        uiStore.pendingRemoteDownloadRequest = null;
      }
    },
  );
}
