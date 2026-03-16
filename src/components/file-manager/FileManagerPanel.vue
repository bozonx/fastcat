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
      title: cached ? 'Transcription loaded from cache' : 'Transcription completed',
      description: cached
        ? 'Cached transcription was loaded from vardata.'
        : mediaType === 'video'
          ? 'Video audio track was transcribed and saved to vardata cache.'
          : 'Transcription was saved to vardata cache.',
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
  vfs: { readFile: (path) => vfs.readFile(path) },
  loadProjectDirectory,
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

async function onCreateTimeline() {
  const selectedDir =
    uiStore.selectedFsEntry?.kind === 'directory' ? uiStore.selectedFsEntry : null;

  if (selectedDir) {
    await createTimelineInDirectory({
      kind: 'directory',
      name: selectedDir.name,
      path: selectedDir.path ?? '',
      parentPath: selectedDir.parentPath,
      lastModified: selectedDir.lastModified,
      size: selectedDir.size,
      source: selectedDir.source,
      remoteId: selectedDir.remoteId,
      remotePath: selectedDir.remotePath,
      remoteData: selectedDir.remoteData,
    });
    return;
  }

  const createdPath = await createTimeline();
  if (!createdPath) return;

  await projectStore.openTimelineFile(createdPath);
  await timelineStore.loadTimeline();
  void timelineStore.loadTimelineMetadata();
}

function triggerFileUpload() {
  fileInput.value?.click();
}

function onSortModeChange(v: 'name' | 'type') {
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

    const selectedDir =
      uiStore.selectedFsEntry?.kind === 'directory' ? uiStore.selectedFsEntry : null;
    if (!selectedDir || !selectedDir.path) {
      handleFiles(files);
      return;
    }

    handleFiles(files, selectedDir.path);
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
  await loadProjectDirectory();
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

// Sync: refresh the tree when needed
// (Removed watch on fileManagerUpdateCounter to prevent full tree reloads.
// Tree updates reactively via rootEntries modification in reloadDirectory)
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

    <div
      class="flex flex-col flex-1 min-h-0"
    >
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
          :title="t('videoEditor.fileManager.actions.uploadFiles')"
          @click="triggerFileUpload"
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
          icon="i-heroicons-folder-plus"
          variant="ghost"
          color="neutral"
          size="xs"
          :title="t('videoEditor.fileManager.actions.createFolder')"
          @click="
            onFileAction(
              'createFolder',
              (uiStore.selectedFsEntry?.kind === 'directory'
                ? uiStore.selectedFsEntry
                : null) as FsEntry,
            )
          "
        />

        <div class="ml-auto flex items-center gap-1">

          <UDropdownMenu
            :items="[
              [
                {
                  label: t('videoEditor.fileManager.actions.syncTreeTooltip', 'Refresh file tree'),
                  icon: 'i-heroicons-arrow-path',
                  disabled: isLoading || !projectStore.currentProjectName,
                  onSelect: async () => {
                    await loadProjectDirectory({ fullRefresh: true });
                    uiStore.notifyFileManagerUpdate();
                  },
                },
              ],
              [
                {
                  label: t('videoEditor.fileManager.sort.name', 'Sort by name'),
                  icon:
                    sortMode === 'name' ? 'i-heroicons-check' : 'i-heroicons-bars-3-bottom-left',
                  onSelect: () => onSortModeChange('name'),
                },
                {
                  label: t('videoEditor.fileManager.sort.type', 'Sort by type'),
                  icon:
                    sortMode === 'type' ? 'i-heroicons-check' : 'i-heroicons-bars-3-bottom-left',
                  onSelect: () => onSortModeChange('type'),
                },
              ],
              [
                {
                  label: uiStore.showHiddenFiles
                    ? t('videoEditor.fileManager.actions.hideHiddenFiles', 'Hide hidden files')
                    : t('videoEditor.fileManager.actions.showHiddenFiles', 'Show hidden files'),
                  icon: uiStore.showHiddenFiles ? 'i-heroicons-eye-slash' : 'i-heroicons-eye',
                  onSelect: () => (uiStore.showHiddenFiles = !uiStore.showHiddenFiles),
                },
              ],
            ]"
            :ui="{ content: 'bottom-end' }"
          >
            <UButton
              icon="i-heroicons-ellipsis-horizontal"
              color="neutral"
              variant="ghost"
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
