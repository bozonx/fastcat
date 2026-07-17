import { ref, computed } from 'vue';
import type { Ref, ComputedRef } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useAddMediaToTimeline } from '~/composables/timeline/useAddMediaToTimeline';
import { isMobileTimelineAddableProjectFileName } from '~/utils/media-types';
import type { FsEntry } from '~/types/fs';
import type { MobileDrawerAction } from '~/types/file-manager';
import type { FileCompatibility } from '~/composables/file-manager/useFileManagerCompatibility';

export interface UseMobileFileBrowserModalsOptions {
  /** All entries visible to the browser — used for rename validation. */
  entries: Ref<FsEntry[]> | ComputedRef<FsEntry[]>;
  /** Compatibility map for the current entries. */
  compatibility:
    | Ref<Record<string, FileCompatibility>>
    | ComputedRef<Record<string, FileCompatibility>>;
  /** Selection mode flag from the parent component. */
  isSelectionMode: Ref<boolean> | ComputedRef<boolean>;
  /** Currently selected entries. */
  selectedEntries: Ref<FsEntry[]> | ComputedRef<FsEntry[]>;
  /** Drawer open state, closed before opening a modal. */
  isDrawerOpen: Ref<boolean>;
  /** Resets selection/drawer UI. */
  closeAllUI: () => void;
  /** VFS rename call. */
  renameEntry: (entry: FsEntry, newName: string) => Promise<void>;
  /** Reloads the current view after destructive changes. */
  reload: () => Promise<void>;
  /** Handles file-browser drawer actions such as copy/cut/paste/info. */
  onFileAction: (action: MobileDrawerAction, entry: FsEntry | FsEntry[]) => Promise<void>;
  /** Confirms deletion from the shared file-browser composable. */
  handleDeleteConfirm: () => Promise<void>;
  /** Opens the transcription modal from the shared file-browser composable. */
  openTranscriptionModal: (entry: FsEntry) => void;
  /** Optional custom rename validation; falls back to a parent-scoped check. */
  validateRename?: (newName: string) => string | boolean | null;
}

export function useMobileFileBrowserModals(options: UseMobileFileBrowserModalsOptions) {
  const projectStore = useProjectStore();
  const selectionStore = useSelectionStore();
  const toast = useToast();
  const { t } = useI18n();
  const { addMediaToTimeline } = useAddMediaToTimeline();

  const isRenameModalOpen = ref(false);
  const entryToRename = ref<FsEntry | null>(null);

  function isAddableEntry(entry: FsEntry): boolean {
    if (entry.kind !== 'file' || !entry.path) return false;
    if (options.compatibility.value[entry.path]?.status === 'fully_unsupported') return false;
    return isMobileTimelineAddableProjectFileName(entry.name);
  }

  async function addEntriesToTimeline(entries: FsEntry[]) {
    const timelineEntries: { name: string; path: string }[] = [];
    for (const entry of entries) {
      if (entry.path) timelineEntries.push({ name: entry.name, path: entry.path });
    }

    if (timelineEntries.length === 0) return;

    const added = await addMediaToTimeline(timelineEntries);
    if (!added) return;

    toast.add({
      title: t('common.success'),
      description: t('common.addedToTimeline'),
      color: 'success',
    });
    options.closeAllUI();
    projectStore.setView('cut');
  }

  const canAddSelectionToTimeline = computed(
    () => options.isSelectionMode.value && options.selectedEntries.value.some(isAddableEntry),
  );

  async function handleAddToProject() {
    const entity = selectionStore.selectedEntity;
    if (!entity || entity.source !== 'fileManager' || entity.kind !== 'file' || !entity.path) {
      return;
    }

    options.isDrawerOpen.value = false;
    await addEntriesToTimeline([entity.entry]);
  }

  async function handleAddSelectionToTimeline() {
    const supportedEntries = options.selectedEntries.value.filter(isAddableEntry);
    if (supportedEntries.length === 0) return;

    options.isDrawerOpen.value = false;
    await addEntriesToTimeline(supportedEntries);
  }

  async function handleRename(entry: FsEntry) {
    entryToRename.value = entry;
    isRenameModalOpen.value = true;
  }

  function defaultValidateRename(newName: string): string | boolean | null {
    const trimmed = newName.trim();
    if (!trimmed) return false;
    if (entryToRename.value && trimmed.toLowerCase() === entryToRename.value.name.toLowerCase()) {
      return true;
    }

    const parentPath =
      entryToRename.value?.parentPath ??
      entryToRename.value?.path?.split('/').slice(0, -1).join('/') ??
      '';

    const exists = options.entries.value.some(
      (entry) =>
        entry.path !== entryToRename.value?.path &&
        (entry.parentPath ?? entry.path?.split('/').slice(0, -1).join('/') ?? '') === parentPath &&
        entry.name.toLowerCase() === trimmed.toLowerCase(),
    );

    if (exists) {
      return t('common.validation.exists');
    }
    return true;
  }

  const validateRename = options.validateRename ?? defaultValidateRename;

  async function onRenameConfirm(newName: string) {
    if (!entryToRename.value || newName === entryToRename.value.name) return;

    try {
      await options.renameEntry(entryToRename.value, newName);
      await options.reload();
      toast.add({
        title: t('common.success'),
        description: t('common.saveSuccess'),
        color: 'success',
      });
    } catch (err) {
      toast.add({
        title: t('common.error'),
        description: String((err as { message?: string })?.message || err),
        color: 'error',
      });
    } finally {
      entryToRename.value = null;
    }
  }

  async function handleDrawerAction(action: MobileDrawerAction, entry: FsEntry | FsEntry[]) {
    if (['copy', 'cut'].includes(action)) {
      options.closeAllUI();
    }

    if (action === 'rename') {
      const entryToProcess = Array.isArray(entry) ? entry[0] : entry;
      if (entryToProcess) {
        await handleRename(entryToProcess);
      }
      options.closeAllUI();
      return;
    }

    if (action === 'transcribe') {
      const entryToProcess = Array.isArray(entry) ? entry[0] : entry;
      if (entryToProcess) {
        options.openTranscriptionModal(entryToProcess);
      }
      options.closeAllUI();
      return;
    }

    if (action === 'delete') {
      options.closeAllUI();
    }

    await options.onFileAction(action, entry);
  }

  async function wrappedHandleDeleteConfirm() {
    await options.handleDeleteConfirm();
    options.closeAllUI();
  }

  return {
    canAddSelectionToTimeline,
    handleAddToProject,
    handleAddSelectionToTimeline,
    isRenameModalOpen,
    entryToRename,
    handleRename,
    validateRename,
    onRenameConfirm,
    handleDrawerAction,
    wrappedHandleDeleteConfirm,
  };
}
