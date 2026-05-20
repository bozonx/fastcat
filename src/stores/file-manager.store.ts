import { defineStore } from 'pinia';
import { ref, watch, computed } from 'vue';
import type { FsEntry } from '~/types/fs';
import { useSelectionStore } from '~/stores/selection.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { createDefaultFileBrowserInstance } from '~/utils/workspace-state';

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
    const workspaceInstance = computed(
      () => workspaceStore.workspaceState.fileBrowser.instances[contextId],
    );

    const defaults = createDefaultFileBrowserInstance();
    const viewMode = ref<FileViewMode>(workspaceInstance.value?.viewMode ?? defaults.viewMode);
    const sortOption = ref<FileSortOption>(
      workspaceInstance.value?.sortOption ?? { ...defaults.sortOption },
    );
    const gridCardSize = ref<number>(
      workspaceInstance.value?.gridCardSize ?? defaults.gridCardSize,
    );
    const showHiddenFiles = ref<boolean>(
      workspaceInstance.value?.showHiddenFiles ?? defaults.showHiddenFiles,
    );
    const treeSize = ref<number | undefined>(workspaceInstance.value?.treeSize);

    const columnWidths = ref<Record<string, number>>(
      workspaceInstance.value?.columnWidths ?? { ...defaults.columnWidths },
    );
    const selectionContext = ref<FileManagerSelectionContext>({});

    const externalFmIds = new Set(['computer-sidebar', 'bloggerdog-sidebar']);
    const isExternalFm = externalFmIds.has(contextId);

    // Watch for internal changes and update WorkspaceState
    watch(
      [
        viewMode,
        sortOption,
        gridCardSize,
        columnWidths,
        showHiddenFiles,
        treeSize,
        () => selectedFolder.value?.path,
      ],
      () => {
        workspaceStore.batchUpdateWorkspaceState((draft) => {
          if (!draft.fileBrowser.instances[contextId]) {
            draft.fileBrowser.instances[contextId] = createDefaultFileBrowserInstance();
          }
          const instance = draft.fileBrowser.instances[contextId]!;
          instance.viewMode = viewMode.value;
          instance.sortOption = sortOption.value;
          instance.gridCardSize = gridCardSize.value;
          instance.columnWidths = columnWidths.value;
          instance.showHiddenFiles = showHiddenFiles.value;
          instance.treeSize = treeSize.value;
          if (isExternalFm) {
            instance.lastPath = selectedFolder.value?.path;
          }
        });
      },
      { deep: true },
    );

    // Sync from WorkspaceState (e.g. if loaded from disk later or another component updates it)
    watch(
      workspaceInstance,
      (val) => {
        if (!val) return;
        if (val.viewMode !== viewMode.value) viewMode.value = val.viewMode;
        if (val.gridCardSize !== gridCardSize.value) gridCardSize.value = val.gridCardSize;
        if (val.columnWidths && val.columnWidths !== columnWidths.value) {
          columnWidths.value = val.columnWidths;
        }
        if (
          typeof val.showHiddenFiles === 'boolean' &&
          val.showHiddenFiles !== showHiddenFiles.value
        ) {
          showHiddenFiles.value = val.showHiddenFiles;
        }
        if (val.treeSize !== treeSize.value) {
          treeSize.value = val.treeSize;
        }
        if (
          val.sortOption &&
          (val.sortOption.field !== sortOption.value.field ||
            val.sortOption.order !== sortOption.value.order)
        ) {
          sortOption.value = { ...val.sortOption };
        }
      },
      { deep: true },
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

    function setShowHiddenFiles(value: boolean) {
      showHiddenFiles.value = value;
    }

    function setTreeSize(value: number | undefined) {
      treeSize.value = value;
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
      showHiddenFiles,
      treeSize,
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
      setShowHiddenFiles,
      setTreeSize,
      resetFileManagerState,
    };
  };
}

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
