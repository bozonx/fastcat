<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useFilesPageStore, type FileSortField } from '~/stores/files-page.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import { useProjectStore } from '~/stores/project.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useUiStore } from '~/stores/ui.store';
import { useFileManagerThumbnails } from '~/composables/fileManager/useFileManagerThumbnails';
import { useFileSorting } from '~/composables/fileManager/useFileSorting';
import { useClipboardStore } from '~/stores/clipboard.store';
import { isOpenableProjectFileName } from '~/utils/media-types';
import {
  useFileManagerActions,
  type FileAction,
} from '~/composables/fileManager/useFileManagerActions';
import { useMobileFileBrowserNavigation } from '~/composables/fileManager/useMobileFileBrowserNavigation';
import { useMobileFileBrowserSelection } from '~/composables/fileManager/useMobileFileBrowserSelection';
import { useMobileFileBrowserCreate } from '~/composables/fileManager/useMobileFileBrowserCreate';
import type { FsEntry } from '~/types/fs';
import MobileFileBrowserGrid from './MobileFileBrowserGrid.vue';
import MobileFileBrowserDrawer from './MobileFileBrowserDrawer.vue';
import MobileFileBrowserNavbar from './MobileFileBrowserNavbar.vue';
import MobileFileBrowserCreateSheet from './MobileFileBrowserCreateSheet.vue';
import FileDeleteConfirmModal from './modals/FileDeleteConfirmModal.vue';
import FileSttTranscriptionModal from './modals/FileSttTranscriptionModal.vue';
import UiRenameModal from '~/components/ui/UiRenameModal.vue';
import { useFileBrowserStt } from '~/composables/fileManager/useFileBrowserStt';

const filesPageStore = useFilesPageStore();
const projectStore = useProjectStore();
const selectionStore = useSelectionStore();
const uiStore = useUiStore();
const clipboardStore = useClipboardStore();
const toast = useToast();
const { t } = useI18n();

const {
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
  readDirectory,
} = useFileManager();

const {
  entries,
  isLoading,
  breadcrumbs,
  loadFolderContent,
  navigateToRoot,
  goBack,
} = useMobileFileBrowserNavigation({
  readDirectory,
  vfs,
  findEntryByPath: (path: string) => findEntryByPath(path) || undefined,
});

const {
  isSelectionMode,
  isDrawerOpen,
  selectedEntries,
  folderSizes,
  totalSelectedSize,
  calculateFolderSize,
  toggleSelectionMode,
  handleLongPress,
  handleToggleSelection,
  handleEntryClick,
  closeAllUI,
} = useMobileFileBrowserSelection();

const {
  fileInput,
  isCreateMenuOpen,
  triggerFileUpload,
  onFileSelect,
  onCreateFolder: runCreateFolder,
  onCreateTimeline,
  onCreateTextFile,
} = useMobileFileBrowserCreate({
  createFolder,
  createTimeline,
  createMarkdown,
  handleFiles,
  loadFolderContent,
});

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

const selectedEntry = computed(() =>
  selectedEntries.value.length === 1 ? selectedEntries.value[0] : null,
);

const { sortedEntries } = useFileSorting(entries);
const { thumbnails } = useFileManagerThumbnails(sortedEntries, vfs);

const {
  sttTranscriptionModalOpen,
  sttTranscriptionLanguage,
  sttTranscriptionError,
  sttTranscribing,
  sttTranscriptionEntry,
  isTranscribableMediaFile,
  openTranscriptionModal,
  submitTranscription,
} = useFileBrowserStt();

// Lazily calculate sizes of all folders in current directory
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

const isAddToTimelineModalOpen = ref(false);
const addToTimelineEntries = ref<FsEntry[]>([]);

const isRenameModalOpen = ref(false);
const entryToRename = ref<FsEntry | null>(null);

const isCreateFolderModalOpen = ref(false);

const canAddSelectionToTimeline = computed(() =>
  isSelectionMode.value &&
  selectedEntries.value.some((e) => e.kind === 'file' && isOpenableProjectFileName(e.name)),
);

async function handleAddToProject() {
  const entity = selectionStore.selectedEntity;
  if (!entity || entity.source !== 'fileManager' || entity.kind !== 'file' || !entity.path) return;

  addToTimelineEntries.value = [entity.entry];
  isAddToTimelineModalOpen.value = true;
}

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
  closeAllUI();
  projectStore.setView('cut');
}

async function handlePaste() {
  const target = filesPageStore.selectedFolder;
  if (!target) return;
  await onFileAction('paste', target);
  await loadFolderContent();
}

async function handleRename(entry: FsEntry) {
  entryToRename.value = entry;
  isRenameModalOpen.value = true;
}

function handleCreateFolderRequest() {
  isCreateFolderModalOpen.value = true;
}

async function onCreateFolderConfirm(name: string) {
  await runCreateFolder(name);
}

async function onRenameConfirm(newName: string) {
  if (!entryToRename.value || newName === entryToRename.value.name) return;

  try {
    await renameEntry(entryToRename.value, newName);
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
  } finally {
    entryToRename.value = null;
  }
}

async function handleDrawerAction(action: FileAction, entry: FsEntry | FsEntry[]) {
  if (['copy', 'cut'].includes(action)) {
    closeAllUI();
  }

  if (action === 'rename') {
    const entryToProcess = Array.isArray(entry) ? entry[0] : entry;
    if (entryToProcess) {
      await handleRename(entryToProcess);
    }
    closeAllUI();
    return;
  }

  if (action === 'transcribe') {
    const entryToProcess = Array.isArray(entry) ? entry[0] : entry;
    if (entryToProcess) {
      openTranscriptionModal(entryToProcess);
    }
    closeAllUI();
    return;
  }

  await onFileAction(action, entry);
}

async function wrappedHandleDeleteConfirm() {
  await handleDeleteConfirm();
  closeAllUI();
}

async function handleEntryPrimaryAction(entry: FsEntry) {
  if (entry.kind === 'directory') {
    filesPageStore.openFolder(entry);
    return;
  }

  selectionStore.selectFsEntry(entry);
  await handleAddToProject();
}

const sortItems = computed(() =>
  filesPageStore.sortFields.map((f) => ({
    label: t(f.labelKey),
    icon: filesPageStore.sortOption.field === f.value ? 'lucide:check' : undefined,
    onSelect: () => {
      filesPageStore.sortOption.field = f.value;
    },
  })),
);

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
      onSelect: handleCreateFolderRequest,
    },
  ],
  [
    ...sortItems.value,
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
</script>

<template>
  <div class="flex flex-col h-full bg-slate-950 text-slate-200">
    <input ref="fileInput" type="file" multiple class="hidden" @change="onFileSelect" />

    <!-- Navigation (Breadcrumbs/Back) -->
    <MobileFileBrowserNavbar
      :is-selection-mode="isSelectionMode"
      :selected-count="selectedEntries.length"
      :total-selected-size="totalSelectedSize"
      :breadcrumbs="breadcrumbs"
      :has-folder-path="!!filesPageStore.selectedFolder?.path"
      :menu-items="menuItems"
      @back="goBack"
      @cancel-selection="toggleSelectionMode"
      @navigate-root="navigateToRoot"
      @navigate-breadcrumb="(name, path) => filesPageStore.selectFolder({ kind: 'directory', name, path })"
    />

    <!-- File Grid -->
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
      :is-transcribable="selectedEntry ? isTranscribableMediaFile(selectedEntry) : false"
      :on-action="handleDrawerAction"
      @close="isDrawerOpen = false"
      @add-to-timeline="handleAddToProject"
    />

    <!-- Selection Mode Toolbar -->
    <MobileFileBrowserSelectionToolbar
      v-if="isSelectionMode"
      :selected-entries="selectedEntries"
      :can-add-to-timeline="canAddSelectionToTimeline"
      @action="handleDrawerAction"
      @add-to-timeline="handleAddSelectionToTimeline"
    />

    <!-- Paste Mode Toolbar -->
    <MobileFileBrowserPasteToolbar
      v-if="!isSelectionMode && clipboardStore.hasFileManagerPayload"
      @paste="handlePaste"
      @cancel="clipboardStore.clearClipboardPayload()"
    />

    <!-- Action FAB -->
    <Teleport to="body">
      <div
        v-if="!isSelectionMode && !isDrawerOpen && !isCreateMenuOpen && !clipboardStore.hasFileManagerPayload"
        class="fixed bottom-20 right-6 z-40 transition-all duration-300"
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
    <MobileFileBrowserCreateSheet
      v-model="isCreateMenuOpen"
      :selected-folder-name="filesPageStore.selectedFolder?.name || '/'"
      :selected-folder-path="filesPageStore.selectedFolder?.path || ''"
      @upload="triggerFileUpload"
      @create-folder="handleCreateFolderRequest"
      @create-timeline="onCreateTimeline"
      @create-text-file="onCreateTextFile"
    />

    <!-- Delete Confirmation Modal -->
    <FileDeleteConfirmModal
      v-model:open="isDeleteConfirmModalOpen"
      :delete-targets="deleteTargets"
      @confirm="wrappedHandleDeleteConfirm"
    />

    <!-- STT Transcription Modal -->
    <FileSttTranscriptionModal
      v-model:open="sttTranscriptionModalOpen"
      :stt-transcribing="sttTranscribing"
      :stt-transcription-error="sttTranscriptionError"
      :stt-transcription-entry="sttTranscriptionEntry"
      :stt-transcription-language="sttTranscriptionLanguage"
      @update:stt-transcription-language="sttTranscriptionLanguage = $event"
      @submit="submitTranscription"
    />

    <!-- Rename Modal -->
    <UiRenameModal
      v-model:open="isRenameModalOpen"
      :initial-name="entryToRename?.name"
      @rename="onRenameConfirm"
    />

    <!-- Create Folder Modal -->
    <UiRenameModal
      v-model:open="isCreateFolderModalOpen"
      :title="t('videoEditor.fileManager.actions.createFolder', 'Create Folder')"
      @rename="onCreateFolderConfirm"
    />

    <!-- Add to Timeline Modal (Global) -->
    <TimelineMobileAddToTimelineModal
      v-model:open="isAddToTimelineModalOpen"
      :entries="addToTimelineEntries"
      @added="onAddedToTimeline"
    />
  </div>
</template>
