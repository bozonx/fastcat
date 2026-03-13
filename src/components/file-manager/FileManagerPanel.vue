<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import type { FsEntry } from '~/types/fs';
import FileManagerFiles from '~/components/file-manager/FileManagerFiles.vue';
import FileManagerPanelModals from '~/components/file-manager/FileManagerPanelModals.vue';
import { useFocusStore } from '~/stores/focus.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useFileManagerActions } from '~/composables/fileManager/useFileManagerActions';
import type { FileAction as FileActionBase } from '~/composables/fileManager/useFileManagerActions';
import { useProxyStore } from '~/stores/proxy.store';
import { createTimelineCommand } from '~/file-manager/application/fileManagerCommands';
import { useProjectTabs } from '~/composables/project/useProjectTabs';
import {
  getMediaTypeFromFilename,
  getMimeTypeFromFilename,
  isOpenableProjectFileName,
} from '~/utils/media-types';
import { useUiStore } from '~/stores/ui.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useFileConversion } from '~/composables/fileManager/useFileConversion';
import { useAudioExtraction } from '~/composables/fileManager/useAudioExtraction';
import { useFileManagerPanelPendingActions } from '~/composables/fileManager/useFileManagerPanelPendingActions';
import { transcribeProjectAudioFile } from '~/utils/stt';
import { resolveExternalServiceConfig } from '~/utils/external-integrations';

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
const workspaceStore = useWorkspaceStore();
const selectionStore = useSelectionStore();
const proxyStore = useProxyStore();
const fileConversion = useFileConversion();
const { extractAudio } = useAudioExtraction();
const { addFileTab, setActiveTab } = useProjectTabs();
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
  createTimeline,
  getFileIcon,
  sortMode,
  setSortMode,
  vfs,
} = fileManager;

const fileInput = ref<HTMLInputElement | null>(null);
const sttTranscriptionModalOpen = ref(false);
const sttTranscriptionLanguage = ref('');
const sttTranscriptionError = ref('');
const sttTranscribing = ref(false);
const sttTranscriptionEntry = ref<FsEntry | null>(null);

const sttConfig = computed(() =>
  resolveExternalServiceConfig({
    service: 'stt',
    integrations: workspaceStore.userSettings.integrations,
    fastcatPublicadorBaseUrl:
      typeof runtimeConfig.public.fastcatPublicadorBaseUrl === 'string'
        ? runtimeConfig.public.fastcatPublicadorBaseUrl
        : '',
  }),
);

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
  setFileTreePathExpanded: (path, expanded) => {
    const projectName = projectStore.currentProjectName;
    if (projectName) uiStore.setFileTreePathExpanded(projectName, path, expanded);
  },
  onFileSelect: (entry) => emit('select', entry),
});

type FileAction =
  | FileActionBase
  | 'refresh'
  | 'createMarkdown'
  | 'createTimeline'
  | 'openAsPanelCut'
  | 'openAsPanelSound'
  | 'openAsProjectTab'
  | 'uploadRemote'
  | 'transcribe'
  | 'extractAudio';

function isTranscribableMediaFile(entry: FsEntry): boolean {
  if (entry.kind !== 'file' || entry.source === 'remote') return false;

  const mediaType = getMediaTypeFromFilename(entry.name);

  return (
    (mediaType === 'audio' || mediaType === 'video') &&
    Boolean(sttConfig.value) &&
    Boolean(workspaceStore.workspaceHandle) &&
    Boolean(projectStore.currentProjectId) &&
    Boolean(entry.path)
  );
}

function openTranscriptionModal(entry: FsEntry) {
  sttTranscriptionEntry.value = entry;
  sttTranscriptionLanguage.value = '';
  sttTranscriptionError.value = '';
  sttTranscriptionModalOpen.value = true;
}

async function submitTranscription() {
  const entry = sttTranscriptionEntry.value;

  if (
    !entry ||
    entry.kind !== 'file' ||
    !workspaceStore.workspaceHandle ||
    !projectStore.currentProjectId
  ) {
    return;
  }

  sttTranscribing.value = true;
  sttTranscriptionError.value = '';

  try {
    const mediaType = getMediaTypeFromFilename(entry.name);
    const file = await vfs.getFile(entry.path);
    if (!file) throw new Error('Failed to access file');
    const request: SttTranscriptionRequest = {
      file,
      filePath: entry.path,
      fileName: entry.name,
      fileType: getMimeTypeFromFilename(entry.name),
      language: sttTranscriptionLanguage.value,
      fastcatPublicadorBaseUrl:
        typeof runtimeConfig.public.fastcatPublicadorBaseUrl === 'string'
          ? runtimeConfig.public.fastcatPublicadorBaseUrl
          : '',
      projectId: projectStore.currentProjectId!,
      userSettings: workspaceStore.userSettings,
      workspaceHandle: workspaceStore.workspaceHandle!,
      resolvedStorageTopology: workspaceStore.resolvedStorageTopology,
    };

    const result = await transcribeProjectAudioFile(request);

    sttTranscriptionModalOpen.value = false;

    toast.add({
      title: result.cached ? 'Transcription loaded from cache' : 'Transcription completed',
      description: result.cached
        ? 'Cached transcription was loaded from vardata.'
        : mediaType === 'video'
          ? 'Video audio track was transcribed and saved to vardata cache.'
          : 'Transcription was saved to vardata cache.',
      color: 'success',
    });
  } catch (error: unknown) {
    sttTranscriptionError.value =
      error instanceof Error ? error.message : 'Failed to transcribe media';
  } finally {
    sttTranscribing.value = false;
  }
}

async function onFileAction(action: string, entry: FsEntry | FsEntry[]) {
  if (Array.isArray(entry)) {
    if (action === 'delete') {
      onFileActionBase('delete', entry);
      return;
    }
    if (['createProxy', 'cancelProxy', 'deleteProxy'].includes(action)) {
      onFileActionBase(action as any, entry);
      return;
    }
    if (action === 'extractAudio') {
      for (const e of entry) {
        if (e.kind === 'file') void extractAudio(e);
      }
      return;
    }
    return;
  }

  if (action === 'refresh') {
    void loadProjectDirectory({ fullRefresh: true });
  } else if (action === 'createFolder') {
    const target: FsEntry = entry ?? {
      kind: 'directory',
      name: projectStore.currentProjectName ?? '',
      path: '',
    };
    if (target.path) {
      uiStore.setFileTreePathExpanded(projectStore.currentProjectName!, target.path, true);
    }
    onFileActionBase('createFolder', target, () =>
      (target.children ?? []).map((child) => child.name),
    );
  } else if (action === 'createTimeline') {
    if (entry.kind === 'directory') {
      if (entry.path) {
        uiStore.setFileTreePathExpanded(projectStore.currentProjectName!, entry.path, true);
      }
      await createTimelineInDirectory(entry);
    }
  } else if (action === 'createMarkdown') {
    if (entry.kind === 'directory') {
      if (entry.path) {
        uiStore.setFileTreePathExpanded(projectStore.currentProjectName!, entry.path, true);
      }
      onFileActionBase('createMarkdown', entry);
    }
  } else if (action === 'openAsPanelCut' || action === 'openAsPanelSound') {
    if (entry.kind !== 'file' || !isOpenableProjectFileName(entry.name)) return;
    const view = action === 'openAsPanelCut' ? 'cut' : 'sound';
    if (view === 'cut') {
      projectStore.goToCut();
    } else {
      projectStore.goToSound();
    }
    const mediaType = getMediaTypeFromFilename(entry.name);
    if (mediaType === 'text') {
      try {
        const blob = await vfs.readFile(entry.path);
        const content = await blob.text();
        projectStore.addTextPanel(entry.path, content, entry.name, undefined, undefined, view);
      } catch {
        projectStore.addTextPanel(entry.path, '', entry.name, undefined, undefined, view);
      }
    } else if (['video', 'audio', 'image'].includes(mediaType)) {
      projectStore.addMediaPanel(entry, mediaType as any, entry.name, undefined, undefined, view);
    }
  } else if (action === 'openAsProjectTab') {
    if (entry.kind !== 'file' || !entry.path || !isOpenableProjectFileName(entry.name)) return;
    const tabId = addFileTab({ filePath: entry.path, fileName: entry.name });
    setActiveTab(tabId);
  } else if (action === 'createOtioVersion') {
    onFileActionBase('createOtioVersion', entry);
  } else if (action === 'createProxyForFolder') {
    if (entry.kind === 'directory' && entry.path !== undefined) {
      const dirHandle = await projectStore.getDirectoryHandleByPath(entry.path);
      if (!dirHandle) return;

      void proxyStore.generateProxiesForFolder({
        dirHandle,
        dirPath: entry.path,
      });
    }
  } else if (action === 'cancelProxyForFolder') {
    if (entry.kind === 'directory' && entry.path !== undefined) {
      const generatingProxies = proxyStore.generatingProxies;
      for (const p of generatingProxies) {
        if (p.startsWith(`${entry.path}/`)) {
          const rel = p.slice(entry.path.length + 1);
          if (!rel.includes('/')) {
            void proxyStore.cancelProxyGeneration(p);
          }
        }
      }
    }
  } else if (action === 'convertFile') {
    if (entry.kind === 'file') {
      void fileConversion.openConversionModal(entry);
    }
  } else if (action === 'uploadRemote') {
    if (entry.kind === 'file' && entry.source !== 'remote') {
      uiStore.remoteExchangeLocalEntry = entry;
      uiStore.remoteExchangeModalOpen = true;
    }
  } else if (action === 'transcribe') {
    openTranscriptionModal(entry);
  } else if (action === 'extractAudio') {
    if (entry.kind === 'file') void extractAudio(entry);
  } else {
    onFileActionBase(action as FileActionBase, entry);
  }
}

async function createTimelineInDirectory(entry: FsEntry) {
  if (entry.kind !== 'directory') return;
  try {
    const createdPath = await createTimelineCommand({
      vfs,
      timelinesDirName: entry.path || undefined,
    });

    await loadProjectDirectory();

    const createdEntry = createdPath ? findEntryByPath(createdPath) : null;
    if (createdEntry) {
      uiStore.selectedFsEntry = {
        kind: createdEntry.kind,
        name: createdEntry.name,
        path: createdEntry.path,
      };
      selectionStore.selectFsEntry(createdEntry);
      emit('select', createdEntry);
    }

    if (createdPath) {
      await projectStore.openTimelineFile(createdPath);
      await timelineStore.loadTimeline();
      void timelineStore.loadTimelineMetadata();
    }
  } catch (e: unknown) {
    console.error('[FileManagerPanel] Failed to create timeline', e);
    toast.add({
      color: 'red',
      title: 'Timeline error',
      description: e instanceof Error ? e.message : 'Failed to create timeline',
    });
  }
}

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

watch(
  () => projectStore.currentProjectName,
  async (name) => {
    if (name) {
      uiStore.restoreFileTreeStateOnce(name);
    }
    await loadProjectDirectory();

    if (name) {
      const rootEntry: FsEntry = {
        kind: 'directory',
        name,
        path: '',
      };
      uiStore.selectedFsEntry = rootEntry;
      selectionStore.selectFsEntry(rootEntry);
      emit('select', rootEntry);
    }
  },
  { immediate: true },
);

// Sync: refresh the tree when needed
// (Removed watch on fileManagerUpdateCounter to prevent full tree reloads.
// Tree updates reactively via rootEntries modification in reloadDirectory)
</script>

<template>
  <div
    class="flex flex-col h-full bg-ui-bg-elevated border-r border-ui-border transition-colors duration-200 min-w-0 overflow-hidden relative"
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
      :class="{
        'outline-2 outline-primary-500/60 -outline-offset-2 z-10':
          focusStore.isPanelFocused('left'),
      }"
      @pointerdown.capture="focusStore.setTempFocus('left')"
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

        <div class="ml-auto flex items-center">
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
