<script setup lang="ts">
import { ref, inject } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import type { FsEntry } from '~/types/fs';
import FileManagerFiles from '~/components/file-manager/FileManagerFiles.vue';
import FileManagerPanelModals from '~/components/file-manager/FileManagerPanelModals.vue';
import { useFocusStore } from '~/stores/focus.store';
import { useFileManagerActions } from '~/composables/file-manager/useFileManagerActions';
import { useProjectTabsStore } from '~/stores/project-tabs.store';
import { useUiStore } from '~/stores/ui.store';
import { useFileConversionStore } from '~/stores/file-conversion.store';
import { useAudioExtraction } from '~/composables/file-manager/useAudioExtraction';
import { useFileManagerPanelPendingActions } from '~/composables/file-manager/useFileManagerPanelPendingActions';
import { useFileManagerPanelBootstrap } from '~/composables/file-manager/useFileManagerPanelBootstrap';
import { useSttTranscription } from '~/composables/file-manager/useSttTranscription';
import { useFileManagerPanelActions } from '~/composables/file-manager/useFileManagerPanelActions';
import { useAppClipboard } from '~/composables/useAppClipboard';
import UiActionButton from '~/components/ui/UiActionButton.vue';
import { useFileManagerStore, type FileSortField } from '~/stores/file-manager.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { resolveExternalServiceConfig } from '~/utils/external-integrations';
import { computed } from 'vue';

const props = defineProps<{
  foldersOnly?: boolean;
  isFilesPage?: boolean;
  compact?: boolean;
  hideActions?: boolean;
  instanceId?: string;
  isExternal?: boolean;
  hideFocusFrame?: boolean;
}>();

const instanceId = props.instanceId || 'left';

const emit = defineEmits<{
  (e: 'select', entry: FsEntry): void;
}>();

const { t } = useI18n();
const toast = useToast();

const projectStore = useProjectStore();
const timelineStore = useTimelineStore();
const fileManagerStore =
  (inject('fileManagerStore', null) as ReturnType<typeof useFileManagerStore> | null) ||
  useFileManagerStore();
const focusStore = useFocusStore();
const uiStore = useUiStore();
const conversionStore = useFileConversionStore();
const { extractAudio } = useAudioExtraction();
const { addFileTab, setActiveTab } = useProjectTabsStore();
const runtimeConfig = useRuntimeConfig();
const workspaceStore = useWorkspaceStore();

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
  vfs,
} = fileManager;

const fileInput = ref<HTMLInputElement | null>(null);

const stt = useSttTranscription({
  vfs: { getFile: (path) => vfs.getFile(path) },
  fastcatAccountApiUrl: computed(() => runtimeConfig.public.fastcatAccountApiUrl as string),
  onSuccess: ({ mediaType }) => {
    toast.add({
      title: t('videoEditor.fileManager.audio.transcriptionCompleted', 'Transcription completed'),
      description:
        mediaType === 'video'
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
  modalOpen: transcriptionModalOpen,
  language: transcriptionLanguage,
  errorMessage: transcriptionError,
  isTranscribing,
  pendingEntry: transcriptionEntry,
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
  copyEntry,
  moveEntry,
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

const rootEntry: FsEntry = {
  kind: 'directory',
  name: '/',
  path: '',
  parentPath: '',
  lastModified: 0,
  size: 0,
  source: 'local',
};

const rootContextMenuItems = computed(() => {
  if (!projectStore.currentProjectName || props.hideActions) return [];

  const menu: any[][] = [
    [
      {
        label: t('videoEditor.fileManager.actions.uploadFiles', 'Upload files'),
        icon: 'i-heroicons-arrow-up-tray',
        onSelect: () => onFileAction('upload', rootEntry),
      },
      {
        label: t('videoEditor.fileManager.actions.createFolder', 'Create Folder'),
        icon: 'i-heroicons-folder-plus',
        onSelect: () => onFileAction('createFolder', rootEntry),
      },
      {
        label: t('videoEditor.fileManager.actions.createTimeline', 'Create Timeline'),
        icon: 'i-heroicons-document-plus',
        onSelect: () => onFileAction('createTimeline', rootEntry),
      },
      {
        label: t('videoEditor.fileManager.actions.createMarkdown', 'Create Markdown document'),
        icon: 'i-heroicons-document-text',
        onSelect: () => onFileAction('createMarkdown', rootEntry),
      },
    ],
    [
      {
        label: t('videoEditor.fileManager.actions.syncTreeTooltip', 'Refresh file tree'),
        icon: 'i-heroicons-arrow-path',
        disabled: isLoading.value,
        onSelect: () => onFileAction('refresh', rootEntry),
      },
    ],
  ];

  const clipboardStore = useAppClipboard();
  if (clipboardStore.hasFileManagerPayload) {
    if (menu[0]) {
      menu[0].push({
        label: t('common.paste', 'Paste'),
        icon: 'i-heroicons-clipboard',
        onSelect: () => onFileActionBase('paste', rootEntry),
      });
    }
  }

  return menu;
});

// toolbarMenuItems removed
const sortFields: { label: string; value: FileSortField }[] = [
  { label: t('common.name', 'Name'), value: 'name' },
  { label: t('common.type', 'Type'), value: 'type' },
  { label: t('common.size', 'Size'), value: 'size' },
  { label: t('common.created', 'Created'), value: 'created' },
  { label: t('common.modified', 'Modified'), value: 'modified' },
];

const menuItems = computed(() => {
  const items: any[][] = [];

  const commonActions = [
    {
      label: t('common.refresh', 'Refresh'),
      icon: 'i-heroicons-arrow-path',
      disabled: isLoading.value,
      onSelect: () => loadProjectDirectory({ fullRefresh: true }),
    },
    {
      label: uiStore.showHiddenFiles
        ? t('videoEditor.fileManager.actions.hideHiddenFiles', 'Hide hidden files')
        : t('videoEditor.fileManager.actions.showHiddenFiles', 'Show hidden files'),
      icon: uiStore.showHiddenFiles ? 'i-heroicons-eye-slash' : 'i-heroicons-eye',
      onSelect: () => {
        uiStore.showHiddenFiles = !uiStore.showHiddenFiles;
      },
    },
  ];
  items.push(commonActions);

  const fieldsGroup = sortFields.map((f) => ({
    label: f.label,
    icon: fileManagerStore.sortOption.field === f.value ? 'i-heroicons-check' : 'i-heroicons-stop',
    onSelect: () => {
      fileManagerStore.sortOption.field = f.value;
    },
  }));
  items.push(fieldsGroup);

  const isAsc = fileManagerStore.sortOption.order === 'asc';
  const orderToggle = [
    {
      label: isAsc
        ? t('common.toSortDesc', 'To descending')
        : t('common.toSortAsc', 'To ascending'),
      icon: isAsc ? 'i-heroicons-bars-arrow-down' : 'i-heroicons-bars-arrow-up',
      onSelect: () => {
        fileManagerStore.sortOption.order = isAsc ? 'desc' : 'asc';
      },
    },
  ];
  items.push(orderToggle);

  return items;
});

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

async function onCreateMarkdown() {
  await onFileAction('createMarkdown', {
    kind: 'directory',
    name: '/',
    path: '',
    parentPath: '',
    lastModified: 0,
    size: 0,
    source: 'local',
  });
}

function triggerFileUpload() {
  fileInput.value?.click();
}

// onSortModeChange removed

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
  instanceId,
});

useFileManagerPanelBootstrap({
  loadProjectDirectory,
  onRootEntrySelected: (entry) => emit('select', entry),
});
</script>

<template>
  <div
    class="flex flex-col h-full bg-ui-bg-elevated border-r border-ui-border transition-colors duration-200 min-w-0 overflow-hidden relative"
    :class="{
      'panel-focus-frame': !props.hideFocusFrame,
      'panel-focus-frame--active':
        !props.hideFocusFrame && focusStore.isPanelFocused(`dynamic:file-manager:${instanceId}`),
    }"
    @pointerdown.capture="focusStore.setPanelFocus(`dynamic:file-manager:${instanceId}`)"
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

    <!-- Actions Toolbar -->
    <UContextMenu :items="rootContextMenuItems">
      <div
        v-if="projectStore.currentProjectName && !props.hideActions"
        class="flex items-center gap-1 px-2 py-1 bg-ui-bg-accent/30 border-b border-ui-border/50"
      >
        <UButton
          icon="i-heroicons-folder-plus"
          variant="ghost"
          color="neutral"
          size="xs"
          :title="t('videoEditor.fileManager.actions.createFolder', 'Create Folder')"
          @click="onFileAction('createFolder', rootEntry)"
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
          icon="i-heroicons-document-text"
          variant="ghost"
          color="neutral"
          size="xs"
          :title="`${t('videoEditor.fileManager.actions.createMarkdown', 'Create Markdown document')} (In _documents folder)`"
          @click="onCreateMarkdown"
        />
        <UButton
          icon="i-heroicons-arrow-up-tray"
          variant="ghost"
          color="neutral"
          size="xs"
          :title="t('videoEditor.fileManager.actions.uploadFiles', 'Upload files')"
          @click="triggerFileUpload"
        />
      </div>
    </UContextMenu>

    <!-- File List -->
    <FileManagerFiles
      :editing-entry-path="editingEntryPath"
      :folders-only="foldersOnly"
      :is-files-page="isFilesPage"
      :instance-id="instanceId"
      :is-external="isExternal"
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
      :on-copy-entries="(entries) => onFileActionBase('copy', entries)"
      :on-cut-entries="(entries) => onFileActionBase('cut', entries)"
      :on-paste-to-entry="(entry) => onFileActionBase('paste', entry)"
      @commit-rename="commitRename"
      @stop-rename="stopRename"
      @toggle="toggleDirectory"
      @action="onFileAction"
      @select="handleFileManagerFilesSelect"
    />

    <!-- Modals -->
    <FileManagerPanelModals
      :delete-targets="deleteTargets"
      :timelines-using-delete-target="timelinesUsingDeleteTarget"
      :is-delete-confirm-modal-open="isDeleteConfirmModalOpen"
      :transcription-modal-open="transcriptionModalOpen"
      :is-transcribing="isTranscribing"
      :transcription-error="transcriptionError"
      :transcription-entry="transcriptionEntry"
      :transcription-language="transcriptionLanguage"
      @update:is-delete-confirm-modal-open="isDeleteConfirmModalOpen = $event"
      @update:transcription-modal-open="transcriptionModalOpen = $event"
      @update:transcription-language="transcriptionLanguage = $event"
      @delete-confirm="handleDeleteConfirm"
      @submit-transcription="submitTranscription"
    />
  </div>
</template>
