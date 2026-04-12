import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import type { FsEntry } from '~/types/fs';
import { useSelectionStore } from '~/stores/selection.store';
import {
  readLocalStorageJson,
  writeLocalStorageJson,
  STORAGE_KEYS,
} from '~/stores/ui/uiLocalStorage';

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
    const selectionStore = useSelectionStore();
    const selectedFolder = ref<FsEntry | null>(null);
    const historyStack = ref<FsEntry[]>([]);
    const futureStack = ref<FsEntry[]>([]);
    const folderSizes = ref<Record<string, number>>({});
    const isBloggerDogPanelVisible = ref(false);

    const viewMode = ref<FileViewMode>(
      readLocalStorageJson(STORAGE_KEYS.FILE_MANAGER.contextKey(contextId, 'viewMode'), 'grid'),
    );
    const sortOption = ref<FileSortOption>(
      readLocalStorageJson(STORAGE_KEYS.FILE_MANAGER.contextKey(contextId, 'sortOption'), {
        field: 'name',
        order: 'asc',
      }),
    );
    const gridCardSize = ref<number>(
      readLocalStorageJson(STORAGE_KEYS.FILE_MANAGER.contextKey(contextId, 'gridCardSize'), 80),
    );

    const columnWidths = ref<Record<string, number>>(
      readLocalStorageJson(STORAGE_KEYS.FILE_MANAGER.contextKey(contextId, 'columnWidths'), {
        name: 200,
        type: 100,
        size: 80,
        created: 140,
        modified: 140,
      }),
    );
    const selectionContext = ref<FileManagerSelectionContext>({});

    // Persist user preferences to localStorage (not navigation state)
    watch(viewMode, (val) =>
      writeLocalStorageJson(STORAGE_KEYS.FILE_MANAGER.contextKey(contextId, 'viewMode'), val),
    );
    watch(sortOption, (val) =>
      writeLocalStorageJson(STORAGE_KEYS.FILE_MANAGER.contextKey(contextId, 'sortOption'), val),
    );
    watch(gridCardSize, (val) =>
      writeLocalStorageJson(STORAGE_KEYS.FILE_MANAGER.contextKey(contextId, 'gridCardSize'), val),
    );
    watch(columnWidths, (val) =>
      writeLocalStorageJson(STORAGE_KEYS.FILE_MANAGER.contextKey(contextId, 'columnWidths'), val),
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

    function openFolderByPath(path: string | null) {
      if (!path) {
        selectedFolder.value = null;
        return;
      }

      const parts = path.split('/').filter(Boolean);
      const name =
        parts.length > 0
          ? parts[parts.length - 1]!
          : contextId === 'computer-sidebar'
            ? 'Computer'
            : 'Project';

      openFolder(
        {
          name,
          kind: 'directory',
          path: path,
          source: contextId === 'bloggerdog-sidebar' ? 'remote' : 'local',
        },
        { skipHistory: true },
      );
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
      openFolderByPath,
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
    readLocalStorageJson(STORAGE_KEYS.FILE_MANAGER.PERSISTENCE.BLOGGERDOG_GRID_SIZE, 100),
  );
  const computerGridCardSize = ref<number>(
    readLocalStorageJson(STORAGE_KEYS.FILE_MANAGER.PERSISTENCE.COMPUTER_GRID_SIZE, 100),
  );
  const computerLastFolder = ref<FsEntry | null>(
    readLocalStorageJson(STORAGE_KEYS.FILE_MANAGER.PERSISTENCE.COMPUTER_LAST_FOLDER, null),
  );
  const computerViewMode = ref<FileViewMode>(
    readLocalStorageJson(STORAGE_KEYS.FILE_MANAGER.PERSISTENCE.COMPUTER_VIEW_MODE, 'list'),
  );
  const filesPageActiveTab = ref<FilesPageTab>(
    readLocalStorageJson(STORAGE_KEYS.FILE_MANAGER.PERSISTENCE.ACTIVE_TAB, 'computer'),
  );

  watch(bloggerDogGridCardSize, (val) =>
    writeLocalStorageJson(STORAGE_KEYS.FILE_MANAGER.PERSISTENCE.BLOGGERDOG_GRID_SIZE, val),
  );
  watch(computerGridCardSize, (val) =>
    writeLocalStorageJson(STORAGE_KEYS.FILE_MANAGER.PERSISTENCE.COMPUTER_GRID_SIZE, val),
  );
  watch(computerLastFolder, (val) =>
    writeLocalStorageJson(STORAGE_KEYS.FILE_MANAGER.PERSISTENCE.COMPUTER_LAST_FOLDER, val),
  );
  watch(computerViewMode, (val) =>
    writeLocalStorageJson(STORAGE_KEYS.FILE_MANAGER.PERSISTENCE.COMPUTER_VIEW_MODE, val),
  );
  watch(filesPageActiveTab, (val) =>
    writeLocalStorageJson(STORAGE_KEYS.FILE_MANAGER.PERSISTENCE.ACTIVE_TAB, val),
  );

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

export const useFileManagerStore = defineStore(
  'fileManager',
  createFileManagerStoreSetup('editor'),
);
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
