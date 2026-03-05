<script setup lang="ts">
import { ref, computed, watch, toRaw, onUnmounted } from 'vue';
import {
  useFilesPageStore,
  type FileViewMode,
  type FileSortField,
  type SortOrder,
} from '~/stores/filesPage.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useProjectStore } from '~/stores/project.store';
import { useUiStore } from '~/stores/ui.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import type { FsEntry } from '~/types/fs';
import { formatBytes } from '~/utils/format';
import { getMediaTypeFromFilename, getIconForMediaType } from '~/utils/media-types';
import WheelSlider from '~/components/ui/WheelSlider.vue';

import { useFileManagerActions } from '~/composables/fileManager/useFileManagerActions';
import FileBrowserToolbar from '~/components/file-manager/FileBrowserToolbar.vue';
import FileBrowserBreadcrumbs from '~/components/file-manager/FileBrowserBreadcrumbs.vue';
import FileBrowserStatusBar from '~/components/file-manager/FileBrowserStatusBar.vue';
import FileBrowserViewGrid from '~/components/file-manager/FileBrowserViewGrid.vue';
import FileBrowserViewList from '~/components/file-manager/FileBrowserViewList.vue';
import { useFileBrowserDragAndDrop } from '~/composables/fileManager/useFileBrowserDragAndDrop';
import { VIDEO_DIR_NAME } from '~/utils/constants';
import ProgressSpinner from '~/components/ui/ProgressSpinner.vue';
import {
  useDraggedFile,
  INTERNAL_DRAG_TYPE,
  FILE_MANAGER_MOVE_DRAG_TYPE,
} from '~/composables/useDraggedFile';
import type { DraggedFileData } from '~/composables/useDraggedFile';
import { useFileDrop } from '~/composables/fileManager/useFileDrop';
import { useProjectTabs } from '~/composables/project/useProjectTabs';
import { createTimelineCommand } from '~/file-manager/application/fileManagerCommands';
import { useFileContextMenu } from '~/composables/fileManager/useFileContextMenu';
import type { FileAction as ContextMenuFileAction } from '~/composables/fileManager/useFileContextMenu';
import FileConversionModal from '~/components/file-manager/FileConversionModal.vue';
import { useFileConversion } from '~/composables/fileManager/useFileConversion';

const filesPageStore = useFilesPageStore();
const selectionStore = useSelectionStore();
const projectStore = useProjectStore();
const uiStore = useUiStore();
const timelineMediaUsageStore = useTimelineMediaUsageStore();
const fileManager = useFileManager();
const proxyStore = useProxyStore();
const { addFileTab, setActiveTab } = useProjectTabs();

const fileConversion = useFileConversion();

const props = defineProps<{
  isFilesPage?: boolean;
}>();
const {
  readDirectory,
  getFileIcon,
  getProjectRootDirHandle,
  loadProjectDirectory,
  createFolder,
  renameEntry,
  deleteEntry,
  handleFiles,
  moveEntry,
  findEntryByPath,
  reloadDirectory,
} = fileManager;
const { t } = useI18n();
const { setDraggedFile, clearDraggedFile } = useDraggedFile();
const { isGlobalDragging } = storeToRefs(uiStore);

const skipNextUpdateReload = ref(false);

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
  handleFiles,
  moveEntry,
  loadFolderContent,
  notifyFileManagerUpdate: () => {
    skipNextUpdateReload.value = true;
    uiStore.notifyFileManagerUpdate();
  },
});

const rootContainer = ref<HTMLElement | null>(null);

function onContainerKeyDown(e: KeyboardEvent) {
  const container = rootContainer.value;
  if (!container) return;

  // We only want to handle keys if focus is within our container
  // and not inside an input field (e.g. InlineNameEditor)
  const activeEl = document.activeElement as HTMLElement;
  if (activeEl?.tagName === 'INPUT') return;

  const items = Array.from(container.querySelectorAll<HTMLElement>('[tabindex="0"]'));

  if (items.length === 0) return;

  const currentIndex = items.indexOf(activeEl);

  if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
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
    } else if (e.key === 'ArrowDown') {
      if (isGrid && items[0]) {
        // Find columns count by looking at items in the first row
        const firstTop = items[0].offsetTop;
        let cols = 0;
        while (cols < items.length && items[cols]?.offsetTop === firstTop) cols++;
        cols = cols || 1;
        nextIndex = Math.min(currentIndex + cols, items.length - 1);
      } else {
        nextIndex = Math.min(currentIndex + 1, items.length - 1);
      }
    } else if (e.key === 'ArrowUp') {
      if (isGrid && items[0]) {
        const firstTop = items[0].offsetTop;
        let cols = 0;
        while (cols < items.length && items[cols]?.offsetTop === firstTop) cols++;
        cols = cols || 1;
        nextIndex = Math.max(currentIndex - cols, 0);
      } else {
        nextIndex = Math.max(currentIndex - 1, 0);
      }
    }

    if (nextIndex !== currentIndex) {
      const item = items[nextIndex];
      if (item) {
        item.focus();
      }
    }
  }
}

const folderEntries = ref<FsEntry[]>([]);
const parentFolders = ref<FsEntry[]>([]);

const {
  isDeleteConfirmModalOpen,
  editingEntryPath,
  commitRename,
  stopRename,
  startRename,
  deleteTarget,
  timelinesUsingDeleteTarget,
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
  onAfterRename: () => {
    void loadFolderContent();
  },
  onAfterDelete: () => {
    void loadFolderContent();
  },
});

function onFileAction(action: any, entry: FsEntry) {
  if (action === 'createProxyForFolder') {
    if (entry.kind === 'directory' && entry.path !== undefined) {
      void proxyStore.generateProxiesForFolder({
        dirHandle: entry.handle as FileSystemDirectoryHandle,
        dirPath: entry.path,
      });
    }
  } else if (action === 'cancelProxyForFolder') {
    if (entry.kind === 'directory' && entry.path !== undefined) {
      const generatingProxies = proxyStore.generatingProxies;
      for (const p of generatingProxies) {
        if (p.startsWith(`${entry.path}/`)) {
          const rel = p.slice(entry.path.length + 1);
          if (!rel.includes('/')) {
            void proxyStore.cancelProxyGeneration(p);
          }
        }
      }
    }
  } else if (action === 'openAsPanel') {
    if (entry.kind !== 'file') return;
    projectStore.goToCut();
    const type = getMediaTypeFromFilename(entry.name);
    if (type === 'text') {
      projectStore.addTextPanel(entry.path ?? entry.name, `File: ${entry.name}`, entry.name);
    } else if (type === 'video' || type === 'audio' || type === 'image') {
      projectStore.addMediaPanel(entry, type, entry.name);
    }
  } else if (action === 'openAsProjectTab') {
    if (entry.kind !== 'file' || !entry.path) return;
    const type = getMediaTypeFromFilename(entry.name);
    if (type !== 'video' && type !== 'audio' && type !== 'image' && type !== 'text') return;
    const tabId = addFileTab({ filePath: entry.path, fileName: entry.name });
    setActiveTab(tabId);
  } else if (action === 'createFolder') {
    const existingNames = folderEntries.value.map((e) => e.name);
    const parentPath = entry.path ?? '';
    onFileActionBase('createFolder', entry, () => existingNames);
    void loadFolderContent();
  } else if (action === 'createTimeline') {
    if (entry.kind === 'directory') {
      uiStore.pendingFsEntryCreateTimeline = entry;
    }
  } else if (action === 'createMarkdown') {
    if (entry.kind === 'directory') {
      uiStore.pendingFsEntryCreateMarkdown = entry;
    }
  } else if (action === 'convertFile') {
    if (entry.kind === 'file') {
      fileConversion.openConversionModal(entry);
    }
  } else {
    onFileActionBase(action, entry);
  }
}

async function refreshFileTree() {
  folderSizes.value = {};
  await loadProjectDirectory({ fullRefresh: true } as any);
}

import { createMarkdownCommand } from '~/file-manager/application/fileManagerCommands';

async function createTimelineInDirectory(entry: FsEntry) {
  if (entry.kind !== 'directory') return;

  const existingInFolder = await readDirectory(entry.handle as FileSystemDirectoryHandle, entry.path);
  const existingNames = existingInFolder.map(e => e.name);

  const createdFileName = await createTimelineCommand({
    projectDir: entry.handle as FileSystemDirectoryHandle,
    timelinesDirName: undefined,
    existingNames,
  });

  await reloadDirectory(entry.path || '');
  uiStore.notifyFileManagerUpdate();
  await loadFolderContent();

  const createdPath = entry.path ? `${entry.path}/${createdFileName}` : createdFileName;
  const createdEntry = findEntryByPath(createdPath);
  if (createdEntry) {
    selectionStore.selectFsEntry(createdEntry);
  }
}

async function createMarkdownInDirectory(entry: FsEntry) {
  if (entry.kind !== 'directory') return;

  const existingInFolder = await readDirectory(entry.handle as FileSystemDirectoryHandle, entry.path);
  const existingNames = existingInFolder.map(e => e.name);

  const createdFileName = await createMarkdownCommand({
    dirHandle: entry.handle as FileSystemDirectoryHandle,
    existingNames,
  });

  await reloadDirectory(entry.path || '');
  uiStore.notifyFileManagerUpdate();
  await loadFolderContent();

  const createdPath = entry.path ? `${entry.path}/${createdFileName}` : createdFileName;
  const createdEntry = findEntryByPath(createdPath);
  if (createdEntry) {
    selectionStore.selectFsEntry(createdEntry);
  }
}

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
  return entry.kind === 'file' && !!entry.path?.startsWith(`${VIDEO_DIR_NAME}/`);
}

const { getContextMenuItems } = useFileContextMenu(
  {
    isGeneratingProxyInDirectory,
    folderHasVideos,
    isOpenableMediaFile: (entry: FsEntry) => {
      if (entry.kind !== 'file') return false;
      const type = getMediaTypeFromFilename(entry.name);
      return type === 'video' || type === 'audio' || type === 'image' || type === 'text';
    },
    isVideo,
    getEntryMeta: (entry: FsEntry) => ({
      hasProxy: entry.path ? fileManager.mediaCache.hasProxy(entry.path) : false,
      generatingProxy: entry.path ? proxyStore.generatingProxies.has(entry.path) : false,
    }),
    isFilesPage: props.isFilesPage,
  },
  (action: ContextMenuFileAction, entry: FsEntry) => onFileAction(action, entry),
);

const emptySpaceContextMenuItems = computed(() => {
  if (!filesPageStore.selectedFolder) return [];
  return getContextMenuItems(filesPageStore.selectedFolder);
});



const GRID_SIZES = [80, 100, 130, 160, 200];
const GRID_SIZE_NAMES = ['xs', 's', 'm', 'l', 'xl'];

const currentGridSizeName = computed(() => {
  const index = GRID_SIZES.indexOf(filesPageStore.gridCardSize);
  return GRID_SIZE_NAMES[index] || 'm';
});

const resizingColumn = ref<string | null>(null);
const resizeStartX = ref(0);
const resizeStartWidth = ref(0);

const folderSizes = ref<Record<string, number>>({});
const folderSizesLoading = ref<Record<string, boolean>>({});

import PQueue from 'p-queue';

const sizeCalcQueue = new PQueue({ concurrency: 5 });

async function calculateFolderSize(path: string, handle: FileSystemDirectoryHandle) {
  if (folderSizes.value[path] !== undefined || folderSizesLoading.value[path]) return;

  folderSizesLoading.value[path] = true;
  await sizeCalcQueue.add(async () => {
    try {
      let totalSize = 0;

      async function calc(dirHandle: FileSystemDirectoryHandle) {
        // @ts-expect-error Types for FileSystemDirectoryHandle values iterator may be incomplete
        for await (const entry of dirHandle.values()) {
          if (entry.kind === 'file') {
            try {
              const file = await entry.getFile();
              totalSize += file.size;
            } catch {
              // skip
            }
          } else if (entry.kind === 'directory') {
            await calc(entry);
          }
        }
      }

      await calc(handle);
      folderSizes.value[path] = totalSize;
    } catch (error) {
      console.error('Failed to calculate folder size:', error);
    } finally {
      folderSizesLoading.value[path] = false;
    }
  });
}

// Calculate size for selected entity (details view)
watch(
  () => uiStore.selectedFsEntry,
  (entry) => {
    if (entry && entry.kind === 'directory' && entry.handle && entry.path) {
      void calculateFolderSize(entry.path, entry.handle as FileSystemDirectoryHandle);
    }
  },
  { immediate: true },
);

// Trigger sizes for directories in list view (one by one)
watch(
  () => [folderEntries.value, filesPageStore.viewMode],
  () => {
    if (filesPageStore.viewMode === 'list' && folderEntries.value.length > 0) {
      for (const entry of folderEntries.value) {
        if (
          entry.kind === 'directory' &&
          entry.path &&
          folderSizes.value[entry.path] === undefined &&
          !folderSizesLoading.value[entry.path]
        ) {
          void calculateFolderSize(entry.path, entry.handle as FileSystemDirectoryHandle);
        }
      }
    }
  },
  { immediate: true },
);

async function loadFolderContent() {
  if (!filesPageStore.selectedFolder || !filesPageStore.selectedFolder.handle) {
    cleanupObjectUrls();
    folderEntries.value = [];
    return;
  }

  try {
    const handle = toRaw(filesPageStore.selectedFolder.handle) as FileSystemDirectoryHandle;
    const path = filesPageStore.selectedFolder.path || '';
    const entries = await readDirectory(handle, path);
    // readDirectory already filters hidden files based on deps.showHiddenFiles(),
    // but just to be sure we also filter it here if needed.
    const filteredEntries = entries.filter(
      (e) => uiStore.showHiddenFiles || !e.name.startsWith('.'),
    );
    cleanupObjectUrls();
    folderEntries.value = await supplementEntries(filteredEntries);
  } catch (error) {
    console.error('Failed to load folder content:', error);
    cleanupObjectUrls();
    folderEntries.value = [];
  }
}

function cleanupObjectUrls() {
  for (const entry of folderEntries.value as ExtendedFsEntry[]) {
    if (entry.objectUrl) {
      URL.revokeObjectURL(entry.objectUrl);
    }
  }
}

onUnmounted(() => {
  cleanupObjectUrls();
  document.removeEventListener('mousemove', onResizeMove);
  document.removeEventListener('mouseup', onResizeEnd);
});

async function loadParentFolders() {
  parentFolders.value = [];
  if (!filesPageStore.selectedFolder?.path) return;

  const rootHandle = await getProjectRootDirHandle();
  if (!rootHandle) return;

  const pathParts = filesPageStore.selectedFolder.path.split('/').filter(Boolean);
  let currentHandle: FileSystemDirectoryHandle = rootHandle;

  for (let i = 0; i < pathParts.length; i++) {
    const part = pathParts[i];
    if (!part) continue;
    try {
      currentHandle = await currentHandle.getDirectoryHandle(part);
      parentFolders.value.push({
        kind: 'directory',
        name: part,
        path: pathParts.slice(0, i + 1).join('/'),
        handle: currentHandle,
      });
    } catch {
      break;
    }
  }
}

watch(
  () => uiStore.showHiddenFiles,
  async () => {
    await loadFolderContent();
  },
);

watch(
  () => filesPageStore.selectedFolder,
  async () => {
    await loadFolderContent();
    await loadParentFolders();
  },
  { immediate: true },
);

watch(
  () => uiStore.fileManagerUpdateCounter,
  async () => {
    if (skipNextUpdateReload.value) {
      skipNextUpdateReload.value = false;
      return;
    }
    // only reload the current view content, not the whole tree
    await loadFolderContent();
  },
);

interface ExtendedFsEntry extends FsEntry {
  size?: number;
  mimeType?: string;
  created?: number;
  objectUrl?: string;
}

const SUPPORTED_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg'];

async function supplementEntries(entries: FsEntry[]): Promise<ExtendedFsEntry[]> {
  const supplements = await Promise.all(
    entries.map(async (entry) => {
      if (entry.kind === 'file') {
        try {
          const file = await (entry.handle as FileSystemFileHandle).getFile();
          const objectUrl = await createPreviewUrl(entry.name, file);
          return {
            ...entry,
            size: file.size,
            mimeType: file.type || getMimeFromExt(entry.name),
            lastModified: file.lastModified,
            created: file.lastModified,
            objectUrl,
          };
        } catch {
          return { ...entry, size: 0, mimeType: 'unknown' };
        }
      }
      return { ...entry, size: 0, mimeType: 'folder' };
    }),
  );
  return supplements;
}

async function createPreviewUrl(name: string, file: File): Promise<string | undefined> {
  const ext = name.split('.').pop()?.toLowerCase();
  if (!ext || !SUPPORTED_IMAGE_EXTS.includes(ext)) return undefined;
  try {
    return URL.createObjectURL(file);
  } catch {
    return undefined;
  }
}

function isImageSupported(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext ? SUPPORTED_IMAGE_EXTS.includes(ext) : false;
}

function getMimeFromExt(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const type = getMediaTypeFromFilename(filename);
  if (type !== 'unknown') return type;
  return ext || 'file';
}

const sortedEntries = computed(() => {
  const { field, order } = filesPageStore.sortOption;
  const entries = [...folderEntries.value];

  entries.sort((a: ExtendedFsEntry, b: ExtendedFsEntry) => {
    let result = 0;

    if (a.kind !== b.kind) {
      return a.kind === 'directory' ? -1 : 1;
    }

    if (field === 'name') {
      result = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    } else if (field === 'size') {
      const aSize = a.kind === 'file' ? a.size || 0 : folderSizes.value[a.path || ''] || 0;
      const bSize = b.kind === 'file' ? b.size || 0 : folderSizes.value[b.path || ''] || 0;
      result = aSize - bSize;
    } else if (field === 'modified') {
      result = (a.lastModified || 0) - (b.lastModified || 0);
    } else if (field === 'created') {
      result = (a.created || 0) - (b.created || 0);
    } else if (field === 'type') {
      result = (a.mimeType || '').localeCompare(b.mimeType || '');
    }

    return order === 'asc' ? result : -result;
  });

  return entries;
});

const stats = computed(() => {
  let totalSize = 0;
  let fileCount = 0;

  for (const entry of folderEntries.value as ExtendedFsEntry[]) {
    if (entry.kind === 'file') {
      totalSize += entry.size || 0;
      fileCount++;
    }
  }

  return {
    totalSize: formatBytes(totalSize),
    fileCount,
  };
});

function handleEntryClick(entry: FsEntry) {
  filesPageStore.selectFile(entry);
}

function handleEntryDoubleClick(entry: FsEntry) {
  if (entry.kind === 'directory') {
    filesPageStore.openFolder(entry);
  } else {
    if (entry.name.toLowerCase().endsWith('.otio')) {
      if (entry.path) {
        // Find a way to open timeline, for now just call onFileAction('openAsProjectTab') or emit select
      }
    } else {
      onFileAction('openAsProjectTab', entry);
    }
  }
}

function handleEntryEnter(entry: FsEntry) {
  filesPageStore.selectFile(entry);
  handleEntryDoubleClick(entry);
}

function formatDate(timestamp?: number) {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleString();
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

function navigateToFolder(index: number) {
  const targetFolder = parentFolders.value[index];
  if (targetFolder) {
    filesPageStore.selectFolder(targetFolder);
  }
}

function navigateBack() {
  if (parentFolders.value.length > 1) {
    const parentIndex = parentFolders.value.length - 2;
    filesPageStore.selectFolder(parentFolders.value[parentIndex] as FsEntry);
  } else {
    void navigateToRoot();
  }
}

function navigateUp() {
  if (parentFolders.value.length > 1) {
    const parentIndex = parentFolders.value.length - 2;
    filesPageStore.selectFolder(parentFolders.value[parentIndex] as FsEntry);
  } else if (parentFolders.value.length === 1) {
    void navigateToRoot();
  }
}

async function navigateToRoot() {
  const rootHandle = await getProjectRootDirHandle();
  if (!rootHandle) return;
  const rootEntry: FsEntry = {
    kind: 'directory',
    name: projectStore.currentProjectName || '',
    path: '',
    handle: rootHandle,
  };
  filesPageStore.selectFolder(rootEntry);
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

function onCardSizeChange(e: Event) {
  const target = e.target as HTMLInputElement;
  if (!target) return;
  const value = parseInt(target.value);
  if (!isNaN(value)) {
    filesPageStore.setGridCardSize(GRID_SIZES[value] || 120);
  }
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
    await handleFiles(files, entry.handle as FileSystemDirectoryHandle, entry.path);
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
    }"
    @dragover.prevent="onPanelDragOver"
    @dragleave="onPanelDragLeave"
    @drop.prevent="onPanelDrop"
  >
    <!-- Navigation bar -->
    <FileBrowserBreadcrumbs
      v-if="filesPageStore.selectedFolder && filesPageStore.selectedFolder.path !== ''"
      :parent-folders="parentFolders"
      @navigate-back="navigateBack"
      @navigate-up="navigateUp"
      @navigate-to-folder="navigateToFolder"
    />

    <!-- Toolbar -->
    <FileBrowserToolbar
      :grid-sizes="GRID_SIZES"
      :current-grid-size-name="currentGridSizeName"
      @refresh="refreshFileTree"
    />

    <!-- Main Content -->
    <div
      ref="rootContainer"
      class="flex-1 overflow-auto p-4 content-scrollbar"
      @click.self="navigateToRoot"
      @keydown="onContainerKeyDown"
    >
      <UContextMenu :items="emptySpaceContextMenuItems" class="min-h-full">
        <div class="min-h-full flex flex-col">
          <div
            v-if="!filesPageStore.selectedFolder"
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
            @root-drag-over="onRootDragOver"
            @root-drag-leave="onRootDragLeave"
            @root-drop="onRootDrop"
            @entry-drag-start="onEntryDragStart"
            @entry-drag-end="onEntryDragEnd"
            @entry-drag-over="onEntryDragOver"
            @entry-drag-leave="onEntryDragLeave"
            @entry-drop="onEntryDrop"
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
            @root-drag-over="onRootDragOver"
            @root-drag-leave="onRootDragLeave"
            @root-drop="onRootDrop"
            @entry-drag-start="onEntryDragStart"
            @entry-drag-end="onEntryDragEnd"
            @entry-drag-over="onEntryDragOver"
            @entry-drag-leave="onEntryDragLeave"
            @entry-drop="onEntryDrop"
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

    <!-- Modals -->
    <UiConfirmModal
      v-model:open="isDeleteConfirmModalOpen"
      :title="t('common.delete', 'Delete')"
      :description="
        t(
          'common.confirmDelete',
          'Are you sure you want to delete this? This action cannot be undone.',
        )
      "
      color="error"
      icon="i-heroicons-exclamation-triangle"
      @confirm="handleDeleteConfirm"
    >
      <div>
        <div v-show="deleteTarget" class="mt-2 text-sm font-medium text-ui-text">
          {{ deleteTarget?.name }}
        </div>
        <div v-if="deleteTarget?.path" class="mt-1 text-xs text-ui-text-muted break-all">
          {{
            deleteTarget.kind === 'directory'
              ? t('common.folder', 'Folder')
              : t('common.file', 'File')
          }}
          ·
          {{ deleteTarget.path }}
        </div>
      </div>
    </UiConfirmModal>

    <FileConversionModal
      v-model:open="fileConversion.isModalOpen.value"
      :media-type="fileConversion.mediaType.value"
      :file-name="fileConversion.targetEntry.value?.name ?? ''"
      :is-converting="fileConversion.isConverting.value"
      :conversion-progress="fileConversion.conversionProgress.value"
      :conversion-error="fileConversion.conversionError.value"
      :conversion-phase="fileConversion.conversionPhase.value"
      v-model:video-format="fileConversion.videoFormat.value"
      v-model:video-codec="fileConversion.videoCodec.value"
      v-model:video-bitrate-mbps="fileConversion.videoBitrateMbps.value"
      v-model:exclude-audio="fileConversion.excludeAudio.value"
      v-model:audio-codec="fileConversion.audioCodec.value"
      v-model:audio-bitrate-kbps="fileConversion.audioBitrateKbps.value"
      v-model:bitrate-mode="fileConversion.bitrateMode.value"
      v-model:keyframe-interval-sec="fileConversion.keyframeIntervalSec.value"
      v-model:audio-only-format="fileConversion.audioOnlyFormat.value"
      v-model:audio-only-codec="fileConversion.audioOnlyCodec.value"
      v-model:audio-only-bitrate-kbps="fileConversion.audioOnlyBitrateKbps.value"
      v-model:audio-channels="fileConversion.audioChannels.value"
      v-model:audio-sample-rate="fileConversion.audioSampleRate.value"
      v-model:image-quality="fileConversion.imageQuality.value"
      @convert="fileConversion.startConversion"
    />

    <input
      ref="directoryUploadInput"
      type="file"
      multiple
      class="hidden"
      @change="onDirectoryUploadChange"
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
