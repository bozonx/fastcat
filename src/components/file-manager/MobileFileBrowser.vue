<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useProjectStore } from '~/stores/project.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useClipboardStore } from '~/stores/clipboard.store';
import { useTeleportTarget } from '~/composables/ui/useTeleportTarget';
import { isOpenableProjectFileName } from '~/utils/media-types';
import { useFileBrowserShared } from '~/composables/file-manager/useFileBrowserShared';
import { useFileBrowserEntries } from '~/composables/file-manager/useFileBrowserEntries';
import { usePullToRefresh } from '~/composables/file-manager/usePullToRefresh';
import { useMobileFileBrowserNavigation } from '~/composables/file-manager/useMobileFileBrowserNavigation';
import { useMobileFileBrowserSelection } from '~/composables/file-manager/useMobileFileBrowserSelection';
import { useMobileFileBrowserCreate } from '~/composables/file-manager/useMobileFileBrowserCreate';
import type { FsEntry } from '~/types/fs';
import type { FileAction as FileManagerAction } from '~/composables/file-manager/useFileManagerActions';
import MobileFileBrowserGrid from './MobileFileBrowserGrid.vue';
import MobileFileBrowserDrawer from './MobileFileBrowserDrawer.vue';
import MobileFileBrowserNavbar from './MobileFileBrowserNavbar.vue';
import MobileFileBrowserCreateSheet from './MobileFileBrowserCreateSheet.vue';
import MobileFileBrowserSelectionToolbar from './MobileFileBrowserSelectionToolbar.vue';
import MobileFileBrowserPasteToolbar from './MobileFileBrowserPasteToolbar.vue';
import FileDeleteConfirmModal from './modals/FileDeleteConfirmModal.vue';
import FileSttTranscriptionModal from './modals/FileTranscriptionModal.vue';
import UiRenameModal from '~/components/ui/UiRenameModal.vue';
import UiEntityCreationModal from '~/components/ui/UiEntityCreationModal.vue';
import MobileAddToTimelineModal from '~/components/timeline/MobileAddToTimelineModal.vue';
import { useFileBrowserBulkSelection } from '~/composables/file-manager/useFileBrowserBulkSelection';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { useHotkeyLabel } from '~/composables/useHotkeyLabel';

type MobileDrawerAction =
  | FileManagerAction
  | 'openAsPanelCut'
  | 'openAsPanelSound'
  | 'openAsProjectTab';

const fileManagerStore = useFileManagerStore();
const projectStore = useProjectStore();
const selectionStore = useSelectionStore();
const clipboardStore = useClipboardStore();
const timelineMediaUsageStore = useTimelineMediaUsageStore();
const toast = useToast();
const { t } = useI18n();
const { getHotkeyLabel } = useHotkeyLabel();
const { target: teleportTarget } = useTeleportTarget();

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
} = useFileManager({ shouldRecordFileManagerHistory: () => false });

const isRemoteMode = ref(false);

const {
  folderEntries,
  sortedEntries,
  videoThumbnails: thumbnails,
  fileCompatibility,
  folderSizes: browserFolderSizes,
  calculateFolderSize: browserCalculateFolderSize,
  supplementEntries,
} = useFileBrowserEntries({ isRemoteMode, vfs });

const { isLoading, error, breadcrumbs, loadFolderContent, navigateToRoot, goBack } =
  useMobileFileBrowserNavigation({
    readDirectory,
    vfs,
    findEntryByPath: (path: string) => findEntryByPath(path) || undefined,
    folderEntries,
    supplementEntries,
  });

const {
  isSelectionMode,
  isDrawerOpen,
  selectedEntries,
  totalSelectedSize,
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
  onCreateTextFile: runCreateTextFile,
} = useMobileFileBrowserCreate({
  createFolder,
  createTimeline,
  createMarkdown,
  handleFiles: (files: File[], targetPath: string) =>
    handleFiles(files, { targetDirPath: targetPath }),
  loadFolderContent,
});

async function onCreateTextFile(targetPath?: string) {
  const path = await runCreateTextFile(targetPath);
  if (path) {
    const name = path.split('/').pop() || '';
    const entry: FsEntry = {
      name,
      path,
      kind: 'file',
    };
    handleEntryClick(entry);
  }
}

// Pull-to-refresh for mobile file grid
const { isPulling, pullDistance, isRefreshing, onTouchStart, onTouchMove, onTouchEnd } =
  usePullToRefresh(async () => {
    const path = fileManagerStore.selectedFolder?.path || '';
    await reloadDirectory(path);
    await loadFolderContent();
  });

const {
  onFileAction,
  isDeleteConfirmModalOpen,
  deleteTargets,
  handleDeleteConfirm,
  modalOpen: transcriptionModalOpen,
  language: transcriptionLanguage,
  errorMessage: transcriptionError,
  isTranscribing,
  isModelReady,
  pendingEntry: transcriptionEntry,
  openModal: openTranscriptionModal,
  submitTranscription,
} = useFileBrowserShared({
  vfs,
  folderEntries,
  loadFolderContent,
  createFolder,
  renameEntry,
  deleteEntry,
  loadProjectDirectory: async () => {
    await loadFolderContent();
  },
  handleFiles,
  mediaCache,
  findEntryByPath,
  readDirectory,
  reloadDirectory,
  copyEntry,
  moveEntry,
  isExternal: false,
  onAfterRename: loadFolderContent,
  onAfterDelete: loadFolderContent,
});

// Lazily calculate sizes of newly appeared folders only
watch(
  () => folderEntries.value.filter((e) => e.kind === 'directory').map((e) => e.path),
  (newPaths, oldPaths) => {
    const prevSet = new Set(oldPaths ?? []);
    for (const path of newPaths) {
      if (path && !prevSet.has(path) && browserFolderSizes.value[path] === undefined) {
        void browserCalculateFolderSize(path);
      }
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  if (clipboardStore.hasFileManagerPayload) {
    clipboardStore.clearClipboardPayload();
  }
});

const isAddToTimelineModalOpen = ref(false);
const addToTimelineEntries = ref<FsEntry[]>([]);

const isRenameModalOpen = ref(false);
const entryToRename = ref<FsEntry | null>(null);

const isCreateFolderModalOpen = ref(false);

const canAddSelectionToTimeline = computed(
  () =>
    isSelectionMode.value &&
    selectedEntries.value.some((e) => {
      if (e.kind !== 'file' || !e.path) return false;
      if (fileCompatibility.value[e.path]?.status === 'fully_unsupported') return false;
      return isOpenableProjectFileName(e.name);
    }),
);

async function handleAddToProject() {
  const entity = selectionStore.selectedEntity;
  if (!entity || entity.source !== 'fileManager' || entity.kind !== 'file' || !entity.path) return;

  addToTimelineEntries.value = [entity.entry];
  isDrawerOpen.value = false;
  isAddToTimelineModalOpen.value = true;
}

async function handleAddSelectionToTimeline() {
  const supportedEntries = selectedEntries.value.filter((e) => {
    if (e.kind !== 'file' || !e.path) return false;
    if (fileCompatibility.value[e.path]?.status === 'fully_unsupported') return false;
    return isOpenableProjectFileName(e.name);
  });
  if (supportedEntries.length === 0) return;

  addToTimelineEntries.value = supportedEntries;
  isDrawerOpen.value = false;
  isAddToTimelineModalOpen.value = true;
}

function onAddedToTimeline() {
  toast.add({
    title: t('common.success'),
    description: t('common.addedToTimeline'),
    color: 'success',
  });
  closeAllUI();
  projectStore.setView('cut');
}

async function handlePaste() {
  const target = fileManagerStore.selectedFolder;
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

function handlePendingBloggerDogCreateSubgroup(_entry: FsEntry) {
  // BloggerDog subgroup creation is not supported in mobile file browser
}

function handlePendingBloggerDogCreateItem(_entry: FsEntry) {
  // BloggerDog content item creation is not supported in mobile file browser
}

async function onRenameConfirm(newName: string) {
  if (!entryToRename.value || newName === entryToRename.value.name) return;

  try {
    await renameEntry(entryToRename.value, newName);
    await loadFolderContent();
    toast.add({
      title: t('common.success'),
      description: t('common.saveSuccess'),
      color: 'success',
    });
  } catch (err) {
    toast.add({
      title: t('common.error'),
      description: String((err as { message?: string })?.message || err),
      color: 'error',
    });
  } finally {
    entryToRename.value = null;
  }
}

async function handleDrawerAction(action: MobileDrawerAction, entry: FsEntry | FsEntry[]) {
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

  if (action === 'delete') {
    closeAllUI();
  }

  if (action === 'createTimeline') {
    const e = Array.isArray(entry) ? entry[0] : entry;
    if (e?.kind === 'directory') await onCreateTimeline(e.path);
    closeAllUI();
    return;
  }

  if (action === 'createMarkdown') {
    const e = Array.isArray(entry) ? entry[0] : entry;
    if (e?.kind === 'directory') await onCreateTextFile(e.path);
    closeAllUI();
    return;
  }

  if (action === 'createSubgroup') {
    const e = Array.isArray(entry) ? entry[0] : entry;
    if (e) handlePendingBloggerDogCreateSubgroup(e);
    closeAllUI();
    return;
  }

  if (action === 'createContentItem') {
    const e = Array.isArray(entry) ? entry[0] : entry;
    if (e) handlePendingBloggerDogCreateItem(e);
    closeAllUI();
    return;
  }

  await onFileAction(action, entry);
}

const bulkSelection = useFileBrowserBulkSelection({
  getVisibleEntries: () => sortedEntries.value,
  getSelectedEntries: () => selectedEntries.value,
  selectEntries: (entries) => {
    selectionStore.selectFsEntries(entries);
    isSelectionMode.value = entries.length > 0;
    isDrawerOpen.value = false;
  },
  clearSelection: () => {
    selectionStore.clearSelection();
    isSelectionMode.value = false;
    isDrawerOpen.value = false;
  },
  getUsedPaths: () => new Set(Object.keys(timelineMediaUsageStore.mediaPathToTimelines)),
  refreshUsage: async () => await timelineMediaUsageStore.refreshUsage(),
});

async function wrappedHandleDeleteConfirm() {
  await handleDeleteConfirm();
  closeAllUI();
}

function onSortFieldSelect(field: string) {
  fileManagerStore.sortOption.field = field as typeof fileManagerStore.sortOption.field;
}

function toggleSortOrder() {
  fileManagerStore.sortOption.order = fileManagerStore.sortOption.order === 'asc' ? 'desc' : 'asc';
}

async function refreshFolder() {
  const path = fileManagerStore.selectedFolder?.path || '';
  await reloadDirectory(path);
  await loadFolderContent();
}

function toggleHiddenFiles() {
  fileManagerStore.setShowHiddenFiles(!fileManagerStore.showHiddenFiles);
}

const sortItems = computed(() =>
  fileManagerStore.sortFields.map((f) => ({
    label: t(f.labelKey),
    icon: fileManagerStore.sortOption.field === f.value ? 'lucide:check' : undefined,
    onSelect: () => onSortFieldSelect(f.value),
  })),
);

const menuItems = computed(() => [
  [
    {
      label: isSelectionMode.value ? t('common.cancelSelection') : t('common.selectItems'),
      icon: isSelectionMode.value ? 'lucide:x-circle' : 'lucide:check-square',
      onSelect: toggleSelectionMode,
    },
  ],
  [
    {
      label: `${t('common.selectAll')}${getHotkeyLabel('general.selectAll') ? ` (${getHotkeyLabel('general.selectAll')})` : ''}`,
      icon: 'i-heroicons-check-circle',
      onSelect: bulkSelection.selectAll,
    },
    {
      label: t('common.selectUnused'),
      icon: 'i-heroicons-circle-stack',
      onSelect: bulkSelection.selectUnused,
    },
    {
      label: t('common.invertSelection'),
      icon: 'i-heroicons-arrow-path-rounded-square',
      onSelect: bulkSelection.invertSelection,
    },
  ],
  [
    {
      label: t('videoEditor.fileManager.actions.uploadFiles'),
      icon: 'i-heroicons-arrow-up-tray',
      onSelect: triggerFileUpload,
    },
    {
      label: `${t('videoEditor.fileManager.actions.createFolder')}${getHotkeyLabel('general.createFolder') ? ` (${getHotkeyLabel('general.createFolder')})` : ''}`,
      icon: 'i-heroicons-folder-plus',
      onSelect: handleCreateFolderRequest,
    },
    {
      label: t('videoEditor.fileManager.actions.createTimeline'),
      icon: 'i-heroicons-document-plus',
      onSelect: onCreateTimeline,
    },
    {
      label: t('videoEditor.fileManager.actions.createMarkdown'),
      icon: 'i-heroicons-document-text',
      onSelect: () => onCreateTextFile(),
    },
  ],
  [...sortItems.value],
  [
    {
      label:
        fileManagerStore.sortOption.order === 'asc'
          ? t('common.sortOrder.asc')
          : t('common.sortOrder.desc'),
      icon: fileManagerStore.sortOption.order === 'asc' ? 'lucide:sort-asc' : 'lucide:sort-desc',
      onSelect: toggleSortOrder,
    },
  ],
  [
    {
      label: t('common.refresh'),
      icon: 'i-heroicons-arrow-path',
      onSelect: refreshFolder,
    },
  ],
  [
    {
      label: fileManagerStore.showHiddenFiles
        ? t('common.hideHiddenFiles')
        : t('common.showHiddenFiles'),
      icon: fileManagerStore.showHiddenFiles ? 'lucide:eye-off' : 'lucide:eye',
      onSelect: toggleHiddenFiles,
    },
  ],
]);
</script>

<template>
  <div class="flex flex-col h-full bg-ui-bg text-ui-text">
    <input ref="fileInput" type="file" multiple class="hidden" @change="onFileSelect" />

    <!-- Navigation (Breadcrumbs/Back) -->
    <MobileFileBrowserNavbar
      :is-selection-mode="isSelectionMode"
      :selected-count="selectedEntries.length"
      :total-selected-size="totalSelectedSize"
      :breadcrumbs="breadcrumbs"
      :has-folder-path="!!fileManagerStore.selectedFolder?.path"
      :menu-items="menuItems"
      @back="goBack"
      @cancel-selection="toggleSelectionMode"
      @navigate-root="navigateToRoot"
      @navigate-breadcrumb="
        (name, path) => fileManagerStore.openFolder({ kind: 'directory', name, path })
      "
    />

    <!-- File Grid -->
    <div
      class="flex-1 overflow-y-auto min-h-0 relative"
      @touchstart="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
    >
      <!-- Pull-to-refresh indicator -->
      <div
        v-if="isPulling || isRefreshing"
        class="absolute top-0 left-0 right-0 flex items-center justify-center z-10 pointer-events-none"
        :class="{ 'transition-all duration-300 ease-out': !isPulling }"
        :style="{
          transform: `translateY(${-48 + pullDistance}px)`,
          opacity: Math.min(1, pullDistance / 48)
        }"
      >
        <div
          class="bg-ui-bg-elevated rounded-full w-10 h-10 flex items-center justify-center shadow-lg border border-ui-border"
        >
          <Icon
            :name="isRefreshing ? 'lucide:loader-2' : 'lucide:arrow-down'"
            class="w-5 h-5 text-ui-text"
            :class="{ 'animate-spin': isRefreshing }"
          />
        </div>
      </div>

      <MobileFileBrowserGrid
        :entries="sortedEntries"
        :thumbnails="thumbnails"
        :file-compatibility="fileCompatibility"
        :selected-entry-path="
          (selectionStore.selectedEntity?.source === 'fileManager' &&
          'path' in selectionStore.selectedEntity
            ? (selectionStore.selectedEntity.path as string | null)
            : null) ?? null
        "
        :selected-entries="selectedEntries"
        :is-selection-mode="isSelectionMode"
        :is-loading="isLoading"
        :error="error"
        :folder-sizes="browserFolderSizes"
        @entry-click="handleEntryClick"
        @long-press="handleLongPress"
        @toggle-selection="handleToggleSelection"
        @retry="loadFolderContent"
      />
    </div>

    <!-- Properties Drawer / Action Bar -->
    <MobileFileBrowserDrawer
      :is-open="isDrawerOpen"
      :is-selection-mode="isSelectionMode"
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
    <Teleport :to="teleportTarget">
      <div
        v-if="
          !isSelectionMode &&
          !isDrawerOpen &&
          !isCreateMenuOpen &&
          !clipboardStore.hasFileManagerPayload
        "
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
      :selected-folder-name="fileManagerStore.selectedFolder?.name || '/'"
      :selected-folder-path="fileManagerStore.selectedFolder?.path || ''"
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
      v-model:open="transcriptionModalOpen"
      :is-transcribing="isTranscribing"
      :is-model-ready="isModelReady"
      :transcription-error="transcriptionError"
      :transcription-entry="transcriptionEntry"
      :transcription-language="transcriptionLanguage"
      @update:transcription-language="transcriptionLanguage = $event"
      @submit="submitTranscription"
    />

    <!-- Rename Modal -->
    <UiRenameModal
      v-model:open="isRenameModalOpen"
      :initial-name="entryToRename?.name"
      @rename="onRenameConfirm"
    />

    <!-- Create Folder Modal -->
    <UiEntityCreationModal
      v-model:open="isCreateFolderModalOpen"
      :title="t('videoEditor.fileManager.actions.createFolder')"
      @confirm="onCreateFolderConfirm"
    />

    <!-- Add to Timeline Modal (Global) -->
    <MobileAddToTimelineModal
      v-model:open="isAddToTimelineModalOpen"
      :entries="addToTimelineEntries"
      @added="onAddedToTimeline"
    />
  </div>
</template>
