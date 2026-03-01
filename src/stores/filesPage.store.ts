import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { FsEntry } from '~/types/fs';
import type { SelectedEntity } from '~/stores/selection.store';

export const useFilesPageStore = defineStore('filesPage', () => {
  const selectedFolder = ref<FsEntry | null>(null);
  const selectedFile = ref<FsEntry | null>(null);

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
    selectFolder,
    selectFile,
    selectedEntity,
  };
});
