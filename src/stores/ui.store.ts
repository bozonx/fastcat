import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

import { readLocalStorageJson, writeLocalStorageJson } from '~/stores/ui/uiLocalStorage';
import { createUiFileTreePersistenceModule } from '~/stores/ui/uiFileTreePersistence';

export interface FsEntrySelection {
  kind: 'file' | 'directory';
  name: string;
  path?: string;
  handle: FileSystemFileHandle | FileSystemDirectoryHandle;
}

export const useUiStore = defineStore('ui', () => {
  const selectedFsEntry = ref<FsEntrySelection | null>(null);
  const showHiddenFiles = ref(readLocalStorageJson('gran-video-editor:show-hidden-files', false));

  watch(
    () => showHiddenFiles.value,
    (val) => writeLocalStorageJson('gran-video-editor:show-hidden-files', val),
  );

  const isGlobalDragging = ref(false);
  const isFileManagerDragging = ref(false);

  const fileTreeExpandedPaths = ref<Record<string, true>>({});

  const pendingFsEntryDelete = ref<unknown>(null);
  const pendingFsEntryRename = ref<unknown>(null);

  const fileTreeModule = createUiFileTreePersistenceModule({ fileTreeExpandedPaths });
  const {
    restoreFileTreeStateOnce,
    hasPersistedFileTreeState,
    isFileTreePathExpanded,
    setFileTreePathExpanded,
  } = fileTreeModule;

  return {
    selectedFsEntry,
    isGlobalDragging,
    isFileManagerDragging,
    fileTreeExpandedPaths,
    pendingFsEntryDelete,
    pendingFsEntryRename,
    showHiddenFiles,
    restoreFileTreeStateOnce,
    hasPersistedFileTreeState,
    isFileTreePathExpanded,
    setFileTreePathExpanded,
  };
});
