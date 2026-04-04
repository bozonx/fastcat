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

const STORAGE_KEY = 'fastcat:file-manager';

export const useFileManagerStore = defineStore('fileManager', () => {
  const selectionStore = useSelectionStore();

  const selectedFolder = ref<FsEntry | null>(null);
  const folderSizes = ref<Record<string, number>>({});
  const isBloggerDogPanelVisible = ref(readLocalStorageJson(`${STORAGE_KEY}:isBloggerDogPanelVisible`, false));

  const viewMode = ref<FileViewMode>(readLocalStorageJson(`${STORAGE_KEY}:viewMode`, 'grid'));
  const sortOption = ref<FileSortOption>(
    readLocalStorageJson(`${STORAGE_KEY}:sortOption`, { field: 'name', order: 'asc' }),
  );
  const filesPageGridCardSize = ref<number>(
    readLocalStorageJson(`${STORAGE_KEY}:filesPageGridCardSize`, 80),
  );
  const editorGridCardSize = ref<number>(
    readLocalStorageJson(`${STORAGE_KEY}:editorGridCardSize`, 100),
  );
  const bloggerDogGridCardSize = ref<number>(
    readLocalStorageJson(`${STORAGE_KEY}:bloggerDogGridCardSize`, 100),
  );
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
  watch(filesPageGridCardSize, (val) =>
    writeLocalStorageJson(`${STORAGE_KEY}:filesPageGridCardSize`, val),
  );
  watch(editorGridCardSize, (val) => writeLocalStorageJson(`${STORAGE_KEY}:editorGridCardSize`, val));
  watch(bloggerDogGridCardSize, (val) =>
    writeLocalStorageJson(`${STORAGE_KEY}:bloggerDogGridCardSize`, val),
  );
  watch(isBloggerDogPanelVisible, (val) =>
    writeLocalStorageJson(`${STORAGE_KEY}:isBloggerDogPanelVisible`, val),
  );
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

  function setViewMode(mode: FileViewMode) {
    viewMode.value = mode;
  }

  function setSortOption(option: FileSortOption) {
    sortOption.value = option;
  }

  function setFilesPageGridCardSize(size: number) {
    filesPageGridCardSize.value = size;
  }

  function setEditorGridCardSize(size: number) {
    editorGridCardSize.value = size;
  }

  function setBloggerDogGridCardSize(size: number) {
    bloggerDogGridCardSize.value = size;
  }

  function setColumnWidth(column: string, width: number) {
    columnWidths.value = { ...columnWidths.value, [column]: width };
  }

  function clearSelection() {
    const selected = selectionStore.selectedEntity;
    if (
      selected?.source === 'fileManager' &&
      (selected.kind === 'file' || selected.kind === 'directory')
    ) {
      selectionStore.clearSelection();
    }
  }

  function resetFileManagerState() {
    selectedFolder.value = null;
    // We don't reset viewMode, sortOption, etc. as they are persisted user preferences
  }

  const sortFields: { labelKey: string; value: FileSortField }[] = [
    { labelKey: 'common.name', value: 'name' },
    { labelKey: 'common.type', value: 'type' },
    { labelKey: 'common.size', value: 'size' },
    { labelKey: 'common.created', value: 'created' },
    { labelKey: 'common.modified', value: 'modified' },
  ];

  return {
    selectedFolder,
    isBloggerDogPanelVisible,
    viewMode,
    sortOption,
    filesPageGridCardSize,
    editorGridCardSize,
    bloggerDogGridCardSize,
    columnWidths,
    folderSizes,
    sortFields,
    openFolder,
    selectItem,
    clearSelection,
    setViewMode,
    setSortOption,
    setFilesPageGridCardSize,
    setEditorGridCardSize,
    setBloggerDogGridCardSize,
    setColumnWidth,
    resetFileManagerState,
  };
});
