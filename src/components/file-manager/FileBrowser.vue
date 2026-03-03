<script setup lang="ts">
import { ref, computed, watch, toRaw } from 'vue';
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

import { useFileManagerModals } from '~/composables/fileManager/useFileManagerModals';
import CreateFolderModal from '~/components/common/CreateFolderModal.vue';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import RenameModal from '~/components/common/RenameModal.vue';
import { useProxyStore } from '~/stores/proxy.store';
import { VIDEO_DIR_NAME } from '~/utils/constants';
import ProgressSpinner from '~/components/ui/ProgressSpinner.vue';

const filesPageStore = useFilesPageStore();
const selectionStore = useSelectionStore();
const projectStore = useProjectStore();
const uiStore = useUiStore();
const timelineMediaUsageStore = useTimelineMediaUsageStore();
const fileManager = useFileManager();
const proxyStore = useProxyStore();
const {
  readDirectory,
  getFileIcon,
  getProjectRootDirHandle,
  loadProjectDirectory,
  createFolder,
  renameEntry,
  deleteEntry,
  handleFiles,
} = fileManager;
const { t } = useI18n();

const folderEntries = ref<FsEntry[]>([]);
const isLoading = ref(false);
const parentFolders = ref<FsEntry[]>([]);

const {
  isCreateFolderModalOpen,
  folderCreationTarget,
  isRenameModalOpen,
  renameTarget,
  isDeleteConfirmModalOpen,
  deleteTarget,
  timelinesUsingDeleteTarget,
  directoryUploadTarget,
  directoryUploadInput,
  openCreateFolderModal,
  handleCreateFolder,
  openDeleteConfirmModal,
  handleDeleteConfirm,
  handleRename,
  onFileAction: onFileActionBase,
} = useFileManagerModals({
  createFolder,
  renameEntry,
  deleteEntry,
  loadProjectDirectory,
  handleFiles,
  mediaCache: fileManager.mediaCache,
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
  } else {
    onFileActionBase(action, entry);
  }
}

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
  return true; // We don't have deeply loaded children here, assume true to allow action
}

function isVideo(entry: FsEntry) {
  return entry.kind === 'file' && entry.path?.startsWith(`${VIDEO_DIR_NAME}/`);
}

function getContextMenuItems(entry: FsEntry) {
  const items = [];

  if (entry.kind === 'directory') {
    const hasVideos = folderHasVideos(entry);

    items.push([
      {
        label: t('videoEditor.fileManager.actions.createFolder', 'Create Folder'),
        icon: 'i-heroicons-folder-plus',
        onSelect: () => onFileAction('createFolder', entry),
      },
      {
        label: t('videoEditor.fileManager.actions.uploadFiles', 'Upload files'),
        icon: 'i-heroicons-arrow-up-tray',
        onSelect: () => onFileAction('upload', entry),
      },
    ]);

    if (hasVideos) {
      if (isGeneratingProxyInDirectory(entry)) {
        items.push([
          {
            label: t(
              'videoEditor.fileManager.actions.cancelProxyGeneration',
              'Cancel proxy generation',
            ),
            icon: 'i-heroicons-x-circle',
            color: 'error',
            onSelect: () => onFileAction('cancelProxyForFolder', entry),
          },
        ]);
      } else {
        items.push([
          {
            label: t(
              'videoEditor.fileManager.actions.createProxyForAll',
              'Create proxy for all videos',
            ),
            icon: 'i-heroicons-film',
            onSelect: () => onFileAction('createProxyForFolder', entry),
          },
        ]);
      }
    }
  }

  items.push([
    {
      label: t('common.rename', 'Rename'),
      icon: 'i-heroicons-pencil',
      onSelect: () => onFileAction('rename', entry),
    },
  ]);

  if (isVideo(entry)) {
    const hasProxy = fileManager.mediaCache.hasProxy(entry.path!);
    const generatingProxy = proxyStore.generatingProxies.has(entry.path!);

    if (!generatingProxy) {
      items.push([
        {
          label: hasProxy
            ? t('videoEditor.fileManager.actions.regenerateProxy', 'Regenerate Proxy')
            : t('videoEditor.fileManager.actions.createProxy', 'Create Proxy'),
          icon: 'i-heroicons-film',
          onSelect: () => onFileAction('createProxy', entry),
        },
      ]);
    }

    if (generatingProxy) {
      items.push([
        {
          label: t(
            'videoEditor.fileManager.actions.cancelProxyGeneration',
            'Cancel proxy generation',
          ),
          icon: 'i-heroicons-x-circle',
          color: 'error',
          onSelect: () => onFileAction('cancelProxy', entry),
        },
      ]);
    }

    if (hasProxy) {
      items.push([
        {
          label: t('videoEditor.fileManager.actions.deleteProxy', 'Delete Proxy'),
          icon: 'i-heroicons-trash',
          color: 'error',
          onSelect: () => onFileAction('deleteProxy', entry),
        },
      ]);
    }
  }

  items.push([
    {
      label: t('common.delete', 'Delete'),
      icon: 'i-heroicons-trash',
      color: 'error',
      onSelect: () => onFileAction('delete', entry),
    },
  ]);

  return items;
}

const emptySpaceContextMenuItems = computed(() => {
  if (!filesPageStore.selectedFolder) return [];
  return getContextMenuItems(filesPageStore.selectedFolder);
});

const sortFields: { label: string; value: FileSortField }[] = [
  { label: t('common.name', 'Name'), value: 'name' },
  { label: t('common.type', 'Type'), value: 'type' },
  { label: t('common.size', 'Size'), value: 'size' },
  { label: t('common.created', 'Created'), value: 'created' },
  { label: t('common.modified', 'Modified'), value: 'modified' },
];

const GRID_SIZES = [80, 100, 130, 160, 200];
const GRID_SIZE_NAMES = ['xs', 's', 'm', 'l', 'xl'];

const currentGridSizeName = computed(() => {
  const index = GRID_SIZES.indexOf(filesPageStore.gridCardSize);
  return GRID_SIZE_NAMES[index] || 'm';
});

const resizingColumn = ref<string | null>(null);
const resizeStartX = ref(0);
const resizeStartWidth = ref(0);

async function loadFolderContent() {
  if (!filesPageStore.selectedFolder || !filesPageStore.selectedFolder.handle) {
    cleanupObjectUrls();
    folderEntries.value = [];
    return;
  }

  isLoading.value = true;
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
  } finally {
    isLoading.value = false;
  }
}

function cleanupObjectUrls() {
  for (const entry of folderEntries.value as ExtendedFsEntry[]) {
    if (entry.objectUrl) {
      URL.revokeObjectURL(entry.objectUrl);
    }
  }
}

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
      result = (a.size || 0) - (b.size || 0);
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
  if (entry.kind === 'directory') {
    filesPageStore.selectFolder(entry);
  } else {
    filesPageStore.selectFile(entry);
  }
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
</script>

<template>
  <div class="flex flex-col h-full bg-ui-bg relative overflow-hidden">
    <!-- Navigation bar -->
    <div
      v-if="filesPageStore.selectedFolder && filesPageStore.selectedFolder.path !== ''"
      class="flex items-center gap-1 px-4 py-2 border-b border-ui-border/50 bg-ui-bg-accent/30 shrink-0"
    >
      <UButton
        variant="ghost"
        color="neutral"
        size="xs"
        icon="i-heroicons-arrow-left"
        @click="navigateBack"
      />
      <UButton
        variant="ghost"
        color="neutral"
        size="xs"
        icon="i-heroicons-arrow-up"
        @click="navigateUp"
      />

      <div class="flex items-center gap-1 ml-2 overflow-x-auto">
        <template v-for="(folder, index) in parentFolders" :key="folder.path">
          <button
            class="text-xs text-ui-text-muted hover:text-ui-text transition-colors shrink-0"
            :class="{ 'text-ui-text font-medium': index === parentFolders.length - 1 }"
            @click="navigateToFolder(index)"
          >
            {{ folder.name }}
          </button>
          <UIcon
            v-if="index < parentFolders.length - 1"
            name="i-heroicons-chevron-right"
            class="w-3 h-3 text-ui-text-muted shrink-0"
          />
        </template>
      </div>
    </div>

    <!-- Toolbar -->
    <div
      class="flex items-center gap-4 px-4 py-2 border-b border-ui-border shrink-0 bg-ui-bg-elevated/50"
    >
      <div class="flex items-center gap-1">
        <UButton
          :color="filesPageStore.viewMode === 'grid' ? 'primary' : 'neutral'"
          variant="ghost"
          icon="i-heroicons-squares-2x2"
          size="sm"
          @click="filesPageStore.setViewMode('grid')"
        />
        <UButton
          :color="filesPageStore.viewMode === 'list' ? 'primary' : 'neutral'"
          variant="ghost"
          icon="i-heroicons-list-bullet"
          size="sm"
          @click="filesPageStore.setViewMode('list')"
        />
      </div>

      <!-- Card size slider (only in grid view) -->
      <div
        v-if="filesPageStore.viewMode === 'grid'"
        class="flex items-center gap-2 ml-2 w-24"
        :title="`${t('videoEditor.fileManager.cardScale', 'Масштаб карточек')}: ${currentGridSizeName}`"
      >
        <WheelSlider
          :model-value="GRID_SIZES.indexOf(filesPageStore.gridCardSize)"
          :min="0"
          :max="GRID_SIZES.length - 1"
          :step="1"
          class="flex-1 w-full"
          @update:model-value="(v: number) => filesPageStore.setGridCardSize(GRID_SIZES[v] || 130)"
        />
      </div>

      <div class="ml-auto flex items-center gap-2">
        <span class="text-xs text-ui-text-muted">{{ t('common.sortBy', 'Sort by') }}:</span>
        <USelectMenu
          v-model="filesPageStore.sortOption.field"
          :items="sortFields"
          value-key="value"
          size="xs"
          class="w-32"
          :search-input="false"
        />
        <UButton
          :icon="
            filesPageStore.sortOption.order === 'asc'
              ? 'i-heroicons-bars-arrow-up'
              : 'i-heroicons-bars-arrow-down'
          "
          variant="ghost"
          color="neutral"
          size="xs"
          @click="
            filesPageStore.sortOption.order =
              filesPageStore.sortOption.order === 'asc' ? 'desc' : 'asc'
          "
        />
        <div class="w-px h-4 bg-ui-border mx-1"></div>
        <UButton
          icon="i-heroicons-arrow-path"
          variant="ghost"
          color="neutral"
          size="xs"
          :title="t('videoEditor.fileManager.actions.syncTreeTooltip', 'Refresh file tree')"
          @click="
            async () => {
              await loadProjectDirectory();
              uiStore.notifyFileManagerUpdate();
              await loadFolderContent();
            }
          "
        />
        <UButton
          :icon="uiStore.showHiddenFiles ? 'i-heroicons-eye-slash' : 'i-heroicons-eye'"
          variant="ghost"
          color="neutral"
          size="xs"
          :title="
            uiStore.showHiddenFiles
              ? t('videoEditor.fileManager.actions.hideHiddenFiles', 'Hide hidden files')
              : t('videoEditor.fileManager.actions.showHiddenFiles', 'Show hidden files')
          "
          @click="uiStore.showHiddenFiles = !uiStore.showHiddenFiles"
        />
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 overflow-auto p-4 content-scrollbar" @click.self="navigateToRoot">
      <UContextMenu :items="emptySpaceContextMenuItems" class="min-h-full">
        <div class="min-h-full flex flex-col">
          <div
            v-if="isLoading"
            class="flex flex-col items-center justify-center flex-1 gap-4 text-ui-text-muted"
          >
            <UIcon name="i-heroicons-arrow-path" class="w-8 h-8 animate-spin" />
            <span>{{ t('common.loading', 'Loading...') }}</span>
          </div>

          <div
            v-else-if="!filesPageStore.selectedFolder"
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
          <div v-else-if="filesPageStore.viewMode === 'grid'" class="flex flex-wrap gap-2">
            <UContextMenu
              v-for="entry in sortedEntries"
              :key="entry.path"
              :items="getContextMenuItems(entry)"
            >
              <div
                class="flex flex-col items-center p-2 rounded-lg border border-transparent hover:border-ui-border hover:bg-ui-bg-elevated cursor-pointer group transition-all shrink-0"
                :class="{
                  'bg-primary-500/10 border-primary-500/30':
                    selectionStore.selectedEntity?.source === 'fileManager' &&
                    selectionStore.selectedEntity.path === entry.path,
                  'border-b-2 border-b-red-500':
                    entry.path && timelineMediaUsageStore.mediaPathToTimelines[entry.path]?.length,
                  'opacity-30': entry.name.startsWith('.'),
                }"
                :style="{ width: `${filesPageStore.gridCardSize}px` }"
                @click="handleEntryClick(entry)"
                @dblclick="
                  entry.kind === 'directory' ? filesPageStore.selectFolder(entry) : undefined
                "
              >
                <div
                  class="relative mb-2 w-full aspect-square flex items-center justify-center bg-ui-bg rounded overflow-hidden"
                >
                  <img
                    v-if="entry.kind === 'file' && (entry as ExtendedFsEntry).objectUrl"
                    :src="(entry as ExtendedFsEntry).objectUrl"
                    :alt="entry.name"
                    class="max-w-full max-h-full object-contain"
                  />
                  <div
                    v-else-if="proxyStore.generatingProxies.has(entry.path || '')"
                    class="relative flex items-center justify-center text-amber-400"
                  >
                    <ProgressSpinner
                      :progress="proxyStore.proxyProgress[entry.path || ''] ?? 0"
                      size="md"
                    />
                  </div>
                  <UIcon
                    v-else
                    :name="getFileIcon(entry)"
                    :class="[
                      entry.kind === 'directory' ? 'text-blue-400' : 'text-ui-text-muted',
                      fileManager.mediaCache.hasProxy(entry.path || '') &&
                      !proxyStore.generatingProxies.has(entry.path || '')
                        ? 'text-(--color-success)!'
                        : '',
                      proxyStore.generatingProxies.has(entry.path || '') ||
                      isGeneratingProxyInDirectory(entry)
                        ? 'text-amber-400/90'
                        : '',
                      {
                        'w-8 h-8': currentGridSizeName === 'xs',
                        'w-10 h-10': currentGridSizeName === 's',
                        'w-12 h-12': currentGridSizeName === 'm',
                        'w-16 h-16': currentGridSizeName === 'l',
                        'w-20 h-20': currentGridSizeName === 'xl',
                      },
                    ]"
                  />
                </div>
                <span
                  class="text-center break-all line-clamp-2 px-1 transition-colors"
                  :class="[
                    fileManager.mediaCache.hasProxy(entry.path || '') &&
                    !proxyStore.generatingProxies.has(entry.path || '')
                      ? 'text-(--color-success)!'
                      : '',
                    proxyStore.generatingProxies.has(entry.path || '') ||
                    isGeneratingProxyInDirectory(entry)
                      ? 'text-amber-400!'
                      : '',
                    {
                      'text-[10px]': currentGridSizeName === 'xs',
                      'text-xs': currentGridSizeName === 's' || currentGridSizeName === 'm',
                      'text-sm': currentGridSizeName === 'l' || currentGridSizeName === 'xl',
                    },
                  ]"
                  :title="entry.name"
                >
                  {{ entry.name }}
                </span>
              </div>
            </UContextMenu>
          </div>

          <!-- List View -->
          <div v-else class="flex flex-col w-full min-w-max">
            <table class="w-full text-left text-xs border-collapse">
              <thead>
                <tr class="text-ui-text-muted border-b border-ui-border">
                  <th
                    class="py-2 px-3 font-medium cursor-pointer hover:text-ui-text transition-colors select-none relative"
                    :style="{ width: `${filesPageStore.columnWidths.name}px`, minWidth: '60px' }"
                    @click="handleSort('name')"
                  >
                    <div class="flex items-center gap-1">
                      {{ t('common.name', 'Name') }}
                      <UIcon
                        v-if="filesPageStore.sortOption.field === 'name'"
                        :name="
                          filesPageStore.sortOption.order === 'asc'
                            ? 'i-heroicons-bars-arrow-up'
                            : 'i-heroicons-bars-arrow-down'
                        "
                        class="w-3 h-3"
                      />
                    </div>
                    <div
                      class="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary-500/50"
                      @mousedown.stop="onResizeStart($event, 'name')"
                    />
                  </th>

                  <th
                    class="py-2 px-3 font-medium cursor-pointer hover:text-ui-text transition-colors select-none relative"
                    :style="{ width: `${filesPageStore.columnWidths.type}px`, minWidth: '60px' }"
                    @click="handleSort('type')"
                  >
                    <div class="flex items-center gap-1">
                      {{ t('common.type', 'Type') }}
                      <UIcon
                        v-if="filesPageStore.sortOption.field === 'type'"
                        :name="
                          filesPageStore.sortOption.order === 'asc'
                            ? 'i-heroicons-bars-arrow-up'
                            : 'i-heroicons-bars-arrow-down'
                        "
                        class="w-3 h-3"
                      />
                    </div>
                    <div
                      class="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary-500/50"
                      @mousedown.stop="onResizeStart($event, 'type')"
                    />
                  </th>

                  <th
                    class="py-2 px-3 font-medium text-right cursor-pointer hover:text-ui-text transition-colors select-none relative"
                    :style="{ width: `${filesPageStore.columnWidths.size}px`, minWidth: '60px' }"
                    @click="handleSort('size')"
                  >
                    <div class="flex items-center justify-end gap-1">
                      {{ t('common.size', 'Size') }}
                      <UIcon
                        v-if="filesPageStore.sortOption.field === 'size'"
                        :name="
                          filesPageStore.sortOption.order === 'asc'
                            ? 'i-heroicons-bars-arrow-up'
                            : 'i-heroicons-bars-arrow-down'
                        "
                        class="w-3 h-3"
                      />
                    </div>
                    <div
                      class="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary-500/50"
                      @mousedown.stop="onResizeStart($event, 'size')"
                    />
                  </th>

                  <th
                    class="py-2 px-3 font-medium cursor-pointer hover:text-ui-text transition-colors select-none relative"
                    :style="{ width: `${filesPageStore.columnWidths.created}px`, minWidth: '60px' }"
                    @click="handleSort('created')"
                  >
                    <div class="flex items-center gap-1">
                      {{ t('common.created', 'Created') }}
                      <UIcon
                        v-if="filesPageStore.sortOption.field === 'created'"
                        :name="
                          filesPageStore.sortOption.order === 'asc'
                            ? 'i-heroicons-bars-arrow-up'
                            : 'i-heroicons-bars-arrow-down'
                        "
                        class="w-3 h-3"
                      />
                    </div>
                    <div
                      class="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary-500/50"
                      @mousedown.stop="onResizeStart($event, 'created')"
                    />
                  </th>

                  <th
                    class="py-2 px-3 font-medium cursor-pointer hover:text-ui-text transition-colors select-none relative"
                    :style="{
                      width: `${filesPageStore.columnWidths.modified}px`,
                      minWidth: '60px',
                    }"
                    @click="handleSort('modified')"
                  >
                    <div class="flex items-center gap-1">
                      {{ t('common.modified', 'Modified') }}
                      <UIcon
                        v-if="filesPageStore.sortOption.field === 'modified'"
                        :name="
                          filesPageStore.sortOption.order === 'asc'
                            ? 'i-heroicons-bars-arrow-up'
                            : 'i-heroicons-bars-arrow-down'
                        "
                        class="w-3 h-3"
                      />
                    </div>
                    <div
                      class="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary-500/50"
                      @mousedown.stop="onResizeStart($event, 'modified')"
                    />
                  </th>
                </tr>
              </thead>

              <tbody>
                <UContextMenu
                  v-for="entry in sortedEntries as ExtendedFsEntry[]"
                  :key="entry.path"
                  :items="getContextMenuItems(entry)"
                  as="tr"
                  class="hover:bg-ui-bg-elevated cursor-pointer group border-b border-ui-border/50"
                  :class="{
                    'bg-primary-500/10':
                      selectionStore.selectedEntity?.source === 'fileManager' &&
                      selectionStore.selectedEntity.path === entry.path,
                    'opacity-30': entry.name.startsWith('.'),
                    'text-(--color-success)!':
                      fileManager.mediaCache.hasProxy(entry.path || '') &&
                      !proxyStore.generatingProxies.has(entry.path || ''),
                    'text-amber-400!':
                      proxyStore.generatingProxies.has(entry.path || '') ||
                      isGeneratingProxyInDirectory(entry),
                  }"
                  @click="handleEntryClick(entry)"
                  @dblclick="
                    entry.kind === 'directory' ? filesPageStore.selectFolder(entry) : undefined
                  "
                >
                  <td class="py-2 px-3 flex items-center gap-2">
                    <div
                      class="h-4 flex items-center justify-center shrink-0"
                      :class="[
                        entry.path &&
                        timelineMediaUsageStore.mediaPathToTimelines[entry.path]?.length
                          ? 'border-b-2 border-red-500'
                          : '',
                      ]"
                    >
                      <ProgressSpinner
                        v-if="proxyStore.generatingProxies.has(entry.path || '')"
                        :progress="proxyStore.proxyProgress[entry.path || ''] ?? 0"
                        size="sm"
                      />
                      <UIcon
                        v-else
                        :name="getFileIcon(entry)"
                        class="w-4 h-4 transition-colors"
                        :class="[
                          entry.kind === 'directory' ? 'text-blue-400' : 'text-ui-text-muted',
                          entry.name.startsWith('.') ? 'opacity-30' : '',
                          fileManager.mediaCache.hasProxy(entry.path || '') &&
                          !proxyStore.generatingProxies.has(entry.path || '')
                            ? 'text-(--color-success)!'
                            : '',
                          proxyStore.generatingProxies.has(entry.path || '') ||
                          isGeneratingProxyInDirectory(entry)
                            ? 'text-amber-400/90'
                            : '',
                        ]"
                      />
                    </div>
                    <span
                      class="truncate max-w-50 transition-colors"
                      :class="[
                        entry.name.startsWith('.') ? 'opacity-30' : '',
                        fileManager.mediaCache.hasProxy(entry.path || '') &&
                        !proxyStore.generatingProxies.has(entry.path || '')
                          ? 'text-(--color-success)!'
                          : '',
                        proxyStore.generatingProxies.has(entry.path || '') ||
                        isGeneratingProxyInDirectory(entry)
                          ? 'text-amber-400!'
                          : '',
                      ]"
                      :title="entry.name"
                    >
                      {{ entry.name }}
                    </span>
                  </td>
                  <td class="py-2 px-3 text-ui-text-muted">
                    {{ entry.kind === 'directory' ? t('common.folder', 'Folder') : entry.mimeType }}
                  </td>
                  <td class="py-2 px-3 text-right text-ui-text-muted">
                    {{ entry.kind === 'file' ? formatBytes(entry.size || 0) : '-' }}
                  </td>
                  <td class="py-2 px-3 text-ui-text-muted">
                    {{ formatDate(entry.created) }}
                  </td>
                  <td class="py-2 px-3 text-ui-text-muted">
                    {{ formatDate(entry.lastModified) }}
                  </td>
                </UContextMenu>
              </tbody>
            </table>
          </div>
        </div>
      </UContextMenu>
    </div>

    <!-- Bottom Panel -->
    <div
      class="px-4 py-2 border-t border-ui-border shrink-0 bg-ui-bg-elevated/50 flex items-center justify-end text-[10px] uppercase font-bold tracking-wider text-ui-text-muted"
    >
      <div v-if="filesPageStore.selectedFolder" class="flex items-center gap-4">
        <span
          >{{ t('common.totalSize', 'Total Size') }}:
          <span class="text-ui-text">{{ stats.totalSize }}</span></span
        >
        <span
          >{{ t('common.filesCount', 'Files') }}:
          <span class="text-ui-text">{{ stats.fileCount }}</span></span
        >
      </div>
    </div>

    <!-- Modals -->
    <CreateFolderModal v-model:open="isCreateFolderModalOpen" @create="handleCreateFolder" />
    <RenameModal
      v-model:open="isRenameModalOpen"
      :initial-name="renameTarget?.name"
      @rename="handleRename"
    />
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
    <input ref="directoryUploadInput" type="file" multiple class="hidden" @change="() => {}" />
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
