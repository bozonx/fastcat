<script setup lang="ts">
import { ref, computed, watch, onUnmounted, onMounted, nextTick, inject } from 'vue';
import { useFileManagerStore, useFileBrowserPersistenceStore } from '~/stores/file-manager.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useProjectStore } from '~/stores/project.store';
import { useUiStore } from '~/stores/ui.store';
import { useFocusStore } from '~/stores/focus.store';
import { useProxyStore } from '~/stores/proxy.store';
import { useMediaStore } from '~/stores/media.store';
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
import { useSttTranscription } from '~/composables/file-manager/useSttTranscription';
import { useFileBrowserFileActions } from '~/composables/file-manager/useFileBrowserFileActions';
import { useFocusableListNavigation } from '~/composables/file-manager/useFocusableListNavigation';
import { useFileBrowserPendingActions } from '~/composables/file-manager/useFileBrowserPendingActions';
import { useFileBrowserCreateActions } from '~/composables/file-manager/useFileBrowserCreateActions';
import { useFileBrowserInteraction } from '~/composables/file-manager/useFileBrowserInteraction';
import { createRemoteCollection } from '~/utils/remote-vfs';
import { handleFilesCommand } from '~/file-manager/application/fileManagerCommands';
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
import FileNameModal from '~/components/file-manager/modals/FileNameModal.vue';

import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';

const props = defineProps<{
  // Unique identifier for this file manager instance.
  // Used for independent focus, state, and selection.
  instanceId?: string;
  isFilesPage?: boolean;
  compact?: boolean;
  remoteModeOnly?: boolean;
  vfs?: IFileSystemAdapter;
  hideActions?: boolean;
  hideUpload?: boolean;
  hideFocusFrame?: boolean;
  rootName?: string;
  preventOpen?: boolean;
}>();

const instanceId = props.instanceId || 'default';
const safeHideFocusFrame = computed(() => props?.hideFocusFrame ?? false);

const fileManagerStore =
  (inject('fileManagerStore', null) as ReturnType<typeof useFileManagerStore> | null) ||
  useFileManagerStore();
const persistenceStore = useFileBrowserPersistenceStore();
const selectionStore = useSelectionStore();
const projectStore = useProjectStore();

const uiStore = useUiStore();
const focusStore = useFocusStore();
const proxyStore = useProxyStore();
const mediaStore = useMediaStore();
const clipboardStore = useAppClipboard();
const { t } = useI18n();
const toast = useToast();
const runtimeConfig = useRuntimeConfig();

const fileManager = useFileManager();
const {
  readDirectory,
  loadProjectDirectory,
  createFolder,
  renameEntry,
  deleteEntry,
  handleFiles: handleFilesBase,
  moveEntry,
  copyEntry,
  findEntryByPath,
  resolveEntryByPath,
  reloadDirectory,
} = fileManager;

const vfs = props.vfs || fileManager.vfs;

const conversionStore = useFileConversionStore();

// --- STT ---
const stt = useSttTranscription({
  fastcatAccountApiUrl: computed(() =>
    typeof runtimeConfig.public.fastcatAccountApiUrl === 'string'
      ? runtimeConfig.public.fastcatAccountApiUrl
      : '',
  ),
  vfs: props.vfs || fileManager.vfs,
  onSuccess: ({ cached, mediaType }) => {
    toast.add({
      title: cached
        ? t('videoEditor.fileManager.audio.transcriptionCached', 'Using cached transcription')
        : t('videoEditor.fileManager.audio.transcriptionCompleted', 'Transcription completed'),
      description: cached
        ? t(
            'videoEditor.fileManager.audio.transcriptionCachedDescription',
            'Cached transcription was loaded from the file directory.',
          )
        : mediaType === 'video'
          ? t(
              'videoEditor.fileManager.audio.transcriptionSavedVideoDescription',
              'Video audio track was transcribed and saved next to the source file.',
            )
          : t(
              'videoEditor.fileManager.audio.transcriptionSavedDescription',
              'Transcription was saved next to the source file.',
            ),
      color: 'success',
    });
  },
  onError: (message) => {
    toast.add({
      title: t('videoEditor.fileManager.audio.transcriptionFailed', 'Failed to transcribe media'),
      description: message,
      color: 'danger',
    });
  },
});
const {
  modalOpen: transcriptionModalOpen,
  language: transcriptionLanguage,
  errorMessage: transcriptionError,
  isTranscribing,
  isModelReady: isSttModelReady,
  pendingEntry: transcriptionEntry,
  isTranscribableMediaFile,
  openModal: openTranscriptionModal,
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
  selectionStore.selectFsEntry(entry, instanceId);
}

// --- Remote ---
// Forward declaration for DnD wrappers
let remoteApi: any = null;

async function handleCrossVfsCopyEntry(params: { source: FsEntry; targetDirPath: string }) {
  if (params.source.source === 'remote') {
    if (!remoteApi) return;
    return await remoteApi.performRemoteDownload({
      entry: params.source as any,
      targetDirPath: params.targetDirPath,
    });
  }
  return await copyEntry(params);
}

async function handleCrossVfsMoveEntry(params: { source: FsEntry; targetDirPath: string }) {
  if (params.source.source === 'remote') {
    // User requested: "ладно, пока move не делаем, только копирование"
    return await handleCrossVfsCopyEntry(params);
  }
  return await moveEntry(params);
}

// --- DragAndDrop (needs loadFolderContent forward-ref) ---
const skipNextUpdateReload = ref(false);

// Forward ref — assigned after navigation is created
let _loadFolderContent: () => Promise<void> = async () => {};

const isExternal = computed(() => !!props.vfs);

const {
  isDragOverPanel,
  dragOverEntryPath,
  currentDragOperation,
  isRootDropOver,
  onEntryDragStart: onEntryDragStartBase,
  onEntryDragEnd: onEntryDragEndBase,
  onEntryDragEnter: onEntryDragEnterBase,
  onEntryDragOver: onEntryDragOverBase,
  onEntryDragLeave: onEntryDragLeaveBase,
  onEntryDrop: onEntryDropBase,
  onRootDragEnter: onRootDragEnterBase,
  onRootDragOver: onRootDragOverBase,
  onRootDragLeave: onRootDragLeaveBase,
  onRootDrop: onRootDropBase,
  onPanelDragOver,
  onPanelDragLeave,
  onPanelDrop,
} = useFileBrowserDragAndDrop({
  findEntryByPath,
  resolveEntryByPath,
  handleFiles,
  moveEntry: handleCrossVfsMoveEntry,
  copyEntry: handleCrossVfsCopyEntry,
  loadFolderContent: () => _loadFolderContent(),
  notifyFileManagerUpdate: () => {
    skipNextUpdateReload.value = true;
    uiStore.notifyFileManagerUpdate();
  },
  fileManagerInstanceId: instanceId,
  isExternal: isExternal.value,
});

async function handleRemoteFiles(files: File[] | FileList, targetDirPath?: string) {
  const fileList = files instanceof FileList ? Array.from(files) : files;
  await handleFilesCommand(
    fileList,
    { targetDirPath },
    {
      vfs,
      getTargetDirPath: async ({ file }) => await fileManager.resolveDefaultTargetDir({ file }),
      onSkipProjectFile: ({ file }) => {
        toast.add({
          color: 'neutral',
          title: t('videoEditor.fileManager.skipOtio.title'),
          description: t('videoEditor.fileManager.skipOtio.description', {
            fileName: file.name,
          }),
        });
      },
      onMediaImported: ({ projectRelativePath }) => {
        // Handle media imported
        void mediaStore.getOrFetchMetadataByPath(projectRelativePath);
      },
    },
  );
  uiStore.notifyFileManagerUpdate();
}

async function handleFiles(files: File[] | FileList, targetDirPath?: string) {
  if (isRemoteMode.value) {
    return handleRemoteFiles(files, targetDirPath);
  }
  return handleFilesBase(files, targetDirPath);
}

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
  onEntryDragStart: onEntryDragStartBase,
  onEntryDragEnd: onEntryDragEndBase,
  onEntryDragEnter: onEntryDragEnterBase,
  onEntryDragOver: onEntryDragOverBase,
  onEntryDragLeave: onEntryDragLeaveBase,
  onEntryDrop: onEntryDropBase,
  onRootDragEnter: onRootDragEnterBase,
  onRootDragOver: onRootDragOverBase,
  onRootDragLeave: onRootDragLeaveBase,
  onRootDrop: onRootDropBase,
  handleFiles,
  vfs,
});

remoteApi = remote;

const {
  remoteTransferOpen,
  remoteTransferProgress,
  remoteTransferPhase,
  remoteTransferFileName,
  isRemoteAvailable,
  buildRemoteDirectoryEntry,
  loadRemoteFolderContent,
  loadRemoteParentFolders,
  remoteError,
  remoteHasMore,
  isLoadingMore,
  onBrowserEntryDragStart,
  onBrowserEntryDragEnd,
  onBrowserEntryDragEnter,
  onBrowserEntryDragOver,
  onBrowserEntryDragLeave,
  onBrowserEntryDrop,
  onBrowserRootDragEnter,
  onBrowserRootDragOver,
  onBrowserRootDragLeave,
  onBrowserRootDrop,
} = remote;

function onEntryDragStart(e: DragEvent, entry: FsEntry) {
  return onBrowserEntryDragStart(e, entry);
}

function onEntryDragEnd() {
  return onBrowserEntryDragEnd();
}

function onEntryDragEnter(e: DragEvent, entry: FsEntry) {
  return onBrowserEntryDragEnter(e, entry);
}

function onEntryDragOver(e: DragEvent, entry: FsEntry) {
  return onBrowserEntryDragOver(e, entry);
}

function onEntryDragLeave(e: DragEvent, entry: FsEntry) {
  return onBrowserEntryDragLeave(e, entry);
}

function onEntryDrop(e: DragEvent, entry: FsEntry) {
  return onBrowserEntryDrop(e, entry);
}

function onRootDragEnter(e: DragEvent) {
  return onBrowserRootDragEnter(e);
}

function onRootDragOver(e: DragEvent) {
  return onBrowserRootDragOver(e);
}

function onRootDragLeave(e: DragEvent) {
  return onBrowserRootDragLeave(e);
}

function onRootDrop(e: DragEvent) {
  return onBrowserRootDrop(e);
}

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
  rootName: props.rootName || projectStore.currentProjectName || 'Project',
});
const {
  parentFolders,
  loadFolderContent,
  loadParentFolders,
  navigateBack,
  navigateForward,
  navigateUp,
  navigateToFolder,
  tryScrollToPendingEntry,
} = navigation;

const isAtRoot = computed(() => {
  if (isRemoteMode.value) {
    return (
      !remoteCurrentFolder.value ||
      remoteCurrentFolder.value.remotePath === '/remote' ||
      remoteCurrentFolder.value.remotePath === '/'
    );
  } else {
    return !fileManagerStore.selectedFolder || !fileManagerStore.selectedFolder.path;
  }
});

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

// --- Create subgroup (remote) ---
const isSubgroupModalOpen = ref(false);
const pendingSubgroupParent = ref<FsEntry | null>(null);

function handlePendingBloggerDogCreateSubgroup(entry: FsEntry) {
  pendingSubgroupParent.value = entry;
  isSubgroupModalOpen.value = true;
  uiStore.pendingBloggerDogCreateSubgroup = null;
}

async function onSubgroupCreateConfirm(name: string) {
  const config = remote.remoteFilesConfig.value;
  const parent = pendingSubgroupParent.value;
  if (!config || !parent) return;

  try {
    const parentId = parent.remoteId;
    const newCollection = await createRemoteCollection({
      config,
      name,
      parentId,
    });

    // Navigate to new subgroup
    const newEntry = remote.buildRemoteDirectoryEntry(newCollection.path);
    // Explicitly merge remoteId and other required fields
    newEntry.remoteData = newCollection;

    remoteCurrentFolder.value = newEntry;
    await loadFolderContent();
    await loadParentFolders();
    uiStore.notifyFileManagerUpdate();
  } catch (error) {
    const toast = useToast();
    toast.add({
      color: 'error',
      title: t('common.error', 'Error'),
      description: error instanceof Error ? error.message : 'Failed to create subgroup',
    });
  } finally {
    isSubgroupModalOpen.value = false;
    pendingSubgroupParent.value = null;
  }
}

// --- Create content item (remote) ---
const isItemModalOpen = ref(false);
const pendingItemParent = ref<FsEntry | null>(null);

function handlePendingBloggerDogCreateItem(entry: FsEntry) {
  pendingItemParent.value = entry;
  isItemModalOpen.value = true;
  uiStore.pendingBloggerDogCreateItem = null;
}

async function onItemCreateConfirm(name: string) {
  const parent = pendingItemParent.value;
  if (!parent) return;

  try {
    const parentPath = parent.path;
    const finalName = name.includes('.') ? name : `${name}.txt`;
    const filePath = parentPath === '/' ? `/${finalName}` : `${parentPath}/${finalName}`;

    // Create empty item by writing an empty blob
    await vfs.writeFile(filePath, new Blob([], { type: 'text/plain' }));

    await loadFolderContent();
    uiStore.notifyFileManagerUpdate();
  } catch (error) {
    const toast = useToast();
    toast.add({
      color: 'error',
      title: t('common.error', 'Error'),
      description: error instanceof Error ? error.message : 'Failed to create item',
    });
  } finally {
    isItemModalOpen.value = false;
    pendingItemParent.value = null;
  }
}

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
  openDeleteConfirmModal,
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
  focusStore.setPanelFocus(`dynamic:file-manager:${instanceId}`);
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
    if (remoteCurrentFolder.value && !remoteError.value && isRemoteAvailable.value) {
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
        name: props.rootName || projectStore.currentProjectName || 'Project',
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

function handleScroll(e: Event) {
  if (!isRemoteMode.value || !remoteHasMore.value || isLoadingMore.value) return;

  const container = e.target as HTMLElement;
  const { scrollTop, scrollHeight, clientHeight } = container;

  if (scrollTop + clientHeight >= scrollHeight - 300) {
    void loadFolderContent({ append: true });
  }
}

// --- Grid size ---
const GRID_SIZES = [80, 100, 130, 160, 200];
const GRID_SIZE_NAMES = ['xs', 's', 'm', 'l', 'xl'];

const effectiveGridCardSize = computed(() => {
  if (props.remoteModeOnly) return persistenceStore.bloggerDogGridCardSize;
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
  openDeleteConfirmModal,
  instanceId,
  handlePendingBloggerDogCreateSubgroup,
  handlePendingBloggerDogCreateItem,
  onCreateFolder: (entry) => onFileAction('createFolder', entry),
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
    if (!focusStore.isPanelFocused(`dynamic:file-manager:${instanceId}`)) return;
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

    selectionStore.selectFsEntries(visibleItems, instanceId);
  },
);

watch(
  () => uiStore.fileBrowserNavigateBackTrigger,
  () => {
    if (!focusStore.isPanelFocused(`dynamic:file-manager:${instanceId}`)) return;
    void navigateBack();
  },
);

watch(
  () => uiStore.fileBrowserNavigateForwardTrigger,
  () => {
    if (!focusStore.isPanelFocused(`dynamic:file-manager:${instanceId}`)) return;
    void navigateForward();
  },
);

watch(
  () => uiStore.fileBrowserNavigateUpTrigger,
  () => {
    if (!focusStore.isPanelFocused(`dynamic:file-manager:${instanceId}`)) return;
    if (isAtRoot.value) return;
    void navigateUp();
  },
);

watch(
  () => uiStore.fileBrowserMoveSelectionTrigger,
  (trigger) => {
    if (!focusStore.isPanelFocused(`dynamic:file-manager:${instanceId}`)) return;
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
    preventOpen: props.preventOpen,
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
    class="flex flex-col h-full bg-ui-bg relative overflow-hidden transition-colors duration-150"
    :class="{
      'panel-focus-frame': !safeHideFocusFrame,
      'bg-primary-500/5': isDragOverPanel,
      'panel-focus-frame--active':
        !safeHideFocusFrame && focusStore.isPanelFocused(`dynamic:file-manager:${instanceId}`),
    }"
    @pointerdown.capture="focusBrowserPanel"
    @dragover.prevent="onPanelDragOver"
    @dragleave="onPanelDragLeave"
    @drop.prevent="onPanelDrop"
  >
    <!-- Toolbar -->
    <FileBrowserToolbar
      v-if="!(remoteModeOnly && (!isRemoteAvailable || remoteError))"
      :grid-sizes="GRID_SIZES"
      :current-grid-size-name="currentGridSizeName"
      :grid-card-size="effectiveGridCardSize"
      :remote-available="isRemoteAvailable"
      :is-remote-panel="remoteModeOnly"
      :compact="compact"
      :hide-actions="hideActions"
      :hide-upload="hideUpload"
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
      v-if="!compact"
      :parent-folders="parentFolders"
      :is-at-root="isAtRoot"
      :can-navigate-back="fileManagerStore.historyStack.length > 0"
      :can-navigate-forward="fileManagerStore.futureStack.length > 0"
      @navigate-back="navigateBack"
      @navigate-forward="navigateForward"
      @navigate-up="navigateUp"
      @navigate-to-folder="navigateToFolder"
    />

    <!-- Main Content -->
    <div
      ref="rootContainer"
      class="flex-1 overflow-auto p-4 content-scrollbar relative"
      tabindex="0"
      @scroll.passive="handleScroll"
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
            v-else-if="isRemoteMode && remoteError"
            class="flex flex-col items-center justify-center flex-1 text-ui-text-dim text-center p-6 gap-6"
          >
            <div class="p-6 rounded-full bg-error-500/10">
              <UIcon
                name="i-heroicons-exclamation-circle"
                class="w-16 h-16 text-error-500 opacity-80"
              />
            </div>
            <div class="space-y-2 max-w-[320px]">
              <h3 class="text-xl font-semibold text-ui-text">
                {{ t('fastcat.fileManager.remote.load_error_title', 'Connection Error') }}
              </h3>
              <p class="text-sm text-ui-text-dim leading-relaxed">
                {{ remoteError }}
              </p>
            </div>
            <div class="flex gap-3">
              <UButton
                color="primary"
                variant="solid"
                icon="i-heroicons-arrow-path"
                @click.stop="() => loadFolderContent()"
              >
                {{ t('common.retry', 'Retry') }}
              </UButton>
            </div>
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
            v-else-if="remoteModeOnly || fileManagerStore.viewMode === 'grid'"
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
            :instance-id="instanceId"
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
            :instance-id="instanceId"
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

          <!-- Pagination Loader -->
          <div
            v-if="isRemoteMode && (isLoadingMore || remoteHasMore)"
            class="w-full flex items-center justify-center p-8 min-h-[100px]"
          >
            <UIcon
              v-if="isLoadingMore"
              name="i-heroicons-arrow-path"
              class="w-8 h-8 animate-spin text-primary-500/50"
            />
            <div v-else class="text-ui-text-dim/30 text-xs font-medium uppercase tracking-widest">
              {{ t('common.scroll_for_more', 'Scroll for more') }}
            </div>
          </div>
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
      v-model:is-delete-confirm-modal-open="isDeleteConfirmModalOpen"
      v-model:transcription-modal-open="transcriptionModalOpen"
      v-model:transcription-language="transcriptionLanguage"
      v-model:is-subgroup-modal-open="isSubgroupModalOpen"
      v-model:is-item-modal-open="isItemModalOpen"
      :delete-targets="deleteTargets"
      :remote-transfer-open="remoteTransferOpen"
      :remote-transfer-progress="remoteTransferProgress"
      :remote-transfer-phase="remoteTransferPhase"
      :remote-transfer-file-name="remoteTransferFileName"
      :is-transcribing="isTranscribing"
      :is-model-ready="isSttModelReady"
      :transcription-error="transcriptionError"
      :transcription-entry="transcriptionEntry"
      @delete-confirm="handleDeleteConfirm"
      @cancel-remote-transfer="remote.cancelRemoteTransfer"
      @submit-transcription="submitTranscription"
      @subgroup-confirm="onSubgroupCreateConfirm"
      @item-confirm="onItemCreateConfirm"
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
