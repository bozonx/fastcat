import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import type { FsEntry } from '~/types/fs';
import { useSelectionStore } from '~/stores/selection.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
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
    const workspaceStore = useWorkspaceStore();

    const selectedFolder = ref<FsEntry | null>(null);
    const historyStack = ref<FsEntry[]>([]);
    const futureStack = ref<FsEntry[]>([]);
    const folderSizes = ref<Record<string, number>>({});
    const isBloggerDogPanelVisible = ref(false);

    // Load from WorkspaceState with localStorage fallback for migration
    const workspaceInstance = computed(() => workspaceStore.workspaceState.fileBrowser.instances[contextId]);

    const viewMode = ref<FileViewMode>(
      workspaceInstance.value?.viewMode ??
      readLocalStorageJson(STORAGE_KEYS.FILE_MANAGER.contextKey(contextId, 'viewMode'), 'grid')
    );
    const sortOption = ref<FileSortOption>(
      workspaceInstance.value?.sortOption ??
      readLocalStorageJson(STORAGE_KEYS.FILE_MANAGER.contextKey(contextId, 'sortOption'), {
        field: 'name',
        order: 'asc',
      })
    );
    const gridCardSize = ref<number>(
      workspaceInstance.value?.gridCardSize ??
      readLocalStorageJson(STORAGE_KEYS.FILE_MANAGER.contextKey(contextId, 'gridCardSize'), 80)
    );

    // Keep column widths in localStorage as they are machine/resolution dependent
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

    // Watch for internal changes and update WorkspaceState
    watch([viewMode, sortOption, gridCardSize, () => selectedFolder.value?.path], () => {
      workspaceStore.batchUpdateWorkspaceState((draft) => {
        if (!draft.fileBrowser.instances[contextId]) {
          draft.fileBrowser.instances[contextId] = {
            viewMode: viewMode.value,
            sortOption: sortOption.value,
            gridCardSize: gridCardSize.value,
          };
        }
        const instance = draft.fileBrowser.instances[contextId]!;
        instance.viewMode = viewMode.value;
        instance.sortOption = sortOption.value;
        instance.gridCardSize = gridCardSize.value;
        if (selectedFolder.value?.path) {
          instance.lastPath = selectedFolder.value.path;
        }
      });
    }, { deep: true });

    // Sync from WorkspaceState (e.g. if loaded from disk later or another component updates it)
    watch(workspaceInstance, (val) => {
      if (!val) return;
      if (val.viewMode !== viewMode.value) viewMode.value = val.viewMode;
      if (val.gridCardSize !== gridCardSize.value) gridCardSize.value = val.gridCardSize;
      // We don't force-update sortOption here to avoid infinite loops or jitter, 
      // but if needed we could implement a shallow compare
    }, { deep: true });

    // Still persist columnWidths to localStorage
    watch(columnWidths, (val) =>
      writeLocalStorageJson(STORAGE_KEYS.FILE_MANAGER.contextKey(contextId, 'columnWidths'), val),
    );

    // Initial folder load from workspace
    if (workspaceInstance.value?.lastPath && !selectedFolder.value) {
      // Logic to restore folder by path will happen in the component or via openFolderByPath
    }

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

// Legacy useFileBrowserPersistenceStore was removed. 
// Use individual fileManager stores and WorkspaceStore instead.

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
