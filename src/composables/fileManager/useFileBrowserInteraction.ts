import { ref, onUnmounted } from 'vue';
import type { Ref } from 'vue';
import type { FsEntry } from '~/types/fs';
import type { RemoteFsEntry } from '~/utils/remote-vfs';
import { isRemoteFsEntry } from '~/utils/remote-vfs';
import { isOpenableProjectFileName } from '~/utils/media-types';
import { useFilesPageStore, type FileSortField } from '~/stores/filesPage.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useFileManagerSelection } from '~/composables/fileManager/useFileManagerSelection';

export interface FileBrowserInteractionOptions {
  isRemoteMode: Ref<boolean>;
  remoteCurrentFolder: Ref<RemoteFsEntry | null>;
  sortedEntries: Ref<FsEntry[]>;
  loadFolderContent: () => Promise<void>;
  loadParentFolders: () => Promise<void>;
  setSelectedFsEntry: (entry: FsEntry | null) => void;
  onFileAction: (action: string, entry: FsEntry) => void;
}

export function useFileBrowserInteraction({
  isRemoteMode,
  remoteCurrentFolder,
  sortedEntries,
  loadFolderContent,
  loadParentFolders,
  setSelectedFsEntry,
  onFileAction,
}: FileBrowserInteractionOptions) {
  const filesPageStore = useFilesPageStore();
  const projectStore = useProjectStore();
  const timelineStore = useTimelineStore();

  const { handleEntryClick: handleSelectionClick } = useFileManagerSelection({
    getVisibleEntries: () => sortedEntries.value,
    enforceSameLevel: false,
    onSingleSelect: (entry) => filesPageStore.selectFile(entry),
  });

  function handleEntryClick(event: MouseEvent, entry: FsEntry) {
    if (isRemoteMode.value) {
      setSelectedFsEntry(entry);
      return;
    }
    handleSelectionClick(event, entry);
  }

  function handleEntryDoubleClick(entry: FsEntry) {
    if (isRemoteMode.value) {
      if (entry.kind === 'directory' && isRemoteFsEntry(entry)) {
        remoteCurrentFolder.value = entry;
        void loadFolderContent();
        void loadParentFolders();
        setSelectedFsEntry(entry);
      }
      return;
    }

    if (entry.kind === 'directory') {
      filesPageStore.openFolder(entry);
    } else {
      if (entry.name.toLowerCase().endsWith('.otio')) {
        const entryPath = entry.path;
        if (!entryPath) return;
        void (async () => {
          await projectStore.openTimelineFile(entryPath);
          await timelineStore.loadTimeline();
          void timelineStore.loadTimelineMetadata();
        })();
      } else {
        if (!isOpenableProjectFileName(entry.name)) return;
        onFileAction('openAsProjectTab', entry);
      }
    }
  }

  function handleEntryEnter(entry: FsEntry) {
    if (!isRemoteMode.value) {
      filesPageStore.selectFile(entry);
    } else {
      setSelectedFsEntry(entry);
    }
    handleEntryDoubleClick(entry);
  }

  function handleSort(field: FileSortField) {
    if (filesPageStore.sortOption.field === field) {
      filesPageStore.sortOption = {
        field,
        order: filesPageStore.sortOption.order === 'asc' ? 'desc' : 'asc',
      };
    } else {
      filesPageStore.sortOption = { field, order: 'asc' };
    }
  }

  const resizingColumn = ref<string | null>(null);
  const resizeStartX = ref(0);
  const resizeStartWidth = ref(0);

  function onResizeStart(e: MouseEvent, column: string) {
    resizingColumn.value = column;
    resizeStartX.value = e.clientX;
    resizeStartWidth.value = filesPageStore.columnWidths[column] || 100;
    document.addEventListener('mousemove', onResizeMove);
    document.addEventListener('mouseup', onResizeEnd);
  }

  function onResizeMove(e: MouseEvent) {
    if (!resizingColumn.value) return;
    const diff = e.clientX - resizeStartX.value;
    const newWidth = Math.max(60, resizeStartWidth.value + diff);
    filesPageStore.setColumnWidth(resizingColumn.value, newWidth);
  }

  function onResizeEnd() {
    resizingColumn.value = null;
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeEnd);
  }

  onUnmounted(() => {
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeEnd);
  });

  return {
    handleEntryClick,
    handleEntryDoubleClick,
    handleEntryEnter,
    handleSort,
    onResizeStart,
  };
}
