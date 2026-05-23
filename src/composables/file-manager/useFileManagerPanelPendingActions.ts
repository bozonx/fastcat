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
  onPasteTarget: (entry: FsEntry) => Promise<void>;
  handlePendingBloggerDogCreateSubgroup: (entry: FsEntry) => void;
  handlePendingBloggerDogCreateItem: (entry: FsEntry) => void;
  instanceId: string;
}

export function useFileManagerPanelPendingActions({
  openDeleteConfirmModal,
  startRename,
  onCreateFolder,
  createTimelineInDirectory,
  createMarkdownInDirectory,
  createOtioVersion,
  onPasteTarget,
  handlePendingBloggerDogCreateSubgroup,
  handlePendingBloggerDogCreateItem,
  instanceId,
}: FileManagerPanelPendingActionsOptions) {
  const uiStore = useUiStore();
  const focusStore = useFocusStore();
  const selectionStore = useSelectionStore();

  const isFocusedOrSelected = () => {
    if (focusStore.isPanelFocused(`dynamic:file-manager:${instanceId}`)) return true;
    const selected = selectionStore.selectedEntity;
    if (selected?.source !== 'fileManager') return false;
    const selectedInstanceId = (selected as { instanceId?: string }).instanceId;
    if (selectedInstanceId) return selectedInstanceId === instanceId;
    return true;
  };

  const isSidebarPasteTarget = () => {
    if (focusStore.isPanelFocused('files-sidebar') || focusStore.isPanelFocused('project')) {
      return true;
    }
    if (focusStore.isPanelFocused(`dynamic:file-manager:${instanceId}:sidebar`)) {
      return true;
    }
    if (focusStore.isPanelFocused(`dynamic:fileManager:${instanceId}:sidebar`)) {
      return true;
    }
    return false;
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
      if (uiStore.pendingFsEntryCreateTimeline !== value) return;
      uiStore.pendingFsEntryCreateTimeline = null;
      try {
        await createTimelineInDirectory(entry);
      } catch (e) {
        console.warn('Failed to create timeline in directory', entry.path, e);
      }
    },
  );

  watch(
    () => uiStore.pendingFsEntryCreateMarkdown,
    async (value) => {
      const entry = value;
      if (!entry || entry.kind !== 'directory') return;
      if (!isFocusedOrSelected()) return;
      if (uiStore.pendingFsEntryCreateMarkdown !== value) return;
      uiStore.pendingFsEntryCreateMarkdown = null;
      try {
        await createMarkdownInDirectory(entry);
      } catch (e) {
        console.warn('Failed to create markdown in directory', entry.path, e);
      }
    },
  );

  watch(
    () => uiStore.pendingOtioCreateVersion,
    async (value) => {
      const entry = value;
      if (!entry || entry.kind !== 'file') return;
      if (!isFocusedOrSelected()) return;
      if (uiStore.pendingOtioCreateVersion !== value) return;
      uiStore.pendingOtioCreateVersion = null;
      try {
        await createOtioVersion(entry);
      } catch (e) {
        console.warn('Failed to create OTIO version', entry.path, e);
      }
    },
  );

  watch(
    () => uiStore.pendingFsEntryPaste,
    async (value) => {
      const entry = value;
      if (!entry || entry.kind !== 'directory') return;
      if (!isSidebarPasteTarget()) return;
      try {
        await onPasteTarget(entry);
      } finally {
        uiStore.pendingFsEntryPaste = null;
      }
    },
  );

  watch(
    () =>
      (uiStore as { pendingBloggerDogCreateSubgroup?: unknown }).pendingBloggerDogCreateSubgroup,
    (entry) => {
      if (!entry || !isFocusedOrSelected()) return;
      handlePendingBloggerDogCreateSubgroup(entry as FsEntry);
      (
        uiStore as { pendingBloggerDogCreateSubgroup?: unknown | null }
      ).pendingBloggerDogCreateSubgroup = null;
    },
  );

  watch(
    () => (uiStore as { pendingBloggerDogCreateItem?: unknown }).pendingBloggerDogCreateItem,
    (entry) => {
      if (!entry || !isFocusedOrSelected()) return;
      handlePendingBloggerDogCreateItem(entry as FsEntry);
      (uiStore as { pendingBloggerDogCreateItem?: unknown | null }).pendingBloggerDogCreateItem =
        null;
    },
  );
}
