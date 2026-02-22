<script setup lang="ts">
import { ref, watch } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useMediaStore } from '~/stores/media.store';
import { useFileManager, type FsEntry } from '~/composables/fileManager/useFileManager';
import CreateFolderModal from '~/components/common/CreateFolderModal.vue';
import FileInfoModal, { type FileInfo } from '~/components/common/FileInfoModal.vue';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import RenameModal from '~/components/common/RenameModal.vue';
import FileManagerProject from '~/components/file-manager/FileManagerProject.vue';
import FileManagerFiles from '~/components/file-manager/FileManagerFiles.vue';
import FileManagerEffects from '~/components/file-manager/FileManagerEffects.vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const projectStore = useProjectStore();
const mediaStore = useMediaStore();

const fileManager = useFileManager();
const {
  rootEntries,
  isLoading,
  error,
  isApiSupported,
  loadProjectDirectory,
  toggleDirectory,
  handleFiles,
  createFolder,
  deleteEntry,
  renameEntry,
  createTimeline,
  getFileIcon,
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

watch(() => projectStore.currentProjectName, loadProjectDirectory, { immediate: true });

function onDrop(e: DragEvent) {
  isDragging.value = false;
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

async function openFileInfoModal(entry: FsEntry) {
  let size: number | undefined;
  let lastModified: number | undefined;

  if (entry.kind === 'file') {
    try {
      const file = await (entry.handle as FileSystemFileHandle).getFile();
      size = file.size;
      lastModified = file.lastModified;
    } catch (e) {
      // ignore
    }
  }

  currentFileInfo.value = {
    name: entry.name,
    kind: entry.kind,
    size,
    lastModified,
    path: entry.path,
    metadata:
      entry.kind === 'file' && entry.path
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
  await deleteEntry(deleteTarget.value);
  deleteTarget.value = null;
  isDeleteConfirmModalOpen.value = false;
}

async function handleRename(newName: string) {
  if (!renameTarget.value) return;
  await renameEntry(renameTarget.value, newName);
  renameTarget.value = null;
}

function onFileAction(action: 'createFolder' | 'rename' | 'info' | 'delete', entry: FsEntry) {
  if (action === 'createFolder') {
    openCreateFolderModal(entry);
  } else if (action === 'rename') {
    renameTarget.value = entry;
    isRenameModalOpen.value = true;
  } else if (action === 'info') {
    openFileInfoModal(entry);
  } else if (action === 'delete') {
    openDeleteConfirmModal(entry);
  }
}

function triggerFileUpload() {
  fileInput.value?.click();
}

function onFileSelect(e: Event) {
  const target = e.target as HTMLInputElement;
  if (target.files) {
    handleFiles(target.files);
  }
}
</script>

<template>
  <div
    class="flex flex-col h-full bg-ui-bg-elevated border-r border-ui-border transition-colors duration-200 min-w-0 overflow-hidden"
    :class="{ 'bg-ui-bg-accent ring-2 ring-inset ring-primary-500/50': isDragging }"
    @dragover.prevent="isDragging = true"
    @dragleave.prevent="isDragging = false"
    @drop.prevent="onDrop"
  >
    <!-- Hidden file input -->
    <input ref="fileInput" type="file" multiple class="hidden" @change="onFileSelect" />

    <!-- Header / Tabs -->
    <div class="flex items-center gap-4 px-3 py-2 border-b border-ui-border shrink-0 select-none">
      <button
        class="text-xs font-semibold uppercase tracking-wider transition-colors outline-none"
        :class="activeTab === 'project' ? 'text-primary-400' : 'text-gray-500 hover:text-gray-300'"
        @click="activeTab = 'project'"
      >
        {{ t('videoEditor.fileManager.tabs.project', 'Project') }}
      </button>
      <button
        class="text-xs font-semibold uppercase tracking-wider transition-colors outline-none"
        :class="activeTab === 'files' ? 'text-primary-400' : 'text-gray-500 hover:text-gray-300'"
        @click="activeTab = 'files'"
      >
        {{ t('videoEditor.fileManager.tabs.files', 'Files') }}
      </button>
      <button
        class="text-xs font-semibold uppercase tracking-wider transition-colors outline-none"
        :class="activeTab === 'effects' ? 'text-primary-400' : 'text-gray-500 hover:text-gray-300'"
        @click="activeTab = 'effects'"
      >
        {{ t('videoEditor.fileManager.tabs.effects', 'Effects') }}
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
        icon="i-heroicons-arrow-up-tray"
        variant="ghost"
        color="neutral"
        size="xs"
        :title="t('videoEditor.fileManager.actions.uploadFiles')"
        @click="triggerFileUpload"
      />
      <UButton
        icon="i-heroicons-document-plus"
        variant="ghost"
        color="neutral"
        size="xs"
        :title="t('videoEditor.fileManager.actions.createTimeline', 'Create Timeline')"
        @click="createTimeline"
      />
    </div>

    <!-- Content -->
    <FileManagerProject v-if="activeTab === 'project'" />
    <FileManagerFiles
      v-else-if="activeTab === 'files'"
      :is-dragging="isDragging"
      :is-loading="isLoading"
      :error="error"
      :is-api-supported="isApiSupported"
      :root-entries="rootEntries"
      :get-file-icon="getFileIcon"
      @toggle="toggleDirectory"
      @action="onFileAction"
      @create-folder="openCreateFolderModal"
    />
    <FileManagerEffects v-else-if="activeTab === 'effects'" />

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
      <div v-if="deleteTarget" class="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100">
        {{ deleteTarget.name }}
      </div>
    </UiConfirmModal>
  </div>
</template>
