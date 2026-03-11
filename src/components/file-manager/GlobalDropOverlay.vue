<script setup lang="ts">
import { ref, computed } from 'vue';
import type { FsEntry } from '~/types/fs';
import { WORKSPACE_COMMON_PATH_PREFIX } from '~/utils/workspace-common';
import GlobalDropOverlayTree from '~/components/file-manager/GlobalDropOverlayTree.vue';

const props = defineProps<{
  rootEntries: FsEntry[];
}>();

const emit = defineEmits<{
  (e: 'drop-to-auto', files: File[]): void;
  (e: 'drop-to-folder', files: File[], targetDirPath: string): void;
}>();

const { t } = useI18n();

const isDropOverAuto = ref(false);
const dropOverFolderPath = ref<string | null>(null);

// Build fully-expanded directory tree
function collectFolders(entries: FsEntry[]): FsEntry[] {
  const result: FsEntry[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'directory') continue;
    const children = entry.children ? collectFolders(entry.children) : [];
    result.push({ ...entry, children, expanded: true });
  }
  return result;
}

const folderTree = computed(() => collectFolders(props.rootEntries));

// Common folder virtual entry
const commonFolder = computed<FsEntry | null>(() => {
  const found = props.rootEntries.find((e) => e.path === WORKSPACE_COMMON_PATH_PREFIX);
  return found ?? null;
});

// Project directories (excluding common)
const projectFolders = computed(() =>
  folderTree.value.filter((e) => e.path !== WORKSPACE_COMMON_PATH_PREFIX),
);

// Auto-sort zone handlers
function onAutoZoneDragOver(e: DragEvent) {
  if (!e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault();
  e.stopPropagation();
  isDropOverAuto.value = true;
  e.dataTransfer.dropEffect = 'copy';
}

function onAutoZoneDragLeave(e: DragEvent) {
  const target = e.currentTarget as HTMLElement;
  if (!target.contains(e.relatedTarget as Node)) {
    isDropOverAuto.value = false;
  }
}

function onAutoZoneDrop(e: DragEvent) {
  e.preventDefault();
  e.stopPropagation();
  isDropOverAuto.value = false;
  const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
  if (files.length > 0) {
    emit('drop-to-auto', files);
  }
}

// Folder drop handlers
function onFolderDragOver(e: DragEvent, path: string) {
  if (!e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault();
  e.stopPropagation();
  dropOverFolderPath.value = path;
  e.dataTransfer.dropEffect = 'copy';
}

function onFolderDragLeave(e: DragEvent, path: string) {
  if (dropOverFolderPath.value !== path) return;
  const target = e.currentTarget as HTMLElement;
  if (!target.contains(e.relatedTarget as Node)) {
    dropOverFolderPath.value = null;
  }
}

function onFolderDrop(e: DragEvent, path: string) {
  e.preventDefault();
  e.stopPropagation();
  dropOverFolderPath.value = null;
  const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
  if (files.length > 0) {
    emit('drop-to-folder', files, path);
  }
}

// Folder icon by name convention
function getFolderIcon(name: string): string {
  const lower = name.toLowerCase();
  if (lower === '_video') return 'i-heroicons-film';
  if (lower === '_audio') return 'i-heroicons-musical-note';
  if (lower === '_images') return 'i-heroicons-photo';
  if (lower === '_files') return 'i-heroicons-document';
  if (lower === '_timelines') return 'i-heroicons-rectangle-stack';
  if (lower === '_export') return 'i-heroicons-arrow-up-on-square';
  return 'i-heroicons-folder';
}
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm transition-opacity pointer-events-auto"
  >
    <div
      class="flex w-full max-w-4xl mx-4 gap-0 rounded-2xl overflow-hidden border border-ui-border/60 shadow-2xl bg-ui-bg-elevated/95 backdrop-blur-md max-h-[80vh]"
    >
      <!-- Left column: Auto-sort explanation -->
      <div
        class="flex-1 flex flex-col items-center justify-center p-8 transition-all duration-200 border-r border-ui-border/40"
        :class="
          isDropOverAuto
            ? 'bg-primary-500/15 ring-2 ring-inset ring-primary-500/50'
            : 'bg-transparent hover:bg-ui-bg-hover/30'
        "
        @dragover="onAutoZoneDragOver"
        @dragleave="onAutoZoneDragLeave"
        @drop="onAutoZoneDrop"
      >
        <UIcon
          name="i-heroicons-arrow-down-tray"
          class="w-14 h-14 mb-5 transition-colors"
          :class="isDropOverAuto ? 'text-primary-400' : 'text-ui-text-muted'"
        />
        <h3 class="text-lg font-semibold text-ui-text mb-3 text-center">
          {{ t('videoEditor.fileManager.dropOverlay.autoTitle', 'Auto-sort upload') }}
        </h3>
        <p class="text-sm text-ui-text-muted text-center mb-5 max-w-xs leading-relaxed">
          {{
            t(
              'videoEditor.fileManager.dropOverlay.autoDescription',
              'Drop files here or anywhere outside the folder tree. Files will be automatically sorted by type:',
            )
          }}
        </p>
        <div class="flex flex-col gap-2 w-full max-w-xs">
          <div class="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-ui-bg-accent/40">
            <UIcon name="i-heroicons-film" class="w-4 h-4 text-violet-400 shrink-0" />
            <span class="text-xs text-ui-text-muted">
              {{ t('videoEditor.fileManager.dropOverlay.autoVideo', 'Video → _video') }}
            </span>
          </div>
          <div class="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-ui-bg-accent/40">
            <UIcon name="i-heroicons-photo" class="w-4 h-4 text-sky-400 shrink-0" />
            <span class="text-xs text-ui-text-muted">
              {{ t('videoEditor.fileManager.dropOverlay.autoImages', 'Images → _images') }}
            </span>
          </div>
          <div class="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-ui-bg-accent/40">
            <UIcon name="i-heroicons-musical-note" class="w-4 h-4 text-emerald-400 shrink-0" />
            <span class="text-xs text-ui-text-muted">
              {{ t('videoEditor.fileManager.dropOverlay.autoAudio', 'Audio → _audio') }}
            </span>
          </div>
          <div class="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-ui-bg-accent/40">
            <UIcon name="i-heroicons-document" class="w-4 h-4 text-amber-400 shrink-0" />
            <span class="text-xs text-ui-text-muted">
              {{ t('videoEditor.fileManager.dropOverlay.autoFiles', 'Other files → _files') }}
            </span>
          </div>
        </div>
      </div>

      <!-- Right column: Folder tree -->
      <div class="flex-1 flex flex-col p-6 min-h-0 overflow-hidden">
        <h3 class="text-lg font-semibold text-ui-text mb-1 text-center">
          {{ t('videoEditor.fileManager.dropOverlay.folderTitle', 'Upload to folder') }}
        </h3>
        <p class="text-xs text-ui-text-muted mb-4 text-center">
          {{
            t(
              'videoEditor.fileManager.dropOverlay.folderDescription',
              'Drop files on a specific folder to upload there',
            )
          }}
        </p>

        <div class="flex-1 overflow-y-auto min-h-0 -mx-2 px-2">
          <!-- Common folder -->
          <div
            v-if="commonFolder"
            class="flex items-center gap-2 px-3 py-2 rounded-lg mb-1 cursor-default transition-all duration-150"
            :class="
              dropOverFolderPath === WORKSPACE_COMMON_PATH_PREFIX
                ? 'bg-violet-500/20 ring-2 ring-inset ring-violet-500/50'
                : 'hover:bg-ui-bg-hover/50'
            "
            @dragover="onFolderDragOver($event, WORKSPACE_COMMON_PATH_PREFIX)"
            @dragleave="onFolderDragLeave($event, WORKSPACE_COMMON_PATH_PREFIX)"
            @drop="onFolderDrop($event, WORKSPACE_COMMON_PATH_PREFIX)"
          >
            <UIcon name="i-heroicons-globe-alt" class="w-4 h-4 text-violet-400 shrink-0" />
            <span class="text-sm text-violet-300 font-medium truncate">
              {{ commonFolder.name }}
            </span>
          </div>

          <div v-if="commonFolder" class="border-b border-ui-border/30 my-2" />

          <!-- Project folders recursive tree -->
          <GlobalDropOverlayTree
            :entries="projectFolders"
            :depth="0"
            :drop-over-path="dropOverFolderPath"
            :get-folder-icon="getFolderIcon"
            @folder-drag-over="onFolderDragOver"
            @folder-drag-leave="onFolderDragLeave"
            @folder-drop="onFolderDrop"
          />

          <div
            v-if="projectFolders.length === 0 && !commonFolder"
            class="flex flex-col items-center justify-center py-8 text-ui-text-disabled"
          >
            <UIcon name="i-heroicons-folder-open" class="w-8 h-8 mb-2" />
            <p class="text-xs">
              {{ t('videoEditor.fileManager.empty', 'No files in this project') }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
