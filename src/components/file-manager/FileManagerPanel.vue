<script setup lang="ts">
import { ref, inject, onUnmounted } from 'vue';
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

import { useWorkspaceStore } from '~/stores/workspace.store';
import { resolveExternalServiceConfig } from '~/utils/external-integrations';
import { useSttTranscription } from '~/composables/file-manager/useSttTranscription';
import { useFileManagerPanelActions } from '~/composables/file-manager/useFileManagerPanelActions';
import { useAppClipboard } from '~/composables/useAppClipboard';
import UiActionButton from '~/components/ui/UiActionButton.vue';
import { useFileManagerStore, type FileSortField } from '~/stores/file-manager.store';
import { computed } from 'vue';

const props = defineProps<{
  foldersOnly?: boolean;
  isFilesPage?: boolean;
  compact?: boolean;
  hideActions?: boolean;
  instanceId?: string;
  isExternal?: boolean;
  hideFocusFrame?: boolean;
  rootSelectionEntry?: FsEntry | null;
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
fileManagerStore.setSelectionContext({
  instanceId,
  isExternal: props.isExternal,
});
const focusStore = useFocusStore();
const uiStore = useUiStore();
const conversionStore = useFileConversionStore();
const { extractAudio } = useAudioExtraction();
const { addFileTab, setActiveTab } = useProjectTabsStore();
const runtimeConfig = useRuntimeConfig();
const workspaceStore = useWorkspaceStore();
const clipboardStore = useAppClipboard();

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
  resolveEntryByPath,
  readDirectory,
  reloadDirectory,
  moveEntry,
  copyEntry,
  createTimeline,
  getFileIcon,
  vfs,
} = fileManager;
clipboardStore.registerFileManagerVfs(instanceId, vfs);

const fileInput = ref<HTMLInputElement | null>(null);

const stt = useSttTranscription({
  vfs: { getFile: (path) => vfs.getFile(path) },
  fastcatAccountApiUrl: computed(() => runtimeConfig.public.fastcatAccountApiUrl as string),
  onSuccess: ({ mediaType }) => {
    toast.add({
      title: t('videoEditor.fileManager.audio.transcriptionCompleted'),
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
  isCreateFolderModalOpen,
  createFolderDefaultName,
  confirmCreateFolder,
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
  instanceId,
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
  extractAudio: (entry) => extractAudio(entry, { instanceId, isExternal: props.isExternal }),
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
        label: t('videoEditor.fileManager.actions.uploadFiles'),
        icon: 'i-heroicons-arrow-up-tray',
        onSelect: () => onFileAction('upload', rootEntry),
      },
      {
        label: t('videoEditor.fileManager.actions.createFolder'),
        icon: 'i-heroicons-folder-plus',
        onSelect: () => onFileAction('createFolder', rootEntry),
      },
      {
        label: t('videoEditor.fileManager.actions.createTimeline'),
        icon: 'i-heroicons-document-plus',
        onSelect: () => onFileAction('createTimeline', rootEntry),
      },
      {
        label: t('videoEditor.fileManager.actions.createMarkdown'),
        icon: 'i-heroicons-document-text',
        onSelect: () => onFileAction('createMarkdown', rootEntry),
      },
    ],
    [
      {
        label: t('videoEditor.fileManager.actions.syncTreeTooltip'),
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
        label: t('common.paste'),
        icon: 'i-heroicons-clipboard',
        onSelect: () => onFileActionBase('paste', rootEntry),
      });
    }
  }

  return menu;
});

// toolbarMenuItems removed
const sortFields: { label: string; value: FileSortField }[] = [
  { label: t('common.name'), value: 'name' },
  { label: t('common.type'), value: 'type' },
  { label: t('common.size'), value: 'size' },
  { label: t('common.created'), value: 'created' },
  { label: t('common.modified'), value: 'modified' },
];

const menuItems = computed(() => {
  const items: any[][] = [];

  const commonActions = [
    {
      label: t('common.refresh'),
      icon: 'i-heroicons-arrow-path',
      disabled: isLoading.value,
      onSelect: () => loadProjectDirectory({ fullRefresh: true }),
    },
    {
      label: uiStore.showHiddenFiles
        ? t('videoEditor.fileManager.actions.hideHiddenFiles')
        : t('videoEditor.fileManager.actions.showHiddenFiles'),
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
        ? t('common.toSortDesc')
        : t('common.toSortAsc'),
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
    await handleFiles(files, { targetDirPath: entry.path });
  }
  await loadProjectDirectory({ fullRefresh: true });
  uiStore.notifyFileManagerUpdate();
}

function handleFileManagerFilesSelect(entry: FsEntry) {
  emit('select', entry);
}

// --- BloggerDog Creation (Sidebar) ---
const isSubgroupModalOpen = ref(false);
const pendingSubgroupParent = ref<FsEntry | null>(null);

function handlePendingBloggerDogCreateSubgroup(entry: FsEntry) {
  pendingSubgroupParent.value = entry;
  isSubgroupModalOpen.value = true;
}

const isItemModalOpen = ref(false);
const pendingItemParent = ref<FsEntry | null>(null);

function handlePendingBloggerDogCreateItem(entry: FsEntry) {
  pendingItemParent.value = entry;
  isItemModalOpen.value = true;
}

const bloggerDogApiUrl = computed(() =>
  typeof runtimeConfig.public.bloggerDogApiUrl === 'string'
    ? runtimeConfig.public.bloggerDogApiUrl
    : '',
);

const remoteFilesConfig = computed(() =>
  resolveExternalServiceConfig({
    service: 'files',
    integrations: workspaceStore.userSettings.integrations,
    bloggerDogApiUrl: bloggerDogApiUrl.value,
  }),
);

async function onSubgroupCreateConfirm(name: string) {
  const parent = pendingSubgroupParent.value;
  if (!parent) return;

  try {
    await vfs.createDirectory(`${parent.path}/${name}`);
    await reloadDirectory(parent.path);
    uiStore.notifyFileManagerUpdate();
  } catch (error) {
    toast.add({
      color: 'error',
      title: t('common.error'),
      description: error instanceof Error ? error.message : 'Failed to create subgroup',
    });
  } finally {
    isSubgroupModalOpen.value = false;
    pendingSubgroupParent.value = null;
  }
}

async function onItemCreateConfirm(name: string) {
  const parent = pendingItemParent.value;
  if (!parent) return;

  try {
    const parentPath = parent.path;
    const finalName = name.includes('.') ? name : `${name}.txt`;
    const filePath = parentPath === '/' ? `/${finalName}` : `${parentPath}/${finalName}`;

    // Create empty item by writing an empty blob
    await vfs.writeFile(filePath, new Blob([], { type: 'text/plain' }));

    await reloadDirectory(parent.path);
    uiStore.notifyFileManagerUpdate();
  } catch (error) {
    toast.add({
      color: 'error',
      title: t('common.error'),
      description: error instanceof Error ? error.message : 'Failed to create item',
    });
  } finally {
    isItemModalOpen.value = false;
    pendingItemParent.value = null;
  }
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
  onPasteTarget: async (entry) => {
    await onFileActionBase('paste', entry);
  },
  handlePendingBloggerDogCreateSubgroup,
  handlePendingBloggerDogCreateItem,
  instanceId,
});

onUnmounted(() => {
  clipboardStore.unregisterFileManagerVfs(instanceId);
});

useFileManagerPanelBootstrap({
  loadProjectDirectory,
  onRootEntrySelected: (entry) => emit('select', entry),
  shouldSelectRoot: () => !fileManagerStore.selectedFolder,
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
          :title="t('videoEditor.fileManager.actions.createFolder')"
          @click="onFileAction('createFolder', rootEntry)"
        />
        <UButton
          icon="i-heroicons-document-plus"
          variant="ghost"
          color="neutral"
          size="xs"
          :title="`${t('videoEditor.fileManager.actions.createTimeline')} (In _timelines folder)`"
          @click="onCreateTimeline"
        />
        <UButton
          icon="i-heroicons-document-text"
          variant="ghost"
          color="neutral"
          size="xs"
          :title="`${t('videoEditor.fileManager.actions.createMarkdown')} (In _documents folder)`"
          @click="onCreateMarkdown"
        />
        <UButton
          icon="i-heroicons-arrow-up-tray"
          variant="ghost"
          color="neutral"
          size="xs"
          :title="t('videoEditor.fileManager.actions.uploadFiles')"
          @click="triggerFileUpload"
        />

        <span
          v-if="!props.isExternal"
          class="ml-auto text-[10px] font-bold uppercase tracking-wider text-ui-text-muted/80 px-1 select-none"
        >
          {{ t('videoEditor.fileManager.projectRoot.project') }}
        </span>
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
      :resolve-entry-by-path="resolveEntryByPath"
      :media-cache="fileManager.mediaCache"
      :move-entry="moveEntry"
      :copy-entry="copyEntry"
      :handle-files="handleFiles"
      :vfs="vfs"
      :on-copy-entries="(entries) => onFileActionBase('copy', entries)"
      :on-cut-entries="(entries) => onFileActionBase('cut', entries)"
      :on-paste-to-entry="(entry) => onFileActionBase('paste', entry)"
      :root-selection-entry="props.rootSelectionEntry"
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
      :is-folder-modal-open="isCreateFolderModalOpen"
      :is-subgroup-modal-open="isSubgroupModalOpen"
      :is-item-modal-open="isItemModalOpen"
      :folder-default-name="createFolderDefaultName"
      :is-transcribing="isTranscribing"
      :transcription-error="transcriptionError"
      :transcription-entry="transcriptionEntry"
      :transcription-language="transcriptionLanguage"
      @update:is-delete-confirm-modal-open="isDeleteConfirmModalOpen = $event"
      @update:transcription-modal-open="transcriptionModalOpen = $event"
      @update:transcription-language="transcriptionLanguage = $event"
      @update:is-folder-modal-open="isCreateFolderModalOpen = $event"
      @update:is-subgroup-modal-open="isSubgroupModalOpen = $event"
      @update:is-item-modal-open="isItemModalOpen = $event"
      @delete-confirm="handleDeleteConfirm"
      @submit-transcription="submitTranscription"
      @folder-confirm="confirmCreateFolder"
      @subgroup-confirm="onSubgroupCreateConfirm"
      @item-confirm="onItemCreateConfirm"
    />
  </div>
</template>
