<script setup lang="ts">
import { ref } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import type { FsEntry } from '~/types/fs';
import FileManagerFiles from '~/components/file-manager/FileManagerFiles.vue';
import FileManagerPanelModals from '~/components/file-manager/FileManagerPanelModals.vue';
import { useFocusStore } from '~/stores/focus.store';
import { useFileManagerActions } from '~/composables/fileManager/useFileManagerActions';
import { useProjectTabsStore } from '~/stores/tabs.store';
import { useUiStore } from '~/stores/ui.store';
import { useFileConversionStore } from '~/stores/file-conversion.store';
import { useAudioExtraction } from '~/composables/fileManager/useAudioExtraction';
import { useFileManagerPanelPendingActions } from '~/composables/fileManager/useFileManagerPanelPendingActions';
import { useFileManagerPanelBootstrap } from '~/composables/fileManager/useFileManagerPanelBootstrap';
import { useFileManagerPanelStt } from '~/composables/fileManager/useFileManagerPanelStt';
import { useFileManagerPanelActions } from '~/composables/fileManager/useFileManagerPanelActions';

const props = defineProps<{
  foldersOnly?: boolean;
  disableSort?: boolean;
  isFilesPage?: boolean;
}>();

const emit = defineEmits<{
  (e: 'select', entry: FsEntry): void;
}>();

const { t } = useI18n();
const toast = useToast();

const projectStore = useProjectStore();
const timelineStore = useTimelineStore();
const focusStore = useFocusStore();
const uiStore = useUiStore();
const conversionStore = useFileConversionStore();
const { extractAudio } = useAudioExtraction();
const { addFileTab, setActiveTab } = useProjectTabsStore();
const runtimeConfig = useRuntimeConfig();

const fileManager = useFileManager();
const {
  rootEntries,
  isLoading,
  isApiSupported,
  loadProjectDirectory,
  toggleDirectory,
  handleFiles,
  createFolder,
  deleteEntry,
  renameEntry,
  findEntryByPath,
  readDirectory,
  reloadDirectory,
  moveEntry,
  copyEntry,
  createTimeline,
  getFileIcon,
  sortMode,
  setSortMode,
  vfs,
} = fileManager;

const fileInput = ref<HTMLInputElement | null>(null);

const fastcatPublicadorBaseUrl =
  typeof runtimeConfig.public.fastcatPublicadorBaseUrl === 'string'
    ? runtimeConfig.public.fastcatPublicadorBaseUrl
    : '';

const stt = useFileManagerPanelStt({
  vfs: { getFile: (path) => vfs.getFile(path) },
  fastcatPublicadorBaseUrl,
  onSuccess: ({ cached, mediaType }) => {
    toast.add({
      title: cached
        ? t('videoEditor.fileManager.audio.transcriptionCached', 'Using cached transcription')
        : t('videoEditor.fileManager.audio.transcriptionCompleted', 'Transcription completed'),
      description: cached
        ? t(
            'videoEditor.fileManager.audio.transcriptionCachedDescription',
            'Cached transcription was loaded from vardata.',
          )
        : mediaType === 'video'
          ? t(
              'videoEditor.fileManager.audio.transcriptionSavedVideoDescription',
              'Video audio track was transcribed and saved to vardata cache.',
            )
          : t(
              'videoEditor.fileManager.audio.transcriptionSavedDescription',
              'Transcription was saved to vardata cache.',
            ),
      color: 'success',
    });
  },
  onError: () => {},
});
const {
  sttConfig,
  modalOpen: sttTranscriptionModalOpen,
  language: sttTranscriptionLanguage,
  errorMessage: sttTranscriptionError,
  isTranscribing: sttTranscribing,
  pendingEntry: sttTranscriptionEntry,
  isTranscribableMediaFile,
  openModal: openTranscriptionModal,
  submitTranscription,
} = stt;

const {
  isDeleteConfirmModalOpen,
  editingEntryPath,
  commitRename,
  stopRename,
  startRename,
  deleteTargets,
  timelinesUsingDeleteTarget,
  directoryUploadTarget,
  directoryUploadInput,
  openDeleteConfirmModal,
  handleDeleteConfirm,
  onFileAction: onFileActionBase,
} = useFileManagerActions({
  createFolder,
  renameEntry,
  deleteEntry,
  loadProjectDirectory,
  handleFiles,
  mediaCache: fileManager.mediaCache,
  vfs,
  findEntryByPath,
  readDirectory,
  reloadDirectory,
  notifyFileManagerUpdate: () => uiStore.notifyFileManagerUpdate(),
  setFileTreePathExpanded: (path, expanded) => uiStore.setFileTreePathExpanded(path, expanded),
  onFileSelect: (entry) => emit('select', entry),
});

const { handleFileAction: onFileAction, createTimelineInDirectory } = useFileManagerPanelActions({
  vfs,
  loadProjectDirectory,
  reloadDirectory,
  findEntryByPath,
  onFileActionBase: onFileActionBase as any,
  openTranscriptionModal,
  extractAudio,
  addFileTab,
  setActiveTab,
  onSelect: (entry) => emit('select', entry),
  handleConvert: (entry: FsEntry) => {
    conversionStore.openConversionModal(entry);
  },
});

const toolbarMenuItems = computed(() => [
  [
    {
      label: t('videoEditor.fileManager.sort.name', 'Sort by name'),
      color: sortMode.value === 'name' ? 'primary' : 'neutral',
      onSelect: () => onSortModeChange('name'),
    },
    {
      label: t('videoEditor.fileManager.sort.type', 'Sort by type'),
      color: sortMode.value === 'type' ? 'primary' : 'neutral',
      onSelect: () => onSortModeChange('type'),
    },
  ],
  [
    {
      label: uiStore.showHiddenFiles
        ? t('videoEditor.fileManager.actions.hideHiddenFiles', 'Hide hidden files')
        : t('videoEditor.fileManager.actions.showHiddenFiles', 'Show hidden files'),
      icon: uiStore.showHiddenFiles ? 'i-heroicons-eye-slash' : 'i-heroicons-eye',
      onSelect: () => {
        uiStore.showHiddenFiles = !uiStore.showHiddenFiles;
        void loadProjectDirectory({ fullRefresh: true });
        uiStore.notifyFileManagerUpdate();
      },
    },
    {
      label: t('videoEditor.fileManager.actions.syncTreeTooltip', 'Refresh file tree'),
      icon: 'i-heroicons-arrow-path',
      onSelect: () =>
        onFileAction('refresh', {
          kind: 'directory',
          name: projectStore.currentProjectName ?? '',
          path: '',
          parentPath: '',
          lastModified: 0,
          size: 0,
          source: 'local',
        } as FsEntry),
    },
  ],
]);

async function onCreateTimeline() {
  const createdPath = await createTimeline();
  if (!createdPath) return;

  await projectStore.openTimelineFile(createdPath);
  await timelineStore.loadTimeline();
  void timelineStore.loadTimelineMetadata();

  // Expand _timelines folder and refresh file tree
  const parentDir = createdPath.substring(0, createdPath.lastIndexOf('/'));
  if (parentDir) {
    uiStore.setFileTreePathExpanded(parentDir, true);
  }
  await loadProjectDirectory({ fullRefresh: true });
  uiStore.notifyFileManagerUpdate();
  uiStore.triggerScrollToFileTreeEntry(createdPath);
}

function triggerFileUpload() {
  fileInput.value?.click();
}

function onSortModeChange(v: 'name' | 'type') {
  setSortMode(v);
  const selectedPath = uiStore.selectedFsEntry?.path;
  void loadProjectDirectory({ fullRefresh: true }).then(() => {
    uiStore.notifyFileManagerUpdate();
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

  if (!entry.path) {
    await handleFiles(files);
  } else {
    await handleFiles(files, entry.path);
  }
  await loadProjectDirectory({ fullRefresh: true });
  uiStore.notifyFileManagerUpdate();
}

function handleFileManagerFilesSelect(entry: FsEntry) {
  emit('select', entry);
}

useFileManagerPanelPendingActions({
  openDeleteConfirmModal,
  startRename,
  onCreateFolder: (entry) => onFileAction('createFolder', entry),
  createTimelineInDirectory,
  createMarkdownInDirectory: async (entry) => {
    await onFileAction('createMarkdown', entry);
  },
  createOtioVersion: (entry) => onFileActionBase('createOtioVersion', entry),
});

useFileManagerPanelBootstrap({
  loadProjectDirectory,
  onRootEntrySelected: (entry) => emit('select', entry),
});
</script>

<template>
  <div
    class="panel-focus-frame flex flex-col h-full bg-ui-bg-elevated border-r border-ui-border transition-colors duration-200 min-w-0 overflow-hidden relative"
    :class="{
      'panel-focus-frame--active': focusStore.isPanelFocused('left'),
    }"
    @pointerdown.capture="focusStore.setTempFocus('left')"
  >
    <!-- Hidden inputs -->
    <input ref="fileInput" type="file" multiple class="hidden" @change="onFileSelect" />
    <input
      ref="directoryUploadInput"
      type="file"
      multiple
      class="hidden"
      @change="onDirectoryFileSelect"
    />

    <div class="flex flex-col flex-1 min-h-0">
      <!-- Actions Toolbar -->
      <div
        v-if="projectStore.currentProjectName"
        class="flex items-center gap-1 px-2 py-1 bg-ui-bg-accent/30 border-b border-ui-border/50"
      >
        <UButton
          icon="i-heroicons-arrow-up-tray"
          variant="ghost"
          color="neutral"
          size="xs"
          :title="`${t('videoEditor.fileManager.actions.uploadFiles')} (Auto-detect folder)`"
          @click="triggerFileUpload"
        />
        <UButton
          icon="i-heroicons-document-plus"
          variant="ghost"
          color="neutral"
          size="xs"
          :title="`${t('videoEditor.fileManager.actions.createTimeline', 'Create Timeline')} (In _timelines folder)`"
          @click="onCreateTimeline"
        />
        <UButton
          icon="i-heroicons-folder-plus"
          variant="ghost"
          color="neutral"
          size="xs"
          :title="`${t('videoEditor.fileManager.actions.createFolder')} (In root folder)`"
          @click="
            onFileAction('createFolder', {
              kind: 'directory',
              name: '',
              path: '',
              parentPath: '',
              lastModified: 0,
              size: 0,
              source: 'local',
            } as FsEntry)
          "
        />
        <div class="ml-auto">
          <UDropdownMenu :items="toolbarMenuItems" :ui="{ content: 'w-56' }">
            <UButton
              icon="i-heroicons-ellipsis-horizontal"
              variant="ghost"
              color="neutral"
              size="xs"
            />
          </UDropdownMenu>
        </div>
      </div>

      <!-- File List -->
      <FileManagerFiles
        :editing-entry-path="editingEntryPath"
        :folders-only="foldersOnly"
        :is-files-page="isFilesPage"
        :is-dragging="false"
        :is-loading="isLoading"
        :is-api-supported="isApiSupported"
        :root-entries="rootEntries"
        :get-file-icon="getFileIcon"
        :find-entry-by-path="findEntryByPath"
        :media-cache="fileManager.mediaCache"
        :move-entry="moveEntry"
        :copy-entry="copyEntry"
        :handle-files="handleFiles"
        @commit-rename="commitRename"
        @stop-rename="stopRename"
        @toggle="toggleDirectory"
        @action="onFileAction"
        @select="handleFileManagerFilesSelect"
      />
    </div>

    <!-- Modals -->
    <FileManagerPanelModals
      :delete-targets="deleteTargets"
      :timelines-using-delete-target="timelinesUsingDeleteTarget"
      :is-delete-confirm-modal-open="isDeleteConfirmModalOpen"
      :stt-transcription-modal-open="sttTranscriptionModalOpen"
      :stt-transcribing="sttTranscribing"
      :stt-transcription-error="sttTranscriptionError"
      :stt-transcription-entry="sttTranscriptionEntry"
      :stt-transcription-language="sttTranscriptionLanguage"
      @update:is-delete-confirm-modal-open="isDeleteConfirmModalOpen = $event"
      @update:stt-transcription-modal-open="sttTranscriptionModalOpen = $event"
      @update:stt-transcription-language="sttTranscriptionLanguage = $event"
      @delete-confirm="handleDeleteConfirm"
      @submit-transcription="submitTranscription"
    />
  </div>
</template>
