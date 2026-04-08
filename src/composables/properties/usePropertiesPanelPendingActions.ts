import { ref, watch } from 'vue';
import { useUiStore } from '~/stores/ui.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useFocusStore } from '~/stores/focus.store';
import { useProjectTabsStore } from '~/stores/project-tabs.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { generateUniqueFsEntryName } from '~/utils/fs';
import type { FsEntry } from '~/types/fs';

export function usePropertiesPanelPendingActions() {
  const uiStore = useUiStore();
  const selectionStore = useSelectionStore();
  const fileManager = useFileManager();
  const projectStore = useProjectStore();
  const timelineStore = useTimelineStore();
  const focusStore = useFocusStore();
  const workspaceStore = useWorkspaceStore();
  const { removeFileTabByPath } = useProjectTabsStore();
  const toast = useToast();
  const { t } = useI18n();

  const isDeleteConfirmModalOpen = ref(false);
  const deleteTargets = ref<FsEntry[]>([]);

  const isNonFileManagerSource = () => {
    const selected = selectionStore.selectedEntity;
    return selected?.source !== 'fileManager';
  };

  watch(
    () => uiStore.pendingFsEntryDelete,
    async (value) => {
      const entries = value;
      if (!entries || entries.length === 0) return;
      if (!isNonFileManagerSource()) return;

      deleteTargets.value = entries;
      uiStore.pendingFsEntryDelete = null;
      if (workspaceStore.userSettings.deleteWithoutConfirmation) {
        await handleDeleteConfirm();
      } else {
        isDeleteConfirmModalOpen.value = true;
      }
    },
  );

  watch(
    () => uiStore.pendingOtioCreateVersion,
    async (value) => {
      const entry = value;
      if (!entry || entry.kind !== 'file') return;
      if (!isNonFileManagerSource()) return;

      try {
        await createOtioVersion(entry);
      } finally {
        uiStore.pendingOtioCreateVersion = null;
      }
    },
  );

  async function createOtioVersion(entry: FsEntry) {
    if (entry.kind !== 'file') return;
    if (!entry.name.toLowerCase().endsWith('.otio')) return;

    const parentPath = entry.parentPath ?? entry.path.split('/').slice(0, -1).join('/');
    const existingNames = await fileManager.vfs.listEntryNames(parentPath);

    const match = entry.name.slice(0, -'.otio'.length).match(/^(.*)_([0-9]{3})$/);
    const prefix = match ? match[1] : entry.name.slice(0, -'.otio'.length);
    const start = match ? Number(match[2]) + 1 : 1;

    const nextName = await generateUniqueFsEntryName({
      vfs: fileManager.vfs,
      dirPath: parentPath,
      baseName: prefix + '_',
      extension: '.otio',
      existingNames,
      startIndex: start,
    });

    const nextPath = parentPath ? `${parentPath}/${nextName}` : nextName;
    await fileManager.vfs.copyFile(entry.path, nextPath);

    await fileManager.loadProjectDirectory();
    uiStore.notifyFileManagerUpdate();

    const newEntry = fileManager.findEntryByPath(nextPath);
    if (newEntry) {
      uiStore.selectedFsEntry = {
        kind: newEntry.kind,
        name: newEntry.name,
        path: newEntry.path,
      };
      selectionStore.selectFsEntry(newEntry);

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

  async function handleDeleteConfirm() {
    if (deleteTargets.value.length === 0) return;

    const pathsToDelete = new Set(deleteTargets.value.map((t) => t.path).filter(Boolean));

    for (const target of deleteTargets.value) {
      await fileManager.deleteEntry(target);
    }

    if (uiStore.selectedFsEntry?.path && pathsToDelete.has(uiStore.selectedFsEntry.path)) {
      uiStore.selectedFsEntry = null;
      selectionStore.clearSelection();
    }

    for (const path of pathsToDelete) {
      if (path?.toLowerCase().endsWith('.otio')) {
        if (projectStore.currentTimelinePath === path) {
          await projectStore.closeTimelineFile(path);
        }
        removeFileTabByPath(path);
      }
    }

    uiStore.notifyFileManagerUpdate();

    isDeleteConfirmModalOpen.value = false;
    setTimeout(() => {
      deleteTargets.value = [];
    }, 300);
  }

  return {
    isDeleteConfirmModalOpen,
    deleteTargets,
    handleDeleteConfirm,
  };
}
