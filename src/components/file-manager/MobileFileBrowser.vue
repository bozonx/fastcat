<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';
import { useFileManagerStore, type FileSortField } from '~/stores/file-manager.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useProjectStore } from '~/stores/project.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useUiStore } from '~/stores/ui.store';
import { useFileManagerThumbnails } from '~/composables/file-manager/useFileManagerThumbnails';
import { useFileManagerCompatibility } from '~/composables/file-manager/useFileManagerCompatibility';
import { useFileSorting } from '~/composables/file-manager/useFileSorting';
import { useClipboardStore } from '~/stores/clipboard.store';
import { useTeleportTarget } from '~/composables/ui/useTeleportTarget';
import { isOpenableProjectFileName } from '~/utils/media-types';
import {
  useFileManagerActions,
  type FileAction as FileManagerAction,
} from '~/composables/file-manager/useFileManagerActions';
import { useBloggerDogStore } from '~/stores/bloggerdog';
import { useFileBrowserRemoteCreate } from '~/composables/file-manager/useFileBrowserRemoteCreate';
import { useMobileFileBrowserNavigation } from '~/composables/file-manager/useMobileFileBrowserNavigation';
import { useMobileFileBrowserSelection } from '~/composables/file-manager/useMobileFileBrowserSelection';
import { useMobileFileBrowserCreate } from '~/composables/file-manager/useMobileFileBrowserCreate';
import { useFileBrowserFileActions } from '~/composables/file-manager/useFileBrowserFileActions';
import type { FsEntry } from '~/types/fs';
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
import { useSttTranscription } from '~/composables/file-manager/useSttTranscription';
import { useFileBrowserBulkSelection } from '~/composables/file-manager/useFileBrowserBulkSelection';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { useFileConversionStore } from '~/stores/file-conversion.store';
import { useAudioExtraction } from '~/composables/file-manager/useAudioExtraction';
import { useProxyStore } from '~/stores/proxy.store';

type MobileDrawerAction =
  | FileManagerAction
  | 'openAsPanelCut'
  | 'openAsPanelSound'
  | 'openAsProjectTab';

const fileManagerStore = useFileManagerStore();
const projectStore = useProjectStore();
const selectionStore = useSelectionStore();
const uiStore = useUiStore();
const clipboardStore = useClipboardStore();
const timelineMediaUsageStore = useTimelineMediaUsageStore();
const toast = useToast();
const { t } = useI18n();
const { target: teleportTarget } = useTeleportTarget();
const runtimeConfig = useRuntimeConfig();

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

const { entries, isLoading, breadcrumbs, loadFolderContent, navigateToRoot, goBack } =
  useMobileFileBrowserNavigation({
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
    // Wait for the next tick for entries to be updated
    await nextTick();
    // Sometimes VFS needs a moment to reflect changes even after reload
    const entry = entries.value.find((e) => e.path === path);
    if (entry) {
      handleEntryClick(entry);
    } else {
      // Fallback: try one more time after a short delay
      setTimeout(() => {
        const retryEntry = entries.value.find((e) => e.path === path);
        if (retryEntry) {
          handleEntryClick(retryEntry);
        }
      }, 300);
    }
  }
}

const bloggerDogStore = useBloggerDogStore();

const {
  isSubgroupModalOpen,
  isItemModalOpen,
  handlePendingBloggerDogCreateSubgroup,
  handlePendingBloggerDogCreateItem,
  onSubgroupCreateConfirm,
  onItemCreateConfirm,
} = useFileBrowserRemoteCreate({
  vfs,
  bloggerDogStore,
  buildRemoteDirectoryEntry: (path) =>
    ({
      path,
      kind: 'directory',
      name: path.split('/').pop() || '',
      source: 'remote',
    }) as any,
  remoteCurrentFolder: ref(null),
  loadFolderContent,
  loadParentFolders: async () => {},
  notifyFileManagerUpdate: () => uiStore.notifyFileManagerUpdate(),
  clearPendingCreateSubgroup: () => {
    uiStore.pendingBloggerDogCreateSubgroup = null;
  },
  clearPendingCreateItem: () => {
    uiStore.pendingBloggerDogCreateItem = null;
  },
  t,
  toast,
});

const {
  onFileAction: onFileActionInternal,
  isDeleteConfirmModalOpen,
  deleteTargets,
  handleDeleteConfirm,
} = useFileManagerActions({
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

const conversionStore = useFileConversionStore();
const { extractAudio } = useAudioExtraction();
const proxyStore = useProxyStore();

const selectedEntry = computed(() =>
  selectedEntries.value.length === 1 ? selectedEntries.value[0] : null,
);

const { sortedEntries } = useFileSorting(entries);
const { thumbnails } = useFileManagerThumbnails(sortedEntries, vfs);
const { compatibility: fileCompatibility } = useFileManagerCompatibility(sortedEntries);

const {
  modalOpen: transcriptionModalOpen,
  language: transcriptionLanguage,
  errorMessage: transcriptionError,
  isTranscribing,
  isModelReady,
  pendingEntry: transcriptionEntry,
  isTranscribableMediaFile,
  openModal: openTranscriptionModal,
  submitTranscription,
} = useSttTranscription({
  fastcatAccountApiUrl: computed(() =>
    typeof runtimeConfig.public.fastcatAccountApiUrl === 'string'
      ? runtimeConfig.public.fastcatAccountApiUrl
      : '',
  ),
  vfs,
  onSuccess: ({ cached, mediaType }) => {
    toast.add({
      title: cached
        ? t('videoEditor.fileManager.audio.transcriptionCached')
        : t('videoEditor.fileManager.audio.transcriptionCompleted'),
      description: cached
        ? t(
            'videoEditor.fileManager.audio.transcriptionCachedDescription',
            'Cached transcription was loaded from the file directory.',
          )
        : mediaType === 'video'
          ? t(
              'videoEditor.fileManager.audio.transcriptionSavedVideoDescription',
              'Video audio track was transcribed and saved next to the source file.',
            )
          : t(
              'videoEditor.fileManager.audio.transcriptionSavedDescription',
              'Transcription was saved next to the source file.',
            ),
      color: 'success',
    });
  },
  onError: (message) => {
    toast.add({
      title: t('videoEditor.fileManager.audio.transcriptionFailed'),
      description: message,
      color: 'danger',
    });
  },
});

const { onFileAction } = useFileBrowserFileActions({
  folderEntries: entries,
  loadFolderContent,
  onFileActionBase: onFileActionInternal,
  conversionStore,
  openTranscriptionModal,
  extractAudio: (entry) => extractAudio(entry),
  vfs,
  isExternal: false,
});

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
  } catch (err: any) {
    toast.add({
      title: t('common.error'),
      description: String(err?.message || err),
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

const sortItems = computed(() =>
  fileManagerStore.sortFields.map((f) => ({
    label: t(f.labelKey),
    icon: fileManagerStore.sortOption.field === f.value ? 'lucide:check' : undefined,
    onSelect: () => {
      fileManagerStore.sortOption.field = f.value;
    },
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
      label: t('common.selectAll'),
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
      label: t('videoEditor.fileManager.actions.createFolder'),
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
      onSelect: () => {
        fileManagerStore.sortOption.order =
          fileManagerStore.sortOption.order === 'asc' ? 'desc' : 'asc';
      },
    },
  ],
  [
    {
      label: t('common.refresh'),
      icon: 'i-heroicons-arrow-path',
      onSelect: async () => {
        const path = fileManagerStore.selectedFolder?.path || '';
        await reloadDirectory(path);
        await loadFolderContent();
      },
    },
  ],
  [
    {
      label: uiStore.showHiddenFiles ? t('common.hideHiddenFiles') : t('common.showHiddenFiles'),
      icon: uiStore.showHiddenFiles ? 'lucide:eye-off' : 'lucide:eye',
      onSelect: () => {
        uiStore.showHiddenFiles = !uiStore.showHiddenFiles;
      },
    },
  ],
]);
</script>

<template>
  <div class="flex flex-col h-full bg-zinc-950 text-zinc-200">
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
    <div class="flex-1 overflow-y-auto min-h-0">
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
        :folder-sizes="folderSizes"
        @entry-click="handleEntryClick"
        @long-press="handleLongPress"
        @toggle-selection="handleToggleSelection"
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
    <TimelineMobileAddToTimelineModal
      v-model:open="isAddToTimelineModalOpen"
      :entries="addToTimelineEntries"
      @added="onAddedToTimeline"
    />

    <!-- BloggerDog Subgroup Modal -->
    <UiEntityCreationModal
      v-model:open="isSubgroupModalOpen"
      :title="t('fastcat.bloggerDog.actions.createSubgroup')"
      @confirm="onSubgroupCreateConfirm"
    />

    <!-- BloggerDog Content Item Modal -->
    <UiEntityCreationModal
      v-model:open="isItemModalOpen"
      :title="t('fastcat.bloggerDog.actions.createItem')"
      @confirm="onItemCreateConfirm"
    />
  </div>
</template>
