import { nextTick, onMounted, onUnmounted, watch } from 'vue';
import type { Ref } from 'vue';
import type { FsEntry } from '~/types/fs';
import type { RemoteFsEntry } from '~/utils/remote-vfs';
import { useFileBrowserBulkSelection } from '~/composables/file-manager/useFileBrowserBulkSelection';

interface MoveSelectionTrigger {
  dir: 'up' | 'down' | 'left' | 'right';
  timestamp: number;
}

interface UseFileBrowserLifecycleParams {
  remoteModeOnly?: boolean;
  isRemoteMode: Ref<boolean>;
  isAtRoot: Ref<boolean>;
  remoteCurrentFolder: Ref<RemoteFsEntry | null>;
  buildRemoteDirectoryEntry: (path: string) => RemoteFsEntry;
  fileManagerStore: {
    selectedFolder: FsEntry | null;
  };
  selectionStore: {
    selectedEntity: Record<string, unknown> | null;
    clearSelection: () => void;
    selectFsEntries: (entries: FsEntry[], instanceId: string, isExternal: boolean) => void;
  };
  focusStore: {
    isPanelFocused: (panelId: any) => boolean;
  };
  uiStore: {
    fileManagerUpdateCounter: number;
    fileBrowserSelectAllTrigger: number;
    fileBrowserNavigateBackTrigger: number;
    fileBrowserNavigateForwardTrigger: number;
    fileBrowserNavigateUpTrigger: number;
    fileBrowserMoveSelectionTrigger: MoveSelectionTrigger;
  };
  clipboardStore: {
    unregisterFileManagerVfs: (instanceId: string) => void;
  };
  instanceId: string;
  isExternal: boolean;
  sortedEntries: Ref<FsEntry[]>;
  pendingScrollToEntryPath: Ref<string | null>;
  skipNextUpdateReload: Ref<boolean>;
  loadFolderContent: (params?: { append?: boolean }) => Promise<void>;
  loadParentFolders: () => Promise<void>;
  tryScrollToPendingEntry: () => void;
  navigateBack: () => void | Promise<void>;
  navigateForward: () => void | Promise<void>;
  navigateUp: () => void | Promise<void>;
  moveSelection: (dir: MoveSelectionTrigger['dir']) => void;
  loadProjectDirectory: (params?: { fullRefresh?: boolean }) => Promise<void>;
  folderSizes: Ref<Record<string, number>>;
  setSelectedFsEntry: (entry: FsEntry | null) => void;
}

export function useFileBrowserLifecycle(params: UseFileBrowserLifecycleParams) {
  const panelId = `dynamic:file-manager:${params.instanceId}`;
  const bulkSelection = useFileBrowserBulkSelection({
    getVisibleEntries: () => params.sortedEntries.value,
    getSelectedEntries: () => {
      const selected = params.selectionStore.selectedEntity as {
        source?: string;
        kind?: string;
        entries?: FsEntry[];
        entry?: FsEntry;
      } | null;

      if (selected?.source !== 'fileManager') return [];
      if (selected.kind === 'multiple') return selected.entries ?? [];
      return selected.entry ? [selected.entry] : [];
    },
    selectEntries: (entries, instanceId, isExternal) => {
      params.selectionStore.selectFsEntries(entries, instanceId!, isExternal!);
    },
    clearSelection: params.selectionStore.clearSelection,
    getUsedPaths: () => new Set(),
    instanceId: params.instanceId,
    isExternal: params.isExternal,
  });

  async function refreshFileTree() {
    if (params.isRemoteMode.value) {
      await params.loadFolderContent();
      return;
    }

    params.folderSizes.value = {};
    await params.loadProjectDirectory({ fullRefresh: true });
  }

  onUnmounted(() => {
    params.clipboardStore.unregisterFileManagerVfs(params.instanceId);
  });

  onMounted(async () => {
    if (params.remoteModeOnly) {
      params.remoteCurrentFolder.value = params.buildRemoteDirectoryEntry('/');
      await params.loadFolderContent();
      await params.loadParentFolders();
      return;
    }

    if (!params.fileManagerStore.selectedFolder) {
      params.setSelectedFsEntry({
        kind: 'directory',
        path: '',
        name: 'Root',
      });
      return;
    }

    await params.loadFolderContent();
  });

  watch(
    () => params.uiStore.fileManagerUpdateCounter,
    async () => {
      if (params.skipNextUpdateReload.value) {
        params.skipNextUpdateReload.value = false;
        return;
      }

      await params.loadFolderContent();
      if (!params.pendingScrollToEntryPath.value) return;
      await nextTick();
      params.tryScrollToPendingEntry();
    },
  );

  watch(
    () => params.uiStore.fileBrowserSelectAllTrigger,
    () => {
      if (!params.focusStore.isPanelFocused(panelId)) return;
      if (params.isRemoteMode.value) return;
      bulkSelection.selectAll();
    },
  );

  watch(
    () => params.uiStore.fileBrowserNavigateBackTrigger,
    () => {
      if (!params.focusStore.isPanelFocused(panelId)) return;
      void params.navigateBack();
    },
  );

  watch(
    () => params.uiStore.fileBrowserNavigateForwardTrigger,
    () => {
      if (!params.focusStore.isPanelFocused(panelId)) return;
      void params.navigateForward();
    },
  );

  watch(
    () => params.uiStore.fileBrowserNavigateUpTrigger,
    () => {
      if (!params.focusStore.isPanelFocused(panelId)) return;
      if (params.isAtRoot.value) return;
      void params.navigateUp();
    },
  );

  watch(
    () => params.uiStore.fileBrowserMoveSelectionTrigger,
    (trigger) => {
      if (!params.focusStore.isPanelFocused(panelId)) return;
      params.moveSelection(trigger.dir);
    },
  );

  return {
    refreshFileTree,
  };
}
