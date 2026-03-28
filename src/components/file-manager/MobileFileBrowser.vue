<script setup lang="ts">
import { ref, onMounted, computed, watch, onBeforeUnmount } from 'vue';
import { useFilesPageStore } from '~/stores/files-page.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import { useProjectStore } from '~/stores/project.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useUiStore } from '~/stores/ui.store';
import { useProxyStore } from '~/stores/proxy.store';
import { formatBytes } from '~/utils/format';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { useTimelineStore } from '~/stores/timeline.store';
import { useFileManagerThumbnails } from '~/composables/fileManager/useFileManagerThumbnails';
import MobileFileBrowserGrid from './MobileFileBrowserGrid.vue';
import MobileFileBrowserDrawer from './MobileFileBrowserDrawer.vue';
import type { FsEntry } from '~/types/fs';
import {
  getWorkspacePathParent,
  WORKSPACE_COMMON_DIR_NAME,
  WORKSPACE_COMMON_PATH_PREFIX,
} from '~/utils/workspace-common';

const SUPPORTED_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg'];

const filesPageStore = useFilesPageStore();
const projectStore = useProjectStore();
const selectionStore = useSelectionStore();
const uiStore = useUiStore();
const proxyStore = useProxyStore();
const timelineStore = useTimelineStore();
const toast = useToast();
const { t } = useI18n();
const { readDirectory, getFileIcon, findEntryByPath, mediaCache, vfs, handleFiles, createFolder, reloadDirectory } = useFileManager();

const fileInput = ref<HTMLInputElement | null>(null);
const viewMode = ref<'grid' | 'list'>('grid');
const isSelectionMode = ref(false);
const isDrawerOpen = ref(false);

const selectedEntries = computed(() => {
  const entity = selectionStore.selectedEntity;
  if (!entity || entity.source !== 'fileManager') return [];
  if (entity.kind === 'multiple') return entity.entries;
  return [entity.entry];
});

function toggleSelectionMode() {
  isSelectionMode.value = !isSelectionMode.value;
  if (!isSelectionMode.value) {
    selectionStore.clearSelection();
  }
}

function handleLongPress(entry: FsEntry) {
  if (!isSelectionMode.value) {
    isSelectionMode.value = true;
    selectionStore.selectFsEntry(entry);
    // При долгом нажатии шторку обычно не открываем сразу, 
    // чтобы пользователь мог продолжить выбор
  }
}

function handleToggleSelection(entry: FsEntry) {
  const current = selectedEntries.value;
  const index = current.findIndex(e => e.path === entry.path);
  
  if (index === -1) {
    selectionStore.selectFsEntries([...current, entry]);
  } else {
    const next = current.filter(e => e.path !== entry.path);
    if (next.length === 0) {
      isSelectionMode.value = false;
      selectionStore.clearSelection();
    } else {
      selectionStore.selectFsEntries(next);
    }
  }
}

function handleEntryClick(entry: FsEntry) {
  if (entry.kind === 'directory' && !isSelectionMode.value) {
    filesPageStore.openFolder(entry);
    return;
  }
  
  if (isSelectionMode.value) {
    handleToggleSelection(entry);
  } else {
    selectionStore.selectFsEntry(entry);
    isDrawerOpen.value = true;
  }
}

async function onCreateFolder() {
  const name = prompt(t('videoEditor.fileManager.actions.createFolder', 'Create Folder'));
  if (name) {
    const parentPath = filesPageStore.selectedFolder?.path || '';
    await createFolder(name, parentPath);
    await loadFolderContent();
  }
}

function triggerFileUpload() {
  fileInput.value?.click();
}

function onFileSelect(e: Event) {
  const target = e.target as HTMLInputElement;
  if (target.files) {
    const files = Array.from(target.files);
    target.value = '';
    const parentPath = filesPageStore.selectedFolder?.path || '';
    handleFiles(files, parentPath).then(() => {
      loadFolderContent();
    });
  }
}

const menuItems = computed(() => [
  [
    {
      label: isSelectionMode.value ? t('common.cancelSelection', 'Cancel Selection') : t('common.selectItems', 'Select Items'),
      icon: isSelectionMode.value ? 'lucide:x-circle' : 'lucide:check-square',
      onSelect: toggleSelectionMode,
    },
    {
      label: viewMode.value === 'grid' ? t('common.listView', 'List View') : t('common.gridView', 'Grid View'),
      icon: viewMode.value === 'grid' ? 'lucide:list' : 'lucide:layout-grid',
      onSelect: () => viewMode.value = viewMode.value === 'grid' ? 'list' : 'grid',
    },
  ],
  [
    {
      label: t('videoEditor.fileManager.actions.uploadFiles', 'Upload files'),
      icon: 'i-heroicons-arrow-up-tray',
      onSelect: triggerFileUpload,
    },
    {
      label: t('videoEditor.fileManager.actions.createFolder', 'Create Folder'),
      icon: 'i-heroicons-folder-plus',
      onSelect: onCreateFolder,
    },
  ],
  [
    {
      label: t('common.refresh', 'Refresh'),
      icon: 'i-heroicons-arrow-path',
      onSelect: async () => {
        const path = filesPageStore.selectedFolder?.path || '';
        await reloadDirectory(path);
        await loadFolderContent();
      },
    },
  ]
]);

interface ExtendedFsEntry extends FsEntry {
  objectUrl?: string;
  size?: number;
}

const entries = ref<ExtendedFsEntry[]>([]);
const isLoading = ref(false);

const { thumbnails } = useFileManagerThumbnails(entries);

// Очистка URL при размонтировании
function cleanupObjectUrls() {
  for (const entry of entries.value) {
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
  }
}

onBeforeUnmount(cleanupObjectUrls);

// Генерируем "хлебные крошки" для навигации назад
const breadcrumbs = computed(() => {
  const folder = filesPageStore.selectedFolder;
  if (!folder || !folder.path) return [];

  const parts = folder.path.split('/').filter(Boolean);
  const result: Array<{ name: string; path: string }> = [];
  let currentPath = '';

  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    result.push({
      name: part === WORKSPACE_COMMON_PATH_PREFIX ? WORKSPACE_COMMON_DIR_NAME : part,
      path: currentPath,
    });
  }

  return result;
});

async function loadFolderContent() {
  const folder = filesPageStore.selectedFolder;
  if (!folder) {
    // Если папка не выбрана, пытаемся открыть корень проекта
    await navigateToRoot();
    return;
  }

  isLoading.value = true;
  try {
    let content = await readDirectory(folder.path);
    if (!folder.path) {
      const commonMetadata = await vfs.getMetadata(WORKSPACE_COMMON_PATH_PREFIX);
      if (commonMetadata?.kind === 'directory') {
        const commonEntry: FsEntry = {
          kind: 'directory',
          name: WORKSPACE_COMMON_DIR_NAME,
          path: WORKSPACE_COMMON_PATH_PREFIX,
        };
        content = [
          commonEntry,
          ...content.filter((entry) => entry.path !== WORKSPACE_COMMON_PATH_PREFIX),
        ];
      }
    }
    
    // Очищаем старые URL перед загрузкой новых
    cleanupObjectUrls();

    // Фильтруем скрытые файлы если настройка выключена и дополняем метаданными
    const filteredContent = content.filter((e) => uiStore.showHiddenFiles || !e.name.startsWith('.'));
    
    // Добавляем objectUrl для картинок
    entries.value = await Promise.all(filteredContent.map(async (entry) => {
      if (entry.kind === 'file') {
        const ext = entry.name.split('.').pop()?.toLowerCase();
        if (ext && SUPPORTED_IMAGE_EXTS.includes(ext)) {
          try {
            const file = await vfs.getFile(entry.path);
            if (file) {
              return {
                ...entry,
                size: file.size,
                objectUrl: URL.createObjectURL(file)
              };
            }
          } catch (e) {
            console.warn('Failed to get file for preview:', entry.path, e);
          }
        }
      }
      return entry as ExtendedFsEntry;
    }));

  } catch (error) {
    console.error('Failed to load mobile folder content:', error);
  } finally {
    isLoading.value = false;
  }
}

async function navigateToRoot() {
  filesPageStore.selectFolder({
    kind: 'directory',
    name: projectStore.currentProjectName || 'Root',
    path: '',
  });
}

async function navigateToWorkspaceCommonRoot() {
  filesPageStore.selectFolder({
    kind: 'directory',
    name: WORKSPACE_COMMON_DIR_NAME,
    path: WORKSPACE_COMMON_PATH_PREFIX,
  });
}

async function handleEntryPrimaryAction(entry: FsEntry) {
  if (entry.kind === 'directory') {
    filesPageStore.openFolder(entry);
    return;
  }

  selectionStore.selectFsEntry(entry);
  await handleAddToProject();
}

async function goBack() {
  const folder = filesPageStore.selectedFolder;
  if (!folder || !folder.path) return;

  const parentPath = getWorkspacePathParent(folder.path);

  if (!parentPath) {
    await navigateToRoot();
  } else if (parentPath === WORKSPACE_COMMON_PATH_PREFIX) {
    await navigateToWorkspaceCommonRoot();
  } else {
    const parentEntry = findEntryByPath(parentPath);
    if (parentEntry) {
      filesPageStore.selectFolder(parentEntry);
    }
  }
}

function isSelected(entry: FsEntry) {
  const selected = selectionStore.selectedEntity;
  if (!selected || selected.source !== 'fileManager') return false;
  if (selected.kind === 'multiple') {
    return selected.entries.some(e => e.path === entry.path);
  }
  return selected.path === entry.path;
}

function isWorkspaceCommonRoot(entry: FsEntry) {
  return entry.kind === 'directory' && entry.path === WORKSPACE_COMMON_PATH_PREFIX;
}

function getStatusColor(entry: FsEntry) {
  if (entry.path && proxyStore.generatingProxies.has(entry.path)) return 'text-amber-400';
  if (entry.path && mediaCache.hasProxy(entry.path)) return 'text-green-500';
  return '';
}

const selectedFile = computed(() => {
  const entity = selectionStore.selectedEntity;
  if (!entity || entity.source !== 'fileManager' || entity.kind !== 'file') return null;
  return entity;
});

const selectedFileTypeLabel = computed(() => {
  if (!selectedFile.value) return '';
  return getMediaTypeFromFilename(selectedFile.value.name);
});

async function handleAddToProject() {
  const entity = selectionStore.selectedEntity;
  if (!entity || entity.source !== 'fileManager' || entity.kind !== 'file' || !entity.path) return;

  const mediaType = getMediaTypeFromFilename(entity.name);
  if (mediaType === 'unknown') {
    toast.add({
      title: t('common.error', 'Error'),
      description: t('mobileFiles.unknownFileType', 'Unknown file type'),
      color: 'error',
    });
    return;
  }

  try {
    const startUs = timelineStore.currentTime;
    const targetTrackKind = mediaType === 'audio' ? 'audio' : 'video';
    const tracks = timelineStore.timelineDoc?.tracks || [];
    const trackId = tracks.find((t) => t.kind === targetTrackKind)?.id;

    if (!trackId) {
      toast.add({
        title: t('common.error', 'Error'),
        description: t('mobileFiles.noSuitableTrack', 'No suitable track found'),
        color: 'error',
      });
      return;
    }

    if (mediaType === 'text') {
      const file = await vfs.getFile(entity.path);
      if (file) {
        const text = await file.text();
        await timelineStore.addVirtualClipToTrack({
          trackId,
          startUs,
          clipType: 'text',
          name: entity.name,
          text,
        });
      }
    } else {
      await timelineStore.addClipToTimelineFromPath({
        trackId,
        name: entity.name,
        path: entity.path,
        startUs,
      });
    }

    await timelineStore.requestTimelineSave({ immediate: true });
  } catch (err: any) {
    toast.add({
      title: t('common.error', 'Error'),
      description: String(err?.message || err),
      color: 'error',
    });
  }
}

// Следим за изменением выбранной папки
watch(
  () => filesPageStore.selectedFolder?.path,
  () => {
    void loadFolderContent();
  },
  { immediate: true },
);

onMounted(() => {
  if (!filesPageStore.selectedFolder) {
    void navigateToRoot();
  } else {
    void loadFolderContent();
  }
});
</script>

<template>
  <div class="flex flex-col h-full bg-slate-950 text-slate-200">
    <input ref="fileInput" type="file" multiple class="hidden" @change="onFileSelect" />

    <!-- Навигация (Breadcrumbs/Back) -->
    <div class="flex items-center gap-2 border-b border-slate-800 bg-slate-900/50 px-3 py-2.5">
      <UButton
        v-if="filesPageStore.selectedFolder?.path && !isSelectionMode"
        icon="lucide:chevron-left"
        variant="ghost"
        color="neutral"
        size="sm"
        @click="goBack"
      />
      <UButton
        v-if="isSelectionMode"
        icon="lucide:x"
        variant="ghost"
        color="neutral"
        size="sm"
        @click="toggleSelectionMode"
      />
      
      <div class="flex-1 overflow-x-hidden">
        <div v-if="isSelectionMode" class="font-medium text-sm px-2">
          {{ selectedEntries.length }} {{ t('common.selected', 'Selected') }}
        </div>
        <div v-else class="flex items-center gap-1 text-xs text-slate-400 overflow-x-auto no-scrollbar">
          <span class="shrink-0">{{ projectStore.currentProjectName }}</span>
          <template v-for="bc in breadcrumbs" :key="bc.path">
            <Icon name="lucide:chevron-right" class="w-3 h-3 opacity-30 shrink-0" />
            <span class="shrink-0 last:text-slate-100 last:font-medium">{{ bc.name }}</span>
          </template>
        </div>
      </div>
      <div class="shrink-0 flex items-center ml-2">
        <UButton
          v-if="isSelectionMode"
          icon="lucide:info"
          variant="ghost"
          color="neutral"
          size="sm"
          class="mr-1"
          @click="isDrawerOpen = true"
        />
        <UDropdownMenu :items="menuItems" :ui="{ content: 'w-56 min-w-max' }">
          <UButton
            icon="lucide:more-vertical"
            variant="ghost"
            color="neutral"
            size="sm"
          />
        </UDropdownMenu>
      </div>
    </div>

    <!-- Список / Сетка файлов -->
    <div class="flex-1 overflow-y-auto min-h-0">
      <!-- Grid View -->
      <MobileFileBrowserGrid
        v-if="viewMode === 'grid'"
        :entries="entries"
        :thumbnails="thumbnails"
        :is-loading="isLoading"
        :is-selection-mode="isSelectionMode"
        :selected-entries="selectedEntries"
        :selected-entry-path="(selectionStore.selectedEntity?.source === 'fileManager' && 'path' in selectionStore.selectedEntity ? selectionStore.selectedEntity.path : null) ?? null"
        @entry-click="handleEntryClick"
        @entry-primary-action="handleEntryPrimaryAction"
        @long-press="handleLongPress"
        @toggle-selection="handleToggleSelection"
      />

      <!-- List View (Fallback/Old view) -->
      <div v-else-if="isLoading" class="flex h-32 items-center justify-center">
        <Icon name="lucide:loader-2" class="w-6 h-6 animate-spin text-blue-500" />
      </div>

      <div
        v-else-if="entries.length === 0"
        class="flex flex-col items-center justify-center h-64 opacity-30"
      >
        <Icon name="lucide:folder-open" class="w-12 h-12 mb-2" />
        <p class="text-sm">Empty folder</p>
      </div>

      <div v-else class="divide-y divide-slate-900/70 px-2 py-2">
        <div v-for="entry in entries" :key="entry.path" class="overflow-hidden rounded-2xl">
          <button
            class="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors active:bg-slate-900"
            :class="{ 'bg-blue-600/10 ring-1 ring-blue-500/30 inset': isSelected(entry) }"
            @click="handleEntryClick(entry)"
          >
            <!-- Checkbox for selection mode in list view -->
            <div 
              v-if="isSelectionMode"
              class="shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all"
              :class="[
                isSelected(entry) 
                  ? 'bg-blue-500 border-blue-500' 
                  : 'bg-black/20 border-white/40'
              ]"
            >
              <Icon v-if="isSelected(entry)" name="lucide:check" class="w-4 h-4 text-white" />
            </div>

            <div
              class="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-900"
            >
              <template v-if="entry.objectUrl || (entry.path && thumbnails[entry.path])">
                <img :src="entry.objectUrl || thumbnails[entry.path!]" class="w-full h-full object-cover" />
              </template>
              <Icon
                v-else
                :name="getFileIcon(entry)"
                class="w-6 h-6"
                :class="[
                  isWorkspaceCommonRoot(entry)
                    ? 'text-violet-400'
                    : entry.kind === 'directory'
                      ? 'text-slate-400'
                      : 'text-slate-400',
                  getStatusColor(entry),
                ]"
              />

              <div
                v-if="entry.path && proxyStore.generatingProxies.has(entry.path)"
                class="absolute inset-0 flex items-center justify-center bg-black/40"
              >
                <div
                  class="h-3 w-3 rounded-full border-2 border-amber-400 border-t-transparent animate-spin"
                ></div>
              </div>
            </div>

            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between gap-2">
                <span class="truncate text-sm font-medium" :class="getStatusColor(entry)">
                  {{ entry.name }}
                </span>
                <span v-if="entry.kind === 'file'" class="text-2xs tabular-nums text-slate-500">
                  {{ formatBytes(entry.size || 0) }}
                </span>
              </div>
              <div class="flex items-center gap-2 text-2xs text-slate-500">
                <span>{{
                  entry.kind === 'directory' ? 'Folder' : getMediaTypeFromFilename(entry.name)
                }}</span>
                <span v-if="entry.lastModified"
                  >• {{ new Date(entry.lastModified).toLocaleDateString() }}</span
                >
              </div>
            </div>

            <div class="flex items-center gap-2">
              <UButton
                v-if="entry.kind === 'file' && !isSelectionMode"
                size="xs"
                color="primary"
                variant="soft"
                icon="lucide:plus"
                aria-label="Add file to project"
                @click.stop="handleEntryPrimaryAction(entry)"
              />
              <Icon
                v-if="entry.kind === 'directory' && !isSelectionMode"
                name="lucide:chevron-right"
                class="h-4 w-4 text-slate-700"
              />
            </div>
          </button>
        </div>
      </div>
    </div>

    <!-- Инфо-панель (быстрые действия, когда что-то выбрано, но шторка закрыта) -->
    <div
      v-if="selectedFile && !isDrawerOpen"
      class="border-t border-slate-800 bg-slate-900 p-3 animate-in slide-in-from-bottom-5"
    >
      <div class="flex items-center justify-between gap-4">
        <div class="flex-1 min-w-0" @click="isDrawerOpen = true">
          <p class="truncate text-xs font-semibold">{{ selectedFile.name }}</p>
          <p class="text-2xs text-slate-500">
            {{ selectedFileTypeLabel }} • {{ t('common.tapToSeeProperties', 'tap to see properties') }}
          </p>
        </div>
        <div class="flex gap-2">
          <UButton
            size="xs"
            color="primary"
            icon="lucide:plus"
            label="Add"
            @click="handleAddToProject"
          />
        </div>
      </div>
    </div>

    <!-- Properties Drawer -->
    <MobileFileBrowserDrawer 
      :is-open="isDrawerOpen" 
      @close="isDrawerOpen = false" 
    />
  </div>
</template>

<style scoped>
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
