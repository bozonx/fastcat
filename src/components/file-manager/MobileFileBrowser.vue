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
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import { useClipboardStore } from '~/stores/clipboard.store';
import { useFileManagerActions, type FileAction } from '~/composables/fileManager/useFileManagerActions';
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
const {
  readDirectory,
  getFileIcon,
  findEntryByPath,
  mediaCache,
  vfs,
  handleFiles,
  createFolder,
  createTimeline,
  createMarkdown,
  reloadDirectory,
  deleteEntry,
  renameEntry,
  copyEntry,
  moveEntry,
} = useFileManager();

const clipboardStore = useClipboardStore();

const { 
  onFileAction, 
  isDeleteConfirmModalOpen, 
  deleteTargets, 
  handleDeleteConfirm 
} = useFileManagerActions({
  createFolder,
  renameEntry,
  deleteEntry,
  loadProjectDirectory: async () => { await loadFolderContent(); },
  handleFiles,
  mediaCache,
  vfs,
  findEntryByPath,
  readDirectory,
  reloadDirectory,
  copyEntry,
  moveEntry,
});

async function handleDrawerAction(action: FileAction, entry: any) {
  if (['copy', 'cut'].includes(action)) {
    isSelectionMode.value = false;
    selectionStore.clearSelection();
    isDrawerOpen.value = false;
  }
  await onFileAction(action, entry);
}

const fileInput = ref<HTMLInputElement | null>(null);
const isSelectionMode = ref(false);
const isDrawerOpen = ref(false);
const isCreateMenuOpen = ref(false);

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
    isDrawerOpen.value = false;
  }
}

// Следим за закрытием шторки, чтобы сбросить выделение
watch(isDrawerOpen, (val) => {
  if (!val && !isSelectionMode.value) {
    selectionStore.clearSelection();
  }
});

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
  const index = current.findIndex((e) => e.path === entry.path);

  if (index === -1) {
    selectionStore.selectFsEntries([...current, entry]);
  } else {
    const next = current.filter((e) => e.path !== entry.path);
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
    isCreateMenuOpen.value = false;
  }
}

async function triggerFileUpload(targetPath?: string) {
  pendingUploadPath.value = targetPath;
  fileInput.value?.click();
}

const pendingUploadPath = ref<string | undefined>(undefined);

function onFileSelect(e: Event) {
  const target = e.target as HTMLInputElement;
  if (target.files) {
    const files = Array.from(target.files);
    target.value = '';
    const targetPath = pendingUploadPath.value ?? filesPageStore.selectedFolder?.path ?? '';
    handleFiles(files, targetPath).then(() => {
      loadFolderContent();
      isCreateMenuOpen.value = false;
    });
  }
}
async function onCreateTimeline(targetPath?: string) {
  const path = await createTimeline(targetPath);
  if (path) {
    await loadFolderContent();
    isCreateMenuOpen.value = false;
    
    // Автоматически открываем созданный таймлайн и переключаемся в режим редактирования
    await projectStore.openTimelineFile(path);
    projectStore.setView('cut');

    toast.add({
      title: t('common.success', 'Success'),
      description: t('timelineCreation.successTitle', 'Timeline created'),
      color: 'success',
    });
  }
}

async function onCreateTextFile(targetPath?: string) {
  const path = await createMarkdown(targetPath);
  if (path) {
    await loadFolderContent();
    isCreateMenuOpen.value = false;
    toast.add({
      title: t('common.success', 'Success'),
      description: t('common.saveSuccess', 'Saved successfully'),
      color: 'success',
    });
  }
}

const menuItems = computed(() => [
  [
    {
      label: isSelectionMode.value
        ? t('common.cancelSelection', 'Cancel Selection')
        : t('common.selectItems', 'Select Items'),
      icon: isSelectionMode.value ? 'lucide:x-circle' : 'lucide:check-square',
      onSelect: toggleSelectionMode,
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
  ],
  [
    {
      label: uiStore.showHiddenFiles
        ? t('common.hideHiddenFiles', 'Hide Hidden Files')
        : t('common.showHiddenFiles', 'Show Hidden Files'),
      icon: uiStore.showHiddenFiles ? 'lucide:eye-off' : 'lucide:eye',
      onSelect: () => {
        uiStore.showHiddenFiles = !uiStore.showHiddenFiles;
      },
    },
  ],
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
    const filteredContent = content.filter(
      (e) => uiStore.showHiddenFiles || !e.name.startsWith('.'),
    );

    // Добавляем objectUrl для картинок
    entries.value = await Promise.all(
      filteredContent.map(async (entry) => {
        if (entry.kind === 'file') {
          const ext = entry.name.split('.').pop()?.toLowerCase();
          if (ext && SUPPORTED_IMAGE_EXTS.includes(ext)) {
            try {
              const file = await vfs.getFile(entry.path);
              if (file) {
                return {
                  ...entry,
                  size: file.size,
                  objectUrl: URL.createObjectURL(file),
                };
              }
            } catch (e) {
              console.warn('Failed to get file for preview:', entry.path, e);
            }
          }
        }
        return entry as ExtendedFsEntry;
      }),
    );
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
    return selected.entries.some((e) => e.path === entry.path);
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

// Следим за изменением настройки скрытых файлов
watch(
  () => uiStore.showHiddenFiles,
  () => {
    void loadFolderContent();
  },
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
        <div
          v-else
          class="flex items-center gap-1 text-xs text-slate-400 overflow-x-auto no-scrollbar"
        >
          <button
            class="shrink-0 transition-colors py-1 px-1.5 -ml-1 rounded-md hover:bg-slate-800 hover:text-slate-100"
            @click="navigateToRoot"
          >
            /
          </button>
          <template v-for="bc in breadcrumbs" :key="bc.path">
            <Icon name="lucide:chevron-right" class="w-2.5 h-2.5 opacity-30 shrink-0" />
            <button
              class="shrink-0 transition-colors py-1 px-1.5 rounded-md hover:bg-slate-800 hover:text-slate-100 last:text-slate-100 last:font-medium"
              @click="filesPageStore.selectFolder({ kind: 'directory', name: bc.name, path: bc.path })"
            >
              {{ bc.name }}
            </button>
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
          <UButton icon="lucide:more-vertical" variant="ghost" color="neutral" size="sm" />
        </UDropdownMenu>
      </div>
    </div>

    <!-- Сетка файлов -->
    <div class="flex-1 overflow-y-auto min-h-0">
      <MobileFileBrowserGrid
        :entries="entries"
        :thumbnails="thumbnails"
        :is-loading="isLoading"
        :is-selection-mode="isSelectionMode"
        :selected-entries="selectedEntries"
        :selected-entry-path="
          (selectionStore.selectedEntity?.source === 'fileManager' &&
          'path' in selectionStore.selectedEntity
            ? selectionStore.selectedEntity.path
            : null) ?? null
        "
        @entry-click="handleEntryClick"
        @entry-primary-action="handleEntryPrimaryAction"
        @long-press="handleLongPress"
        @toggle-selection="handleToggleSelection"
      />
    </div>


    <!-- Properties Drawer / Action Bar -->
    <MobileFileBrowserDrawer 
      :is-open="isDrawerOpen" 
      :is-selection-mode="isSelectionMode"
      @close="isDrawerOpen = false" 
      :on-action="handleDrawerAction"
      @add-to-timeline="handleAddToProject"
    />

    <!-- Paste Mode Toolbar -->
    <div
      v-if="!isSelectionMode && clipboardStore.hasFileManagerPayload"
      class="border-t border-slate-800 bg-slate-900 p-3 flex items-center justify-between z-40"
    >
      <div class="text-sm font-medium">
        {{ clipboardStore.clipboardPayload?.operation === 'cut' ? t('common.cut', 'Cut') : t('common.copied', 'Copied') }}: {{ clipboardStore.clipboardPayload?.items.length }} 
      </div>
      <div class="flex gap-2">
        <UButton
          size="sm"
          color="neutral"
          variant="soft"
          :label="t('common.cancel', 'Cancel')"
          @click="clipboardStore.clearClipboardPayload()"
        />
        <UButton
          size="sm"
          color="primary"
          :label="t('common.paste', 'Paste')"
          @click="onFileAction('paste', filesPageStore.selectedFolder!)"
        />
      </div>
    </div>

    <!-- Action FAB -->
    <Teleport to="body">
      <div
        v-if="!isSelectionMode && !isDrawerOpen && !isCreateMenuOpen"
        class="fixed bottom-20 right-6 z-40 transition-all duration-300"
        :class="[isCreateMenuOpen ? 'rotate-45 scale-90' : 'rotate-0 scale-100']"
      >
        <UButton
          icon="lucide:plus"
          size="xl"
          class="rounded-full shadow-2xl w-14 h-14 flex items-center justify-center bg-ui-action hover:bg-ui-action-hover text-white border-none shadow-ui-action/20"
          :ui="{ icon: 'w-7 h-7' }"
          @click="isCreateMenuOpen = !isCreateMenuOpen"
        />
      </div>
    </Teleport>

    <!-- Create Menu Sheet -->
    <UDrawer v-model:open="isCreateMenuOpen" :title="t('common.create', 'Create')">
      <template #content>
        <div class="flex flex-col gap-6 px-4 pt-2 pb-10">
          <!-- Block 1: Create in selected folder -->
          <div class="flex flex-col gap-3">
            <div class="flex items-center gap-2 px-1 opacity-60">
              <Icon name="lucide:folder" class="w-4 h-4" />
              <span class="text-xs font-semibold uppercase tracking-wider truncate">
                {{ t('common.createInFolder') }}: {{ filesPageStore.selectedFolder?.name || '/' }}
              </span>
            </div>
            
            <div class="flex flex-col gap-1 bg-slate-800/30 rounded-2xl overflow-hidden border border-slate-800/50 p-1">
              <button 
                class="flex items-center gap-4 w-full p-3.5 rounded-xl hover:bg-slate-700/40 transition-colors group text-left"
                @click="() => triggerFileUpload()"
              >
                <div class="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center group-active:scale-95 transition-transform">
                  <Icon name="lucide:upload-cloud" class="w-5 h-5 text-indigo-400" />
                </div>
                <span class="text-sm font-medium text-slate-200">{{ t('videoEditor.fileManager.actions.uploadFiles', 'Upload Files') }}</span>
                <Icon name="lucide:chevron-right" class="w-4 h-4 ml-auto opacity-20" />
              </button>

              <button 
                class="flex items-center gap-4 w-full p-3.5 rounded-xl hover:bg-slate-700/40 transition-colors group text-left"
                @click="onCreateFolder"
              >
                <div class="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center group-active:scale-95 transition-transform">
                  <Icon name="lucide:folder-plus" class="w-5 h-5 text-emerald-400" />
                </div>
                <span class="text-sm font-medium text-slate-200">{{ t('videoEditor.fileManager.actions.createFolder', 'Create Folder') }}</span>
                <Icon name="lucide:chevron-right" class="w-4 h-4 ml-auto opacity-20" />
              </button>

              <button 
                class="flex items-center gap-4 w-full p-3.5 rounded-xl hover:bg-slate-700/40 transition-colors group text-left"
                @click="() => onCreateTextFile(filesPageStore.selectedFolder?.path)"
              >
                <div class="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center group-active:scale-95 transition-transform">
                  <Icon name="lucide:file-text" class="w-5 h-5 text-blue-400" />
                </div>
                <span class="text-sm font-medium text-slate-200">{{ t('common.textDocument', 'Text Document') }}</span>
                <Icon name="lucide:chevron-right" class="w-4 h-4 ml-auto opacity-20" />
              </button>

              <button 
                class="flex items-center gap-4 w-full p-3.5 rounded-xl hover:bg-slate-700/40 transition-colors group text-left"
                @click="() => onCreateTimeline(filesPageStore.selectedFolder?.path)"
              >
                <div class="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center group-active:scale-95 transition-transform">
                  <Icon name="lucide:film" class="w-5 h-5 text-orange-400" />
                </div>
                <span class="text-sm font-medium text-slate-200">{{ t('common.timeline', 'Timeline') }}</span>
                <Icon name="lucide:chevron-right" class="w-4 h-4 ml-auto opacity-20" />
              </button>
            </div>
          </div>

          <!-- Block 2: Global Actions (Default folders) -->
          <div class="flex flex-col gap-4 pt-2">
              <div class="flex items-center gap-2 px-1 opacity-60">
              <Icon name="lucide:layers" class="w-4 h-4" />
              <span class="text-xs font-semibold uppercase tracking-wider">{{ t('common.quickCreateDefault') }}</span>
            </div>

              <div class="grid grid-cols-2 gap-3">
              <button 
                class="col-span-2 flex items-center justify-center gap-4 p-4 rounded-2xl bg-primary-600/10 border border-primary-500/20 hover:bg-primary-600/20 active:scale-[0.98] transition-all group"
                @click="() => triggerFileUpload('')"
              >
                  <Icon name="lucide:upload" class="w-6 h-6 text-primary-400" />
                  <div class="flex flex-col items-start">
                    <span class="font-bold text-primary-100 text-base leading-tight">{{ t('videoEditor.fileManager.actions.uploadFiles', 'Upload Files') }}</span>
                    <span class="text-[10px] text-primary-400/80 font-medium tracking-tight uppercase">{{ t('common.autoRecognition', 'Auto recognition') }}</span>
                  </div>
              </button>

              <button 
                class="flex flex-col items-center gap-1.5 p-5 rounded-2xl bg-slate-800/40 border border-slate-700/50 hover:bg-slate-700 active:scale-95 transition-all text-center group"
                @click="() => onCreateTimeline()"
              >
                  <div class="w-12 h-12 rounded-xl bg-orange-500/10 flex items-center justify-center mb-0.5 transition-transform group-active:scale-90">
                  <Icon name="lucide:film" class="w-6 h-6 text-orange-500" />
                </div>
                <span class="text-xs font-bold text-slate-200 uppercase tracking-tight">{{ t('common.timeline', 'Timeline') }}</span>
                <span class="text-[10px] text-orange-400/60 font-medium leading-none">{{ t('common.inDirTimelines') }}</span>
              </button>

              <button 
                class="flex flex-col items-center gap-1.5 p-5 rounded-2xl bg-slate-800/40 border border-slate-700/50 hover:bg-slate-700 active:scale-95 transition-all text-center group"
                @click="() => onCreateTextFile()"
              >
                  <div class="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center mb-0.5 transition-transform group-active:scale-90">
                  <Icon name="lucide:file-text" class="w-6 h-6 text-blue-500" />
                </div>
                <span class="text-xs font-bold text-slate-200 uppercase tracking-tight text-nowrap whitespace-nowrap overflow-hidden text-ellipsis w-full px-1">{{ t('common.textDocument', 'Text Doc') }}</span>
                <span class="text-[10px] text-blue-400/60 font-medium leading-none">{{ t('common.inDirDocuments') }}</span>
              </button>
              </div>
          </div>
        </div>
      </template>
    </UDrawer>

    <!-- Delete Confirmation Modal -->
    <UiConfirmModal
      :open="isDeleteConfirmModalOpen"
      :title="t('common.delete', 'Delete')"
      :description="t('common.confirmDelete', 'Are you sure you want to delete this? This action cannot be undone.')"
      color="error"
      icon="i-heroicons-exclamation-triangle"
      @update:open="isDeleteConfirmModalOpen = $event"
      @confirm="handleDeleteConfirm"
    >
      <div>
        <div v-if="deleteTargets.length === 1" class="mt-2 text-sm font-medium text-ui-text">
          {{ deleteTargets[0]?.name }}
        </div>
        <div v-else-if="deleteTargets.length > 1" class="mt-2 text-sm font-medium text-ui-text">
          {{ deleteTargets.length }} {{ t('common.itemsSelected', 'items selected') }}
        </div>
      </div>
    </UiConfirmModal>
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
