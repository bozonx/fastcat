<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import type { FsEntry } from '~/types/fs';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import FileManagerFiles from '~/components/file-manager/FileManagerFiles.vue';
import FileManagerEffects from '~/components/file-manager/FileManagerEffects.vue';
import FileManagerHistory from '~/components/file-manager/FileManagerHistory.vue';
import TimelineToolbar from '~/components/timeline/TimelineToolbar.vue';
import { useFocusStore } from '~/stores/focus.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useFileManagerActions } from '~/composables/fileManager/useFileManagerActions';
import { useProxyStore } from '~/stores/proxy.store';
import { useProjectTabs } from '~/composables/project/useProjectTabs';
import { getMediaTypeFromFilename, isOpenableProjectFileName } from '~/utils/media-types';
import { useFileConversion } from '~/composables/fileManager/useFileConversion';
import { createTimelineCommand } from '~/file-manager/application/fileManagerCommands';

import type { FileAction } from '~/composables/fileManager/useFileManagerActions';

const _props = defineProps<{
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
const selectionStore = useSelectionStore();
const proxyStore = useProxyStore();
const { addFileTab, setActiveTab } = useProjectTabs();

const fileConversion = useFileConversion();

const fileManager = useFileManager();
const {
  rootEntries,
  isLoading,
  isApiSupported,
  getProjectRootDirHandle,
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
} = fileManager;

const activeTab = ref('files');
const isDragging = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

const directoryUploadTarget = ref<FsEntry | null>(null);
const directoryUploadInput = ref<HTMLInputElement | null>(null);

const {
  isDeleteConfirmModalOpen,
  editingEntryPath,
  commitRename,
  stopRename,
  startRename,
  deleteTargets,
  timelinesUsingDeleteTarget,
  handleDeleteConfirm,
  onFileAction: onFileActionBase,
} = useFileManagerActions({
  createFolder,
  renameEntry,
  deleteEntry,
  loadProjectDirectory,
  handleFiles,
  mediaCache: fileManager.mediaCache,
  getProjectRootDirHandle,
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

// openFileInfoModal is now handled entirely within useFileManagerActions

function onFileAction(
  action:
    | FileAction
    | 'refresh'
    | 'upload'
    | 'openAsPanel'
    | 'openAsProjectTab'
    | 'convertFile'
    | 'createProxyForFolder'
    | 'cancelProxyForFolder'
    | 'createTimeline'
    | 'createMarkdown'
    | 'addToTimeline',
  entry: FsEntry | FsEntry[],
) {
  if (Array.isArray(entry)) {
    if (action === 'delete') {
      onFileActionBase('delete', entry);
      return;
    }
    if (action === 'createProxy') {
      onFileActionBase('createProxy', entry);
      return;
    }
    if (action === 'cancelProxy') {
      onFileActionBase('cancelProxy', entry);
      return;
    }
    if (action === 'deleteProxy') {
      onFileActionBase('deleteProxy', entry);
      return;
    }
    return;
  }

  if (action === 'refresh') {
    void loadProjectDirectory({ fullRefresh: true });
    return;
  } else if (action === 'createFolder') {
    const target: FsEntry = entry ?? {
      kind: 'directory',
      name: '',
      path: '',
      handle: null as unknown as FileSystemDirectoryHandle,
    };
    onFileActionBase('createFolder', target, () =>
      fileManager.rootEntries.value.map((e) => e.name),
    );
  } else if (action === 'createMarkdown') {
    if (entry.kind === 'directory') {
      onFileActionBase('createMarkdown', entry);
    }
  } else if (action === 'createTimeline') {
    if (entry.kind === 'directory') {
      uiStore.pendingFsEntryCreateTimeline = entry;
    }
  } else if (action === 'upload') {
    directoryUploadTarget.value = entry;
    directoryUploadInput.value?.click();
  } else if (action === 'openAsPanel') {
    if (entry.kind !== 'file') return;
    if (!isOpenableProjectFileName(entry.name)) return;
    projectStore.goToCut();
    const mediaType = getMediaTypeFromFilename(entry.name);
    if (mediaType === 'text') {
      void (async () => {
        try {
          const file = await (entry.handle as FileSystemFileHandle).getFile();
          const content = await file.text();
          projectStore.addTextPanel(entry.path ?? entry.name, content, entry.name);
        } catch {
          projectStore.addTextPanel(entry.path ?? entry.name, '', entry.name);
        }
      })();
    } else if (mediaType === 'video' || mediaType === 'audio' || mediaType === 'image') {
      projectStore.addMediaPanel(entry, mediaType, entry.name);
    }
  } else if (action === 'openAsProjectTab') {
    if (entry.kind !== 'file' || !entry.path) return;
    if (!isOpenableProjectFileName(entry.name)) return;
    const tabId = addFileTab({ filePath: entry.path, fileName: entry.name });
    setActiveTab(tabId);
  } else if (action === 'createOtioVersion') {
    onFileActionBase('createOtioVersion', entry);
  } else if (action === 'convertFile') {
    if (entry.kind === 'file') {
      fileConversion.openConversionModal(entry);
    }
  } else if (action === 'createProxyForFolder') {
    if (entry.kind === 'directory' && entry.path !== undefined) {
      void proxyStore.generateProxiesForFolder({
        dirHandle: entry.handle as FileSystemDirectoryHandle,
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
  } else {
    onFileActionBase(action as FileAction, entry);
  }
}

watch(
  () => uiStore.pendingFsEntryDelete,
  (value) => {
    const entry = value as FsEntry | null;
    if (entry) {
      onFileActionBase('delete', entry);
      uiStore.pendingFsEntryDelete = null;
    }
  },
);

watch(
  () => uiStore.pendingFsEntryRename,
  (value) => {
    const entry = value as FsEntry | null;
    if (entry) {
      onFileActionBase('rename', entry);
      uiStore.pendingFsEntryRename = null;
    }
  },
);

watch(
  () => uiStore.pendingFsEntryCreateFolder,
  (value) => {
    const entry = value as FsEntry | null;
    if (entry && entry.kind === 'directory') {
      if (entry.path) {
        uiStore.setFileTreePathExpanded(projectStore.currentProjectName!, entry.path, true);
      }
      onFileActionBase('createFolder', entry, () => entry.children?.map((e) => e.name) ?? []);
      uiStore.pendingFsEntryCreateFolder = null;
    }
  },
);

watch(
  () => uiStore.pendingFsEntryCreateTimeline,
  async (value) => {
    const entry = value as FsEntry | null;
    if (entry && entry.kind === 'directory') {
      try {
        if (entry.path) {
          uiStore.setFileTreePathExpanded(projectStore.currentProjectName!, entry.path, true);
        }
        const projectDir = entry.handle
          ? (entry.handle as FileSystemDirectoryHandle)
          : await getProjectRootDirHandle();
        if (!projectDir) throw new Error('No directory handle found');

        const createdFileName = await createTimelineCommand({
          projectDir,
          timelinesDirName: undefined,
        });

        await loadProjectDirectory();

        const createdPath = entry.path ? `${entry.path}/${createdFileName}` : createdFileName;
        const createdEntry = createdPath ? findEntryByPath(createdPath) : null;
        if (createdEntry) {
          uiStore.selectedFsEntry = {
            kind: createdEntry.kind,
            name: createdEntry.name,
            path: createdEntry.path,
            handle: createdEntry.handle,
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
        console.error('[FileManager] Failed to create timeline', e);
        toast.add({
          color: 'red',
          title: 'Timeline error',
          description: e instanceof Error ? e.message : 'Failed to create timeline',
        });
      } finally {
        uiStore.pendingFsEntryCreateTimeline = null;
      }
    }
  },
);

watch(
  () => uiStore.pendingFsEntryCreateMarkdown,
  (value) => {
    const entry = value as FsEntry | null;
    if (entry && entry.kind === 'directory') {
      if (entry.path) {
        uiStore.setFileTreePathExpanded(projectStore.currentProjectName!, entry.path, true);
      }
      onFileActionBase('createMarkdown', entry);
      uiStore.pendingFsEntryCreateMarkdown = null;
    }
  },
);

watch(
  () => uiStore.pendingOtioCreateVersion,
  (value) => {
    const entry = value as FsEntry | null;
    if (entry) {
      onFileActionBase('createOtioVersion', entry);
      uiStore.pendingOtioCreateVersion = null;
    }
  },
);

watch(
  () => projectStore.currentProjectName,
  async (name) => {
    if (name) {
      uiStore.restoreFileTreeStateOnce(name);
    }
    await loadProjectDirectory();

    if (name) {
      const handle = await getProjectRootDirHandle();
      if (handle) {
        const rootEntry: FsEntry = {
          kind: 'directory',
          name,
          path: '',
          handle,
        };
        uiStore.selectedFsEntry = {
          kind: 'directory',
          name,
          path: '',
          handle,
        };
        selectionStore.selectFsEntry(rootEntry);
        emit('select', rootEntry);
      }
    }
  },
  { immediate: true },
);

// Sync: when another panel (e.g. FileBrowser) modifies files, refresh the tree
let isReloadingFromCounter = false;
watch(
  () => uiStore.fileManagerUpdateCounter,
  async () => {
    if (isReloadingFromCounter) return;
    isReloadingFromCounter = true;
    try {
      await loadProjectDirectory();
    } finally {
      // Wait for next tick so the counter increment from our own loadProjectDirectory
      // is processed before we start listening again
      await nextTick();
      isReloadingFromCounter = false;
    }
  },
);

function onDragOver(e: DragEvent) {
  if (e.dataTransfer?.types.includes('Files')) {
    isDragging.value = true;
    uiStore.isFileManagerDragging = true;
  }
}

function onDragLeave(e: DragEvent) {
  const currentTarget = e.currentTarget as HTMLElement | null;
  const relatedTarget = e.relatedTarget as Node | null;
  if (!currentTarget?.contains(relatedTarget)) {
    isDragging.value = false;
    uiStore.isFileManagerDragging = false;
  }
}

function onDrop(e: DragEvent) {
  isDragging.value = false;
  uiStore.isFileManagerDragging = false;
  uiStore.isGlobalDragging = false;

  if (e.dataTransfer?.files) {
    handleFiles(e.dataTransfer.files);
  }
}

async function onCreateTimeline() {
  const selectedDir =
    uiStore.selectedFsEntry?.kind === 'directory' ? uiStore.selectedFsEntry : null;

  if (selectedDir) {
    uiStore.pendingFsEntryCreateTimeline = selectedDir;
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

    handleFiles(files, selectedDir.handle as FileSystemDirectoryHandle, selectedDir.path);
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
    await handleFiles(files, entry.handle as FileSystemDirectoryHandle, entry.path);
  }
  await loadProjectDirectory();
}

function handleFileManagerFilesSelect(entry: FsEntry) {
  emit('select', entry);
}
</script>

<template>
  <div
    class="flex flex-col h-full bg-ui-bg-elevated border-r border-ui-border transition-colors duration-200 min-w-0 overflow-hidden relative"
    :class="{
      'bg-ui-bg-accent outline-2 outline-primary-500/50 -outline-offset-2 z-10': isDragging,
    }"
    @dragover.prevent="onDragOver"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
  >
    <!-- Hidden file input -->
    <input ref="fileInput" type="file" multiple class="hidden" @change="onFileSelect" />
    <input
      ref="directoryUploadInput"
      type="file"
      multiple
      class="hidden"
      @change="onDirectoryFileSelect"
    />

    <!-- Content Wrapper with Focus Frame -->
    <div
      class="flex flex-col flex-1 min-h-0"
      :class="{
        'outline-2 outline-primary-500/60 -outline-offset-2 z-10':
          focusStore.isPanelFocused('left'),
      }"
      @pointerdown.capture="focusStore.setTempFocus('left')"
    >
      <!-- Header / Tabs -->
      <div
        v-if="!foldersOnly"
        class="flex items-center gap-4 px-3 py-2 border-b border-ui-border shrink-0 select-none"
      >
        <button
          class="text-xs font-semibold uppercase tracking-wider transition-colors outline-none"
          :class="
            activeTab === 'files' ? 'text-primary-400' : 'text-ui-text-muted hover:text-ui-text'
          "
          @click="activeTab = 'files'"
        >
          {{ t('videoEditor.fileManager.tabs.files', 'Files') }}
        </button>
        <button
          class="text-xs font-semibold uppercase tracking-wider transition-colors outline-none"
          :class="
            activeTab === 'effects' ? 'text-primary-400' : 'text-ui-text-muted hover:text-ui-text'
          "
          @click="activeTab = 'effects'"
        >
          {{ t('videoEditor.fileManager.tabs.effects', 'Effects') }}
        </button>
        <button
          class="text-xs font-semibold uppercase tracking-wider transition-colors outline-none"
          :class="
            activeTab === 'history' ? 'text-primary-400' : 'text-ui-text-muted hover:text-ui-text'
          "
          @click="activeTab = 'history'"
        >
          {{ t('videoEditor.fileManager.tabs.history', 'History') }}
        </button>
      </div>

      <!-- Actions Toolbar (only for Files tab) -->
      <div
        v-if="activeTab === 'files' && projectStore.currentProjectName"
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

        <div v-if="!foldersOnly" class="ml-auto flex items-center">
          <UDropdownMenu
            :items="[
              [
                {
                  label: t('videoEditor.fileManager.actions.syncTreeTooltip', 'Refresh file tree'),
                  icon: 'i-heroicons-arrow-path',
                  disabled: isLoading || !projectStore.currentProjectName,
                  onSelect: async () => {
                    await loadProjectDirectory();
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

      <!-- Content -->
      <FileManagerFiles
        v-if="activeTab === 'files'"
        :editing-entry-path="editingEntryPath"
        :folders-only="foldersOnly"
        :is-files-page="isFilesPage"
        :is-dragging="isDragging"
        :is-loading="isLoading"
        :is-api-supported="isApiSupported"
        :root-entries="rootEntries"
        :get-file-icon="getFileIcon"
        :find-entry-by-path="findEntryByPath"
        :media-cache="fileManager.mediaCache"
        :move-entry="moveEntry"
        :get-project-root-dir-handle="getProjectRootDirHandle"
        :handle-files="handleFiles"
        @commit-rename="commitRename"
        @stop-rename="stopRename"
        @toggle="toggleDirectory"
        @action="onFileAction"
        @select="handleFileManagerFilesSelect"
      />
      <FileManagerEffects
        v-else-if="activeTab === 'effects' && !foldersOnly"
        class="flex-1 min-h-0"
      />
      <FileManagerHistory
        v-else-if="activeTab === 'history' && !foldersOnly"
        class="flex-1 min-h-0"
      />
    </div>

    <!-- Timeline Toolbar at the bottom of the panel -->
    <TimelineToolbar v-if="!foldersOnly" />

    <!-- Modals -->
    <UiConfirmModal
      v-model:open="isDeleteConfirmModalOpen"
      :title="t('common.delete', 'Delete')"
      :description="
        t(
          'common.confirmDelete',
          'Are you sure you want to delete this? This action cannot be undone.',
        )
      "
      color="error"
      icon="i-heroicons-exclamation-triangle"
      @confirm="handleDeleteConfirm"
    >
      <div>
        <div v-if="deleteTargets.length === 1" class="mt-2 text-sm font-medium text-ui-text">
          {{ deleteTargets[0]?.name }}
        </div>
        <div v-else-if="deleteTargets.length > 1" class="mt-2 text-sm font-medium text-ui-text">
          {{ deleteTargets.length }} {{ t('common.itemsSelected', 'items selected') }}
        </div>
        <div
          v-if="deleteTargets.length === 1 && deleteTargets[0]?.path"
          class="mt-1 text-xs text-ui-text-muted break-all"
        >
          {{
            deleteTargets[0].kind === 'directory'
              ? t('common.folder', 'Folder')
              : t('common.file', 'File')
          }}
          ·
          {{ deleteTargets[0].path }}
        </div>

        <div
          v-if="timelinesUsingDeleteTarget.length > 0"
          class="mt-3 p-2 rounded border border-red-500/40 bg-red-500/10"
        >
          <div class="text-xs font-semibold text-red-400">
            {{ t('videoEditor.fileManager.delete.usedWarning', 'This file is used in timelines:') }}
          </div>
          <div class="mt-1 flex flex-col gap-1">
            <div
              v-for="tl in timelinesUsingDeleteTarget"
              :key="tl.timelinePath"
              class="text-xs text-ui-text break-all"
            >
              {{ tl.timelineName }}
              <span class="text-[10px] text-ui-text-muted">({{ tl.timelinePath }})</span>
            </div>
          </div>
        </div>
      </div>
    </UiConfirmModal>

    <!-- Global Drag Highlight / Hint -->
    <div
      v-if="uiStore.isGlobalDragging && !uiStore.isFileManagerDragging"
      class="absolute inset-0 z-100 flex flex-col items-center justify-center bg-primary-500/10 border-4 border-dashed border-primary-500/50 m-2 rounded-2xl pointer-events-none transition-all duration-300"
    >
      <div
        class="flex flex-col items-center bg-ui-bg-elevated/90 px-6 py-4 rounded-xl border border-primary-500/30 shadow-xl"
      >
        <UIcon name="i-heroicons-folder-arrow-down" class="w-10 h-10 text-primary-400 mb-2" />
        <p class="text-sm font-bold text-primary-400 text-center uppercase tracking-wider">
          {{ t('videoEditor.fileManager.actions.dropZone', 'Move to folder') }}
        </p>
      </div>
    </div>
  </div>
</template>
