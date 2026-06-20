<script setup lang="ts">
import { ref, computed, watch, watchEffect, onMounted, provide } from 'vue';
import {
  useFileManager,
  FILE_MANAGER_INJECTION_KEY,
} from '~/composables/file-manager/useFileManager';
import { useProjectStore } from '~/stores/project.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useTeleportTarget } from '~/composables/ui/useTeleportTarget';
import { isOpenableProjectFileName } from '~/utils/media-types';
import { useFileBrowserShared } from '~/composables/file-manager/useFileBrowserShared';
import { useMobileFileBrowserSelection } from '~/composables/file-manager/useMobileFileBrowserSelection';
import { useMobileFileBrowserCreate } from '~/composables/file-manager/useMobileFileBrowserCreate';
import { useMobileAssetCategories } from '~/composables/file-manager/useMobileAssetCategories';
import { usePullToRefresh } from '~/composables/file-manager/usePullToRefresh';
import type { FsEntry } from '~/types/fs';
import type { MobileDrawerAction } from '~/types/file-manager';
import type { FileCompatibility } from '~/composables/file-manager/useFileManagerCompatibility';
import MobileFileBrowserGrid from './MobileFileBrowserGrid.vue';
import MobileFileBrowserList from './MobileFileBrowserList.vue';
import MobileFileBrowserDrawer from './MobileFileBrowserDrawer.vue';
import MobileFileBrowserSelectionToolbar from './MobileFileBrowserSelectionToolbar.vue';
import MobilePullToRefreshIndicator from './MobilePullToRefreshIndicator.vue';
import FileDeleteConfirmModal from './modals/FileDeleteConfirmModal.vue';
import FileSttTranscriptionModal from './modals/FileTranscriptionModal.vue';
import UiRenameModal from '~/components/ui/UiRenameModal.vue';
import MobileAddToTimelineModal from '~/components/timeline/MobileAddToTimelineModal.vue';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { useUiStore } from '~/stores/ui.store';

const projectStore = useProjectStore();
const selectionStore = useSelectionStore();
const timelineMediaUsageStore = useTimelineMediaUsageStore();
const uiStore = useUiStore();
const toast = useToast();
const { t } = useI18n();
const { target: teleportTarget } = useTeleportTarget();

const fileManager = useFileManager({ shouldRecordFileManagerHistory: () => false });
provide(FILE_MANAGER_INJECTION_KEY, fileManager);

const {
  findEntryByPath,
  mediaCache,
  vfs,
  handleFiles,
  createFolder,
  createMarkdown,
  reloadDirectory,
  deleteEntry,
  renameEntry,
  copyEntry,
  moveEntry,
  readDirectory,
} = fileManager;

const { categories, loadAll, toggleCollapse, isCollapsed } = useMobileAssetCategories({
  vfs,
  readDirectory,
});

// Flattened view of every visible asset across all categories — used for shared
// actions, bulk-selection and the selection toolbar. Kept as a writable ref so it
// satisfies the shared composables that expect a mutable Ref<FsEntry[]>.
const allEntries = ref<FsEntry[]>([]);
watchEffect(() => {
  allEntries.value = categories.flatMap((c) => c.sortedEntries.value);
});

const combinedCompatibility = computed<Record<string, FileCompatibility>>(() => {
  const merged: Record<string, FileCompatibility> = {};
  for (const c of categories) Object.assign(merged, c.fileCompatibility.value);
  return merged;
});

async function reloadAll() {
  await loadAll(true);
}

const { isPulling, pullDistance, isRefreshing, onTouchStart, onTouchMove, onTouchEnd } =
  usePullToRefresh(reloadAll);

// Assets are files only (no folders are listed), so folder sizes never apply.
const EMPTY_FOLDER_SIZES: Record<string, number> = {};

const {
  isSelectionMode,
  isDrawerOpen,
  selectedEntries,
  toggleSelectionMode,
  handleLongPress,
  handleToggleSelection,
  handleEntryClick,
  closeAllUI,
} = useMobileFileBrowserSelection();

const { fileInput, triggerGlobalFileUpload, onFileSelect } = useMobileFileBrowserCreate({
  createFolder,
  createMarkdown,
  handleFiles: (files: File[], targetPath?: string) =>
    handleFiles(files, targetPath !== undefined ? { targetDirPath: targetPath } : {}),
  loadFolderContent: reloadAll,
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
  folderEntries: allEntries,
  loadFolderContent: reloadAll,
  createFolder,
  renameEntry,
  deleteEntry,
  loadProjectDirectory: reloadAll,
  handleFiles,
  mediaCache,
  findEntryByPath,
  readDirectory,
  reloadDirectory,
  copyEntry,
  moveEntry,
  isExternal: false,
  onAfterRename: reloadAll,
  onAfterDelete: reloadAll,
});

onMounted(() => {
  void timelineMediaUsageStore.refreshUsage();
  void loadAll();
});

watch(
  () => uiStore.fileManagerUpdateCounter,
  () => {
    void reloadAll();
  },
);

const isAddToTimelineModalOpen = ref(false);
const addToTimelineEntries = ref<FsEntry[]>([]);

const isRenameModalOpen = ref(false);
const entryToRename = ref<FsEntry | null>(null);

const selectedEntryPath = computed<string | null>(() => {
  const entity = selectionStore.selectedEntity;
  if (entity?.source === 'fileManager' && entity && 'path' in entity) {
    return (entity.path as string | null) ?? null;
  }
  return null;
});

function isAddableEntry(entry: FsEntry): boolean {
  if (entry.kind !== 'file' || !entry.path) return false;
  if (combinedCompatibility.value[entry.path]?.status === 'fully_unsupported') return false;
  return isOpenableProjectFileName(entry.name);
}

const canAddSelectionToTimeline = computed(
  () => isSelectionMode.value && selectedEntries.value.some(isAddableEntry),
);

async function handleAddToProject() {
  const entity = selectionStore.selectedEntity;
  if (!entity || entity.source !== 'fileManager' || entity.kind !== 'file' || !entity.path) return;

  addToTimelineEntries.value = [entity.entry];
  isDrawerOpen.value = false;
  isAddToTimelineModalOpen.value = true;
}

async function handleAddSelectionToTimeline() {
  const supportedEntries = selectedEntries.value.filter(isAddableEntry);
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

async function handleRename(entry: FsEntry) {
  entryToRename.value = entry;
  isRenameModalOpen.value = true;
}

function validateRename(newName: string): string | boolean | null {
  const trimmed = newName.trim();
  if (!trimmed) return false;
  if (entryToRename.value && trimmed.toLowerCase() === entryToRename.value.name.toLowerCase()) {
    return true;
  }
  const parentPath =
    entryToRename.value?.parentPath ??
    entryToRename.value?.path?.split('/').slice(0, -1).join('/') ??
    '';
  const exists = allEntries.value.some(
    (entry) =>
      entry.path !== entryToRename.value?.path &&
      (entry.parentPath ?? entry.path?.split('/').slice(0, -1).join('/') ?? '') === parentPath &&
      entry.name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (exists) {
    return t('common.validation.exists');
  }
  return true;
}

async function onRenameConfirm(newName: string) {
  if (!entryToRename.value || newName === entryToRename.value.name) return;

  try {
    await renameEntry(entryToRename.value, newName);
    await reloadAll();
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
    if (entryToProcess) await handleRename(entryToProcess);
    closeAllUI();
    return;
  }

  if (action === 'transcribe') {
    const entryToProcess = Array.isArray(entry) ? entry[0] : entry;
    if (entryToProcess) openTranscriptionModal(entryToProcess);
    closeAllUI();
    return;
  }

  if (action === 'delete') {
    closeAllUI();
  }

  await onFileAction(action, entry);
}

async function wrappedHandleDeleteConfirm() {
  await handleDeleteConfirm();
  closeAllUI();
}
</script>

<template>
  <div class="flex flex-col h-full bg-ui-bg text-ui-text">
    <input ref="fileInput" type="file" multiple class="hidden" @change="onFileSelect" />

    <!-- Selection-mode header (this view has no navbar, so it carries the exit action) -->
    <div
      v-if="isSelectionMode"
      class="flex shrink-0 items-center gap-3 border-b border-ui-border bg-ui-bg-elevated px-4 py-2.5"
    >
      <UButton
        icon="lucide:x"
        color="neutral"
        variant="ghost"
        size="sm"
        @click="toggleSelectionMode"
      />
      <span class="text-sm font-medium">
        {{ t('common.itemsSelected', { count: selectedEntries.length }) }}
      </span>
    </div>

    <div
      class="flex-1 overflow-y-auto min-h-0 relative"
      @touchstart="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
    >
      <MobilePullToRefreshIndicator
        :is-pulling="isPulling"
        :is-refreshing="isRefreshing"
        :pull-distance="pullDistance"
      />

      <section
        v-for="category in categories"
        v-show="
          category.sortedEntries.value.length > 0 ||
          category.isLoading.value ||
          category.error.value
        "
        :key="category.id"
        class="border-b border-ui-border/50"
      >
        <button
          class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-ui-bg-elevated"
          @click="toggleCollapse(category.id)"
        >
          <Icon
            name="lucide:chevron-right"
            class="w-4 h-4 shrink-0 text-ui-text-muted transition-transform"
            :class="{ 'rotate-90': !isCollapsed(category.id) }"
          />
          <Icon :name="category.icon" class="w-5 h-5 shrink-0 text-ui-text-muted" />
          <span class="text-sm font-semibold">{{ t(category.labelKey) }}</span>
          <span class="ml-auto text-xs tabular-nums text-ui-text-muted">
            {{ category.sortedEntries.value.length }}
          </span>
        </button>

        <component
          :is="['audio', 'documents', 'files'].includes(category.id) ? MobileFileBrowserList : MobileFileBrowserGrid"
          v-show="!isCollapsed(category.id)"
          :entries="category.sortedEntries.value"
          :thumbnails="category.thumbnails.value"
          :file-compatibility="category.fileCompatibility.value"
          :selected-entry-path="selectedEntryPath"
          :selected-entries="selectedEntries"
          :is-selection-mode="isSelectionMode"
          :is-loading="category.isLoading.value"
          :error="category.error.value"
          :folder-sizes="EMPTY_FOLDER_SIZES"
          @entry-click="handleEntryClick"
          @long-press="handleLongPress"
          @toggle-selection="handleToggleSelection"
          @retry="category.load(true)"
        />
      </section>
    </div>

    <!-- Properties Drawer (шторка) -->
    <MobileFileBrowserDrawer
      :is-open="isDrawerOpen"
      :is-selection-mode="isSelectionMode"
      hide-clipboard-actions
      :on-action="handleDrawerAction"
      @close="isDrawerOpen = false"
      @add-to-timeline="handleAddToProject"
    />

    <!-- Selection Mode Toolbar -->
    <MobileFileBrowserSelectionToolbar
      v-if="isSelectionMode"
      :selected-entries="selectedEntries"
      :can-add-to-timeline="canAddSelectionToTimeline"
      hide-clipboard-actions
      @action="handleDrawerAction"
      @add-to-timeline="handleAddSelectionToTimeline"
    />

    <!-- Action FAB: uploads with auto-routing into _video / _audio / _images -->
    <Teleport :to="teleportTarget">
      <div
        v-if="!isSelectionMode && !isDrawerOpen"
        class="fixed bottom-20 right-6 z-40 transition-all duration-300"
      >
        <UButton
          icon="lucide:plus"
          size="xl"
          class="rounded-full shadow-2xl w-14 h-14 flex items-center justify-center bg-ui-action hover:bg-ui-action-hover text-white border-none shadow-ui-action/20"
          :ui="{ icon: 'w-7 h-7' }"
          @click="triggerGlobalFileUpload"
        />
      </div>
    </Teleport>

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
      :validate="validateRename"
      @rename="onRenameConfirm"
    />

    <!-- Add to Timeline Modal -->
    <MobileAddToTimelineModal
      v-model:open="isAddToTimelineModalOpen"
      :entries="addToTimelineEntries"
      @added="onAddedToTimeline"
    />
  </div>
</template>
