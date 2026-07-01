<script setup lang="ts">
import { ref, computed, inject } from 'vue';
import { getActiveElement } from '~/utils/browser-api';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useProjectStore } from '~/stores/project.store';
import { useUiStore } from '~/stores/ui.store';
import { useFocusStore } from '~/stores/focus.store';
import { useProxyStore } from '~/stores/proxy.store';
import { useMediaStore } from '~/stores/media.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useFileBrowserShared } from '~/composables/file-manager/useFileBrowserShared';
import { useFileBrowserDragAndDrop } from '~/composables/file-manager/useFileBrowserDragAndDrop';
import { useFileBrowserMarquee } from '~/composables/file-manager/useFileBrowserMarquee';
import { useFileBrowserEntries } from '~/composables/file-manager/useFileBrowserEntries';
import { useFileBrowserRemote } from '~/composables/file-manager/useFileBrowserRemote';
import { useFileBrowserNavigation } from '~/composables/file-manager/useFileBrowserNavigation';

import { useFileBrowserPendingActions } from '~/composables/file-manager/useFileBrowserPendingActions';
import { useFileBrowserCreateActions } from '~/composables/file-manager/useFileBrowserCreateActions';
import { useFileBrowserInteraction } from '~/composables/file-manager/useFileBrowserInteraction';
import { useFileBrowserRemoteCreate } from '~/composables/file-manager/useFileBrowserRemoteCreate';
import { useFileBrowserLifecycle } from '~/composables/file-manager/useFileBrowserLifecycle';
import { useFileBrowserBulkSelection } from '~/composables/file-manager/useFileBrowserBulkSelection';
import { useFileBrowserContainer } from '~/composables/file-manager/useFileBrowserContainer';
import { useFileBrowserContextMenuState } from '~/composables/file-manager/useFileBrowserContextMenuState';
import { useFileBrowserViewSettings } from '~/composables/file-manager/useFileBrowserViewSettings';
import { handleFilesCommand } from '~/file-manager/application/fileManagerCommands';
import { useAppClipboard } from '~/composables/useAppClipboard';
import type { FsEntry } from '~/types/fs';
import type { RemoteFsEntry } from '~/utils/remote-vfs';
import type { MediaType } from '~/utils/media-types';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import FileBrowserToolbar from '~/components/file-manager/FileBrowserToolbar.vue';
import FileBrowserBreadcrumbs from '~/components/file-manager/FileBrowserBreadcrumbs.vue';
import FileBrowserContent from '~/components/file-manager/FileBrowserContent.vue';
import FileBrowserModals from '~/components/file-manager/FileBrowserModals.vue';

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
  hideViewSwitcher?: boolean;
  hideBreadcrumbs?: boolean;
  hideSelectUnused?: boolean;
  rootName?: string;
  preventOpen?: boolean;
  hideToolbar?: boolean;
  singleClickFolders?: boolean;
  disableMarquee?: boolean;
  allowedMediaTypes?: MediaType[];
  excludedPaths?: string[];
  isolatedSelection?: boolean;
  hideUsageIndicators?: boolean;
}>();

const emit = defineEmits<{
  (e: 'select', entry: FsEntry | null): void;
}>();

const instanceId = props.instanceId || 'default';
const safeHideFocusFrame = computed(() => props?.hideFocusFrame ?? false);

const fileManagerStore =
  (inject('fileManagerStore', null) as ReturnType<typeof useFileManagerStore> | null) ||
  useFileManagerStore();
const selectionStore = useSelectionStore();
const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();

const uiStore = useUiStore();
const focusStore = useFocusStore();
const proxyStore = useProxyStore();
const mediaStore = useMediaStore();
const timelineMediaUsageStore = useTimelineMediaUsageStore();
const clipboardStore = useAppClipboard();
const { t } = useI18n();
const toast = useToast();
const fileManager = useFileManager();
const isolatedSelectedEntry = ref<FsEntry | null>(null);
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
clipboardStore.registerFileManagerVfs(instanceId, vfs);

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
const {
  rootContainer,
  pendingScrollToEntryPath,
  rootSpacerStyle,
  setRootContainerRef,
  scrollToEntryPath,
} = useFileBrowserContainer();

// --- setSelectedFsEntry (shared between remote & navigation) ---
function setSelectedFsEntry(entry: FsEntry | null) {
  if (props.isolatedSelection) {
    isolatedSelectedEntry.value = entry;
    emit('select', entry);
    return;
  }

  if (!entry) {
    selectionStore.clearSelection();
    return;
  }
  selectionStore.selectFsEntryWithUiUpdate(entry, instanceId, isExternal.value);
}

function getSelectedEntries(): FsEntry[] {
  if (props.isolatedSelection) {
    return isolatedSelectedEntry.value ? [isolatedSelectedEntry.value] : [];
  }

  const selectedEntity = selectionStore.selectedEntity;
  if (!selectedEntity || selectedEntity.source !== 'fileManager') return [];
  if (selectedEntity.kind === 'multiple') return selectedEntity.entries;
  return [selectedEntity.entry];
}

const excludedPathSet = computed(() => new Set(props.excludedPaths ?? []));
const visibleEntries = computed(() =>
  sortedEntries.value.filter((entry) => !entry.path || !excludedPathSet.value.has(entry.path)),
);
const selectedEntryPaths = computed(() =>
  props.isolatedSelection && isolatedSelectedEntry.value?.path
    ? [isolatedSelectedEntry.value.path]
    : undefined,
);

const isExternal = computed(() => !!props.vfs);

const bulkSelection = useFileBrowserBulkSelection({
  getVisibleEntries: () => visibleEntries.value,
  getSelectedEntries,
  selectEntries: (entries, nextInstanceId, nextIsExternal) => {
    selectionStore.selectFsEntries(entries, nextInstanceId, nextIsExternal);
  },
  clearSelection: selectionStore.clearSelection,
  getUsedPaths: () => new Set(Object.keys(timelineMediaUsageStore.mediaPathToTimelines)),
  refreshUsage: async () => await timelineMediaUsageStore.refreshUsage(),
  instanceId,
  isExternal: isExternal.value,
});

// --- Remote ---
// Forward declaration for DnD wrappers
let remoteApi: {
  performRemoteDownload: (params: { entry: FsEntry; targetDirPath: string }) => Promise<void>;
} | null = null;

async function handleCrossVfsCopyEntry(params: { source: FsEntry; targetDirPath: string }) {
  if (params.source.source === 'remote') {
    if (!remoteApi) return;
    return await remoteApi.performRemoteDownload({
      entry: params.source as FsEntry,
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

fileManagerStore.setSelectionContext({
  instanceId,
  isExternal: isExternal.value,
});

const {
  dragOverEntryPath,
  currentDragOperation,
  startEntryDrag,
  handleInternalDragOver,
  handleInternalDragLeave,
  handleInternalDrop,
  onRootDragEnter: onRootDragEnterBase,
  onRootDragOver: onRootDragOverBase,
  onRootDragLeave: onRootDragLeaveBase,
  onRootDrop: onRootDropBase,
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
  vfs,
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

async function handleFiles(
  files: File[] | FileList,
  options?: {
    targetDirPath?: string;
    abortSignal?: AbortSignal;
    onProgress?: (params: {
      currentFileIndex: number;
      totalFiles: number;
      fileName: string;
    }) => void;
  },
): Promise<unknown> {
  if (isRemoteMode.value) {
    return handleRemoteFiles(files, options?.targetDirPath);
  }
  return handleFilesBase(files, options);
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
  startEntryDrag,
  handleInternalDragOver,
  handleInternalDragLeave,
  handleInternalDrop,
  onRootDragEnter: onRootDragEnterBase,
  onRootDragOver: onRootDragOverBase,
  onRootDragLeave: onRootDragLeaveBase,
  onRootDrop: onRootDropBase,
  fileManagerInstanceId: instanceId,
  handleFiles,
  vfs,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
remoteApi = remote as any;

const {
  remoteTransferOpen,
  remoteTransferProgress,
  remoteTransferPhase,
  remoteTransferFileName,
  isRemoteAvailable,
  buildRemoteDirectoryEntry,
  remoteError,
  remoteHasMore,
  isLoadingMore,
  startBrowserEntryDrag,
  dndZoneAttrs,
  onBrowserRootDragEnter,
  onBrowserRootDragOver,
  onBrowserRootDragLeave,
  onBrowserRootDrop,
  createAdapter,
} = remote;

function onEntryPointerDown(e: PointerEvent, entry: FsEntry) {
  return startBrowserEntryDrag(e, entry);
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
  sourceAdapter: createAdapter(),
  calculateFolderSize,
  pendingScrollToEntryPath,
  scrollToEntryPath,
  vfs,
  readDirectory,
  rootName: props.rootName || projectStore.currentProjectName || 'Project',
  allowedMediaTypes: computed(() => props.allowedMediaTypes),
  isolatedSelection: props.isolatedSelection,
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
  instanceId,
  onFileSelect: (entry) => setSelectedFsEntry(entry),
});

const {
  isSubgroupModalOpen,
  isItemModalOpen,
  handlePendingBloggerDogCreateSubgroup,
  handlePendingBloggerDogCreateItem,
  onSubgroupCreateConfirm,
  onItemCreateConfirm,
  validateSubgroupName,
  validateItemName,
} = useFileBrowserRemoteCreate({
  vfs,
  buildRemoteDirectoryEntry,
  remoteCurrentFolder,
  loadFolderContent,
  loadParentFolders,
});

// --- File manager actions + file actions dispatcher + STT ---
const {
  onFileAction,
  onFileActionBase,
  isDeleteConfirmModalOpen,
  isCreateFolderModalOpen,
  createFolderDefaultName,
  confirmCreateFolder,
  validateFolderCreation,
  editingEntryPath,
  commitRename,
  stopRename,
  startRename,
  deleteTargets,
  directoryUploadTarget,
  directoryUploadInput,
  openDeleteConfirmModal,
  handleDeleteConfirm,
  modalOpen: transcriptionModalOpen,
  language: transcriptionLanguage,
  errorMessage: transcriptionError,
  isTranscribing,
  isModelReady: isSttModelReady,
  pendingEntry: transcriptionEntry,
  isTranscribableMediaFile,
  openModal: _openTranscriptionModal,
  submitTranscription,
} = useFileBrowserShared({
  vfs,
  folderEntries,
  loadFolderContent,
  createFolder,
  renameEntry,
  deleteEntry,
  loadProjectDirectory,
  handleFiles,
  mediaCache: fileManager.mediaCache,
  findEntryByPath: fileManager.findEntryByPath,
  readDirectory: fileManager.readDirectory,
  reloadDirectory: fileManager.reloadDirectory,
  copyEntry,
  moveEntry,
  instanceId,
  isExternal: isExternal.value,
  notifyFileManagerUpdate: () => uiStore.notifyFileManagerUpdate(),
  setFileTreePathExpanded: (path: string, expanded: boolean) => {
    fileManager.setFileTreePathExpanded(path, expanded);
  },
  onFileSelect: (entry: FsEntry) => setSelectedFsEntry(entry),
  onAfterRename: () => {
    void loadFolderContent();
  },
  onAfterDelete: () => {
    void loadFolderContent();
  },
});

// --- Context menu ---
const { canUseFile, isDirectoryGeneratingProxy, getContextMenuItems, emptySpaceContextMenuItems } =
  useFileBrowserContextMenuState({
    isRemoteMode,
    selectedFolder: () => fileManagerStore.selectedFolder,
    selectedEntity: () => selectionStore.selectedEntity,
    fileCompatibility,
    mediaMetadata: mediaStore.mediaMetadata,
    generatingProxies: proxyStore.generatingProxies,
    hasProxy: (path) => fileManager.mediaCache.hasProxy(path),
    hasClipboardItems: () => clipboardStore.hasFileManagerPayload,
    isTranscribableMediaFile,
    onFileAction,
    isFilesPage: props.isFilesPage,
    instanceId,
    isExternal: isExternal.value,
    inDevelopmentFeaturesEnabled: workspaceStore.inDevelopmentFeaturesEnabled,
  });

// --- Marquee selection ---
function focusBrowserPanel() {
  focusStore.setFileManagerPanelFocus(`dynamic:file-manager:${instanceId}`, 'list');
}

const {
  marqueeStyle,
  preventClickClear,
  onMarqueePointerDown: onMarqueePointerDownBase,
  onMarqueePointerMove: onMarqueePointerMoveBase,
  onMarqueePointerUp: onMarqueePointerUpBase,
} = useFileBrowserMarquee({ rootContainer, sortedEntries, onFocusPanel: focusBrowserPanel });

function onMarqueePointerDown(e: PointerEvent) {
  if (props.disableMarquee) return;
  onMarqueePointerDownBase(e);
}

function onMarqueePointerMove(e: PointerEvent) {
  if (props.disableMarquee) return;
  onMarqueePointerMoveBase(e);
}

function onMarqueePointerUp(e: PointerEvent) {
  if (props.disableMarquee) return;
  onMarqueePointerUpBase(e);
}

function handleContainerClick() {
  focusBrowserPanel();
  if (preventClickClear.value) return;

  if (isRemoteMode.value) {
    if (remoteCurrentFolder.value && !remoteError.value && isRemoteAvailable.value) {
      setSelectedFsEntry(remoteCurrentFolder.value as unknown as FsEntry);
    } else {
      setSelectedFsEntry(null);
    }
  } else {
    const currentFolder = fileManagerStore.selectedFolder;
    setSelectedFsEntry({
      kind: 'directory',
      path: currentFolder?.path ?? '',
      name: currentFolder?.name || props.rootName || projectStore.currentProjectName || 'Project',
    } as FsEntry);
  }
}

// --- Keyboard navigation ---
const selectionAnchor = ref<FsEntry | null>(null);

// Automatically track the selection anchor when selection changes
watch(
  () => (props.isolatedSelection ? isolatedSelectedEntry.value : selectionStore.selectedEntity),
  (selected) => {
    if (props.isolatedSelection) {
      selectionAnchor.value = selected as FsEntry | null;
      return;
    }

    if (!selected || selected.source !== 'fileManager' || selected.instanceId !== instanceId) {
      selectionAnchor.value = null;
      return;
    }
    if (selected.kind === 'file' || selected.kind === 'directory') {
      selectionAnchor.value = selected.entry;
    } else if (selected.kind === 'multiple' && selected.entries.length > 0) {
      if (
        !selectionAnchor.value ||
        !selected.entries.some((e) => e.path === selectionAnchor.value?.path)
      ) {
        selectionAnchor.value = selected.entries[0] ?? null;
      }
    }
  },
  { immediate: true },
);

watch(
  () => fileManagerStore.selectedFolder?.path,
  () => {
    if (!props.isolatedSelection) return;
    if (!isolatedSelectedEntry.value) return;
    setSelectedFsEntry(null);
  },
);

function getColumnCount(): number {
  if (fileManagerStore.viewMode !== 'grid' || !rootContainer.value) return 1;
  const items = Array.from(rootContainer.value.querySelectorAll<HTMLElement>('[data-entry-path]'));
  if (items.length === 0) return 1;
  // Batch layout reads to avoid forced synchronous layout
  const tops = items.map((item) => item.getBoundingClientRect().top);
  const firstTop = tops[0] ?? 0;
  let cols = 0;
  while (cols < items.length && tops[cols] === firstTop) cols++;
  return cols || 1;
}

function isTextInputElement(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable;
}

function onContainerKeyDown(event: KeyboardEvent) {
  const container = rootContainer.value;
  if (!container) return;

  const activeEl = getActiveElement();
  if (isTextInputElement(activeEl)) return;

  const allowedKeys = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'];
  if (!allowedKeys.includes(event.key)) return;

  // Let Alt/Ctrl/Cmd combinations pass through (e.g. navigation / browser shortcuts)
  if (event.ctrlKey || event.altKey || event.metaKey) return;

  const items = Array.from(container.querySelectorAll<HTMLElement>('[data-entry-path]'));
  if (items.length === 0) return;

  const currentIndex = items.indexOf(activeEl as HTMLElement);
  event.preventDefault();

  let nextIndex = currentIndex;

  if (event.key === 'ArrowRight') {
    nextIndex = Math.min(currentIndex + 1, items.length - 1);
  } else if (event.key === 'ArrowLeft') {
    nextIndex = Math.max(currentIndex - 1, 0);
  } else {
    const step = getColumnCount();
    nextIndex =
      event.key === 'ArrowDown'
        ? Math.min(currentIndex + step, items.length - 1)
        : Math.max(currentIndex - step, 0);
  }

  // Handle case where nothing was focused/selected yet
  if (currentIndex === -1) {
    if (props.isolatedSelection) {
      const selectedPath = isolatedSelectedEntry.value?.path;
      if (selectedPath) {
        const foundIdx = visibleEntries.value.findIndex((e) => e.path === selectedPath);
        nextIndex = foundIdx !== -1 ? foundIdx : 0;
      } else {
        nextIndex = 0;
      }
    } else {
      const selected = selectionStore.selectedEntity;
      if (selected?.source === 'fileManager' && selected.instanceId === instanceId) {
        const selectedPath =
          selected.kind === 'multiple' ? selected.entries[0]?.path : selected.entry?.path;
        if (selectedPath) {
          const foundIdx = visibleEntries.value.findIndex((e) => e.path === selectedPath);
          if (foundIdx !== -1) {
            nextIndex = foundIdx;
          } else {
            nextIndex = 0;
          }
        } else {
          nextIndex = 0;
        }
      } else {
        nextIndex = 0;
      }
    }
  }

  if (nextIndex >= 0 && nextIndex < items.length) {
    const targetEntry = visibleEntries.value[nextIndex];
    if (!targetEntry) return;

    // Focus the target DOM element
    const targetEl = items[nextIndex];
    targetEl?.focus();

    if (event.shiftKey) {
      // Range selection
      if (!selectionAnchor.value) {
        const currentEntry = currentIndex >= 0 ? visibleEntries.value[currentIndex] : null;
        selectionAnchor.value = currentEntry ?? visibleEntries.value[0] ?? null;
      }

      if (selectionAnchor.value) {
        const anchorIdx = visibleEntries.value.findIndex(
          (e) => e.path === selectionAnchor.value?.path,
        );
        if (anchorIdx !== -1) {
          const start = Math.min(anchorIdx, nextIndex);
          const end = Math.max(anchorIdx, nextIndex);
          const range = visibleEntries.value.slice(start, end + 1);
          if (!props.isolatedSelection) {
            selectionStore.selectFsEntries(range, instanceId, isExternal.value);
          }
        } else {
          setSelectedFsEntry(targetEntry);
        }
      } else {
        setSelectedFsEntry(targetEntry);
      }
    } else {
      // Single selection
      selectionAnchor.value = targetEntry;
      setSelectedFsEntry(targetEntry);
    }
  }
}

function moveSelection(dir: 'up' | 'down' | 'left' | 'right') {
  const keyMap: Record<string, string> = {
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
  };
  onContainerKeyDown({
    key: keyMap[dir],
    preventDefault: () => {},
  } as KeyboardEvent);
}

function handleScroll(e: Event) {
  if (!isRemoteMode.value || !remoteHasMore.value || isLoadingMore.value) return;

  const container = e.target as HTMLElement;
  const { scrollTop, scrollHeight, clientHeight } = container;

  if (scrollTop + clientHeight >= scrollHeight - 300) {
    void loadFolderContent({ append: true });
  }
}

// --- Grid size ---
const {
  gridSizes: fileBrowserGridSizes,
  effectiveGridCardSize,
  currentGridSizeName,
} = useFileBrowserViewSettings({
  gridCardSize: () => fileManagerStore.gridCardSize,
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
  onPasteTarget: async (entry) => {
    await onFileActionBase('paste', entry);
  },
  handlePendingRemoteDownloadRequest: async () => {
    const request = uiStore.pendingRemoteDownloadRequest;
    if (!request) return;

    try {
      await remote.performRemoteDownload(request);
    } catch (error) {
      if ((error as Error | undefined)?.name !== 'AbortError') {
        toast.add({
          color: 'error',
          title: t('common.error'),
          description:
            error instanceof Error
              ? error.message
              : t('videoEditor.fileManager.errors.remoteFailed'),
        });
      }
    }
  },
});

const { refreshFileTree } = useFileBrowserLifecycle({
  remoteModeOnly: props.remoteModeOnly,
  isRemoteMode,
  isAtRoot,
  remoteCurrentFolder,
  buildRemoteDirectoryEntry,
  fileManagerStore,
  selectionStore,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  focusStore: focusStore as any,
  uiStore,
  clipboardStore,
  instanceId,
  isExternal: isExternal.value,
  sortedEntries,
  pendingScrollToEntryPath,
  skipNextUpdateReload,
  loadFolderContent,
  loadParentFolders,
  tryScrollToPendingEntry,
  navigateBack,
  navigateForward,
  navigateUp,
  moveSelection,
  loadProjectDirectory,
  folderSizes,
  setSelectedFsEntry,
});

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
    instanceId,
    isExternal: isExternal.value,
    canInteractWithEntry: canUseFile,
    singleClickFolders: props.singleClickFolders,
    isolatedSelection: props.isolatedSelection,
  });

async function onDirectoryUploadChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = input.files ? Array.from(input.files) : [];
  input.value = '';

  const entry = directoryUploadTarget.value;
  if (!entry || entry.kind !== 'directory') return;
  if (files.length === 0) return;

  await handleFiles(files, { targetDirPath: entry.path });
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
      'panel-focus-frame--active':
        !safeHideFocusFrame && focusStore.isPanelFocused(`dynamic:file-manager:${instanceId}`),
    }"
    v-bind="dndZoneAttrs"
    @pointerdown.capture="focusBrowserPanel"
  >
    <FileBrowserToolbar
      v-if="!hideToolbar && !(remoteModeOnly && (!isRemoteAvailable || remoteError))"
      :grid-sizes="fileBrowserGridSizes"
      :current-grid-size-name="currentGridSizeName"
      :grid-card-size="effectiveGridCardSize"
      :remote-available="isRemoteAvailable"
      :is-remote-panel="remoteModeOnly"
      :compact="compact"
      :hide-actions="hideActions"
      :hide-upload="hideUpload"
      :hide-view-switcher="hideViewSwitcher"
      :hide-select-unused="hideSelectUnused"
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
      @select-all="bulkSelection.selectAll"
      @select-unused="bulkSelection.selectUnused"
      @invert-selection="bulkSelection.invertSelection"
    />

    <!-- Navigation bar (Breadcrumbs) -->
    <FileBrowserBreadcrumbs
      v-if="!hideBreadcrumbs && !(remoteModeOnly && (!isRemoteAvailable || remoteError))"
      :parent-folders="parentFolders"
      :is-at-root="isAtRoot"
      :can-navigate-back="fileManagerStore.historyStack.length > 0"
      :can-navigate-forward="fileManagerStore.futureStack.length > 0"
      @navigate-back="navigateBack"
      @navigate-forward="navigateForward"
      @navigate-up="navigateUp"
      @navigate-to-folder="navigateToFolder"
    />

    <FileBrowserContent
      :set-root-container-ref="setRootContainerRef"
      :marquee-style="marqueeStyle"
      :empty-space-context-menu-items="emptySpaceContextMenuItems"
      :is-remote-mode="isRemoteMode"
      :remote-error="remoteError"
      :folder-entries-length="visibleEntries.length"
      :sorted-entries="visibleEntries"
      :drag-over-entry-path="dragOverEntryPath"
      :current-drag-operation="currentDragOperation"
      :current-grid-size-name="currentGridSizeName"
      :effective-grid-card-size="effectiveGridCardSize"
      :editing-entry-path="editingEntryPath"
      :folder-entry-names="folderEntries.map((entry) => entry.name)"
      :get-context-menu-items="getContextMenuItems"
      :is-directory-generating-proxy="isDirectoryGeneratingProxy"
      :video-thumbnails="videoThumbnails"
      :file-compatibility="fileCompatibility"
      :instance-id="instanceId"
      :selected-entry-paths="selectedEntryPaths"
      :hide-usage-indicators="hideUsageIndicators"
      :folder-sizes-loading="folderSizesLoading"
      :folder-sizes="folderSizes"
      :show-grid-view="remoteModeOnly || fileManagerStore.viewMode === 'grid'"
      :is-loading-more="isLoadingMore"
      :remote-has-more="remoteHasMore"
      :root-spacer-style="rootSpacerStyle"
      @scroll="handleScroll"
      @root-drag-enter="onRootDragEnter"
      @root-drag-over="onRootDragOver"
      @root-drag-leave="onRootDragLeave"
      @root-drop="onRootDrop"
      @container-click="handleContainerClick"
      @container-keydown="onContainerKeyDown"
      @marquee-pointer-down="onMarqueePointerDown"
      @marquee-pointer-move="onMarqueePointerMove"
      @marquee-pointer-up="onMarqueePointerUp"
      @retry-remote-load="loadFolderContent"
      @entry-pointer-down="onEntryPointerDown"
      @entry-click="handleEntryClick"
      @entry-double-click="handleEntryDoubleClick"
      @entry-enter="handleEntryEnter"
      @commit-rename="commitRename"
      @stop-rename="stopRename"
      @file-action="onFileAction"
      @sort="handleSort"
      @resize-start="onResizeStart"
    />

    <!-- Hidden input for directory upload -->
    <input
      ref="directoryUploadInput"
      data-testid="file-upload-input"
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
      v-model:is-folder-modal-open="isCreateFolderModalOpen"
      :folder-default-name="createFolderDefaultName"
      :validate-folder="validateFolderCreation"
      :validate-subgroup="validateSubgroupName"
      :validate-item="validateItemName"
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
      @folder-confirm="confirmCreateFolder"
    />
  </div>
</template>
