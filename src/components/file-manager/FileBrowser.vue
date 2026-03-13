<script setup lang="ts">
import { ref, computed, watch, onUnmounted, nextTick } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { isLayer1Active, isLayer2Active } from '~/utils/hotkeys/layerUtils';
import { useFilesPageStore, type FileSortField } from '~/stores/filesPage.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useUiStore } from '~/stores/ui.store';
import { useFocusStore } from '~/stores/focus.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import { useFileManagerActions } from '~/composables/fileManager/useFileManagerActions';
import { useFileConversion } from '~/composables/fileManager/useFileConversion';
import { useFileContextMenu } from '~/composables/fileManager/useFileContextMenu';
import type { FileAction as ContextMenuFileAction } from '~/composables/fileManager/useFileContextMenu';
import { useFileBrowserDragAndDrop } from '~/composables/fileManager/useFileBrowserDragAndDrop';
import { useFileBrowserMarquee } from '~/composables/fileManager/useFileBrowserMarquee';
import { useFileBrowserEntries, type ExtendedFsEntry } from '~/composables/fileManager/useFileBrowserEntries';
import { useFileBrowserRemote } from '~/composables/fileManager/useFileBrowserRemote';
import { useFileBrowserNavigation } from '~/composables/fileManager/useFileBrowserNavigation';
import { useFileBrowserStt } from '~/composables/fileManager/useFileBrowserStt';
import { useFileBrowserFileActions } from '~/composables/fileManager/useFileBrowserFileActions';
import {
  createTimelineCommand,
  createMarkdownCommand,
} from '~/file-manager/application/fileManagerCommands';
import type { FsEntry } from '~/types/fs';
import { getMediaTypeFromFilename, isOpenableProjectFileName } from '~/utils/media-types';
import { isRemoteFsEntry } from '~/utils/remote-vfs';
import FileBrowserToolbar from '~/components/file-manager/FileBrowserToolbar.vue';
import FileBrowserBreadcrumbs from '~/components/file-manager/FileBrowserBreadcrumbs.vue';
import FileBrowserStatusBar from '~/components/file-manager/FileBrowserStatusBar.vue';
import FileBrowserViewGrid from '~/components/file-manager/FileBrowserViewGrid.vue';
import FileBrowserViewList from '~/components/file-manager/FileBrowserViewList.vue';
import FileBrowserModals from '~/components/file-manager/FileBrowserModals.vue';

const props = defineProps<{
  isFilesPage?: boolean;
}>();

const filesPageStore = useFilesPageStore();
const selectionStore = useSelectionStore();
const projectStore = useProjectStore();
const timelineStore = useTimelineStore();
const uiStore = useUiStore();
const focusStore = useFocusStore();
const proxyStore = useProxyStore();
const workspaceStore = useWorkspaceStore();
const { t } = useI18n();

const fileManager = useFileManager();
const {
  readDirectory,
  loadProjectDirectory,
  createFolder,
  renameEntry,
  deleteEntry,
  handleFiles,
  moveEntry,
  findEntryByPath,
  resolveEntryByPath,
  reloadDirectory,
  vfs,
} = fileManager;

const fileConversion = useFileConversion();

// --- STT ---
const stt = useFileBrowserStt();
const {
  sttTranscriptionModalOpen,
  sttTranscriptionLanguage,
  sttTranscriptionError,
  sttTranscribing,
  sttTranscriptionEntry,
  isTranscribableMediaFile,
  openTranscriptionModal,
  submitTranscription,
} = stt;

// --- State (shared between components) ---
const isRemoteMode = ref(false);
const remoteCurrentFolder = ref<RemoteFsEntry | null>(null);

// --- Entries (folderEntries, sortedEntries, sizes, stats) ---
const entries = useFileBrowserEntries({ isRemoteMode, vfs });
const {
  folderEntries,
  folderSizes,
  folderSizesLoading,
  sortedEntries,
  videoThumbnails,
  stats,
  calculateFolderSize,
  supplementEntries,
  cleanupObjectUrls,
} = entries;

// --- Scroll helper (used by navigation) ---
const rootContainer = ref<HTMLElement | null>(null);
const pendingScrollToEntryPath = ref<string | null>(null);

function scrollToEntryPath(path: string): boolean {
  const container = rootContainer.value;
  if (!container) return false;
  const targetNode = container.querySelector<HTMLElement>(
    `[data-entry-path="${CSS.escape(path)}"]`,
  );
  if (!targetNode) return false;
  const containerRect = container.getBoundingClientRect();
  const targetRect = targetNode.getBoundingClientRect();
  const targetTop = targetRect.top - containerRect.top + container.scrollTop;
  const targetBottom = targetTop + targetRect.height;
  const visibleTop = container.scrollTop;
  const visibleBottom = visibleTop + container.clientHeight;
  if (targetTop < visibleTop) {
    container.scrollTop = Math.max(targetTop - 8, 0);
  } else if (targetBottom > visibleBottom) {
    container.scrollTop = Math.max(targetBottom - container.clientHeight + 8, 0);
  }
  return true;
}

// --- setSelectedFsEntry (shared between remote & navigation) ---
function setSelectedFsEntry(entry: FsEntry | null) {
  if (!entry) {
    uiStore.selectedFsEntry = null;
    selectionStore.clearSelection();
    return;
  }
  uiStore.selectedFsEntry = {
    kind: entry.kind,
    name: entry.name,
    path: entry.path,
    parentPath: entry.parentPath,
    lastModified: entry.lastModified,
    size: entry.size,
    source: entry.source ?? 'local',
    remoteId: entry.remoteId,
    remotePath: entry.remotePath,
    remoteData: entry.remoteData,
  };
  selectionStore.selectFsEntry(entry);
}

// --- DragAndDrop (needs loadFolderContent forward-ref) ---
const skipNextUpdateReload = ref(false);

// Forward ref — assigned after navigation is created
let _loadFolderContent: () => Promise<void> = async () => {};

const {
  isDragOverPanel,
  dragOverEntryPath,
  isRootDropOver,
  onRootDragOver,
  onRootDragLeave,
  onRootDrop,
  onEntryDragStart,
  onEntryDragEnd,
  onEntryDragOver,
  onEntryDragLeave,
  onEntryDrop,
  onPanelDragOver,
  onPanelDragLeave,
  onPanelDrop,
} = useFileBrowserDragAndDrop({
  findEntryByPath,
  resolveEntryByPath,
  handleFiles,
  moveEntry,
  loadFolderContent: () => _loadFolderContent(),
  notifyFileManagerUpdate: () => {
    skipNextUpdateReload.value = true;
    uiStore.notifyFileManagerUpdate();
  },
});

// --- Remote ---
const remote = useFileBrowserRemote({
  isRemoteMode,
  remoteCurrentFolder,
  folderEntries,
  loadFolderContent: () => _loadFolderContent(),
  loadParentFolders: () => navigation.loadParentFolders(),
  navigateToRoot: () => navigation.navigateToRoot(),
  setSelectedFsEntry,
  onEntryDragStart,
  onEntryDragEnd,
  onEntryDragOver,
  onEntryDragLeave,
  onEntryDrop,
  onRootDragOver,
  onRootDragLeave,
  onRootDrop,
  handleFiles,
});
const {
  remoteTransferOpen,
  remoteTransferProgress,
  remoteTransferPhase,
  remoteTransferFileName,
  isRemoteAvailable,
  buildRemoteDirectoryEntry,
  loadRemoteFolderContent,
  loadRemoteParentFolders,
  openRemoteExchangeModal,
  toggleRemoteMode,
  performRemoteDownload,
  cancelRemoteTransfer,
  onBrowserEntryDragStart,
  onBrowserEntryDragEnd,
  onBrowserEntryDragOver,
  onBrowserEntryDragLeave,
  onBrowserEntryDrop,
  onBrowserRootDragOver,
  onBrowserRootDragLeave,
  onBrowserRootDrop,
} = remote;

// --- Navigation ---
const navigation = useFileBrowserNavigation({
  rootContainer,
  isRemoteMode,
  remoteCurrentFolder,
  folderEntries,
  supplementEntries,
  cleanupObjectUrls,
  buildRemoteDirectoryEntry,
  loadRemoteFolderContent,
  loadRemoteParentFolders,
  calculateFolderSize,
  pendingScrollToEntryPath,
  scrollToEntryPath,
  vfs,
  readDirectory,
});
const {
  parentFolders,
  loadFolderContent,
  loadParentFolders,
  navigateBack,
  navigateUp,
  navigateToFolder,
  navigateToRoot,
  tryScrollToPendingEntry,
} = navigation;

// Resolve forward refs
_loadFolderContent = loadFolderContent;

// --- File manager actions (CRUD, rename, delete) ---
const {
  isDeleteConfirmModalOpen,
  editingEntryPath,
  commitRename,
  stopRename,
  startRename,
  deleteTargets,
  directoryUploadTarget,
  directoryUploadInput,
  handleDeleteConfirm,
  onFileAction: onFileActionBase,
} = useFileManagerActions({
  createFolder,
  renameEntry,
  deleteEntry,
  loadProjectDirectory,
  handleFiles,
  mediaCache: fileManager.mediaCache,
  vfs,
  findEntryByPath: fileManager.findEntryByPath,
  readDirectory: fileManager.readDirectory,
  reloadDirectory: fileManager.reloadDirectory,
  notifyFileManagerUpdate: () => uiStore.notifyFileManagerUpdate(),
  setFileTreePathExpanded: (path, expanded) => {
    const projectName = projectStore.currentProjectName;
    if (projectName) uiStore.setFileTreePathExpanded(projectName, path, expanded);
  },
  onAfterRename: () => { void loadFolderContent(); },
  onAfterDelete: () => { void loadFolderContent(); },
});

// --- File actions dispatcher ---
const { onFileAction } = useFileBrowserFileActions({
  folderEntries,
  loadFolderContent,
  onFileActionBase,
  fileConversion,
  openTranscriptionModal,
  vfs,
});

// --- Proxy helpers ---
function isGeneratingProxyInDirectory(entry: FsEntry): boolean {
  if (entry.kind !== 'directory') return false;
  const dirPath = entry.path;
  for (const p of proxyStore.generatingProxies) {
    if (!dirPath) {
      if (!p.includes('/')) return true;
    } else {
      if (p.startsWith(`${dirPath}/`)) {
        const rel = p.slice(dirPath.length + 1);
        if (!rel.includes('/')) return true;
      }
    }
  }
  return false;
}

function folderHasVideos(entry: FsEntry): boolean {
  if (entry.kind !== 'directory') return false;
  const children = Array.isArray(entry.children) ? entry.children : [];
  return children.some((child) => {
    if (child.kind !== 'file') return false;
    const ext = child.name.split('.').pop()?.toLowerCase() ?? '';
    return ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext);
  });
}

function isVideo(entry: FsEntry): boolean {
  return entry.kind === 'file' && getMediaTypeFromFilename(entry.name) === 'video';
}

// --- Context menu ---
const { getContextMenuItems } = useFileContextMenu(
  {
    isGeneratingProxyInDirectory,
    folderHasVideos,
    isOpenableMediaFile: (entry: FsEntry) =>
      entry.kind === 'file' && isOpenableProjectFileName(entry.name),
    isConvertibleMediaFile: (entry: FsEntry) => {
      if (entry.kind !== 'file') return false;
      const type = getMediaTypeFromFilename(entry.name);
      return type === 'video' || type === 'audio' || type === 'image';
    },
    isTranscribableMediaFile,
    isVideo,
    getEntryMeta: (entry: FsEntry) => ({
      hasProxy: entry.path ? fileManager.mediaCache.hasProxy(entry.path) : false,
      generatingProxy: entry.path ? proxyStore.generatingProxies.has(entry.path) : false,
    }),
    isFilesPage: props.isFilesPage,
    getSelectedEntries: () => {
      const selected = selectionStore.selectedEntity;
      if (selected?.source === 'fileManager') {
        if (selected.kind === 'multiple') return selected.entries;
        if ('entry' in selected) return [selected.entry];
      }
      return [];
    },
  },
  (action: ContextMenuFileAction, entry: FsEntry | FsEntry[]) => onFileAction(action, entry),
);

const emptySpaceContextMenuItems = computed(() => {
  if (isRemoteMode.value) return [];
  const selected = selectionStore.selectedEntity;
  if (
    selected?.source === 'fileManager' &&
    selected.kind === 'multiple' &&
    selected.entries.length > 1
  ) {
    const first = selected.entries[0];
    if (!first) return [];
    return getContextMenuItems(first);
  }
  if (!filesPageStore.selectedFolder) return [];
  return getContextMenuItems(filesPageStore.selectedFolder);
});

// --- Marquee selection ---
function focusBrowserPanel() {
  focusStore.setPanelFocus('filesBrowser');
}

const { marqueeStyle, preventClickClear, onMarqueePointerDown, onMarqueePointerMove, onMarqueePointerUp } =
  useFileBrowserMarquee({ rootContainer, sortedEntries, onFocusPanel: focusBrowserPanel });

function handleContainerClick() {
  focusBrowserPanel();
  if (preventClickClear.value) return;
  selectionStore.clearSelection();
}

// --- Keyboard navigation ---
function onContainerKeyDown(e: KeyboardEvent) {
  const container = rootContainer.value;
  if (!container) return;
  const activeEl = document.activeElement as HTMLElement;
  if (activeEl?.tagName === 'INPUT') return;

  const items = Array.from(container.querySelectorAll<HTMLElement>('[tabindex="0"]'));
  if (items.length === 0) return;
  const currentIndex = items.indexOf(activeEl);

  if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  e.preventDefault();

  if (currentIndex === -1) {
    items[0]?.focus();
    return;
  }

  let nextIndex = currentIndex;
  const isGrid = filesPageStore.viewMode === 'grid';

  if (e.key === 'ArrowRight') {
    nextIndex = Math.min(currentIndex + 1, items.length - 1);
  } else if (e.key === 'ArrowLeft') {
    nextIndex = Math.max(currentIndex - 1, 0);
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    let cols = 1;
    if (isGrid && items[0]) {
      const firstTop = items[0].offsetTop;
      cols = 0;
      while (cols < items.length && items[cols]?.offsetTop === firstTop) cols++;
      cols = cols || 1;
    }
    nextIndex =
      e.key === 'ArrowDown'
        ? Math.min(currentIndex + cols, items.length - 1)
        : Math.max(currentIndex - cols, 0);
  }

  if (nextIndex !== currentIndex) items[nextIndex]?.focus();
}

// --- Grid size ---
const GRID_SIZES = [80, 100, 130, 160, 200];
const GRID_SIZE_NAMES = ['xs', 's', 'm', 'l', 'xl'];
const currentGridSizeName = computed(() => {
  const index = GRID_SIZES.indexOf(filesPageStore.gridCardSize);
  return GRID_SIZE_NAMES[index] || 'm';
});

// --- Column resize ---
const resizingColumn = ref<string | null>(null);
const resizeStartX = ref(0);
const resizeStartWidth = ref(0);

onUnmounted(() => {
  cleanupObjectUrls();
  document.removeEventListener('mousemove', onResizeMove);
  document.removeEventListener('mouseup', onResizeEnd);
});

// --- Watches that remain in component ---

watch(
  () => uiStore.pendingFsEntryRename,
  (value) => {
    const entry = value as FsEntry | null;
    if (!entry) return;
    const inCurrentFolder = folderEntries.value.some((e) => e.path === entry.path);
    if (inCurrentFolder) {
      startRename(entry);
      uiStore.pendingFsEntryRename = null;
    }
  },
);

watch(
  () => uiStore.pendingFsEntryCreateTimeline,
  async (value) => {
    const entry = value as FsEntry | null;
    if (!entry || entry.kind !== 'directory') return;
    try {
      await createTimelineInDirectory(entry);
    } finally {
      uiStore.pendingFsEntryCreateTimeline = null;
    }
  },
);

watch(
  () => uiStore.pendingFsEntryCreateMarkdown,
  async (value) => {
    const entry = value as FsEntry | null;
    if (!entry || entry.kind !== 'directory') return;
    try {
      await createMarkdownInDirectory(entry);
    } finally {
      uiStore.pendingFsEntryCreateMarkdown = null;
    }
  },
);

watch(
  () => uiStore.pendingRemoteDownloadRequest,
  async (request) => {
    if (!request) return;
    try {
      await performRemoteDownload(request);
    } catch (error) {
      if ((error as Error | undefined)?.name !== 'AbortError') {
        const toast = useToast();
        toast.add({
          color: 'error',
          title: t('common.error', 'Error'),
          description: error instanceof Error ? error.message : 'Remote download failed',
        });
      }
    } finally {
      uiStore.pendingRemoteDownloadRequest = null;
    }
  },
);

watch(
  () => uiStore.fileManagerUpdateCounter,
  async () => {
    if (skipNextUpdateReload.value) {
      skipNextUpdateReload.value = false;
      return;
    }
    await loadFolderContent();
    if (!pendingScrollToEntryPath.value) return;
    await nextTick();
    tryScrollToPendingEntry();
  },
);

// --- Create timeline / markdown in directory ---

async function createTimelineInDirectory(entry: FsEntry) {
  if (entry.kind !== 'directory') return;
  const existingInFolder = await readDirectory(entry.path);
  const existingNames = existingInFolder.map((e) => e.name);
  const createdPath = await createTimelineCommand({
    vfs,
    timelinesDirName: entry.path || undefined,
    existingNames,
  });
  await reloadDirectory(entry.path || '');
  uiStore.notifyFileManagerUpdate();
  await loadFolderContent();
  const createdEntry = findEntryByPath(createdPath);
  if (createdEntry) selectionStore.selectFsEntry(createdEntry);
}

async function createMarkdownInDirectory(entry: FsEntry) {
  if (entry.kind !== 'directory') return;
  if (entry.path) {
    const projectName = projectStore.currentProjectName;
    if (projectName) uiStore.setFileTreePathExpanded(projectName, entry.path, true);
  }
  const existingInFolder = await readDirectory(entry.path);
  const existingNames = existingInFolder.map((e) => e.name);
  const createdFileName = await createMarkdownCommand({ vfs, dirPath: entry.path, existingNames });
  await reloadDirectory(entry.path || '');
  uiStore.notifyFileManagerUpdate();
  await loadFolderContent();
  const createdPath = entry.path ? `${entry.path}/${createdFileName}` : createdFileName;
  const createdEntry = findEntryByPath(createdPath);
  if (createdEntry) selectionStore.selectFsEntry(createdEntry);
}

// --- Refresh ---

async function refreshFileTree() {
  if (isRemoteMode.value) {
    await loadFolderContent();
    return;
  }
  folderSizes.value = {};
  await loadProjectDirectory({ fullRefresh: true } as any);
}

// --- Entry interaction ---

function handleEntryClick(event: MouseEvent, entry: FsEntry) {
  if (isRemoteMode.value) {
    setSelectedFsEntry(entry);
    return;
  }

  const isL1 = isLayer1Active(event, workspaceStore.userSettings);
  const isL2 = isLayer2Active(event, workspaceStore.userSettings);

  if (isL2) {
    // Toggle selection
    const selected = selectionStore.selectedEntity;
    if (selected && selected.source === 'fileManager') {
      let currentEntries: FsEntry[] = [];
      if (selected.kind === 'multiple') {
        currentEntries = [...selected.entries];
      } else if (selected.kind === 'file' || selected.kind === 'directory') {
        currentEntries = [selected.entry];
      }

      const existingIndex = currentEntries.findIndex((e) => e.path === entry.path);
      if (existingIndex >= 0) {
        currentEntries.splice(existingIndex, 1);
        selectionStore.selectFsEntries(currentEntries);
      } else {
        selectionStore.selectFsEntries([...currentEntries, entry]);
      }
    } else {
      selectionStore.selectFsEntry(entry);
    }
  } else if (isL1) {
    // Range selection
    const selected = selectionStore.selectedEntity;
    if (selected && selected.source === 'fileManager') {
      const visibleEntries = sortedEntries.value;
      const targetIndex = visibleEntries.findIndex((e) => e.path === entry.path);

      let lastSelectedIndex = -1;
      if (selected.kind === 'multiple' && selected.entries.length > 0) {
        const lastSelected = selected.entries[selected.entries.length - 1];
        lastSelectedIndex = visibleEntries.findIndex((e) => e.path === lastSelected?.path);
      } else if ('path' in selected) {
        lastSelectedIndex = visibleEntries.findIndex((e) => e.path === selected.path);
      }

      if (lastSelectedIndex >= 0 && targetIndex >= 0) {
        const start = Math.min(lastSelectedIndex, targetIndex);
        const end = Math.max(lastSelectedIndex, targetIndex);
        const range = visibleEntries.slice(start, end + 1);
        selectionStore.selectFsEntries(range);
      } else {
        selectionStore.selectFsEntry(entry);
      }
    } else {
      selectionStore.selectFsEntry(entry);
    }
  } else {
    // Normal single selection
    filesPageStore.selectFile(entry);
  }
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

// --- Drag-and-drop within the browser panel ---
// Logic moved to useFileBrowserDragAndDrop

async function onDirectoryUploadChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = input.files ? Array.from(input.files) : [];
  input.value = '';

  const entry = directoryUploadTarget.value;
  if (!entry || entry.kind !== 'directory') return;
  if (files.length === 0) return;

  if (!entry.path) {
    await handleFiles(files);
  } else {
    await handleFiles(files, entry.path);
  }
  uiStore.notifyFileManagerUpdate();
  await loadFolderContent();
}

// Panel drop handled by useFileBrowserDragAndDrop
</script>

<template>
  <div
    class="flex flex-col h-full bg-ui-bg relative overflow-hidden transition-colors duration-150"
    :class="{
      'bg-primary-500/5 outline-2 outline-primary-500/30 -outline-offset-2': isDragOverPanel,
      'outline-2 outline-primary-500/60 -outline-offset-2 z-10':
        focusStore.isPanelFocused('filesBrowser'),
    }"
    @pointerdown.capture="focusBrowserPanel"
    @dragover.prevent="onPanelDragOver"
    @dragleave="onPanelDragLeave"
    @drop.prevent="onPanelDrop"
  >
    <!-- Navigation bar -->
    <FileBrowserBreadcrumbs
      v-if="
        (isRemoteMode && parentFolders.length > 0) ||
        (!isRemoteMode &&
          filesPageStore.selectedFolder &&
          filesPageStore.selectedFolder.path !== '')
      "
      :parent-folders="parentFolders"
      @navigate-back="navigateBack"
      @navigate-up="navigateUp"
      @navigate-to-folder="navigateToFolder"
    />

    <!-- Toolbar -->
    <FileBrowserToolbar
      :grid-sizes="GRID_SIZES"
      :current-grid-size-name="currentGridSizeName"
      :remote-available="isRemoteAvailable"
      @refresh="refreshFileTree"
      @open-remote="openRemoteExchangeModal"
    />

    <!-- Main Content -->
    <div
      ref="rootContainer"
      class="flex-1 overflow-auto p-4 content-scrollbar relative"
      tabindex="0"
      @click.self="handleContainerClick"
      @keydown="onContainerKeyDown"
      @pointerdown.capture="onMarqueePointerDown"
      @pointermove="onMarqueePointerMove"
      @pointerup="onMarqueePointerUp"
      @pointercancel="onMarqueePointerUp"
    >
      <div
        v-if="marqueeStyle"
        class="absolute border border-primary-400 bg-primary-400/15 rounded-sm pointer-events-none"
        :style="marqueeStyle"
      />
      <UContextMenu :items="emptySpaceContextMenuItems" class="min-h-full">
        <div class="min-h-full flex flex-col">
          <div
            v-if="!isRemoteMode && !filesPageStore.selectedFolder"
            class="flex flex-col items-center justify-center flex-1 text-ui-text-muted gap-2"
          >
            <UIcon name="i-heroicons-folder-open" class="w-12 h-12 opacity-20" />
            <span>{{
              t(
                'videoEditor.fileManager.selectFolderHint',
                'Select a folder in the sidebar to view its contents',
              )
            }}</span>
          </div>

          <div
            v-else-if="folderEntries.length === 0"
            class="flex flex-col items-center justify-center flex-1 text-ui-text-muted gap-2"
          >
            <UIcon name="i-heroicons-inbox" class="w-12 h-12 opacity-20" />
            <span>{{ t('common.empty', 'Folder is empty') }}</span>
          </div>

          <!-- Grid View -->
          <FileBrowserViewGrid
            v-else-if="filesPageStore.viewMode === 'grid'"
            :entries="sortedEntries as ExtendedFsEntry[]"
            :is-root-drop-over="isRootDropOver"
            :drag-over-entry-path="dragOverEntryPath"
            :current-grid-size-name="currentGridSizeName"
            :editing-entry-path="editingEntryPath"
            :folder-entries-names="folderEntries.map((e) => e.name)"
            :get-context-menu-items="getContextMenuItems"
            :is-generating-proxy-in-directory="isGeneratingProxyInDirectory"
            :video-thumbnails="videoThumbnails"
            @root-drag-over="onBrowserRootDragOver"
            @root-drag-leave="onBrowserRootDragLeave"
            @root-drop="onBrowserRootDrop"
            @entry-drag-start="onBrowserEntryDragStart"
            @entry-drag-end="onBrowserEntryDragEnd"
            @entry-drag-over="onBrowserEntryDragOver"
            @entry-drag-leave="onBrowserEntryDragLeave"
            @entry-drop="onBrowserEntryDrop"
            @entry-click="handleEntryClick"
            @entry-double-click="handleEntryDoubleClick"
            @entry-enter="handleEntryEnter"
            @commit-rename="commitRename"
            @stop-rename="stopRename"
            @file-action="onFileAction"
          />

          <!-- List View -->
          <FileBrowserViewList
            v-else
            :entries="sortedEntries as ExtendedFsEntry[]"
            :is-root-drop-over="isRootDropOver"
            :drag-over-entry-path="dragOverEntryPath"
            :folder-sizes-loading="folderSizesLoading"
            :folder-sizes="folderSizes"
            :editing-entry-path="editingEntryPath"
            :folder-entries-names="folderEntries.map((e) => e.name)"
            :get-context-menu-items="getContextMenuItems"
            :is-generating-proxy-in-directory="isGeneratingProxyInDirectory"
            :video-thumbnails="videoThumbnails"
            @root-drag-over="onBrowserRootDragOver"
            @root-drag-leave="onBrowserRootDragLeave"
            @root-drop="onBrowserRootDrop"
            @entry-drag-start="onBrowserEntryDragStart"
            @entry-drag-end="onBrowserEntryDragEnd"
            @entry-drag-over="onBrowserEntryDragOver"
            @entry-drag-leave="onBrowserEntryDragLeave"
            @entry-drop="onBrowserEntryDrop"
            @entry-click="handleEntryClick"
            @entry-double-click="handleEntryDoubleClick"
            @entry-enter="handleEntryEnter"
            @commit-rename="commitRename"
            @stop-rename="stopRename"
            @file-action="onFileAction"
            @sort="handleSort"
            @resize-start="onResizeStart"
          />
        </div>
      </UContextMenu>
    </div>

    <!-- Bottom Panel -->
    <FileBrowserStatusBar :stats="stats" />

    <!-- Hidden input for directory upload -->
    <input
      ref="directoryUploadInput"
      type="file"
      multiple
      class="hidden"
      @change="onDirectoryUploadChange"
    />

    <!-- Modals -->
    <FileBrowserModals
      :delete-targets="deleteTargets"
      :is-delete-confirm-modal-open="isDeleteConfirmModalOpen"
      :remote-transfer-open="remoteTransferOpen"
      :remote-transfer-progress="remoteTransferProgress"
      :remote-transfer-phase="remoteTransferPhase"
      :remote-transfer-file-name="remoteTransferFileName"
      :stt-transcription-modal-open="sttTranscriptionModalOpen"
      :stt-transcribing="sttTranscribing"
      :stt-transcription-error="sttTranscriptionError"
      :stt-transcription-entry="sttTranscriptionEntry"
      :stt-transcription-language="sttTranscriptionLanguage"
      @update:is-delete-confirm-modal-open="isDeleteConfirmModalOpen = $event"
      @update:stt-transcription-modal-open="sttTranscriptionModalOpen = $event"
      @update:stt-transcription-language="sttTranscriptionLanguage = $event"
      @delete-confirm="handleDeleteConfirm"
      @cancel-remote-transfer="cancelRemoteTransfer"
      @submit-transcription="submitTranscription"
    />
  </div>
</template>

<style scoped>
.content-scrollbar::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.content-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.content-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(var(--color-neutral-500), 0.1);
  border-radius: 3px;
}

.content-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(var(--color-neutral-500), 0.2);
}
</style>
