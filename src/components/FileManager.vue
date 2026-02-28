<script setup lang="ts">
import { ref, watch } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useMediaStore } from '~/stores/media.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import type { FsEntry } from '~/types/fs';
import CreateFolderModal from '~/components/common/CreateFolderModal.vue';
import FileInfoModal, { type FileInfo } from '~/components/common/FileInfoModal.vue';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import RenameModal from '~/components/common/RenameModal.vue';
import FileManagerFiles from '~/components/file-manager/FileManagerFiles.vue';
import FileManagerEffects from '~/components/file-manager/FileManagerEffects.vue';
import FileManagerHistory from '~/components/file-manager/FileManagerHistory.vue';
import { useProxyStore } from '~/stores/proxy.store';
import { useFocusStore } from '~/stores/focus.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { isEditableTarget } from '~/utils/hotkeys/hotkeyUtils';

const { t } = useI18n();
const projectStore = useProjectStore();
const mediaStore = useMediaStore();
const timelineStore = useTimelineStore();
const focusStore = useFocusStore();
const timelineMediaUsageStore = useTimelineMediaUsageStore();

const fileManager = useFileManager();
const {
  rootEntries,
  isLoading,
  error,
  isApiSupported,
  getProjectRootDirHandle,
  loadProjectDirectory,
  toggleDirectory,
  handleFiles,
  createFolder,
  deleteEntry,
  renameEntry,
  findEntryByPath,
  moveEntry,
  createTimeline,
  getFileIcon,
  sortMode,
  setSortMode,
} = fileManager;

const activeTab = ref('files');
const isDragging = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

// Modals state
const isCreateFolderModalOpen = ref(false);
const folderCreationTarget = ref<FileSystemDirectoryHandle | null>(null);

const isRenameModalOpen = ref(false);
const renameTarget = ref<FsEntry | null>(null);

const isFileInfoModalOpen = ref(false);
const currentFileInfo = ref<FileInfo | null>(null);

const isDeleteConfirmModalOpen = ref(false);
const deleteTarget = ref<FsEntry | null>(null);

const directoryUploadTarget = ref<FsEntry | null>(null);
const directoryUploadInput = ref<HTMLInputElement | null>(null);

const uiStore = useUiStore();
const selectionStore = useSelectionStore();

const timelinesUsingDeleteTarget = computed(() => {
  const entry = deleteTarget.value;
  if (!entry || entry.kind !== 'file' || !entry.path) return [];
  return timelineMediaUsageStore.mediaPathToTimelines[entry.path] ?? [];
});

const toast = useToast();

interface FsDirectoryHandleWithIteration extends FileSystemDirectoryHandle {
  values?: () => AsyncIterable<FileSystemHandle>;
  entries?: () => AsyncIterable<[string, FileSystemHandle]>;
}

async function computeDirectorySize(
  dirHandle: FileSystemDirectoryHandle,
  options?: { maxEntries?: number },
): Promise<number | undefined> {
  const maxEntries = options?.maxEntries ?? 25_000;
  let seen = 0;

  async function walk(handle: FileSystemDirectoryHandle): Promise<number> {
    const iterator = (handle as FsDirectoryHandleWithIteration).values?.() ??
      (handle as FsDirectoryHandleWithIteration).entries?.();
    if (!iterator) return 0;

    let total = 0;
    for await (const value of iterator) {
      if (seen >= maxEntries) {
        throw new Error('Directory too large');
      }
      seen += 1;

      const entryHandle = (Array.isArray(value) ? value[1] : value) as
        | FileSystemFileHandle
        | FileSystemDirectoryHandle;

      if (entryHandle.kind === 'file') {
        try {
          const file = await (entryHandle as FileSystemFileHandle).getFile();
          total += file.size;
        } catch {
          // ignore
        }
      } else {
        total += await walk(entryHandle as FileSystemDirectoryHandle);
      }
    }
    return total;
  }

  try {
    return await walk(dirHandle);
  } catch {
    return undefined;
  }
}

watch(() => uiStore.pendingFsEntryDelete, (entry) => {
  if (entry) {
    openDeleteConfirmModal(entry);
    uiStore.pendingFsEntryDelete = null;
  }
});

watch(
  () => projectStore.currentProjectName,
  async (name) => {
    if (name) {
      uiStore.restoreFileTreeStateOnce(name);
    }
    await loadProjectDirectory();
  },
  { immediate: true },
);

function onDragOver(e: DragEvent) {
  if (e.dataTransfer?.types.includes('Files')) {
    isDragging.value = true;
    uiStore.isFileManagerDragging = true;
  }
}

function onDragLeave(e: DragEvent) {
  const currentTarget = e.currentTarget as HTMLElement | null;
  const relatedTarget = e.relatedTarget as Node | null;
  if (!currentTarget?.contains(relatedTarget)) {
    isDragging.value = false;
    uiStore.isFileManagerDragging = false;
  }
}

function onDrop(e: DragEvent) {
  isDragging.value = false;
  uiStore.isFileManagerDragging = false;
  uiStore.isGlobalDragging = false;
  
  if (e.dataTransfer?.files) {
    handleFiles(e.dataTransfer.files);
  }
}

function openCreateFolderModal(targetEntry: FsEntry | null = null) {
  folderCreationTarget.value =
    targetEntry?.kind === 'directory' ? (targetEntry.handle as FileSystemDirectoryHandle) : null;
  isCreateFolderModalOpen.value = true;
}

async function handleCreateFolder(name: string) {
  await createFolder(name, folderCreationTarget.value);
}

async function onCreateTimeline() {
  const createdPath = await createTimeline();
  if (!createdPath) return;

  await projectStore.openTimelineFile(createdPath);
  await timelineStore.loadTimeline();
  void timelineStore.loadTimelineMetadata();
}

async function openFileInfoModal(entry: FsEntry) {
  let size: number | undefined;
  let lastModified: number | undefined;
  let fileType: string | undefined;

  if (entry.kind === 'file') {
    try {
      const file = await (entry.handle as FileSystemFileHandle).getFile();
      size = file.size;
      lastModified = file.lastModified;
      fileType = file.type;
    } catch (e) {
      toast.add({
        color: 'red',
        title: t('videoEditor.fileManager.info.error', 'Information error'),
        description: String((e as any)?.message ?? e),
      });
    }
  } else {
    try {
      size = await computeDirectorySize(entry.handle as FileSystemDirectoryHandle);
    } catch (e) {
      toast.add({
        color: 'red',
        title: t('videoEditor.fileManager.info.error', 'Information error'),
        description: String((e as any)?.message ?? e),
      });
    }
  }

  currentFileInfo.value = {
    name: entry.name,
    kind: entry.kind,
    size,
    lastModified,
    path: entry.path,
    metadata:
      entry.kind === 'file' &&
      entry.path &&
      typeof fileType === 'string' &&
      (fileType.startsWith('video/') || fileType.startsWith('audio/'))
        ? await mediaStore.getOrFetchMetadata(entry.handle as FileSystemFileHandle, entry.path, {
            forceRefresh: true,
          })
        : undefined,
  };
  isFileInfoModalOpen.value = true;
}

function openDeleteConfirmModal(entry: FsEntry) {
  deleteTarget.value = entry;
  isDeleteConfirmModalOpen.value = true;
}

async function handleDeleteConfirm() {
  if (!deleteTarget.value) return;
  const deletePath = deleteTarget.value.path;
  await deleteEntry(deleteTarget.value);

  if (deletePath && uiStore.selectedFsEntry?.path === deletePath) {
    uiStore.selectedFsEntry = null;
  }
  
  if (
    selectionStore.selectedEntity?.source === 'fileManager' &&
    (selectionStore.selectedEntity.path
      ? selectionStore.selectedEntity.path === deletePath
      : selectionStore.selectedEntity.name === deleteTarget.value.name)
  ) {
    selectionStore.clearSelection();
  }

  // Delay closing the modal for a tick to allow the click event loop to finish
  // This prevents Nuxt UI / Vue from crashing when trying to find nextSibling of the clicked button
  // during the modal's unmount phase
  setTimeout(() => {
    isDeleteConfirmModalOpen.value = false;
    
    // Wait for the modal transition to finish before clearing the reference
    setTimeout(() => {
      deleteTarget.value = null;
    }, 300);
  }, 0);
}

async function handleRename(newName: string) {
  if (!renameTarget.value) return;

  const trimmed = newName.trim();
  if (!trimmed) {
    toast.add({
      color: 'red',
      title: t('common.rename', 'Rename'),
      description: t('common.validation.required', 'Name is required.'),
    });
    return;
  }

  if (trimmed.includes('/')) {
    toast.add({
      color: 'red',
      title: t('common.rename', 'Rename'),
      description: t(
        'common.validation.invalidName',
        'Name contains invalid characters.',
      ),
    });
    return;
  }

  if (trimmed === '.' || trimmed === '..') {
    toast.add({
      color: 'red',
      title: t('common.rename', 'Rename'),
      description: t(
        'common.validation.invalidName',
        'Name contains invalid characters.',
      ),
    });
    return;
  }

  await renameEntry(renameTarget.value, trimmed);
  renameTarget.value = null;
}

function onFileAction(
  action:
    | 'createFolder'
    | 'rename'
    | 'info'
    | 'delete'
    | 'createProxy'
    | 'cancelProxy'
    | 'deleteProxy'
    | 'upload'
    | 'createProxyForFolder',
  entry: FsEntry,
) {
  if (action === 'createFolder') {
    openCreateFolderModal(entry);
  } else if (action === 'upload') {
    if (entry.kind !== 'directory') return;
    directoryUploadTarget.value = entry;
    directoryUploadInput.value?.click();
  } else if (action === 'rename') {
    renameTarget.value = entry;
    isRenameModalOpen.value = true;
  } else if (action === 'info') {
    openFileInfoModal(entry);
  } else if (action === 'delete') {
    openDeleteConfirmModal(entry);
  } else if (action === 'createProxy') {
    const proxyStore = useProxyStore();
    if (entry.kind === 'file' && entry.path) {
      void proxyStore.generateProxy(entry.handle as FileSystemFileHandle, entry.path);
    }
  } else if (action === 'cancelProxy') {
    const proxyStore = useProxyStore();
    if (entry.kind === 'file' && entry.path) {
      void proxyStore.cancelProxyGeneration(entry.path);
    }
  } else if (action === 'deleteProxy') {
    const proxyStore = useProxyStore();
    if (entry.kind === 'file' && entry.path) {
      void proxyStore.deleteProxy(entry.path);
    }
  } else if (action === 'createProxyForFolder') {
    const proxyStore = useProxyStore();
    if (entry.kind === 'directory' && entry.path !== undefined) {
      const dirPath = entry.path;
      const dirHandle = entry.handle as FileSystemDirectoryHandle;

      (async () => {
        const collect = async (dir: FileSystemDirectoryHandle, bPath: string) => {
          const iterator =
            (dir as FsDirectoryHandleWithIteration).values?.() ??
            (dir as FsDirectoryHandleWithIteration).entries?.();
          if (!iterator) return;

          for await (const value of iterator) {
            const handle = (Array.isArray(value) ? value[1] : value) as
              | FileSystemFileHandle
              | FileSystemDirectoryHandle;

            const fullPath = bPath ? `${bPath}/${handle.name}` : handle.name;

            if (handle.kind === 'file') {
              const ext = handle.name.split('.').pop()?.toLowerCase() ?? '';
              if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) {
                if (
                  !proxyStore.existingProxies.has(fullPath) &&
                  !proxyStore.generatingProxies.has(fullPath)
                ) {
                  void proxyStore.generateProxy(handle as FileSystemFileHandle, fullPath);
                }
              }
            } else if (handle.kind === 'directory') {
              await collect(handle as FileSystemDirectoryHandle, fullPath);
            }
          }
        };

        try {
          // If tree children are already loaded, we can skip existing/generating even faster
          // but walking handles is more accurate if the tree is not fully expanded.
          // We walk handles starting from the current directory
          await collect(dirHandle, dirPath);
        } catch (e) {
          console.error('Failed to walk folder for proxy creation', e);
        }
      })();
    }
  }
}

function triggerFileUpload() {
  fileInput.value?.click();
}

function onSortModeChange(v: 'name' | 'modified') {
  setSortMode(v);
  const selectedPath = uiStore.selectedFsEntry?.path;
  void loadProjectDirectory().then(() => {
    if (!selectedPath) return;
    if (uiStore.selectedFsEntry?.path !== selectedPath) return;
    focusStore.setTempFocus('left');
  });
}

function onFileSelect(e: Event) {
  const target = e.target as HTMLInputElement;
  if (target.files) {
    const files = Array.from(target.files);
    target.value = '';
    handleFiles(files);
  }
}

async function onDirectoryFileSelect(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = input.files ? Array.from(input.files) : [];
  input.value = '';

  const entry = directoryUploadTarget.value;
  directoryUploadTarget.value = null;
  if (!entry || entry.kind !== 'directory') return;
  if (!files || files.length === 0) return;

  await handleFiles(files, entry.handle as FileSystemDirectoryHandle, entry.path);
  await loadProjectDirectory();
}
</script>

<template>
  <div
    class="flex flex-col h-full bg-ui-bg-elevated border-r border-ui-border transition-colors duration-200 min-w-0 overflow-hidden relative"
    :class="{
      'bg-ui-bg-accent outline-2 outline-primary-500/50 -outline-offset-2 z-10': isDragging,
      'outline-2 outline-primary-500/60 -outline-offset-2 z-10': focusStore.isPanelFocused('left'),
    }"
    @pointerdown.capture="focusStore.setTempFocus('left')"
    @dragover.prevent="onDragOver"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
  >
    <!-- Hidden file input -->
    <input ref="fileInput" type="file" multiple class="hidden" @change="onFileSelect" />
    <input
      ref="directoryUploadInput"
      type="file"
      multiple
      class="hidden"
      @change="onDirectoryFileSelect"
    />

    <!-- Header / Tabs -->
    <div class="flex items-center gap-4 px-3 py-2 border-b border-ui-border shrink-0 select-none">
      <button
        class="text-xs font-semibold uppercase tracking-wider transition-colors outline-none"
        :class="
          activeTab === 'files' ? 'text-primary-400' : 'text-ui-text-muted hover:text-ui-text'
        "
        @click="activeTab = 'files'"
      >
        {{ t('videoEditor.fileManager.tabs.files', 'Files') }}
      </button>
      <button
        class="text-xs font-semibold uppercase tracking-wider transition-colors outline-none"
        :class="
          activeTab === 'effects' ? 'text-primary-400' : 'text-ui-text-muted hover:text-ui-text'
        "
        @click="activeTab = 'effects'"
      >
        {{ t('videoEditor.fileManager.tabs.effects', 'Effects') }}
      </button>
      <button
        class="text-xs font-semibold uppercase tracking-wider transition-colors outline-none"
        :class="
          activeTab === 'history' ? 'text-primary-400' : 'text-ui-text-muted hover:text-ui-text'
        "
        @click="activeTab = 'history'"
      >
        {{ t('videoEditor.fileManager.tabs.history', 'History') }}
      </button>
    </div>

    <!-- Actions Toolbar (only for Files tab) -->
    <div
      v-if="activeTab === 'files' && projectStore.currentProjectName"
      class="flex items-center gap-1 px-2 py-1 bg-ui-bg-accent/30 border-b border-ui-border/50"
    >
      <UButton
        icon="i-heroicons-folder-plus"
        variant="ghost"
        color="neutral"
        size="xs"
        :title="t('videoEditor.fileManager.actions.createFolder')"
        @click="openCreateFolderModal(null)"
      />
      <UButton
        icon="i-heroicons-document-plus"
        variant="ghost"
        color="neutral"
        size="xs"
        :title="t('videoEditor.fileManager.actions.createTimeline', 'Create Timeline')"
        @click="onCreateTimeline"
      />
      <UButton
        icon="i-heroicons-arrow-up-tray"
        variant="ghost"
        color="neutral"
        size="xs"
        :title="t('videoEditor.fileManager.actions.uploadFiles')"
        @click="triggerFileUpload"
      />
      <UButton
        :icon="uiStore.showHiddenFiles ? 'i-heroicons-eye' : 'i-heroicons-eye-slash'"
        variant="ghost"
        color="neutral"
        size="xs"
        :title="t('videoEditor.fileManager.actions.toggleHiddenFiles', 'Show/Hide hidden files')"
        @click="uiStore.showHiddenFiles = !uiStore.showHiddenFiles"
      />
      <UButton
        icon="i-heroicons-arrow-path"
        variant="ghost"
        color="neutral"
        size="xs"
        :title="t('videoEditor.fileManager.actions.syncTreeTooltip', 'Refresh file tree')"
        :disabled="isLoading || !projectStore.currentProjectName"
        @click="loadProjectDirectory"
      />

      <div class="ml-auto w-20">
        <USelectMenu
          :model-value="sortMode"
          :items="[
            { value: 'name', label: t('videoEditor.fileManager.sort.name', 'Name') },
            { value: 'modified', label: t('videoEditor.fileManager.sort.modified', 'Modified') },
          ]"
          value-key="value"
          label-key="label"
          size="xs"
          class="w-full"
          @update:model-value="(v: any) => onSortModeChange(v?.value ?? v)"
        />
      </div>
    </div>

    <!-- Content -->
    <FileManagerFiles
      v-if="activeTab === 'files'"
      :is-dragging="isDragging"
      :is-loading="isLoading"
      :is-api-supported="isApiSupported"
      :root-entries="rootEntries"
      :get-file-icon="getFileIcon"
      :find-entry-by-path="findEntryByPath"
      :move-entry="moveEntry"
      :get-project-root-dir-handle="getProjectRootDirHandle"
      :handle-files="handleFiles"
      @toggle="toggleDirectory"
      @action="onFileAction"
      @create-folder="openCreateFolderModal"
    />
    <FileManagerEffects v-else-if="activeTab === 'effects'" />
    <FileManagerHistory v-else-if="activeTab === 'history'" />

    <CreateFolderModal v-model:open="isCreateFolderModalOpen" @create="handleCreateFolder" />

    <RenameModal
      v-model:open="isRenameModalOpen"
      :initial-name="renameTarget?.name"
      @rename="handleRename"
    />

    <FileInfoModal v-model:open="isFileInfoModalOpen" :info="currentFileInfo" />

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
          {{ deleteTarget.kind === 'directory' ? t('common.folder', 'Folder') : t('common.file', 'File') }}
          ·
          {{ deleteTarget.path }}
        </div>

        <div
          v-if="deleteTarget?.kind === 'file' && timelinesUsingDeleteTarget.length > 0"
          class="mt-3 p-2 rounded border border-red-500/40 bg-red-500/10"
        >
          <div class="text-xs font-semibold text-red-400">
            {{ t('videoEditor.fileManager.delete.usedWarning', 'This file is used in timelines:') }}
          </div>
          <div class="mt-1 flex flex-col gap-1">
            <div
              v-for="tl in timelinesUsingDeleteTarget"
              :key="tl.timelinePath"
              class="text-xs text-ui-text break-all"
            >
              {{ tl.timelineName }}
              <span class="text-[10px] text-ui-text-muted">({{ tl.timelinePath }})</span>
            </div>
          </div>
        </div>
      </div>
    </UiConfirmModal>

    <!-- Global Drag Highlight / Hint -->
    <div
      v-if="uiStore.isGlobalDragging && !isDragging"
      class="absolute inset-0 z-100 flex flex-col items-center justify-center bg-primary-500/10 border-4 border-dashed border-primary-500/50 m-2 rounded-2xl pointer-events-none transition-all duration-300"
    >
      <div class="flex flex-col items-center bg-ui-bg-elevated/90 px-6 py-4 rounded-xl border border-primary-500/30 shadow-xl">
        <UIcon name="i-heroicons-folder-arrow-down" class="w-10 h-10 text-primary-400 mb-2" />
        <p class="text-sm font-bold text-primary-400 text-center uppercase tracking-wider">
          {{ t('videoEditor.fileManager.actions.dropZone', 'Move to folder') }}
        </p>
      </div>
    </div>
  </div>
</template>
