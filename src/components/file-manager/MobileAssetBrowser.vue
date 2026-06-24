<script setup lang="ts">
import { ref, computed, watch, watchEffect, onMounted, provide } from 'vue';
import {
  useFileManager,
  FILE_MANAGER_INJECTION_KEY,
} from '~/composables/file-manager/useFileManager';
import { useMobileFileBrowserShell } from '~/composables/file-manager/useMobileFileBrowserShell';
import { useMobileAssetCategories } from '~/composables/file-manager/useMobileAssetCategories';
import { useSelectionStore } from '~/stores/selection.store';
import { useTeleportTarget } from '~/composables/ui/useTeleportTarget';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { useUiStore } from '~/stores/ui.store';
import { useMobileAssetBrowserStore } from '~/stores/file-manager.store';
import type { FsEntry } from '~/types/fs';
import type { FileCompatibility } from '~/composables/file-manager/useFileManagerCompatibility';
import MobileFileBrowserDrawer from './MobileFileBrowserDrawer.vue';
import MobileFileBrowserSelectionToolbar from './MobileFileBrowserSelectionToolbar.vue';
import MobileAssetCategoryList from './MobileAssetCategoryList.vue';
import FileDeleteConfirmModal from './modals/FileDeleteConfirmModal.vue';
import FileSttTranscriptionModal from './modals/FileTranscriptionModal.vue';
import UiRenameModal from '~/components/ui/UiRenameModal.vue';
import MobileAddToTimelineModal from '~/components/timeline/MobileAddToTimelineModal.vue';
import UiButtonGroup from '~/components/ui/UiButtonGroup.vue';

const selectionStore = useSelectionStore();
const timelineMediaUsageStore = useTimelineMediaUsageStore();
const uiStore = useUiStore();
const { t } = useI18n();
const { target: teleportTarget } = useTeleportTarget();

const assetStore = useMobileAssetBrowserStore();

const fileManager = useFileManager({ shouldRecordFileManagerHistory: () => false });
provide(FILE_MANAGER_INJECTION_KEY, fileManager);

const sortFieldOptions = computed(() => [
  { label: t('common.modified'), value: 'modified' },
  { label: t('common.name'), value: 'name' },
  { label: t('common.size'), value: 'size' },
]);

function toggleSortOrder() {
  assetStore.sortOption.order = assetStore.sortOption.order === 'asc' ? 'desc' : 'asc';
}

// Flattened view of every visible asset across all categories — used for shared
// actions, bulk-selection and the selection toolbar. Kept as a writable ref so it
// satisfies the shared composables that expect a mutable Ref<FsEntry[]>.
const allEntries = ref<FsEntry[]>([]);

const { categories, loadAll, toggleCollapse, isCollapsed } = useMobileAssetCategories({
  vfs: fileManager.vfs,
  readDirectory: fileManager.readDirectory,
  fileManagerStore: assetStore,
});

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

const {
  fileInput,
  triggerGlobalFileUpload,
  onFileSelect,
  isSelectionMode,
  isDrawerOpen,
  selectedEntries,
  toggleSelectionMode,
  handleLongPress,
  handleToggleSelection,
  handleEntryClick,
  isPulling,
  pullDistance,
  isRefreshing,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  isDeleteConfirmModalOpen,
  deleteTargets,
  transcriptionModalOpen,
  transcriptionLanguage,
  transcriptionError,
  isTranscribing,
  isModelReady,
  transcriptionEntry,
  submitTranscription,
  isAddToTimelineModalOpen,
  addToTimelineEntries,
  canAddSelectionToTimeline,
  handleAddToProject,
  handleAddSelectionToTimeline,
  onAddedToTimeline,
  isRenameModalOpen,
  entryToRename,
  validateRename,
  onRenameConfirm,
  handleDrawerAction,
  wrappedHandleDeleteConfirm,
} = useMobileFileBrowserShell({
  fileManager,
  fileManagerStore: assetStore,
  entries: allEntries,
  compatibility: combinedCompatibility,
  reload: reloadAll,
  loadFolderContent: reloadAll,
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

const selectedEntryPath = computed<string | null>(() => {
  const entity = selectionStore.selectedEntity;
  if (entity?.source === 'fileManager' && entity && 'path' in entity) {
    return (entity.path as string | null) ?? null;
  }
  return null;
});
</script>

<template>
  <div class="flex flex-col h-full bg-ui-bg text-ui-text">
    <input ref="fileInput" type="file" multiple class="hidden" @change="onFileSelect" />

    <!-- Sorting Toolbar -->
    <div
      class="flex shrink-0 items-center justify-between border-b border-ui-border/60 bg-ui-bg px-4 py-2 gap-2"
    >
      <UiButtonGroup
        v-model="assetStore.sortOption.field"
        :options="sortFieldOptions"
        size="xs"
        active-color="primary"
        active-variant="solid"
        variant="ghost"
        color="neutral"
        class="min-w-0"
      />
      <UButton
        :icon="
          assetStore.sortOption.order === 'asc'
            ? 'lucide:arrow-up-narrow-wide'
            : 'lucide:arrow-down-wide-narrow'
        "
        size="sm"
        color="neutral"
        variant="ghost"
        class="shrink-0"
        @click="toggleSortOrder"
      />
    </div>

    <MobileAssetCategoryList
      :categories="categories"
      :selected-entry-path="selectedEntryPath"
      :selected-entries="selectedEntries"
      :is-selection-mode="isSelectionMode"
      :is-collapsed="isCollapsed"
      :is-pulling="isPulling"
      :is-refreshing="isRefreshing"
      :pull-distance="pullDistance"
      @entry-click="handleEntryClick"
      @long-press="handleLongPress"
      @toggle-selection="handleToggleSelection"
      @toggle-collapse="toggleCollapse"
      @retry="categories.find((category) => category.id === $event)?.load(true)"
      @touch-start="onTouchStart"
      @touch-move="onTouchMove"
      @touch-end="onTouchEnd"
    />

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
      @cancel-selection="toggleSelectionMode"
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
      select-without-extension
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
