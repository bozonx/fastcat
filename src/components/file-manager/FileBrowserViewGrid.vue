<script setup lang="ts">
import { useFilesPageStore } from '~/stores/filesPage.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { useProxyStore } from '~/stores/proxy.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import type { FsEntry } from '~/types/fs';
import { WORKSPACE_COMMON_PATH_PREFIX } from '~/utils/workspace-common';
import InlineNameEditor from '~/components/file-manager/InlineNameEditor.vue';
import UiProgressSpinner from '~/components/ui/UiProgressSpinner.vue';

// Local type for entries that might have objectUrl
type ExtendedFsEntry = FsEntry & {
  objectUrl?: string;
  size?: number;
  mimeType?: string;
  created?: number;
};

const props = defineProps<{
  entries: ExtendedFsEntry[];
  isRootDropOver: boolean;
  dragOverEntryPath: string | null;
  currentDragOperation: 'copy' | 'move' | null;
  currentGridSizeName: string;
  editingEntryPath: string | null;
  folderEntriesNames: string[];
  getContextMenuItems: (entry: FsEntry) => any[];
  isGeneratingProxyInDirectory: (entry: FsEntry) => boolean;
  videoThumbnails?: Record<string, string>;
}>();

const emit = defineEmits<{
  (e: 'rootDragOver', event: DragEvent): void;
  (e: 'rootDragEnter', event: DragEvent): void;
  (e: 'rootDragLeave', event: DragEvent): void;
  (e: 'rootDrop', event: DragEvent): void;
  (e: 'entryDragStart', event: DragEvent, entry: FsEntry): void;
  (e: 'entryDragEnd'): void;
  (e: 'entryDragEnter', event: DragEvent, entry: FsEntry): void;
  (e: 'entryDragOver', event: DragEvent, entry: FsEntry): void;
  (e: 'entryDragLeave', event: DragEvent, entry: FsEntry): void;
  (e: 'entryDrop', event: DragEvent, entry: FsEntry): void;
  (e: 'entryClick', event: MouseEvent, entry: FsEntry): void;
  (e: 'entryDoubleClick', entry: FsEntry): void;
  (e: 'entryEnter', entry: FsEntry): void;
  (e: 'commitRename', entry: FsEntry, name: string): void;
  (e: 'stopRename'): void;
  (e: 'fileAction', action: string, entry: FsEntry): void;
}>();

const { t } = useI18n();
const filesPageStore = useFilesPageStore();
const selectionStore = useSelectionStore();
const timelineMediaUsageStore = useTimelineMediaUsageStore();
const proxyStore = useProxyStore();
const fileManager = useFileManager();

function isSelected(entry: FsEntry): boolean {
  const selected = selectionStore.selectedEntity;
  if (!selected || selected.source !== 'fileManager') return false;
  if (selected.kind === 'multiple') {
    return selected.entries.some((e) => e.path === entry.path);
  }
  return selected.path === entry.path;
}

function isWorkspaceCommonRoot(entry: FsEntry): boolean {
  return entry.kind === 'directory' && entry.path === WORKSPACE_COMMON_PATH_PREFIX;
}

let renameTimer: ReturnType<typeof setTimeout> | null = null;

function onNameClick(event: MouseEvent, entry: FsEntry) {
  if (!isSelected(entry)) return;
  event.stopPropagation();

  if (event.detail === 1) {
    renameTimer = setTimeout(() => {
      emit('fileAction', 'rename', entry);
    }, 250);
  }
}

function onNameDblClick(event: MouseEvent, entry: FsEntry) {
  if (renameTimer) {
    clearTimeout(renameTimer);
    renameTimer = null;
  }
}
</script>

<template>
  <div class="flex flex-wrap gap-2 content-start">
    <UContextMenu v-for="entry in entries" :key="entry.path" :items="getContextMenuItems(entry)">
      <div
        :data-entry-path="entry.path ?? null"
        class="flex flex-col items-center p-2 rounded-lg border border-transparent hover:border-ui-border hover:bg-ui-bg-elevated cursor-pointer group transition-all shrink-0 focus:outline-none"
        :class="{
          'ring-1 ring-(--selection-ring) bg-(--selection-range-bg)': isSelected(entry),
          'text-(--color-success)!':
            fileManager.mediaCache.hasProxy(entry.path || '') &&
            !proxyStore.generatingProxies.has(entry.path || ''),
          'text-amber-400!':
            proxyStore.generatingProxies.has(entry.path || '') ||
            isGeneratingProxyInDirectory(entry),
          'border-b-2 border-b-red-500':
            entry.path && timelineMediaUsageStore.mediaPathToTimelines[entry.path]?.length,
          'opacity-30': entry.name.startsWith('.'),
          'ring-2 ring-primary-500 bg-primary-500/20':
            dragOverEntryPath === (entry.path ?? null) && props.currentDragOperation !== 'copy',
          'ring-2 ring-emerald-500 bg-emerald-500/15':
            dragOverEntryPath === (entry.path ?? null) && props.currentDragOperation === 'copy',
        }"
        :style="{ width: `${filesPageStore.gridCardSize}px` }"
        :draggable="true"
        tabindex="0"
        @dragstart="emit('entryDragStart', $event, entry)"
        @dragend="emit('entryDragEnd')"
        @dragenter.prevent="emit('entryDragEnter', $event, entry)"
        @dragover.prevent="emit('entryDragOver', $event, entry)"
        @dragleave="emit('entryDragLeave', $event, entry)"
        @drop.prevent="emit('entryDrop', $event, entry)"
        @click="emit('entryClick', $event, entry)"
        @dblclick="emit('entryDoubleClick', entry)"
        @keydown.enter.prevent.stop="emit('entryEnter', entry)"
        @keydown.space.prevent.stop="emit('entryEnter', entry)"
      >
        <div
          class="relative mb-2 w-full aspect-square flex items-center justify-center bg-ui-bg rounded overflow-hidden"
        >
          <img
            v-if="entry.kind === 'file' && entry.objectUrl"
            :src="entry.objectUrl"
            :alt="entry.name"
            class="max-w-full max-h-full object-contain"
          />
          <img
            v-else-if="
              entry.kind === 'file' && videoThumbnails && entry.path && videoThumbnails[entry.path]
            "
            :src="videoThumbnails[entry.path]"
            :alt="entry.name"
            class="max-w-full max-h-full object-contain"
          />
          <div
            v-else-if="proxyStore.generatingProxies.has(entry.path || '')"
            class="relative flex items-center justify-center text-amber-400"
          >
            <UiProgressSpinner
              :progress="proxyStore.proxyProgress.get(entry.path || '') ?? 0"
              size="md"
            />
          </div>
          <UIcon
            v-else
            :name="fileManager.getFileIcon(entry)"
            :class="[
              isWorkspaceCommonRoot(entry)
                ? 'text-violet-400'
                : entry.kind === 'directory'
                  ? 'text-ui-text-muted/80'
                  : 'text-ui-text-muted',
              fileManager.mediaCache.hasProxy(entry.path || '') &&
              !proxyStore.generatingProxies.has(entry.path || '')
                ? 'text-(--color-success)!'
                : '',
              proxyStore.generatingProxies.has(entry.path || '') ||
              isGeneratingProxyInDirectory(entry)
                ? 'text-amber-400/90'
                : '',
              {
                'w-8 h-8': currentGridSizeName === 'xs',
                'w-10 h-10': currentGridSizeName === 's',
                'w-12 h-12': currentGridSizeName === 'm',
                'w-16 h-16': currentGridSizeName === 'l',
                'w-20 h-20': currentGridSizeName === 'xl',
              },
            ]"
          />
        </div>
        <InlineNameEditor
          v-if="editingEntryPath === entry.path"
          :initial-name="entry.name"
          :is-folder="entry.kind === 'directory'"
          :existing-names="folderEntriesNames"
          @save="(name) => emit('commitRename', entry, name)"
          @cancel="emit('stopRename')"
        />
        <span
          v-else
          class="text-center break-all line-clamp-2 px-1 transition-colors border border-transparent rounded-sm"
          :class="[
            entry.kind === 'directory'
              ? isWorkspaceCommonRoot(entry)
                ? 'font-medium text-violet-300 group-hover:text-violet-200'
                : 'font-medium text-ui-text group-hover:text-primary-400'
              : 'text-ui-text',
            entry.name.startsWith('.') ? 'opacity-50' : '',
            fileManager.mediaCache.hasProxy(entry.path || '') &&
            !proxyStore.generatingProxies.has(entry.path || '')
              ? 'text-(--color-success)!'
              : '',
            proxyStore.generatingProxies.has(entry.path || '') ||
            isGeneratingProxyInDirectory(entry)
              ? 'text-amber-400!'
              : '',
            {
              'text-xs':
                currentGridSizeName === 'xs' ||
                currentGridSizeName === 's' ||
                currentGridSizeName === 'm',
              'text-sm': currentGridSizeName === 'l' || currentGridSizeName === 'xl',
            },
            isSelected(entry)
              ? 'hover:border-(--selection-accent-500)/50 border-(--selection-accent-500)/35 cursor-text'
              : '',
          ]"
          :title="entry.name"
          @click="onNameClick($event, entry)"
          @dblclick="onNameDblClick($event, entry)"
        >
          {{ entry.name }}
        </span>
      </div>
    </UContextMenu>

    <!-- Root drop zone for grid view -->
    <div
      class="w-full flex items-center justify-center min-h-12 mt-2 rounded-lg transition-colors"
      :class="{
        'bg-primary-500/10 outline outline-primary-500/40 -outline-offset-1':
          isRootDropOver && props.currentDragOperation !== 'copy',
        'bg-emerald-500/10 outline outline-emerald-500/40 -outline-offset-1':
          isRootDropOver && props.currentDragOperation === 'copy',
      }"
      @dragenter.prevent.stop="emit('rootDragEnter', $event)"
      @dragover.prevent="emit('rootDragOver', $event)"
      @dragleave.prevent="emit('rootDragLeave', $event)"
      @drop.prevent="emit('rootDrop', $event)"
    >
      <p v-if="isRootDropOver" class="text-xs font-medium text-primary-400">
        {{
          props.currentDragOperation === 'copy'
            ? t(
                'videoEditor.fileManager.actions.dropToRootCopyHint',
                'Release to copy into the current folder',
              )
            : t(
                'videoEditor.fileManager.actions.dropToRootHint',
                'Release to upload into the project root',
              )
        }}
      </p>
    </div>
  </div>
</template>
