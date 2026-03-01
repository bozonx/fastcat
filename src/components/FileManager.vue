<script setup lang="ts">
import { ref, watch } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useMediaStore } from '~/stores/media.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import type { FsEntry } from '~/types/fs';
import type { FileInfo } from '~/types/fileManager';
import CreateFolderModal from '~/components/common/CreateFolderModal.vue';
import FileInfoModal from '~/components/common/FileInfoModal.vue';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import RenameModal from '~/components/common/RenameModal.vue';
import FileManagerFiles from '~/components/file-manager/FileManagerFiles.vue';
import FileManagerEffects from '~/components/file-manager/FileManagerEffects.vue';
import FileManagerHistory from '~/components/file-manager/FileManagerHistory.vue';
import { useFocusStore } from '~/stores/focus.store';
import { useSelectionStore } from '~/stores/selection.store';
import { ensureProxyCommand } from '~/media-cache/application/proxyThumbnailCommands';

const { t } = useI18n();
import { useFileManagerModals } from '~/composables/fileManager/useFileManagerModals';
import { computeDirectorySize } from '~/utils/fs';

const projectStore = useProjectStore();
const mediaStore = useMediaStore();
const timelineStore = useTimelineStore();
const focusStore = useFocusStore();
const uiStore = useUiStore();
const selectionStore = useSelectionStore();

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

const {
  isCreateFolderModalOpen,
  folderCreationTarget, // still needed for template binding if used there
  isRenameModalOpen,
  renameTarget,
  isFileInfoModalOpen,
  currentFileInfo,
  isDeleteConfirmModalOpen,
  deleteTarget,
  timelinesUsingDeleteTarget,
  directoryUploadTarget,
  directoryUploadInput,
  openCreateFolderModal,
  handleCreateFolder,
  // openFileInfoModal is used inside onFileAction but can be called directly
  openFileInfoModal: openFileInfoModalBase,
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

async function openFileInfoModal(entry: FsEntry) {
  // Override to include computeDirectorySize which uses locally available knowledge
  const original = openFileInfoModalBase;
  let size: number | undefined;
  
  if (entry.kind === 'directory') {
    size = await computeDirectorySize(entry.handle as FileSystemDirectoryHandle);
  }
  
  await original(entry);
  if (size !== undefined && currentFileInfo.value) {
    currentFileInfo.value.size = size;
  }
}

function onFileAction(action: any, entry: FsEntry) {
  if (action === 'info') {
    openFileInfoModal(entry);
  } else if (action === 'createProxyForFolder') {
    // Keep this complex logic here for now, or move to a store later
    if (entry.kind === 'directory' && entry.path !== undefined) {
      const dirPath = entry.path;
      const dirHandle = entry.handle as FileSystemDirectoryHandle;
      (async () => {
        const collect = async (dir: FileSystemDirectoryHandle, bPath: string) => {
          // Iterator logic simplified for brevity here, or we keep original
          // Using the logic from the original onFileAction
          const iterator = (dir as any).values?.() ?? (dir as any).entries?.();
          if (!iterator) return;

          for await (const value of iterator) {
            const handle = (Array.isArray(value) ? value[1] : value) as FileSystemFileHandle | FileSystemDirectoryHandle;
            const fullPath = bPath ? `${bPath}/${handle.name}` : handle.name;

            if (handle.kind === 'file') {
              const ext = handle.name.split('.').pop()?.toLowerCase() ?? '';
              if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) {
                if (!fileManager.mediaCache.hasProxy(fullPath)) {
                  void ensureProxyCommand({
                    service: fileManager.mediaCache,
                    fileHandle: handle as FileSystemFileHandle,
                    projectRelativePath: fullPath,
                  });
                }
              }
            } else if (handle.kind === 'directory') {
              await collect(handle as FileSystemDirectoryHandle, fullPath);
            }
          }
        };
        try {
          await collect(dirHandle, dirPath);
        } catch (e) {
          console.error('Failed to walk folder for proxy creation', e);
        }
      })();
    }
  } else {
    onFileActionBase(action, entry);
  }
}

watch(
  () => uiStore.pendingFsEntryDelete,
  (value) => {
    const entry = value as FsEntry | null;
    if (entry) {
      openDeleteConfirmModal(entry);
      uiStore.pendingFsEntryDelete = null;
    }
  },
);

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

async function onCreateTimeline() {
  const createdPath = await createTimeline();
  if (!createdPath) return;

  await projectStore.openTimelineFile(createdPath);
  await timelineStore.loadTimeline();
  void timelineStore.loadTimelineMetadata();
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
      :media-cache="fileManager.mediaCache"
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
          {{
            deleteTarget.kind === 'directory'
              ? t('common.folder', 'Folder')
              : t('common.file', 'File')
          }}
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
      <div
        class="flex flex-col items-center bg-ui-bg-elevated/90 px-6 py-4 rounded-xl border border-primary-500/30 shadow-xl"
      >
        <UIcon name="i-heroicons-folder-arrow-down" class="w-10 h-10 text-primary-400 mb-2" />
        <p class="text-sm font-bold text-primary-400 text-center uppercase tracking-wider">
          {{ t('videoEditor.fileManager.actions.dropZone', 'Move to folder') }}
        </p>
      </div>
    </div>
  </div>
</template>
