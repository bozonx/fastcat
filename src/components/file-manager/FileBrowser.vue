<script setup lang="ts">
import { ref, computed, watch, onUnmounted, onMounted, nextTick, inject } from 'vue';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useProjectStore } from '~/stores/project.store';
import { useUiStore } from '~/stores/ui.store';
import { useFocusStore } from '~/stores/focus.store';
import { useProxyStore } from '~/stores/proxy.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useFileManagerActions } from '~/composables/file-manager/useFileManagerActions';
import { useFileConversionStore } from '~/stores/file-conversion.store';
import { useFileContextMenu } from '~/composables/file-manager/useFileContextMenu';
import type { FileAction as ContextMenuFileAction } from '~/composables/file-manager/useFileContextMenu';
import { useFileBrowserDragAndDrop } from '~/composables/file-manager/useFileBrowserDragAndDrop';
import { useFileBrowserMarquee } from '~/composables/file-manager/useFileBrowserMarquee';
import {
  useFileBrowserEntries,
  type ExtendedFsEntry,
} from '~/composables/file-manager/useFileBrowserEntries';
import { useFileBrowserRemote } from '~/composables/file-manager/useFileBrowserRemote';
import { useFileBrowserNavigation } from '~/composables/file-manager/useFileBrowserNavigation';
import { useFileBrowserTranscription } from '~/composables/file-manager/useFileBrowserTranscription';
import { useFileBrowserFileActions } from '~/composables/file-manager/useFileBrowserFileActions';
import { useFocusableListNavigation } from '~/composables/file-manager/useFocusableListNavigation';
import { useFileBrowserPendingActions } from '~/composables/file-manager/useFileBrowserPendingActions';
import { useFileBrowserCreateActions } from '~/composables/file-manager/useFileBrowserCreateActions';
import { useFileBrowserInteraction } from '~/composables/file-manager/useFileBrowserInteraction';
import { useAppClipboard } from '~/composables/useAppClipboard';
import { isEditableTarget } from '~/utils/hotkeys/hotkeyUtils';
import type { FsEntry } from '~/types/fs';
import { getMediaTypeFromFilename, isOpenableProjectFileName } from '~/utils/media-types';
import {
  isGeneratingProxyInDirectory as hasGeneratingProxyInDirectory,
  folderHasVideos,
} from '~/utils/fs-entry-utils';
import FileBrowserToolbar from '~/components/file-manager/FileBrowserToolbar.vue';
import FileBrowserBreadcrumbs from '~/components/file-manager/FileBrowserBreadcrumbs.vue';
import FileBrowserViewGrid from '~/components/file-manager/FileBrowserViewGrid.vue';
import FileBrowserViewList from '~/components/file-manager/FileBrowserViewList.vue';
import FileBrowserModals from '~/components/file-manager/FileBrowserModals.vue';

import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';

const props = defineProps<{
  isFilesPage?: boolean;
  compact?: boolean;
  remoteModeOnly?: boolean;
  vfs?: IFileSystemAdapter;
  hideActions?: boolean;
}>();


const fileManagerStore = inject('fileManagerStore') as ReturnType<typeof useFileManagerStore> || useFileManagerStore();
const selectionStore = useSelectionStore();
const projectStore = useProjectStore();

const uiStore = useUiStore();
const focusStore = useFocusStore();
const proxyStore = useProxyStore();
const clipboardStore = useAppClipboard();
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
  copyEntry,
  findEntryByPath,
  resolveEntryByPath,
  reloadDirectory,
} = fileManager;

const vfs = props.vfs || fileManager.vfs;

const conversionStore = useFileConversionStore();

// --- STT ---
const stt = useFileBrowserTranscription();
const {
  transcriptionModalOpen,
  transcriptionLanguage,
  transcriptionError,
  isTranscribing,
  transcriptionEntry,
  isTranscribableMediaFile,
  openTranscriptionModal,
  submitTranscription,
} = stt;

const isRemoteMode = ref(!!props.remoteModeOnly);
const remoteCurrentFolder = ref<RemoteFsEntry | null>(null);

// --- Entries (folderEntries, sortedEntries, sizes, stats) ---
const entries = useFileBrowserEntries({ isRemoteMode, vfs });
const {
  folderEntries,
  folderSizes,
  folderSizesLoading,
  sortedEntries,
  videoThumbnails,
  fileCompatibility,
  calculateFolderSize,
  supplementEntries,
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
  targetNode.scrollIntoView({ block: 'nearest' });
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
  currentDragOperation,
  isRootDropOver,
  onRootDragEnter,
  onRootDragOver,
  onRootDragLeave,
  onRootDrop,
  onEntryDragStart,
  onEntryDragEnd,
  onEntryDragEnter,
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
  copyEntry,
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
  loadParentFolders: async () => {}, // Handled by navigation
  navigateToRoot: async () => {}, // Handled by navigation
  setSelectedFsEntry: (entry) => {
    if (entry) {
      handleEntryClick(new MouseEvent('click'), entry);
    } else {
      selectionStore.clearSelection();
    }
  },
  onEntryDragStart,
  onEntryDragEnd,
  onEntryDragEnter,
  onEntryDragOver,
  onEntryDragLeave,
  onEntryDrop,
  onRootDragEnter,
  onRootDragOver,
  onRootDragLeave,
  onRootDrop,
  handleFiles,
  vfs,
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
} = remote;

function toggleBloggerDogPanel() {
  if (!isRemoteAvailable.value) {
    uiStore.isEditorSettingsOpen = true;
  } else {
    fileManagerStore.isBloggerDogPanelVisible = !fileManagerStore.isBloggerDogPanelVisible;
  }
}

// --- Navigation ---
const navigation = useFileBrowserNavigation({
  rootContainer,
  isRemoteMode,
  remoteCurrentFolder,
  folderEntries,
  supplementEntries,
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
  tryScrollToPendingEntry,
} = navigation;

// Resolve forward refs
_loadFolderContent = loadFolderContent;

// --- Create timeline / markdown in directory ---
const { createTimelineInDirectory, createMarkdownInDirectory } = useFileBrowserCreateActions({
  vfs,
  readDirectory,
  reloadDirectory,
  loadFolderContent,
  findEntryByPath,
});

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
  copyEntry,
  moveEntry,
  notifyFileManagerUpdate: () => uiStore.notifyFileManagerUpdate(),
  setFileTreePathExpanded: (path, expanded) => {
    uiStore.setFileTreePathExpanded(path, expanded);
  },
  onAfterRename: () => {
    void loadFolderContent();
  },
  onAfterDelete: () => {
    void loadFolderContent();
  },
});

// --- File actions dispatcher ---
const { onFileAction } = useFileBrowserFileActions({
  folderEntries,
  loadFolderContent,
  onFileActionBase,
  conversionStore,
  openTranscriptionModal,
  vfs,
});

function isVideo(entry: FsEntry): boolean {
  return entry.kind === 'file' && getMediaTypeFromFilename(entry.name) === 'video';
}

function isDirectoryGeneratingProxy(entry: FsEntry): boolean {
  return hasGeneratingProxyInDirectory(entry, proxyStore.generatingProxies);
}

// --- Context menu ---
const { getContextMenuItems } = useFileContextMenu(
  {
    isGeneratingProxyInDirectory: isDirectoryGeneratingProxy,
    folderHasVideos,
    isOpenableMediaFile: (entry: FsEntry) => {
      if (entry.kind !== 'file' || !entry.path) return false;
      const status = fileCompatibility.value[entry.path]?.status;
      if (status === 'fully_unsupported' || status === 'corrupt') return false;
      return isOpenableProjectFileName(entry.name);
    },
    isConvertibleMediaFile: (entry: FsEntry) => {
      if (entry.kind !== 'file' || !entry.path) return false;
      const status = fileCompatibility.value[entry.path]?.status;
      if (status === 'fully_unsupported' || status === 'corrupt') return false;
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
    get hasClipboardItems() {
      return clipboardStore.hasFileManagerPayload;
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
  if (!fileManagerStore.selectedFolder) return [];
  return getContextMenuItems(fileManagerStore.selectedFolder);
});

// --- Marquee selection ---
function focusBrowserPanel() {
  focusStore.setPanelFocus('filesBrowser');
}

const {
  marqueeStyle,
  preventClickClear,
  onMarqueePointerDown,
  onMarqueePointerMove,
  onMarqueePointerUp,
} = useFileBrowserMarquee({ rootContainer, sortedEntries, onFocusPanel: focusBrowserPanel });

function handleContainerClick() {
  focusBrowserPanel();
  if (preventClickClear.value) return;

  if (isRemoteMode.value) {
    if (remoteCurrentFolder.value) {
      setSelectedFsEntry(remoteCurrentFolder.value as unknown as FsEntry);
    } else {
      selectionStore.clearSelection();
    }
  } else {
    const currentFolder = fileManagerStore.selectedFolder;
    if (currentFolder) {
      setSelectedFsEntry(currentFolder);
    } else {
      setSelectedFsEntry({
        kind: 'directory',
        path: '',
        name: projectStore.currentProjectName || 'Project',
      } as FsEntry);
    }
  }
}

// --- Keyboard navigation ---
const { onKeyDown: onContainerKeyDown, moveSelection } = useFocusableListNavigation({
  containerRef: rootContainer,
  horizontal: true,
  getColumnCount: () => {
    if (fileManagerStore.viewMode !== 'grid' || !rootContainer.value) return 1;
    const items = Array.from(rootContainer.value.querySelectorAll<HTMLElement>('[tabindex="0"]'));
    if (items.length === 0) return 1;
    const firstTop = items[0]?.offsetTop;
    let cols = 0;
    while (cols < items.length && items[cols]?.offsetTop === firstTop) cols++;
    return cols || 1;
  },
});

// --- Grid size ---
const GRID_SIZES = [80, 100, 130, 160, 200];
const GRID_SIZE_NAMES = ['xs', 's', 'm', 'l', 'xl'];

const effectiveGridCardSize = computed(() => {
  if (props.remoteModeOnly) return fileManagerStore.bloggerDogGridCardSize;
  return fileManagerStore.gridCardSize;
});

const currentGridSizeName = computed(() => {
  const index = GRID_SIZES.indexOf(effectiveGridCardSize.value);
  return GRID_SIZE_NAMES[index] || 'm';
});

// --- Column resize ---

onUnmounted(() => {});

onMounted(async () => {
  if (props.remoteModeOnly) {
    remoteCurrentFolder.value = buildRemoteDirectoryEntry('/');
    await loadFolderContent();
    await loadRemoteParentFolders(parentFolders);
  }
});

useFileBrowserPendingActions({
  folderEntries,
  startRename,
  createTimelineInDirectory,
  createMarkdownInDirectory,
  handlePendingRemoteDownloadRequest: async () => {
    const request = uiStore.pendingRemoteDownloadRequest;
    if (!request) return;
    try {
      await remote.performRemoteDownload(request);
    } catch (error) {
      if ((error as Error | undefined)?.name !== 'AbortError') {
        const toast = useToast();
        toast.add({
          color: 'error',
          title: t('common.error', 'Error'),
          description: error instanceof Error ? error.message : 'Remote download failed',
        });
      }
    }
  },
});

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

watch(
  () => uiStore.fileBrowserSelectAllTrigger,
  () => {
    if (!focusStore.isPanelFocused('filesBrowser')) return;
    if (isRemoteMode.value) return;

    const visibleItems = sortedEntries.value;
    const selected = selectionStore.selectedEntity;
    const selectedPaths =
      selected?.source === 'fileManager'
        ? selected.kind === 'multiple'
          ? selected.entries.map((entry) => entry.path)
          : [selected.entry.path]
        : [];
    const visiblePaths = visibleItems.map((entry) => entry.path);

    const isAllSelected =
      visibleItems.length > 0 &&
      selectedPaths.length === visiblePaths.length &&
      visiblePaths.every((path) => selectedPaths.includes(path));

    if (isAllSelected) {
      selectionStore.clearSelection();
      return;
    }

    selectionStore.selectFsEntries(visibleItems);
  },
);

watch(
  () => uiStore.fileBrowserNavigateBackTrigger,
  () => {
    if (!focusStore.isPanelFocused('filesBrowser')) return;
    void navigateBack();
  },
);

watch(
  () => uiStore.fileBrowserNavigateUpTrigger,
  () => {
    if (!focusStore.isPanelFocused('filesBrowser')) return;
    void navigateUp();
  },
);

watch(
  () => uiStore.fileBrowserMoveSelectionTrigger,
  (trigger) => {
    if (!focusStore.isPanelFocused('filesBrowser')) return;
    moveSelection(trigger.dir);
  },
);

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

const { handleEntryClick, handleEntryDoubleClick, handleEntryEnter, handleSort, onResizeStart } =
  useFileBrowserInteraction({
    isRemoteMode,
    remoteCurrentFolder,
    sortedEntries,
    loadFolderContent,
    loadParentFolders,
    setSelectedFsEntry,
    onFileAction,
  });

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
    class="panel-focus-frame flex flex-col h-full bg-ui-bg relative overflow-hidden transition-colors duration-150"
    :class="{
      'bg-primary-500/5': isDragOverPanel,
      'panel-focus-frame--active': focusStore.isPanelFocused('filesBrowser'),
    }"
    @pointerdown.capture="focusBrowserPanel"
    @dragover.prevent="onPanelDragOver"
    @dragleave="onPanelDragLeave"
    @drop.prevent="onPanelDrop"
  >
    <!-- Toolbar -->
    <FileBrowserToolbar
      :grid-sizes="GRID_SIZES"
      :current-grid-size-name="currentGridSizeName"
      :grid-card-size="effectiveGridCardSize"
      :remote-available="isRemoteAvailable"
      :is-remote-panel="props.remoteModeOnly"
      :compact="compact"
      :hide-actions="hideActions"
      @refresh="refreshFileTree"

      @open-remote="toggleBloggerDogPanel"
      @create-folder="
        () =>
          onFileAction(
            'createFolder',
            fileManagerStore.selectedFolder ||
              ({ kind: 'directory', path: '', name: '' } as FsEntry),
          )
      "
      @upload="
        () =>
          onFileAction(
            'upload',
            fileManagerStore.selectedFolder ||
              ({ kind: 'directory', path: '', name: '' } as FsEntry),
          )
      "
    />

    <!-- Navigation bar (Breadcrumbs) -->
    <FileBrowserBreadcrumbs
      v-if="
        (isRemoteMode && parentFolders.length > 0) ||
        (!isRemoteMode && fileManagerStore.selectedFolder)
      "
      :parent-folders="parentFolders"
      @navigate-back="navigateBack"
      @navigate-up="navigateUp"
      @navigate-to-folder="navigateToFolder"
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
        <div class="min-h-full flex flex-col" @click.self="handleContainerClick">
          <div
            v-if="!isRemoteMode && !fileManagerStore.selectedFolder"
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
            v-else-if="props.remoteModeOnly || fileManagerStore.viewMode === 'grid'"
            :entries="sortedEntries as ExtendedFsEntry[]"
            :is-root-drop-over="isRootDropOver"
            :drag-over-entry-path="dragOverEntryPath"
            :current-drag-operation="currentDragOperation"
            :current-grid-size-name="currentGridSizeName"
            :current-grid-card-size="effectiveGridCardSize"
            :editing-entry-path="editingEntryPath"
            :folder-entries-names="folderEntries.map((e) => e.name)"
            :get-context-menu-items="getContextMenuItems"
            :is-generating-proxy-in-directory="isDirectoryGeneratingProxy"
            :video-thumbnails="videoThumbnails"
            :file-compatibility="fileCompatibility"
            @entry-drag-start="onEntryDragStart"
            @entry-drag-end="onEntryDragEnd"
            @entry-drag-enter="onEntryDragEnter"
            @entry-drag-over="onEntryDragOver"
            @entry-drag-leave="onEntryDragLeave"
            @entry-drop="onEntryDrop"
            @root-drag-enter="onRootDragEnter"
            @root-drag-over="onRootDragOver"
            @root-drag-leave="onRootDragLeave"
            @root-drop="onRootDrop"
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
            :current-drag-operation="currentDragOperation"
            :folder-sizes-loading="folderSizesLoading"
            :folder-sizes="folderSizes"
            :editing-entry-path="editingEntryPath"
            :folder-entries-names="folderEntries.map((e) => e.name)"
            :get-context-menu-items="getContextMenuItems"
            :is-generating-proxy-in-directory="isDirectoryGeneratingProxy"
            :video-thumbnails="videoThumbnails"
            :file-compatibility="fileCompatibility"
            @entry-drag-start="onEntryDragStart"
            @entry-drag-end="onEntryDragEnd"
            @entry-drag-enter="onEntryDragEnter"
            @entry-drag-over="onEntryDragOver"
            @entry-drag-leave="onEntryDragLeave"
            @entry-drop="onEntryDrop"
            @root-drag-enter="onRootDragEnter"
            @root-drag-over="onRootDragOver"
            @root-drag-leave="onRootDragLeave"
            @root-drop="onRootDrop"
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
      :transcription-modal-open="transcriptionModalOpen"
      :is-transcribing="isTranscribing"
      :transcription-error="transcriptionError"
      :transcription-entry="transcriptionEntry"
      :transcription-language="transcriptionLanguage"
      @update:is-delete-confirm-modal-open="isDeleteConfirmModalOpen = $event"
      @update:transcription-modal-open="transcriptionModalOpen = $event"
      @update:transcription-language="transcriptionLanguage = $event"
      @delete-confirm="handleDeleteConfirm"
      @cancel-remote-transfer="() => {}"
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
