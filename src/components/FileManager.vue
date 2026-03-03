<script setup lang="ts">
import { ref, watch } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useMediaStore } from '~/stores/media.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import type { FsEntry } from '~/types/fs';
import CreateFolderModal from '~/components/common/CreateFolderModal.vue';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';
import RenameModal from '~/components/common/RenameModal.vue';
import FileManagerFiles from '~/components/file-manager/FileManagerFiles.vue';
import FileManagerEffects from '~/components/file-manager/FileManagerEffects.vue';
import FileManagerHistory from '~/components/file-manager/FileManagerHistory.vue';
import TimelineToolbar from '~/components/timeline/TimelineToolbar.vue';
import { useFocusStore } from '~/stores/focus.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useFileManagerModals } from '~/composables/fileManager/useFileManagerModals';
import { useProxyStore } from '~/stores/proxy.store';
import { createTimelineCommand } from '~/file-manager/application/fileManagerCommands';

const props = defineProps<{
  foldersOnly?: boolean;
  disableSort?: boolean;
}>();

const emit = defineEmits<{
  (e: 'select', entry: FsEntry): void;
}>();

const { t } = useI18n();
const toast = useToast();

const projectStore = useProjectStore();
const mediaStore = useMediaStore();
const timelineStore = useTimelineStore();
const focusStore = useFocusStore();
const uiStore = useUiStore();
const selectionStore = useSelectionStore();
const proxyStore = useProxyStore();

const fileManager = useFileManager();
const {
  rootEntries,
  isLoading,
  error,
  isApiSupported,
  getProjectRootDirHandle,
  loadProjectDirectory,
  toggleDirectory,
  handleFiles,
  createFolder,
  deleteEntry,
  renameEntry,
  findEntryByPath,
  moveEntry,
  createTimeline,
  getFileIcon,
  sortMode,
  setSortMode,
} = fileManager;

const activeTab = ref('files');
const isDragging = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

const {
  isCreateFolderModalOpen,
  folderCreationTarget, // still needed for template binding if used there
  isRenameModalOpen,
  renameTarget,
  isDeleteConfirmModalOpen,
  deleteTarget,
  timelinesUsingDeleteTarget,
  directoryUploadTarget,
  directoryUploadInput,
  openCreateFolderModal,
  handleCreateFolder,
  openDeleteConfirmModal,
  handleDeleteConfirm,
  handleRename,
  onFileAction: onFileActionBase,
} = useFileManagerModals({
  createFolder,
  renameEntry,
  deleteEntry,
  loadProjectDirectory,
  handleFiles,
  mediaCache: fileManager.mediaCache,
});

// openFileInfoModal is now handled entirely within useFileManagerModals

function onFileAction(action: any, entry: FsEntry) {
  if (action === 'createMarkdown') {
    if (entry.kind === 'directory') {
      void createMarkdownInDirectory(entry);
    }
  } else if (action === 'createTimeline') {
    if (entry.kind === 'directory') {
      (uiStore as any).pendingFsEntryCreateTimeline = entry;
    }
  } else if (action === 'createOtioVersion') {
    void createOtioVersion(entry);
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
    onFileActionBase(action, entry);
  }
}

function buildNextOtioVersionName(name: string, existingNames: Set<string>): string {
  const lower = name.toLowerCase();
  if (!lower.endsWith('.otio')) return name;

  const base = name.slice(0, -'.otio'.length);
  const match = base.match(/^(.*)_([0-9]{3})$/);
  const prefix = match ? match[1] : base;
  const start = match ? Number(match[2]) + 1 : 1;

  for (let i = start; i < 10_000; i += 1) {
    const candidate = `${prefix}_${String(i).padStart(3, '0')}.otio`;
    if (!existingNames.has(candidate)) return candidate;
  }

  return `${prefix}_${Date.now()}.otio`;
}

async function resolveParentDirHandleForEntry(
  entry: FsEntry,
): Promise<FileSystemDirectoryHandle | null> {
  if (entry.parentHandle) return entry.parentHandle;
  if (!entry.path) return null;

  const root = await getProjectRootDirHandle();
  if (!root) return null;

  const parts = entry.path.split('/').slice(0, -1);
  let dir: FileSystemDirectoryHandle = root;
  for (const p of parts) {
    if (!p) continue;
    dir = await dir.getDirectoryHandle(p);
  }
  return dir;
}

async function createOtioVersion(entry: FsEntry) {
  if (entry.kind !== 'file') return;
  if (!entry.name.toLowerCase().endsWith('.otio')) return;

  const parentDir = await resolveParentDirHandleForEntry(entry);
  if (!parentDir) return;

  const existing = new Set<string>();
  try {
    const iterator = (parentDir as any).values?.() ?? (parentDir as any).entries?.();
    if (iterator) {
      for await (const value of iterator) {
        const h = (Array.isArray(value) ? value[1] : value) as FileSystemHandle;
        existing.add(h.name);
      }
    }
  } catch {
    // ignore
  }

  const nextName = buildNextOtioVersionName(entry.name, existing);
  const file = await (entry.handle as FileSystemFileHandle).getFile();
  const nextHandle = await parentDir.getFileHandle(nextName, { create: true });
  const createWritable = (nextHandle as FileSystemFileHandle).createWritable;
  if (typeof createWritable !== 'function') return;

  const writable = await (nextHandle as FileSystemFileHandle).createWritable();
  await writable.write(file);
  await writable.close();

  await loadProjectDirectory();

  const parentPath = entry.path ? entry.path.split('/').slice(0, -1).join('/') : '';
  const nextPath = parentPath ? `${parentPath}/${nextName}` : nextName;
  const newEntry = findEntryByPath(nextPath);
  if (newEntry) {
    uiStore.selectedFsEntry = {
      kind: newEntry.kind,
      name: newEntry.name,
      path: newEntry.path,
      handle: newEntry.handle,
    };
    selectionStore.selectFsEntry(newEntry);
  }
}

async function createMarkdownInDirectory(entry: FsEntry) {
  const dirHandle = entry.handle as FileSystemDirectoryHandle;
  const baseName = 'Документ_';
  const ext = '.md';

  const existing = new Set<string>();
  try {
    const iterator = (dirHandle as any).values?.() ?? (dirHandle as any).entries?.();
    if (iterator) {
      for await (const value of iterator) {
        const handle = (Array.isArray(value) ? value[1] : value) as FileSystemHandle;
        existing.add(handle.name);
      }
    }
  } catch {
    // ignore
  }

  let i = 1;
  let fileName = `${baseName}${i}${ext}`;
  while (existing.has(fileName)) {
    i += 1;
    fileName = `${baseName}${i}${ext}`;
  }

  const handle = await dirHandle.getFileHandle(fileName, { create: true });
  const createWritable = (handle as FileSystemFileHandle).createWritable;
  if (typeof createWritable === 'function') {
    const writable = await (handle as FileSystemFileHandle).createWritable();
    await writable.write('');
    await writable.close();
  }

  await loadProjectDirectory();

  const newPath = entry.path ? `${entry.path}/${fileName}` : fileName;
  const newEntry = findEntryByPath(newPath);
  if (newEntry) {
    uiStore.selectedFsEntry = {
      kind: newEntry.kind,
      name: newEntry.name,
      path: newEntry.path,
      handle: newEntry.handle,
    };
    selectionStore.selectFsEntry(newEntry);
    emit('select', newEntry);
  }
}

watch(
  () => uiStore.pendingFsEntryDelete,
  (value) => {
    const entry = value as FsEntry | null;
    if (entry) {
      openDeleteConfirmModal(entry);
      uiStore.pendingFsEntryDelete = null;
    }
  },
);

watch(
  () => (uiStore as any).pendingFsEntryRename,
  (value) => {
    const entry = value as FsEntry | null;
    if (entry) {
      renameTarget.value = entry;
      isRenameModalOpen.value = true;
      (uiStore as any).pendingFsEntryRename = null;
    }
  },
);

watch(
  () => (uiStore as any).pendingFsEntryCreateTimeline,
  async (value) => {
    const entry = value as FsEntry | null;
    if (entry && entry.kind === 'directory') {
      try {
        const createdFileName = await createTimelineCommand({
          projectDir: entry.handle as FileSystemDirectoryHandle,
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
        (uiStore as any).pendingFsEntryCreateTimeline = null;
      }
    }
  },
);

watch(
  () => (uiStore as any).pendingFsEntryCreateMarkdown,
  (value) => {
    const entry = value as FsEntry | null;
    if (entry && entry.kind === 'directory') {
      void createMarkdownInDirectory(entry);
      (uiStore as any).pendingFsEntryCreateMarkdown = null;
    }
  },
);

watch(
  () => (uiStore as any).pendingOtioCreateVersion,
  (value) => {
    const entry = value as FsEntry | null;
    if (entry) {
      void createOtioVersion(entry);
      (uiStore as any).pendingOtioCreateVersion = null;
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

  await handleFiles(files, entry.handle as FileSystemDirectoryHandle, entry.path);
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
            openCreateFolderModal(
              uiStore.selectedFsEntry?.kind === 'directory' ? uiStore.selectedFsEntry : null,
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
                  onSelect: () => loadProjectDirectory(),
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
        :folders-only="foldersOnly"
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
        @toggle="toggleDirectory"
        @action="onFileAction"
        @create-folder="openCreateFolderModal"
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

    <CreateFolderModal v-model:open="isCreateFolderModalOpen" @create="handleCreateFolder" />

    <RenameModal
      v-model:open="isRenameModalOpen"
      :initial-name="renameTarget?.name"
      @rename="handleRename"
    />

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
        <div v-show="deleteTarget" class="mt-2 text-sm font-medium text-ui-text">
          {{ deleteTarget?.name }}
        </div>
        <div v-if="deleteTarget?.path" class="mt-1 text-xs text-ui-text-muted break-all">
          {{
            deleteTarget.kind === 'directory'
              ? t('common.folder', 'Folder')
              : t('common.file', 'File')
          }}
          ·
          {{ deleteTarget.path }}
        </div>

        <div
          v-if="deleteTarget?.kind === 'file' && timelinesUsingDeleteTarget.length > 0"
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
      v-if="uiStore.isGlobalDragging && !isDragging"
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
