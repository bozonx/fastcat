import { ref, computed, watch } from 'vue';
import type { FsEntry } from '~/types/fs';
import { useSelectionStore } from '~/stores/selection.store';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useProjectStore } from '~/stores/project.store';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { computeDirectoryStats } from '~/utils/fs';

export function useMobileFileBrowserSelection() {
  const selectionStore = useSelectionStore();
  const fileManagerStore = useFileManagerStore();
  const projectStore = useProjectStore();

  const isSelectionMode = ref(false);
  const isDrawerOpen = ref(false);
  const folderSizes = computed(() => fileManagerStore.folderSizes);

  const selectedEntries = computed(() => {
    const entity = selectionStore.selectedEntity;
    if (!entity || entity.source !== 'fileManager') return [];
    if (entity.kind === 'multiple') return entity.entries;
    return [entity.entry];
  });

  const totalSelectedSize = computed(() => {
    let size = 0;
    for (const entry of selectedEntries.value) {
      if (entry.kind === 'file') {
        size += entry.size ?? 0;
      } else if (entry.kind === 'directory' && entry.path) {
        size += folderSizes.value[entry.path] ?? 0;
      }
    }
    return size;
  });

  async function calculateFolderSize(path: string) {
    if (folderSizes.value[path] !== undefined) return;

    try {
      const handle = await projectStore.getDirectoryHandleByPath(path);
      if (!handle) return;
      const stats = await computeDirectoryStats(handle);
      if (stats) {
        fileManagerStore.folderSizes[path] = stats.size;
      }
    } catch (err) {
      console.warn('Failed to calculate folder size:', path, err);
    }
  }

  function toggleSelectionMode() {
    isSelectionMode.value = !isSelectionMode.value;
    if (!isSelectionMode.value) {
      selectionStore.clearSelection();
      isDrawerOpen.value = false;
    }
  }

  function handleLongPress(entry: FsEntry) {
    if (!isSelectionMode.value) {
      isSelectionMode.value = true;
      selectionStore.selectFsEntry(entry);
      isDrawerOpen.value = false;
    }
  }

  function handleToggleSelection(entry: FsEntry) {
    const current = selectedEntries.value;
    const index = current.findIndex((e) => e.path === entry.path);

    if (index === -1) {
      selectionStore.selectFsEntries([...current, entry]);
    } else {
      const next = current.filter((e) => e.path !== entry.path);
      if (next.length === 0) {
        isSelectionMode.value = false;
        selectionStore.clearSelection();
      } else {
        selectionStore.selectFsEntries(next);
      }
    }
  }

  function handleEntryClick(entry: FsEntry) {
    if (entry.kind === 'directory' && !isSelectionMode.value) {
      fileManagerStore.openFolder(entry);
      return;
    }

    if (isSelectionMode.value) {
      handleToggleSelection(entry);
    } else {
      if (getMediaTypeFromFilename(entry.name) === 'timeline' && entry.path) {
        projectStore.openTimelineFile(entry.path);
        projectStore.setView('cut');
        return;
      }

      selectionStore.selectFsEntry(entry);
      isDrawerOpen.value = true;
    }
  }

  function isSelected(entry: FsEntry) {
    const selected = selectionStore.selectedEntity;
    if (!selected || selected.source !== 'fileManager') return false;
    if (selected.kind === 'multiple') {
      return selected.entries.some((e) => e.path === entry.path);
    }
    return selected.path === entry.path;
  }

  // Reset selection when closing the drawer while not in selection mode
  watch(isDrawerOpen, (val) => {
    if (!val && !isSelectionMode.value) {
      selectionStore.clearSelection();
    }
  });

  // Calculate sizes of selected folders
  watch(
    selectedEntries,
    (entries) => {
      for (const entry of entries) {
        if (
          entry.kind === 'directory' &&
          entry.path &&
          folderSizes.value[entry.path] === undefined
        ) {
          void calculateFolderSize(entry.path);
        }
      }
    },
    { deep: true },
  );

  function closeAllUI() {
    isSelectionMode.value = false;
    isDrawerOpen.value = false;
    selectionStore.clearSelection();
  }

  return {
    isSelectionMode,
    isDrawerOpen,
    selectedEntries,
    folderSizes,
    totalSelectedSize,
    calculateFolderSize,
    toggleSelectionMode,
    handleLongPress,
    handleToggleSelection,
    handleEntryClick,
    closeAllUI,
  };
}
