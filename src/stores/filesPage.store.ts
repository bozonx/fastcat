import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { FsEntry } from '~/types/fs';
import type { SelectedEntity } from '~/stores/selection.store';

export type FileViewMode = 'grid' | 'list';
export type FileSortField = 'name' | 'type' | 'size' | 'modified' | 'created';
export type SortOrder = 'asc' | 'desc';

export interface FileSortOption {
  field: FileSortField;
  order: SortOrder;
}

export const useFilesPageStore = defineStore('filesPage', () => {
  const selectedFolder = ref<FsEntry | null>(null);
  const selectedFile = ref<FsEntry | null>(null);
  const viewMode = ref<FileViewMode>('grid');
  const sortOption = ref<FileSortOption>({ field: 'name', order: 'asc' });

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
    selectFolder,
    selectFile,
    setViewMode,
    setSortOption,
    selectedEntity,
  };
});
