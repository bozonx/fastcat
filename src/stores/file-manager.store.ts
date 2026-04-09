import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import type { FsEntry } from '~/types/fs';
import { useSelectionStore } from '~/stores/selection.store';
import { readLocalStorageJson, writeLocalStorageJson } from '~/stores/ui/uiLocalStorage';

export type FileViewMode = 'grid' | 'list';
export type FileSortField = 'name' | 'type' | 'size' | 'modified' | 'created';
export type SortOrder = 'asc' | 'desc';

export interface FileManagerSelectionContext {
  instanceId?: string;
  isExternal?: boolean;
}

export interface FileSortOption {
  field: FileSortField;
  order: SortOrder;
}

export type FilesPageTab = 'computer' | 'bloggerdog' | 'fastcat';


function createFileManagerStoreSetup(contextId: string) {
  return () => {
    const STORAGE_KEY = `fastcat:file-manager-${contextId}`;
    const selectionStore = useSelectionStore();

    const selectedFolder = ref<FsEntry | null>(readLocalStorageJson(`${STORAGE_KEY}:selectedFolder`, null));
    const historyStack = ref<FsEntry[]>([]);
    const futureStack = ref<FsEntry[]>([]);
    const folderSizes = ref<Record<string, number>>({});
    const isBloggerDogPanelVisible = ref(readLocalStorageJson(`${STORAGE_KEY}:isBloggerDogPanelVisible`, false));

    const viewMode = ref<FileViewMode>(readLocalStorageJson(`${STORAGE_KEY}:viewMode`, 'grid'));
    const sortOption = ref<FileSortOption>(
      readLocalStorageJson(`${STORAGE_KEY}:sortOption`, { field: 'name', order: 'asc' }),
    );
    const gridCardSize = ref<number>(
      readLocalStorageJson(`${STORAGE_KEY}:gridCardSize`, 80),
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
    const selectionContext = ref<FileManagerSelectionContext>({});

    // Persist settings to localStorage
    watch(viewMode, (val) => writeLocalStorageJson(`${STORAGE_KEY}:viewMode`, val));
    watch(
      sortOption,
      (val) => writeLocalStorageJson(`${STORAGE_KEY}:sortOption`, val),
      {
        deep: true,
      },
    );
    watch(gridCardSize, (val) => writeLocalStorageJson(`${STORAGE_KEY}:gridCardSize`, val));
    watch(isBloggerDogPanelVisible, (val) =>
      writeLocalStorageJson(`${STORAGE_KEY}:isBloggerDogPanelVisible`, val),
    );
    watch(selectedFolder, (val) => writeLocalStorageJson(`${STORAGE_KEY}:selectedFolder`, val));

    watch(
      columnWidths,
      (val) => writeLocalStorageJson(`${STORAGE_KEY}:columnWidths`, val),
      {
        deep: true,
      },
    );

    function setSelectionContext(context: FileManagerSelectionContext) {
      selectionContext.value = { ...context };
    }

    function openFolder(
      entry: FsEntry | null,
      options: { skipHistory?: boolean; selectionContext?: FileManagerSelectionContext } = {},
    ) {
      if (entry && entry.kind === 'directory') {
        if (!options.skipHistory && selectedFolder.value) {
          const current = { ...selectedFolder.value };
          // Only add to history if path or source changed
          if (current.path !== entry.path || current.source !== entry.source) {
            historyStack.value.push(current);
            futureStack.value = [];
          }
        }
        selectedFolder.value = entry;
        const nextSelectionContext = options.selectionContext ?? selectionContext.value;
        selectionStore.selectFsEntry(
          entry,
          nextSelectionContext.instanceId,
          nextSelectionContext.isExternal,
        );
      } else {
        selectedFolder.value = null;
      }
    }

    function addToHistory(entry: FsEntry) {
      const last = historyStack.value[historyStack.value.length - 1];
      if (last && last.path === entry.path && last.source === entry.source) return;
      historyStack.value.push({ ...entry });
      futureStack.value = [];
    }

    function selectItem(entry: FsEntry | null, context?: FileManagerSelectionContext) {
      if (entry) {
        const nextSelectionContext = context ?? selectionContext.value;
        selectionStore.selectFsEntry(
          entry,
          nextSelectionContext.instanceId,
          nextSelectionContext.isExternal,
        );
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

    function setGridCardSize(size: number) {
      gridCardSize.value = size;
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
      gridCardSize,
      columnWidths,
      folderSizes,
      sortFields,
      historyStack,
      futureStack,
      openFolder,
      addToHistory,
      selectItem,
      setSelectionContext,
      clearSelection,
      setViewMode,
      setSortOption,
      setGridCardSize,
      setColumnWidth,
      resetFileManagerState,
    };
  };
}

export const useFileBrowserPersistenceStore = defineStore('fileBrowserPersistence', () => {
  const bloggerDogGridCardSize = ref<number>(
    readLocalStorageJson(`fastcat:file-manager:bloggerDogGridCardSize`, 100),
  );
  const computerGridCardSize = ref<number>(
    readLocalStorageJson(`fastcat:file-manager:computerGridCardSize`, 100),
  );
  const computerLastFolder = ref<FsEntry | null>(
    readLocalStorageJson(`fastcat:file-manager:computerLastFolder`, null),
  );
  const computerViewMode = ref<FileViewMode>(
    readLocalStorageJson(`fastcat:file-manager:computerViewMode`, 'list'),
  );
  const filesPageActiveTab = ref<FilesPageTab>(
    readLocalStorageJson(`fastcat:file-manager:filesPageActiveTab`, 'computer'),
  );

  watch(bloggerDogGridCardSize, (val) =>
    writeLocalStorageJson(`fastcat:file-manager:bloggerDogGridCardSize`, val),
  );
  watch(computerGridCardSize, (val) =>
    writeLocalStorageJson(`fastcat:file-manager:computerGridCardSize`, val),
  );
  watch(computerLastFolder, (val) =>
    writeLocalStorageJson(`fastcat:file-manager:computerLastFolder`, val),
  );
  watch(computerViewMode, (val) => writeLocalStorageJson(`fastcat:file-manager:computerViewMode`, val));
  watch(filesPageActiveTab, (val) => writeLocalStorageJson(`fastcat:file-manager:filesPageActiveTab`, val));

  function setBloggerDogGridCardSize(size: number) {
    bloggerDogGridCardSize.value = size;
  }

  function setComputerGridCardSize(size: number) {
    computerGridCardSize.value = size;
  }

  function setComputerLastFolder(entry: FsEntry | null) {
    computerLastFolder.value = entry;
  }

  function setComputerViewMode(mode: FileViewMode) {
    computerViewMode.value = mode;
  }

  function setFilesPageActiveTab(tab: FilesPageTab) {
    filesPageActiveTab.value = tab;
  }

  return {
    bloggerDogGridCardSize,
    computerGridCardSize,
    computerLastFolder,
    computerViewMode,
    filesPageActiveTab,
    setBloggerDogGridCardSize,
    setComputerGridCardSize,
    setComputerLastFolder,
    setComputerViewMode,
    setFilesPageActiveTab,
  };
});

export type FileManagerStore = ReturnType<ReturnType<typeof createFileManagerStoreSetup>>;

export const useFileManagerStore = defineStore('fileManager', createFileManagerStoreSetup('editor'));
export const useFilesPageFileManagerStore = defineStore(
  'filesPageFileManager',
  createFileManagerStoreSetup('filesPage'),
);
export const useFilesPageSidebarFileManagerStore = defineStore(
  'filesPageSidebarFileManager',
  createFileManagerStoreSetup('filesPage-sidebar'),
);

export const useComputerSidebarStore = defineStore(
  'computerSidebar',
  createFileManagerStoreSetup('computer-sidebar'),
);

export const useBloggerDogSidebarStore = defineStore(
  'bloggerDogSidebar',
  createFileManagerStoreSetup('bloggerdog-sidebar'),
);
