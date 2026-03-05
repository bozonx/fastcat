<script setup lang="ts">
import { useFilesPageStore } from '~/stores/filesPage.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { useProxyStore } from '~/stores/proxy.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import type { FsEntry } from '~/types/fs';
import InlineNameEditor from '~/components/file-manager/InlineNameEditor.vue';
import ProgressSpinner from '~/components/ui/ProgressSpinner.vue';

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
  currentGridSizeName: string;
  editingEntryPath: string | null;
  folderEntriesNames: string[];
  getContextMenuItems: (entry: FsEntry) => any[];
  isGeneratingProxyInDirectory: (entry: FsEntry) => boolean;
}>();

const emit = defineEmits<{
  (e: 'rootDragOver', event: DragEvent): void;
  (e: 'rootDragLeave', event: DragEvent): void;
  (e: 'rootDrop', event: DragEvent): void;
  (e: 'entryDragStart', event: DragEvent, entry: FsEntry): void;
  (e: 'entryDragEnd'): void;
  (e: 'entryDragOver', event: DragEvent, entry: FsEntry): void;
  (e: 'entryDragLeave', event: DragEvent, entry: FsEntry): void;
  (e: 'entryDrop', event: DragEvent, entry: FsEntry): void;
  (e: 'entryClick', entry: FsEntry): void;
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
</script>

<template>
  <div class="flex flex-wrap gap-2 content-start">
    <UContextMenu v-for="entry in entries" :key="entry.path" :items="getContextMenuItems(entry)">
      <div
        class="flex flex-col items-center p-2 rounded-lg border border-transparent hover:border-ui-border hover:bg-ui-bg-elevated cursor-pointer group transition-all shrink-0"
        :class="{
          'bg-primary-500/10 border-primary-500/30':
            selectionStore.selectedEntity?.source === 'fileManager' &&
            selectionStore.selectedEntity.path === entry.path,
          'border-b-2 border-b-red-500':
            entry.path && timelineMediaUsageStore.mediaPathToTimelines[entry.path]?.length,
          'opacity-30': entry.name.startsWith('.'),
          'ring-2 ring-primary-500 bg-primary-500/20': dragOverEntryPath === (entry.path ?? null),
        }"
        :style="{ width: `${filesPageStore.gridCardSize}px` }"
        :draggable="true"
        tabindex="0"
        @dragstart="emit('entryDragStart', $event, entry)"
        @dragend="emit('entryDragEnd')"
        @dragover.prevent="emit('entryDragOver', $event, entry)"
        @dragleave="emit('entryDragLeave', $event, entry)"
        @drop.prevent="emit('entryDrop', $event, entry)"
        @click="emit('entryClick', entry)"
        @dblclick="emit('entryDoubleClick', entry)"
        @keydown.enter.prevent="emit('entryEnter', entry)"
        @keydown.space.prevent="emit('entryEnter', entry)"
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
          <div
            v-else-if="proxyStore.generatingProxies.has(entry.path || '')"
            class="relative flex items-center justify-center text-amber-400"
          >
            <ProgressSpinner
              :progress="proxyStore.proxyProgress[entry.path || ''] ?? 0"
              size="md"
            />
          </div>
          <UIcon
            v-else
            :name="fileManager.getFileIcon(entry)"
            :class="[
              entry.kind === 'directory' ? 'text-blue-400' : 'text-ui-text-muted',
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
          class="text-center break-all line-clamp-2 px-1 transition-colors"
          :class="[
            entry.kind === 'directory'
              ? 'font-medium text-ui-text group-hover:text-primary-400'
              : 'text-ui-text',
            entry.name.startsWith('.') ? 'opacity-50' : '',
            {
              'text-xs':
                currentGridSizeName === 'xs' ||
                currentGridSizeName === 's' ||
                currentGridSizeName === 'm',
              'text-sm': currentGridSizeName === 'l' || currentGridSizeName === 'xl',
            },
          ]"
          :title="entry.name"
          @dblclick.stop="emit('fileAction', 'rename', entry)"
        >
          {{ entry.name }}
        </span>
      </div>
    </UContextMenu>

    <!-- Root drop zone for grid view -->
    <div
      class="w-full flex items-center justify-center min-h-12 mt-2 rounded-lg transition-colors"
      :class="{
        'bg-primary-500/10 outline outline-primary-500/40 -outline-offset-1': isRootDropOver,
      }"
      @dragover.prevent="emit('rootDragOver', $event)"
      @dragleave.prevent="emit('rootDragLeave', $event)"
      @drop.prevent="emit('rootDrop', $event)"
    >
      <p v-if="isRootDropOver" class="text-xs font-medium text-primary-400">
        {{
          t(
            'videoEditor.fileManager.actions.dropToRootHint',
            'Release to upload into the project root',
          )
        }}
      </p>
    </div>
  </div>
</template>
