import { watch } from 'vue';
import type { Ref } from 'vue';
import type { FsEntry } from '~/types/fs';
import { useUiStore } from '~/stores/ui.store';
import { useFocusStore } from '~/stores/focus.store';
import { useSelectionStore } from '~/stores/selection.store';

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
  onPasteTarget: (entry: FsEntry) => Promise<void>;
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
  onPasteTarget,
  instanceId,
}: FileBrowserPendingActionsOptions) {
  const uiStore = useUiStore();
  const focusStore = useFocusStore();
  const selectionStore = useSelectionStore();

  function matchesInstance(selected: any): boolean {
    if (selected?.source !== 'fileManager') return false;
    if (selected.instanceId) return selected.instanceId === instanceId;
    return true;
  }

  watch(
    () => uiStore.pendingFsEntryDelete,
    (value) => {
      const entries = value as FsEntry[] | null;
      if (!entries || entries.length === 0) return;
      if (!focusStore.isPanelFocused(`dynamic:file-manager:${instanceId}`)) {
        const selected = selectionStore.selectedEntity;
        if (!matchesInstance(selected)) {
          return;
        }
      }

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
      const selected = selectionStore.selectedEntity;
      const isSelected =
        selected?.source === 'fileManager' && (selected as any).entry?.path === entry.path;

      if (!inCurrentFolder && !isSelected) return;
      if (isSelected && !matchesInstance(selected)) return;
      startRename(entry);
      uiStore.pendingFsEntryRename = null;
    },
  );

  watch(
    () => uiStore.pendingFsEntryCreateTimeline,
    async (value) => {
      const entry = value as FsEntry | null;
      if (!entry || entry.kind !== 'directory') return;

      const selected = selectionStore.selectedEntity;
      if (!matchesInstance(selected)) {
        return;
      }
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

      const selected = selectionStore.selectedEntity;
      if (!matchesInstance(selected)) {
        return;
      }
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
      if (!focusStore.isPanelFocused(`dynamic:file-manager:${instanceId}`)) {
        if (!matchesInstance(selectionStore.selectedEntity)) {
          return;
        }
      }
      handlePendingBloggerDogCreateSubgroup(entry);
    },
  );

  watch(
    () => (uiStore as any).pendingBloggerDogCreateItem,
    (entry) => {
      if (!entry) return;
      if (!focusStore.isPanelFocused(`dynamic:file-manager:${instanceId}`)) {
        if (!matchesInstance(selectionStore.selectedEntity)) {
          return;
        }
      }
      handlePendingBloggerDogCreateItem(entry);
    },
  );

  watch(
    () => uiStore.pendingFsEntryCreateFolder,
    (entry) => {
      if (!entry) return;
      if (!focusStore.isPanelFocused(`dynamic:file-manager:${instanceId}`)) {
        if (!matchesInstance(selectionStore.selectedEntity)) {
          return;
        }
      }
      onCreateFolder(entry);
      uiStore.pendingFsEntryCreateFolder = null;
    },
  );

  watch(
    () => uiStore.pendingFsEntryPaste,
    async (targetEntry) => {
      if (!targetEntry) return;

      if (!focusStore.isPanelFocused(`dynamic:file-manager:${instanceId}`)) {
        if (!matchesInstance(selectionStore.selectedEntity)) {
          return;
        }
      }

      try {
        await onPasteTarget(targetEntry);
      } finally {
        uiStore.pendingFsEntryPaste = null;
      }
    },
  );
}
