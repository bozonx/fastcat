<script setup lang="ts">
import { ref, onMounted, computed, watch, onBeforeUnmount } from 'vue';
import { useFilesPageStore, type FileSortField } from '~/stores/files-page.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import { useProjectStore } from '~/stores/project.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useUiStore } from '~/stores/ui.store';
import { useProxyStore } from '~/stores/proxy.store';
import { formatBytes } from '~/utils/format';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { useFileManagerThumbnails } from '~/composables/fileManager/useFileManagerThumbnails';
import { useAddMediaToTimeline } from '~/composables/timeline/useAddMediaToTimeline';
import { useFileSorting } from '~/composables/fileManager/useFileSorting';
import MobileFileBrowserGrid from './MobileFileBrowserGrid.vue';
import MobileFileBrowserDrawer from './MobileFileBrowserDrawer.vue';
import MobileAddToTimelineModal from '../timeline/MobileAddToTimelineModal.vue';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import { useClipboardStore } from '~/stores/clipboard.store';
import { isOpenableProjectFileName } from '~/utils/media-types';
import {
  useFileManagerActions,
  type FileAction,
} from '~/composables/fileManager/useFileManagerActions';
import type { FsEntry } from '~/types/fs';
import {
  getWorkspacePathParent,
  WORKSPACE_COMMON_DIR_NAME,
  WORKSPACE_COMMON_PATH_PREFIX,
} from '~/utils/workspace-common';
import { computeDirectoryStats } from '~/utils/fs';

const filesPageStore = useFilesPageStore();
const projectStore = useProjectStore();
const selectionStore = useSelectionStore();
const uiStore = useUiStore();
const proxyStore = useProxyStore();
const { addMediaToTimeline } = useAddMediaToTimeline();
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

const { onFileAction, isDeleteConfirmModalOpen, deleteTargets, handleDeleteConfirm } =
  useFileManagerActions({
    createFolder,
    renameEntry,
    deleteEntry,
    loadProjectDirectory: async () => {
      await loadFolderContent();
    },
    handleFiles,
    mediaCache,
    vfs,
    findEntryByPath,
    readDirectory,
    reloadDirectory,
    copyEntry,
    moveEntry,
  });

const canAddSelectionToTimeline = computed(() => {
  return (
    isSelectionMode.value &&
    selectedEntries.value.some((e) => e.kind === 'file' && isOpenableProjectFileName(e.name))
  );
});

const isAddToTimelineModalOpen = ref(false);
const addToTimelineEntries = ref<FsEntry[]>([]);

async function handleAddSelectionToTimeline() {
  const supportedEntries = selectedEntries.value.filter(
    (e) => e.kind === 'file' && isOpenableProjectFileName(e.name),
  );
  if (supportedEntries.length === 0) return;

  addToTimelineEntries.value = supportedEntries;
  isAddToTimelineModalOpen.value = true;
}

function onAddedToTimeline() {
  toast.add({
    title: t('common.success', 'Success'),
    description: t('common.addedToTimeline', 'Added to timeline'),
    color: 'success',
  });
  isSelectionMode.value = false;
  selectionStore.clearSelection();
  isDrawerOpen.value = false;
}

async function handlePaste() {
  const target = filesPageStore.selectedFolder;
  if (!target) return;
  await onFileAction('paste', target);
  await loadFolderContent();
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

const folderSizes = ref<Record<string, number>>({});

async function handleDrawerAction(action: FileAction, entry: any) {
  if (['copy', 'cut'].includes(action)) {
    isSelectionMode.value = false;
    selectionStore.clearSelection();
    isDrawerOpen.value = false;
  }

  if (action === 'rename') {
    await handleRename(entry);
    isSelectionMode.value = false;
    selectionStore.clearSelection();
    isDrawerOpen.value = false;
    return;
  }

  await onFileAction(action, entry);
}

async function wrappedHandleDeleteConfirm() {
  await handleDeleteConfirm();
  isSelectionMode.value = false;
  selectionStore.clearSelection();
  isDrawerOpen.value = false;
}

async function handleRename(entry: FsEntry) {
  const newName = prompt(t('videoEditor.fileManager.actions.rename', 'Rename'), entry.name);
  if (newName && newName !== entry.name) {
    try {
      await renameEntry(entry, newName);
      await loadFolderContent();
      toast.add({
        title: t('common.success', 'Success'),
        description: t('common.saveSuccess', 'Saved successfully'),
        color: 'success',
      });
    } catch (err: any) {
      toast.add({
        title: t('common.error', 'Error'),
        description: String(err?.message || err),
        color: 'error',
      });
    }
  }
}

async function calculateFolderSize(path: string) {
  if (folderSizes.value[path] !== undefined) return;

  try {
    const handle = await projectStore.getDirectoryHandleByPath(path);
    if (!handle) return;
    const stats = await computeDirectoryStats(handle);
    if (stats) {
      folderSizes.value[path] = stats.size;
    }
  } catch (err) {
    console.warn('Failed to calculate folder size:', path, err);
  }
}

const totalSelectedSize = computed(() => {
  let size = 0;
  for (const entry of selectedEntries.value) {
    if (entry.kind === 'file') {
      size += entry.size ?? 0;
    } else if (entry.kind === 'directory' && entry.path) {
      size += folderSizes.value[entry.path] ?? 0;
    }
  }
  return size;
});

// Следим за выделенными папками для подсчета размера
watch(
  selectedEntries,
  (entries) => {
    for (const entry of entries) {
      if (entry.kind === 'directory' && entry.path && folderSizes.value[entry.path] === undefined) {
        void calculateFolderSize(entry.path);
      }
    }
  },
  { deep: true },
);

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
    isDrawerOpen.value = false;
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
    // Если это таймлайн, открываем его сразу в режиме монтажа
    if (getMediaTypeFromFilename(entry.name) === 'timeline' && entry.path) {
      projectStore.openTimelineFile(entry.path);
      projectStore.setView('cut');
      return;
    }

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

const sortFields: { label: string; value: FileSortField }[] = [
  { label: t('common.name', 'Name'), value: 'name' },
  { label: t('common.type', 'Type'), value: 'type' },
  { label: t('common.size', 'Size'), value: 'size' },
  { label: t('common.created', 'Created'), value: 'created' },
  { label: t('common.modified', 'Modified'), value: 'modified' },
];

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
    ...sortFields.map((f) => ({
      label: f.label,
      icon: filesPageStore.sortOption.field === f.value ? 'lucide:check' : undefined,
      onSelect: () => {
        filesPageStore.sortOption.field = f.value;
      },
    })),
  ],
  [
    {
      label:
        filesPageStore.sortOption.order === 'asc'
          ? t('common.sortOrder.asc', 'Ascending')
          : t('common.sortOrder.desc', 'Descending'),
      icon: filesPageStore.sortOption.order === 'asc' ? 'lucide:sort-asc' : 'lucide:sort-desc',
      onSelect: () => {
        filesPageStore.sortOption.order =
          filesPageStore.sortOption.order === 'asc' ? 'desc' : 'asc';
      },
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

const entries = ref<FsEntry[]>([]);
const isLoading = ref(false);

const { sortedEntries } = useFileSorting(entries);

const { thumbnails } = useFileManagerThumbnails(sortedEntries, vfs);

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

    // Фильтруем скрытые файлы если настройка выключена и дополняем метаданными
    const filteredContent = content.filter(
      (e) => uiStore.showHiddenFiles || !e.name.startsWith('.'),
    );

    // Наполняем записи базовыми метаданными
    entries.value = await Promise.all(
      filteredContent.map(async (entry) => {
        if (entry.kind === 'file') {
          try {
            const metadata = await vfs.getMetadata(entry.path);
            if (metadata && metadata.kind === 'file') {
              return {
                ...entry,
                size: metadata.size,
                lastModified: metadata.lastModified,
              };
            }
          } catch (e) {
            console.warn('Failed to get metadata for:', entry.path, e);
          }
        }
        return entry;
      }),
    );
  } catch (error) {
    console.error('Failed to load mobile folder content:', error);
  } finally {
    isLoading.value = false;
  }
}

// Следим за всеми записями для ленивого подсчета размера папок
watch(
  entries,
  (newEntries) => {
    for (const entry of newEntries) {
      if (entry.kind === 'directory' && entry.path && folderSizes.value[entry.path] === undefined) {
        void calculateFolderSize(entry.path);
      }
    }
  },
  { deep: true },
);

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

  addToTimelineEntries.value = [entity.entry];
  isAddToTimelineModalOpen.value = true;
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
        <div v-if="isSelectionMode" class="font-medium text-sm px-2 truncate">
          {{ selectedEntries.length }} {{ t('common.selected', 'Selected') }}
          <span v-if="totalSelectedSize > 0" class="ml-1 text-slate-400 font-normal">
            ({{ formatBytes(totalSelectedSize) }})
          </span>
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
              @click="
                filesPageStore.selectFolder({ kind: 'directory', name: bc.name, path: bc.path })
              "
            >
              {{ bc.name }}
            </button>
          </template>
        </div>
      </div>
      <div class="shrink-0 flex items-center ml-2">
        <UDropdownMenu
          v-if="!isSelectionMode"
          :items="menuItems"
          :ui="{ content: 'w-56 min-w-max' }"
        >
          <UButton icon="lucide:more-vertical" variant="ghost" color="neutral" size="sm" />
        </UDropdownMenu>
      </div>
    </div>

    <!-- Сетка файлов -->
    <div class="flex-1 overflow-y-auto min-h-0">
      <MobileFileBrowserGrid
        :entries="sortedEntries"
        :thumbnails="thumbnails"
        :selected-entry-path="
          (selectionStore.selectedEntity?.source === 'fileManager' &&
          'path' in selectionStore.selectedEntity
            ? (selectionStore.selectedEntity.path as string | null)
            : null) ?? null
        "
        :selected-entries="selectedEntries"
        :is-selection-mode="isSelectionMode"
        :is-loading="isLoading"
        :folder-sizes="folderSizes"
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

    <!-- Selection Mode Toolbar -->
    <div
      v-if="isSelectionMode"
      class="border-t border-slate-800 bg-slate-900 px-4 py-4 flex flex-col gap-4 z-40 shrink-0"
    >
      <!-- Selection Tool Buttons -->

      <!-- Add to Timeline Button -->
      <div v-if="canAddSelectionToTimeline" class="flex justify-center px-2">
        <UButton
          size="xl"
          variant="solid"
          icon="lucide:plus"
          class="w-full rounded-2xl shadow-xl font-bold active:scale-95 transition-all text-white border-none bg-ui-action hover:bg-ui-action-hover shadow-ui-action/20"
          @click="handleAddSelectionToTimeline"
        >
          {{ t('common.addToTimeline', 'Add to timeline') }}
        </UButton>
      </div>

      <div class="flex items-center justify-around">
        <div class="flex flex-col items-center gap-1">
          <UButton
            icon="lucide:trash-2"
            size="xl"
            variant="soft"
            color="red"
            class="rounded-2xl w-14 h-14"
            @click="handleDrawerAction('delete', selectedEntries)"
          />
          <span class="text-xs font-medium text-red-400">{{ t('common.delete', 'Delete') }}</span>
        </div>

        <div v-if="selectedEntries.length === 1" class="flex flex-col items-center gap-1">
          <UButton
            icon="lucide:pen-line"
            size="xl"
            variant="soft"
            color="neutral"
            class="rounded-2xl w-14 h-14"
            @click="handleDrawerAction('rename', selectedEntries[0])"
          />
          <span class="text-xs font-medium text-slate-400">{{ t('common.rename', 'Rename') }}</span>
        </div>

        <div class="flex flex-col items-center gap-1">
          <UButton
            icon="lucide:copy"
            size="xl"
            variant="soft"
            color="neutral"
            class="rounded-2xl w-14 h-14"
            @click="handleDrawerAction('copy', selectedEntries)"
          />
          <span class="text-xs font-medium text-slate-400">{{ t('common.copy', 'Copy') }}</span>
        </div>

        <div class="flex flex-col items-center gap-1">
          <UButton
            icon="lucide:scissors"
            size="xl"
            variant="soft"
            color="neutral"
            class="rounded-2xl w-14 h-14"
            @click="handleDrawerAction('cut', selectedEntries)"
          />
          <span class="text-xs font-medium text-slate-400">{{ t('common.cut', 'Cut') }}</span>
        </div>
      </div>
    </div>

    <!-- Paste Mode Toolbar -->
    <div
      v-if="!isSelectionMode && clipboardStore.hasFileManagerPayload"
      class="border-t border-slate-800 bg-slate-900 p-3 flex items-center justify-between z-40"
    >
      <div class="text-sm font-medium">
        {{
          clipboardStore.clipboardPayload?.operation === 'cut'
            ? t('common.cut', 'Cut')
            : t('common.copied', 'Copied')
        }}: {{ clipboardStore.clipboardPayload?.items.length }}
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
          @click="handlePaste"
        />
      </div>
    </div>

    <!-- Action FAB -->
    <Teleport to="body">
      <div
        v-if="
          !isSelectionMode &&
          !isDrawerOpen &&
          !isCreateMenuOpen &&
          !clipboardStore.hasFileManagerPayload
        "
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

            <div
              class="flex flex-col gap-1 bg-slate-800/30 rounded-2xl overflow-hidden border border-slate-800/50 p-1"
            >
              <button
                class="flex items-center gap-4 w-full p-3.5 rounded-xl hover:bg-slate-700/40 transition-colors group text-left"
                @click="() => triggerFileUpload()"
              >
                <div
                  class="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center group-active:scale-95 transition-transform"
                >
                  <Icon name="lucide:upload-cloud" class="w-5 h-5 text-indigo-400" />
                </div>
                <span class="text-sm font-medium text-slate-200">{{
                  t('videoEditor.fileManager.actions.uploadFiles', 'Upload Files')
                }}</span>
                <Icon name="lucide:chevron-right" class="w-4 h-4 ml-auto opacity-20" />
              </button>

              <button
                class="flex items-center gap-4 w-full p-3.5 rounded-xl hover:bg-slate-700/40 transition-colors group text-left"
                @click="onCreateFolder"
              >
                <div
                  class="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center group-active:scale-95 transition-transform"
                >
                  <Icon name="lucide:folder-plus" class="w-5 h-5 text-emerald-400" />
                </div>
                <span class="text-sm font-medium text-slate-200">{{
                  t('videoEditor.fileManager.actions.createFolder', 'Create Folder')
                }}</span>
                <Icon name="lucide:chevron-right" class="w-4 h-4 ml-auto opacity-20" />
              </button>

              <button
                class="flex items-center gap-4 w-full p-3.5 rounded-xl hover:bg-slate-700/40 transition-colors group text-left"
                @click="() => onCreateTextFile(filesPageStore.selectedFolder?.path)"
              >
                <div
                  class="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center group-active:scale-95 transition-transform"
                >
                  <Icon name="lucide:file-text" class="w-5 h-5 text-blue-400" />
                </div>
                <span class="text-sm font-medium text-slate-200">{{
                  t('common.textDocument', 'Text Document')
                }}</span>
                <Icon name="lucide:chevron-right" class="w-4 h-4 ml-auto opacity-20" />
              </button>

              <button
                class="flex items-center gap-4 w-full p-3.5 rounded-xl hover:bg-slate-700/40 transition-colors group text-left"
                @click="() => onCreateTimeline(filesPageStore.selectedFolder?.path)"
              >
                <div
                  class="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center group-active:scale-95 transition-transform"
                >
                  <Icon name="lucide:film" class="w-5 h-5 text-orange-400" />
                </div>
                <span class="text-sm font-medium text-slate-200">{{
                  t('common.timeline', 'Timeline')
                }}</span>
                <Icon name="lucide:chevron-right" class="w-4 h-4 ml-auto opacity-20" />
              </button>
            </div>
          </div>

          <!-- Block 2: Global Actions (Default folders) -->
          <div class="flex flex-col gap-4 pt-2">
            <div class="flex items-center gap-2 px-1 opacity-60">
              <Icon name="lucide:layers" class="w-4 h-4" />
              <span class="text-xs font-semibold uppercase tracking-wider">{{
                t('common.quickCreateDefault')
              }}</span>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <button
                class="col-span-2 flex items-center justify-center gap-4 p-4 rounded-2xl bg-primary-600/10 border border-primary-500/20 hover:bg-primary-600/20 active:scale-[0.98] transition-all group"
                @click="() => triggerFileUpload('')"
              >
                <Icon name="lucide:upload" class="w-6 h-6 text-primary-400" />
                <div class="flex flex-col items-start">
                  <span class="font-bold text-primary-100 text-base leading-tight">{{
                    t('videoEditor.fileManager.actions.uploadFiles', 'Upload Files')
                  }}</span>
                  <span
                    class="text-[10px] text-primary-400/80 font-medium tracking-tight uppercase"
                    >{{ t('common.autoRecognition', 'Auto recognition') }}</span
                  >
                </div>
              </button>

              <button
                class="flex flex-col items-center gap-1.5 p-5 rounded-2xl bg-slate-800/40 border border-slate-700/50 hover:bg-slate-700 active:scale-95 transition-all text-center group"
                @click="() => onCreateTimeline()"
              >
                <div
                  class="w-12 h-12 rounded-xl bg-orange-500/10 flex items-center justify-center mb-0.5 transition-transform group-active:scale-90"
                >
                  <Icon name="lucide:film" class="w-6 h-6 text-orange-500" />
                </div>
                <span class="text-xs font-bold text-slate-200 uppercase tracking-tight">{{
                  t('common.timeline', 'Timeline')
                }}</span>
                <span class="text-[10px] text-orange-400/60 font-medium leading-none">{{
                  t('common.inDirTimelines')
                }}</span>
              </button>

              <button
                class="flex flex-col items-center gap-1.5 p-5 rounded-2xl bg-slate-800/40 border border-slate-700/50 hover:bg-slate-700 active:scale-95 transition-all text-center group"
                @click="() => onCreateTextFile()"
              >
                <div
                  class="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center mb-0.5 transition-transform group-active:scale-90"
                >
                  <Icon name="lucide:file-text" class="w-6 h-6 text-blue-500" />
                </div>
                <span
                  class="text-xs font-bold text-slate-200 uppercase tracking-tight text-nowrap whitespace-nowrap overflow-hidden text-ellipsis w-full px-1"
                  >{{ t('common.textDocument', 'Text Doc') }}</span
                >
                <span class="text-[10px] text-blue-400/60 font-medium leading-none">{{
                  t('common.inDirDocuments')
                }}</span>
              </button>
            </div>
          </div>
        </div>
      </template>
    </UDrawer>

    <!-- Delete Confirmation Modal -->
    <UiConfirmModal
      v-model:open="isDeleteConfirmModalOpen"
      :title="t('videoEditor.fileManager.delete.confirmTitle', 'Delete Files')"
      :description="
        t('videoEditor.fileManager.delete.confirmDescription', 'Are you sure you want to delete?')
      "
      :color="'error'"
      @confirm="wrappedHandleDeleteConfirm"
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

    <!-- Add to Timeline Modal (Global) -->
    <MobileAddToTimelineModal
      v-model:open="isAddToTimelineModalOpen"
      :entries="addToTimelineEntries"
      @added="onAddedToTimeline"
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
