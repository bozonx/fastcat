<script setup lang="ts">
import { ref, inject, onMounted, onUnmounted, computed, nextTick } from 'vue';
import { useRuntimeConfig } from 'nuxt/app';
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
import { useFileConversionStoreActions } from '~/composables/file-conversion/useFileConversionStoreActions';
import { useAudioExtraction } from '~/composables/file-manager/useAudioExtraction';
import { useFileManagerPanelPendingActions } from '~/composables/file-manager/useFileManagerPanelPendingActions';
import { useFileManagerPanelBootstrap } from '~/composables/file-manager/useFileManagerPanelBootstrap';

import { DOCUMENTS_DIR_NAME } from '~/utils/constants';
import { useSttTranscription } from '~/composables/file-manager/useSttTranscription';
import { useFileManagerPanelActions } from '~/composables/file-manager/useFileManagerPanelActions';
import { useAppClipboard } from '~/composables/useAppClipboard';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useSelectionStore } from '~/stores/selection.store';
import UiTooltip from '~/components/ui/UiTooltip.vue';
import { useHotkeyLabel } from '~/composables/useHotkeyLabel';

const props = defineProps<{
  foldersOnly?: boolean;
  isFilesPage?: boolean;
  compact?: boolean;
  hideActions?: boolean;
  instanceId?: string;
  isExternal?: boolean;
  hideFocusFrame?: boolean;
  rootSelectionEntry?: FsEntry | null;
  hideProjectLabel?: boolean;
}>();

const instanceId = props.instanceId || 'left';

const emit = defineEmits<{
  (e: 'select', entry: FsEntry): void;
}>();

const { t } = useI18n();
const toast = useToast();
const runtimeConfig = useRuntimeConfig();

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
const fileManager = useFileManager();
const conversionStore = useFileConversionStore();
const { openConversionModal } = useFileConversionStoreActions(conversionStore, fileManager);
const { extractAudio } = useAudioExtraction();
const { addFileTab, setActiveTab } = useProjectTabsStore();
const clipboardStore = useAppClipboard();
const selectionStore = useSelectionStore();

const { getHotkeyTitle } = useHotkeyLabel();

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
          ? t('videoEditor.fileManager.audio.transcriptionSavedVideoDescription')
          : t('videoEditor.fileManager.audio.transcriptionSavedDescription'),
      color: 'success',
    });
  },
  onError: () => {},
});
const {
  modalOpen: transcriptionModalOpen,
  language: transcriptionLanguage,
  errorMessage: transcriptionError,
  isTranscribing,
  pendingEntry: transcriptionEntry,
  openModal: openTranscriptionModal,
  submitTranscription,
} = stt;

const {
  isDeleteConfirmModalOpen,
  isCreateFolderModalOpen,
  createFolderDefaultName,
  confirmCreateFolder,
  validateFolderCreation,
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
  setFileTreePathExpanded: (path, expanded) => fileManager.setFileTreePathExpanded(path, expanded),
  onFileSelect: (entry) => emit('select', entry),
});

const { handleFileAction: onFileAction, createTimelineInDirectory } = useFileManagerPanelActions({
  vfs,
  loadProjectDirectory: loadProjectDirectory as (opts?: unknown) => Promise<void>,
  reloadDirectory,
  findEntryByPath,
  onFileActionBase: onFileActionBase as (
    action: import('~/composables/file-manager/useFileManagerActions').FileAction,
    entry: FsEntry | FsEntry[],
    getExistingNames?: () => string[],
  ) => void | Promise<void>,
  openTranscriptionModal,
  extractAudio: (entry) => extractAudio(entry, { instanceId, isExternal: props.isExternal }),
  addFileTab,
  setActiveTab,
  onSelect: (entry) => emit('select', entry),
  handleConvert: (entry: FsEntry) => {
    openConversionModal(entry, {
      isExternal: props.isExternal,
      vfs,
      reloadDirectory: fileManager.reloadDirectory,
    });
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

  const menu: unknown[][] = [
    [
      {
        label: t('videoEditor.fileManager.actions.uploadToThisFolder'),
        icon: 'i-heroicons-arrow-up-tray',
        onSelect: () => onFileAction('upload', rootEntry),
      },
      {
        label: getHotkeyTitle(
          t('videoEditor.fileManager.actions.createFolder'),
          'general.createFolder',
        ),
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

async function onCreateTimeline() {
  const createdPath = await createTimeline();
  if (!createdPath) return;

  await projectStore.openTimelineFile(createdPath);
  focusStore.setActiveTimelinePath(createdPath);
  await timelineStore.loadTimeline();
  void timelineStore.loadTimelineMetadata();

  // Expand _timelines folder and refresh file tree
  const parentDir = createdPath.substring(0, createdPath.lastIndexOf('/'));
  if (parentDir) {
    uiStore.setFileTreePathExpanded(parentDir, true);
  }
  await loadProjectDirectory({ fullRefresh: true });
  uiStore.notifyFileManagerUpdate();

  const createdEntry = findEntryByPath(createdPath);
  if (createdEntry) {
    await nextTick();
    selectionStore.selectFsEntryWithUiUpdate(createdEntry, instanceId);
  }
  uiStore.triggerScrollToFileTreeEntry(createdPath);
}

async function onCreateMarkdown() {
  await onFileAction('createMarkdown', {
    kind: 'directory',
    name: DOCUMENTS_DIR_NAME,
    path: DOCUMENTS_DIR_NAME,
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
const isItemModalOpen = ref(false);
const pendingItemParent = ref<FsEntry | null>(null);
const existingBloggerDogNames = ref<string[]>([]);

async function handlePendingBloggerDogCreateSubgroup(entry: FsEntry) {
  pendingSubgroupParent.value = entry;
  if (entry.path) {
    try {
      existingBloggerDogNames.value = await vfs.listEntryNames(entry.path);
    } catch {
      existingBloggerDogNames.value = entry.children?.map((c) => c.name) || [];
    }
  } else {
    existingBloggerDogNames.value = entry.children?.map((c) => c.name) || [];
  }
  isSubgroupModalOpen.value = true;
}

async function handlePendingBloggerDogCreateItem(entry: FsEntry) {
  pendingItemParent.value = entry;
  if (entry.path) {
    try {
      existingBloggerDogNames.value = await vfs.listEntryNames(entry.path);
    } catch {
      existingBloggerDogNames.value = entry.children?.map((c) => c.name) || [];
    }
  } else {
    existingBloggerDogNames.value = entry.children?.map((c) => c.name) || [];
  }
  isItemModalOpen.value = true;
}

function validateSubgroupName(newName: string): string | boolean | null {
  const trimmed = newName.trim();
  if (!trimmed) return false;
  if (existingBloggerDogNames.value.includes(trimmed)) {
    return t('common.validation.exists');
  }
  return true;
}

function validateItemName(newName: string): string | boolean | null {
  const trimmed = newName.trim();
  if (!trimmed) return false;
  const finalName = trimmed.includes('.') ? trimmed : `${trimmed}.txt`;
  if (existingBloggerDogNames.value.includes(finalName)) {
    return t('common.validation.exists');
  }
  return true;
}

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

type FastcatE2eCreateRootFolder = (params: { name: string }) => Promise<void>;
type FastcatE2eRenameEntry = (params: { path: string; newName: string }) => Promise<void>;
type FastcatE2eMoveEntry = (params: { sourcePath: string; targetDirPath: string }) => Promise<void>;
type FastcatE2eDeleteEntry = (params: { path: string }) => Promise<void>;
type FastcatE2eSetFileViewMode = (params: { mode: 'grid' | 'list' }) => Promise<void>;

interface FastcatE2eFileManagerWindow {
  __fastcatE2eCreateRootFolder?: FastcatE2eCreateRootFolder;
  __fastcatE2eRenameEntry?: FastcatE2eRenameEntry;
  __fastcatE2eMoveEntry?: FastcatE2eMoveEntry;
  __fastcatE2eDeleteEntry?: FastcatE2eDeleteEntry;
  __fastcatE2eSetFileViewMode?: FastcatE2eSetFileViewMode;
}

function registerE2eFileManagerHooks() {
  if (!runtimeConfig.public.e2eTest || props.hideActions) return;

  const e2eWindow = window as Window & FastcatE2eFileManagerWindow;

  e2eWindow.__fastcatE2eCreateRootFolder = async ({ name }) => {
    await createFolder(name, '');
    await loadProjectDirectory({ fullRefresh: true });
    uiStore.notifyFileManagerUpdate();
  };

  e2eWindow.__fastcatE2eRenameEntry = async ({ path, newName }) => {
    const target = await findEntryByPath(path);
    if (!target) throw new Error(`File-manager entry not found: ${path}`);
    await renameEntry(target, newName);
    await loadProjectDirectory({ fullRefresh: true });
    uiStore.notifyFileManagerUpdate();
  };

  e2eWindow.__fastcatE2eMoveEntry = async ({ sourcePath, targetDirPath }) => {
    const source = await findEntryByPath(sourcePath);
    if (!source) throw new Error(`File-manager entry not found: ${sourcePath}`);
    await moveEntry({ source, targetDirPath });
    await loadProjectDirectory({ fullRefresh: true });
    uiStore.notifyFileManagerUpdate();
  };

  e2eWindow.__fastcatE2eDeleteEntry = async ({ path }) => {
    const target = await findEntryByPath(path);
    if (!target) throw new Error(`File-manager entry not found: ${path}`);
    await deleteEntry(target);
    await loadProjectDirectory({ fullRefresh: true });
    uiStore.notifyFileManagerUpdate();
  };

  e2eWindow.__fastcatE2eSetFileViewMode = async ({ mode }) => {
    fileManagerStore.setViewMode(mode);
    await nextTick();
  };
}

registerE2eFileManagerHooks();

onMounted(registerE2eFileManagerHooks);

onUnmounted(() => {
  clipboardStore.unregisterFileManagerVfs(instanceId);
  if (runtimeConfig.public.e2eTest) {
    const e2eWindow = window as Window & FastcatE2eFileManagerWindow;
    delete e2eWindow.__fastcatE2eCreateRootFolder;
    delete e2eWindow.__fastcatE2eRenameEntry;
    delete e2eWindow.__fastcatE2eMoveEntry;
    delete e2eWindow.__fastcatE2eDeleteEntry;
    delete e2eWindow.__fastcatE2eSetFileViewMode;
  }
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
    @pointerdown.capture="
      focusStore.setFileManagerPanelFocus(`dynamic:file-manager:${instanceId}`, 'tree')
    "
  >
    <!-- Hidden inputs -->
    <input
      ref="fileInput"
      type="file"
      multiple
      class="hidden"
      data-testid="file-upload-input"
      @change="onFileSelect"
    />
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
        <UiTooltip
          :text="
            getHotkeyTitle(
              `${t('videoEditor.fileManager.actions.createTimeline')} (In _timelines folder)`,
              'general.newTimeline',
            )
          "
        >
          <UiActionButton
            icon="i-heroicons-document-plus"
            variant="ghost"
            color="neutral"
            size="xs"
            @click="onCreateTimeline"
          />
        </UiTooltip>
        <UiTooltip
          :text="`${t('videoEditor.fileManager.actions.createMarkdown')} (In _documents folder)`"
        >
          <UiActionButton
            icon="i-heroicons-document-text"
            variant="ghost"
            color="neutral"
            size="xs"
            @click="onCreateMarkdown"
          />
        </UiTooltip>
        <UiTooltip :text="t('videoEditor.fileManager.actions.uploadFiles')">
          <UiActionButton
            data-testid="file-upload"
            icon="i-heroicons-arrow-up-tray"
            variant="ghost"
            color="neutral"
            size="xs"
            @click="triggerFileUpload"
          />
        </UiTooltip>

        <span
          v-if="!props.isExternal && !props.hideProjectLabel"
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
      :validate-folder="validateFolderCreation"
      :validate-subgroup="validateSubgroupName"
      :validate-item="validateItemName"
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
