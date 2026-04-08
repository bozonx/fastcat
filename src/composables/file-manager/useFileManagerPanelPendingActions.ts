import { watch } from 'vue';
import type { FsEntry } from '~/types/fs';
import { useUiStore } from '~/stores/ui.store';
import { useFocusStore } from '~/stores/focus.store';
import { useSelectionStore } from '~/stores/selection.store';

export interface FileManagerPanelPendingActionsOptions {
  openDeleteConfirmModal: (entries: FsEntry[]) => void;
  startRename: (entry: FsEntry) => void;
  onCreateFolder: (entry: FsEntry) => void;
  createTimelineInDirectory: (entry: FsEntry) => Promise<void>;
  createMarkdownInDirectory: (entry: FsEntry) => Promise<void>;
  createOtioVersion: (entry: FsEntry) => void | Promise<void>;
  instanceId: string;
}

export function useFileManagerPanelPendingActions({
  openDeleteConfirmModal,
  startRename,
  onCreateFolder,
  createTimelineInDirectory,
  createMarkdownInDirectory,
  createOtioVersion,
  instanceId,
}: FileManagerPanelPendingActionsOptions) {
  const uiStore = useUiStore();
  const focusStore = useFocusStore();
  const selectionStore = useSelectionStore();

  const isFocusedOrSelected = () => {
    if (focusStore.isPanelFocused(`dynamic:file-manager:${instanceId}`)) return true;
    const selected = selectionStore.selectedEntity;
    return selected?.source === 'fileManager' && (selected as any).instanceId === instanceId;
  };

  watch(
    () => uiStore.pendingFsEntryDelete,
    (value) => {
      const entries = value;
      if (!entries || entries.length === 0) return;
      if (!isFocusedOrSelected()) return;
      openDeleteConfirmModal(entries);
      uiStore.pendingFsEntryDelete = null;
    },
  );

  watch(
    () => uiStore.pendingFsEntryRename,
    (value) => {
      const entry = value;
      if (!entry) return;
      if (!isFocusedOrSelected()) return;
      startRename(entry);
      uiStore.pendingFsEntryRename = null;
    },
  );

  watch(
    () => uiStore.pendingFsEntryCreateFolder,
    (value) => {
      const entry = value;
      if (!entry || entry.kind !== 'directory') return;
      if (!isFocusedOrSelected()) return;
      onCreateFolder(entry);
      uiStore.pendingFsEntryCreateFolder = null;
    },
  );

  watch(
    () => uiStore.pendingFsEntryCreateTimeline,
    async (value) => {
      const entry = value;
      if (!entry || entry.kind !== 'directory') return;
      if (!isFocusedOrSelected()) return;
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
      const entry = value;
      if (!entry || entry.kind !== 'directory') return;
      if (!isFocusedOrSelected()) return;
      try {
        await createMarkdownInDirectory(entry);
      } finally {
        uiStore.pendingFsEntryCreateMarkdown = null;
      }
    },
  );

  watch(
    () => uiStore.pendingOtioCreateVersion,
    async (value) => {
      const entry = value;
      if (!entry || entry.kind !== 'file') return;
      if (!isFocusedOrSelected()) return;
      try {
        await createOtioVersion(entry);
      } finally {
        uiStore.pendingOtioCreateVersion = null;
      }
    },
  );
}
