import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import type { FsEntry } from '~/types/fs';
import type { SelectedEntity } from '~/stores/selection.store';

export type FileViewMode = 'grid' | 'list';
export type FileSortField = 'name' | 'type' | 'size' | 'modified' | 'created';
export type SortOrder = 'asc' | 'desc';

export interface FileSortOption {
  field: FileSortField;
  order: SortOrder;
}

const STORAGE_KEY = 'gran-video-editor-files-page';

function loadFromStorage<T>(key: string, defaultValue: T): T {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const stored = localStorage.getItem(`${STORAGE_KEY}-${key}`);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch {
    return defaultValue;
  }
}

function saveToStorage<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(`${STORAGE_KEY}-${key}`, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export const useFilesPageStore = defineStore('filesPage', () => {
  const selectedFolder = ref<FsEntry | null>(null);
  const selectedFile = ref<FsEntry | null>(null);
  const viewMode = ref<FileViewMode>(loadFromStorage('viewMode', 'grid'));
  const sortOption = ref<FileSortOption>(
    loadFromStorage('sortOption', { field: 'name', order: 'asc' }),
  );
  const gridCardSize = ref<number>(loadFromStorage('gridCardSize', 120));
  const columnWidths = ref<Record<string, number>>(
    loadFromStorage('columnWidths', {
      name: 200,
      type: 100,
      size: 80,
      created: 140,
      modified: 140,
    }),
  );

  // Persist settings to localStorage
  watch(viewMode, (val) => saveToStorage('viewMode', val));
  watch(sortOption, (val) => saveToStorage('sortOption', val), { deep: true });
  watch(gridCardSize, (val) => saveToStorage('gridCardSize', val));
  watch(columnWidths, (val) => saveToStorage('columnWidths', val), { deep: true });

  function selectFolder(entry: FsEntry | null) {
    if (entry && entry.kind === 'directory') {
      selectedFolder.value = entry;
    } else {
      selectedFolder.value = null;
    }
  }

  function selectFile(entry: FsEntry | null) {
    if (entry && entry.kind === 'file') {
      selectedFile.value = entry;
    } else {
      selectedFile.value = null;
    }
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

  function navigateUp() {
    if (!selectedFolder.value) return;
    const path = selectedFolder.value.path;
    if (!path) {
      selectedFolder.value = null;
      return;
    }
    const parts = path.split('/');
    parts.pop();
    // We need parent handle - this will be handled in component
    selectedFolder.value = null;
  }

  const selectedEntity = computed<SelectedEntity | null>(() => {
    if (selectedFile.value) {
      return {
        source: 'fileManager',
        kind: 'file',
        path: selectedFile.value.path,
        name: selectedFile.value.name,
        entry: selectedFile.value,
      };
    }
    if (selectedFolder.value) {
      return {
        source: 'fileManager',
        kind: 'directory',
        path: selectedFolder.value.path,
        name: selectedFolder.value.name,
        entry: selectedFolder.value,
      };
    }
    return null;
  });

  return {
    selectedFolder,
    selectedFile,
    viewMode,
    sortOption,
    gridCardSize,
    columnWidths,
    selectFolder,
    selectFile,
    setViewMode,
    setSortOption,
    setGridCardSize,
    setColumnWidth,
    navigateUp,
    selectedEntity,
  };
});
