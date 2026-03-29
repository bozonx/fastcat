import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import type { FsEntry } from '~/types/fs';
import { useSelectionStore } from '~/stores/selection.store';
import { readLocalStorageJson, writeLocalStorageJson } from '~/stores/ui/uiLocalStorage';

export type FileViewMode = 'grid' | 'list';
export type FileSortField = 'name' | 'type' | 'size' | 'modified' | 'created';
export type SortOrder = 'asc' | 'desc';

export interface FileSortOption {
  field: FileSortField;
  order: SortOrder;
}

const STORAGE_KEY = 'fastcat:files-page';

export const useFilesPageStore = defineStore('filesPage', () => {
  const selectionStore = useSelectionStore();

  const selectedFolder = ref<FsEntry | null>(null);
  const folderSizes = ref<Record<string, number>>({});

  const viewMode = ref<FileViewMode>(readLocalStorageJson(`${STORAGE_KEY}:viewMode`, 'grid'));
  const sortOption = ref<FileSortOption>(
    readLocalStorageJson(`${STORAGE_KEY}:sortOption`, { field: 'name', order: 'asc' }),
  );
  const gridCardSize = ref<number>(readLocalStorageJson(`${STORAGE_KEY}:gridCardSize`, 80));
  const columnWidths = ref<Record<string, number>>(
    readLocalStorageJson(`${STORAGE_KEY}:columnWidths`, {
      name: 200,
      type: 100,
      size: 80,
      created: 140,
      modified: 140,
    }),
  );

  // Persist settings to localStorage
  watch(viewMode, (val) => writeLocalStorageJson(`${STORAGE_KEY}:viewMode`, val));
  watch(sortOption, (val) => writeLocalStorageJson(`${STORAGE_KEY}:sortOption`, val), {
    deep: true,
  });
  watch(gridCardSize, (val) => writeLocalStorageJson(`${STORAGE_KEY}:gridCardSize`, val));
  watch(columnWidths, (val) => writeLocalStorageJson(`${STORAGE_KEY}:columnWidths`, val), {
    deep: true,
  });

  function openFolder(entry: FsEntry | null) {
    if (entry && entry.kind === 'directory') {
      selectedFolder.value = entry;
      selectionStore.selectFsEntry(entry);
    } else {
      selectedFolder.value = null;
    }
  }

  function selectItem(entry: FsEntry | null) {
    if (entry) {
      selectionStore.selectFsEntry(entry);
    } else {
      const selected = selectionStore.selectedEntity;
      if (selected?.source === 'fileManager') {
        selectionStore.clearSelection();
      }
    }
  }

  // Legacy wrappers for backward compatibility if needed, but we will replace them
  function selectFolder(entry: FsEntry | null) {
    openFolder(entry);
  }

  function selectFile(entry: FsEntry | null) {
    selectItem(entry);
  }

  function setViewMode(mode: FileViewMode) {
    viewMode.value = mode;
  }

  function setSortOption(option: FileSortOption) {
    sortOption.value = option;
  }

  function setGridCardSize(size: number) {
    gridCardSize.value = size;
  }

  function setColumnWidth(column: string, width: number) {
    columnWidths.value = { ...columnWidths.value, [column]: width };
  }

  function clearSelection() {
    const selected = selectionStore.selectedEntity;
    if (selected?.source === 'fileManager' && selected.kind === 'file') {
      selectionStore.clearSelection();
    }
  }

  function resetFilesPageState() {
    selectedFolder.value = null;
    // We don't reset viewMode, sortOption, etc. as they are persisted user preferences
  }

  return {
    selectedFolder,
    viewMode,
    sortOption,
    gridCardSize,
    columnWidths,
    folderSizes,
    openFolder,
    selectItem,
    selectFolder,
    selectFile,
    clearSelection,
    setViewMode,
    setSortOption,
    setGridCardSize,
    setColumnWidth,
    resetFilesPageState,
  };
});
