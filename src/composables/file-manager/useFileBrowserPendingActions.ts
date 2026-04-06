import { watch } from 'vue';
import type { Ref } from 'vue';
import type { FsEntry } from '~/types/fs';
import { useUiStore } from '~/stores/ui.store';
import { useFocusStore } from '~/stores/focus.store';

export interface FileBrowserPendingActionsOptions {
  folderEntries: Ref<FsEntry[]>;
  startRename: (entry: FsEntry) => void;
  createTimelineInDirectory: (entry: FsEntry) => Promise<void>;
  createMarkdownInDirectory: (entry: FsEntry) => Promise<void>;
  openDeleteConfirmModal: (entries: FsEntry[]) => void;
  handlePendingRemoteDownloadRequest: () => Promise<void>;
  handlePendingBloggerDogCreateSubgroup: (entry: FsEntry) => void;
  handlePendingBloggerDogCreateItem: (entry: FsEntry) => void;
  onCreateFolder: (entry: FsEntry) => void;
  instanceId: string;
}

export function useFileBrowserPendingActions({
  folderEntries,
  startRename,
  createTimelineInDirectory,
  createMarkdownInDirectory,
  openDeleteConfirmModal,
  handlePendingRemoteDownloadRequest,
  handlePendingBloggerDogCreateSubgroup,
  handlePendingBloggerDogCreateItem,
  onCreateFolder,
  instanceId,
}: FileBrowserPendingActionsOptions) {
  const uiStore = useUiStore();
  const focusStore = useFocusStore();

  watch(
    () => uiStore.pendingFsEntryDelete,
    (value) => {
      const entries = value as FsEntry[] | null;
      if (!entries || entries.length === 0) return;
      if (!focusStore.isPanelFocused(`dynamic:file-manager:${instanceId}`)) return;

      openDeleteConfirmModal(entries);
      uiStore.pendingFsEntryDelete = null;
    },
  );

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
  
  watch(
    () => (uiStore as any).pendingBloggerDogCreateSubgroup,
    (entry) => {
      if (!entry) return;
      if (!focusStore.isPanelFocused(`dynamic:file-manager:${instanceId}`)) return;
      handlePendingBloggerDogCreateSubgroup(entry);
    },
  );

  watch(
    () => (uiStore as any).pendingBloggerDogCreateItem,
    (entry) => {
      if (!entry) return;
      if (!focusStore.isPanelFocused(`dynamic:file-manager:${instanceId}`)) return;
      handlePendingBloggerDogCreateItem(entry);
    },
  );

  watch(
    () => uiStore.pendingFsEntryCreateFolder,
    (entry) => {
      if (!entry) return;
      if (!focusStore.isPanelFocused(`dynamic:file-manager:${instanceId}`)) return;
      onCreateFolder(entry);
      uiStore.pendingFsEntryCreateFolder = null;
    },
  );
}
