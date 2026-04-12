<script setup lang="ts">
import type { VNodeRef } from 'vue';
import type { ExtendedFsEntry } from '~/composables/file-manager/useFileBrowserEntries';
import type { FileCompatibility } from '~/composables/file-manager/useFileManagerCompatibility';
import type { FsEntry } from '~/types/fs';
import FileBrowserViewGrid from '~/components/file-manager/FileBrowserViewGrid.vue';
import FileBrowserViewList from '~/components/file-manager/FileBrowserViewList.vue';

interface FileBrowserContentProps {
  setRootContainerRef: VNodeRef;
  marqueeStyle: Record<string, string> | null;
  emptySpaceContextMenuItems: unknown[];
  isRemoteMode: boolean;
  remoteError: string | null;
  folderEntriesLength: number;
  sortedEntries: ExtendedFsEntry[];
  dragOverEntryPath: string | null;
  currentDragOperation: 'copy' | 'move' | 'cancel' | null;
  currentGridSizeName: string;
  effectiveGridCardSize: number;
  editingEntryPath: string | null;
  folderEntryNames: string[];
  getContextMenuItems: (entry: FsEntry) => unknown[];
  isDirectoryGeneratingProxy: (entry: FsEntry) => boolean;
  videoThumbnails: Record<string, string>;
  fileCompatibility: Record<string, FileCompatibility>;
  instanceId: string;
  folderSizesLoading: Record<string, boolean>;
  folderSizes: Record<string, number>;
  showGridView: boolean;
  isLoadingMore: boolean;
  remoteHasMore: boolean;
  rootSpacerStyle: Record<string, string | number>;
}

const props = defineProps<FileBrowserContentProps>();
const { t } = useI18n();

const emit = defineEmits([
  'scroll',
  'rootDragEnter',
  'rootDragOver',
  'rootDragLeave',
  'rootDrop',
  'containerClick',
  'containerKeydown',
  'marqueePointerDown',
  'marqueePointerMove',
  'marqueePointerUp',
  'retryRemoteLoad',
  'entryDragStart',
  'entryDragEnd',
  'entryDragEnter',
  'entryDragOver',
  'entryDragLeave',
  'entryDrop',
  'entryClick',
  'entryDoubleClick',
  'entryEnter',
  'commitRename',
  'stopRename',
  'fileAction',
  'sort',
  'resizeStart',
]);

function emitEntryDragStart(event: DragEvent, entry: FsEntry) {
  emit('entryDragStart', event, entry);
}

function emitEntryDragEnter(event: DragEvent, entry: FsEntry) {
  emit('entryDragEnter', event, entry);
}

function emitEntryDragOver(event: DragEvent, entry: FsEntry) {
  emit('entryDragOver', event, entry);
}

function emitEntryDragLeave(event: DragEvent, entry: FsEntry) {
  emit('entryDragLeave', event, entry);
}

function emitEntryDrop(event: DragEvent, entry: FsEntry) {
  emit('entryDrop', event, entry);
}

function emitEntryClick(event: MouseEvent, entry: FsEntry) {
  emit('entryClick', event, entry);
}

function emitEntryDoubleClick(event: MouseEvent, entry: FsEntry) {
  emit('entryDoubleClick', event, entry);
}

function emitEntryEnter(entry: FsEntry) {
  emit('entryEnter', entry);
}

function emitCommitRename(entry: FsEntry, newName: string) {
  emit('commitRename', entry, newName);
}

function emitFileAction(action: string, entry: FsEntry | FsEntry[]) {
  emit('fileAction', action, entry);
}

function emitSort(field: string) {
  emit('sort', field);
}

function emitResizeStart(event: MouseEvent, column: string) {
  emit('resizeStart', event, column);
}
</script>

<template>
  <div
    :ref="props.setRootContainerRef"
    class="flex-1 overflow-auto p-4 content-scrollbar relative"
    tabindex="0"
    @scroll.passive="emit('scroll', $event)"
    @dragenter.prevent="emit('rootDragEnter', $event)"
    @dragover.prevent="emit('rootDragOver', $event)"
    @dragleave.prevent="emit('rootDragLeave', $event)"
    @drop.prevent="emit('rootDrop', $event)"
    @click.self="emit('containerClick')"
    @keydown="emit('containerKeydown', $event)"
    @pointerdown.capture="emit('marqueePointerDown', $event)"
    @pointermove="emit('marqueePointerMove', $event)"
    @pointerup="emit('marqueePointerUp', $event)"
    @pointercancel="emit('marqueePointerUp', $event)"
  >
    <div
      v-if="props.marqueeStyle"
      class="absolute border border-primary-400 bg-primary-400/15 rounded-sm pointer-events-none"
      :style="props.marqueeStyle"
    />
    <UContextMenu :items="props.emptySpaceContextMenuItems as any" class="min-h-full">
      <div class="min-h-full flex flex-col" @click.self="emit('containerClick')">
        <div
          v-if="props.isRemoteMode && props.remoteError"
          class="flex flex-col items-center justify-center flex-1 text-ui-text-dim text-center p-6 gap-6"
        >
          <div class="p-6 rounded-full bg-error-500/10">
            <UIcon
              name="i-heroicons-exclamation-circle"
              class="w-16 h-16 text-error-500 opacity-80"
            />
          </div>
          <div class="space-y-2 max-w-[320px]">
            <h3 class="text-xl font-semibold text-ui-text">
              {{ t('fastcat.fileManager.remote.load_error_title') }}
            </h3>
            <p class="text-sm text-ui-text-dim leading-relaxed">
              {{ props.remoteError }}
            </p>
          </div>
          <div class="flex gap-3">
            <UButton
              color="primary"
              variant="solid"
              icon="i-heroicons-arrow-path"
              @click.stop="emit('retryRemoteLoad')"
            >
              {{ t('common.retry') }}
            </UButton>
          </div>
        </div>

        <div
          v-else-if="props.folderEntriesLength === 0"
          class="flex flex-col items-center justify-center flex-1 text-ui-text-muted gap-2"
        >
          <UIcon name="i-heroicons-inbox" class="w-12 h-12 opacity-20" />
          <span>{{ t('common.empty') }}</span>
        </div>

        <FileBrowserViewGrid
          v-else-if="props.showGridView"
          :entries="props.sortedEntries"
          :drag-over-entry-path="props.dragOverEntryPath"
          :current-drag-operation="props.currentDragOperation"
          :current-grid-size-name="props.currentGridSizeName"
          :current-grid-card-size="props.effectiveGridCardSize"
          :editing-entry-path="props.editingEntryPath"
          :folder-entries-names="props.folderEntryNames"
          :get-context-menu-items="props.getContextMenuItems"
          :is-generating-proxy-in-directory="props.isDirectoryGeneratingProxy"
          :video-thumbnails="props.videoThumbnails"
          :file-compatibility="props.fileCompatibility"
          :instance-id="props.instanceId"
          @entry-drag-start="emitEntryDragStart"
          @entry-drag-end="emit('entryDragEnd')"
          @entry-drag-enter="emitEntryDragEnter"
          @entry-drag-over="emitEntryDragOver"
          @entry-drag-leave="emitEntryDragLeave"
          @entry-drop="emitEntryDrop"
          @entry-click="emitEntryClick"
          @entry-double-click="emitEntryDoubleClick"
          @entry-enter="emitEntryEnter"
          @commit-rename="emitCommitRename"
          @stop-rename="emit('stopRename')"
          @file-action="emitFileAction"
        />

        <FileBrowserViewList
          v-else
          :entries="props.sortedEntries"
          :drag-over-entry-path="props.dragOverEntryPath"
          :current-drag-operation="props.currentDragOperation"
          :folder-sizes-loading="props.folderSizesLoading"
          :folder-sizes="props.folderSizes"
          :editing-entry-path="props.editingEntryPath"
          :folder-entries-names="props.folderEntryNames"
          :get-context-menu-items="props.getContextMenuItems"
          :is-generating-proxy-in-directory="props.isDirectoryGeneratingProxy"
          :video-thumbnails="props.videoThumbnails"
          :file-compatibility="props.fileCompatibility"
          :instance-id="props.instanceId"
          @entry-drag-start="emitEntryDragStart"
          @entry-drag-end="emit('entryDragEnd')"
          @entry-drag-enter="emitEntryDragEnter"
          @entry-drag-over="emitEntryDragOver"
          @entry-drag-leave="emitEntryDragLeave"
          @entry-drop="emitEntryDrop"
          @entry-click="emitEntryClick"
          @entry-double-click="emitEntryDoubleClick"
          @entry-enter="emitEntryEnter"
          @commit-rename="emitCommitRename"
          @stop-rename="emit('stopRename')"
          @file-action="emitFileAction"
          @sort="emitSort"
          @resize-start="emitResizeStart"
        />

        <div
          v-if="props.isRemoteMode && (props.isLoadingMore || props.remoteHasMore)"
          class="w-full flex items-center justify-center p-8 min-h-[100px]"
        >
          <UIcon
            v-if="props.isLoadingMore"
            name="i-heroicons-arrow-path"
            class="w-8 h-8 animate-spin text-primary-500/50"
          />
          <div v-else class="text-ui-text-dim/30 text-xs font-medium uppercase tracking-widest">
            {{ t('common.scroll_for_more') }}
          </div>
        </div>

        <div :style="props.rootSpacerStyle" @click.self="emit('containerClick')" />
      </div>
    </UContextMenu>
  </div>
</template>

<style scoped>
.content-scrollbar::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.content-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.content-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(var(--color-neutral-500), 0.1);
  border-radius: 3px;
}

.content-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(var(--color-neutral-500), 0.2);
}
</style>
