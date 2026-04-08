<script setup lang="ts">
import { useFileManagerStore, type FileSortField } from '~/stores/file-manager.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { useProxyStore } from '~/stores/proxy.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useClipboardPaths } from '~/composables/file-manager/useClipboardIndicator';
import type { FsEntry } from '~/types/fs';
import type { getBdPayload } from '~/types/bloggerdog';
import { formatBytes } from '~/utils/format';
import { WORKSPACE_COMMON_PATH_PREFIX, isWorkspaceCommonPath } from '~/utils/workspace-common';
import type { FileCompatibility } from '~/composables/file-manager/useFileManagerCompatibility';
import { inject } from 'vue';
import InlineNameEditor from '~/components/file-manager/InlineNameEditor.vue';
import UiProgressSpinner from '~/components/ui/UiProgressSpinner.vue';

type ExtendedFsEntry = FsEntry & {
  objectUrl?: string;
  size?: number;
  mimeType?: string;
  created?: number;
};

function getBdType(entry: FsEntry): string | undefined {
  return (entry.adapterPayload as ReturnType<typeof getBdPayload>)?.type;
}

function getBdThumbnail(entry: FsEntry): string | undefined {
  return (entry.adapterPayload as ReturnType<typeof getBdPayload>)?.thumbnailUrl;
}

const props = defineProps<{
  entries: ExtendedFsEntry[];
  isRootDropOver: boolean;
  dragOverEntryPath: string | null;
  currentDragOperation: 'copy' | 'move' | null;
  folderSizesLoading: Record<string, boolean>;
  folderSizes: Record<string, number>;
  editingEntryPath: string | null;
  folderEntriesNames: string[];
  getContextMenuItems: (entry: FsEntry) => any[];
  isGeneratingProxyInDirectory: (entry: FsEntry) => boolean;
  videoThumbnails?: Record<string, string>;
  fileCompatibility?: Record<string, FileCompatibility>;
  instanceId?: string;
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
  (e: 'sort', field: FileSortField): void;
  (e: 'resizeStart', event: MouseEvent, column: string): void;
}>();

const { t } = useI18n();
const fileManagerStore =
  (inject('fileManagerStore', null) as ReturnType<typeof useFileManagerStore> | null) ||
  useFileManagerStore();
const selectionStore = useSelectionStore();
const timelineMediaUsageStore = useTimelineMediaUsageStore();
const proxyStore = useProxyStore();
const fileManager = useFileManager();
const clipboardPaths = useClipboardPaths();
const mediaStore = useMediaStore();

function handleImageError(entry: FsEntry) {
  if (entry.path) {
    mediaStore.metadataLoadFailed[entry.path] = true;
  }
}

function isCutEntry(entry: FsEntry): boolean {
  return entry.path ? clipboardPaths.value.has(entry.path) : false;
}

function formatDate(timestamp?: number) {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleString();
}

function isSelected(entry: FsEntry): boolean {
  const selected = selectionStore.selectedEntity;
  if (!selected || selected.source !== 'fileManager') return false;
  if (selected.instanceId && selected.instanceId !== props.instanceId) return false;

  if (selected.kind === 'multiple') {
    return selected.entries.some((e) => e.path === entry.path);
  }
  return selected.path === entry.path;
}

function isWorkspaceCommonRoot(entry: FsEntry): boolean {
  return entry.kind === 'directory' && entry.path === WORKSPACE_COMMON_PATH_PREFIX;
}

function getCompatibilityStatus(entry: FsEntry) {
  if (!entry.path || !props.fileCompatibility) return 'ok';
  return props.fileCompatibility[entry.path]?.status ?? 'ok';
}

let renameTimer: ReturnType<typeof setTimeout> | null = null;

function onNameClick(event: MouseEvent, entry: FsEntry) {
  if (!isSelected(entry)) return;
  if (isWorkspaceCommonPath(entry.path)) return;
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
  <div class="flex flex-col w-full min-w-max">
    <table class="w-full text-left text-sm border-collapse">
      <thead>
        <tr class="text-ui-text-muted border-b border-ui-border">
          <th
            class="py-1 px-3 font-medium cursor-pointer hover:text-ui-text transition-colors select-none relative"
            :style="{ width: `${fileManagerStore.columnWidths.name}px`, minWidth: '60px' }"
            @click="emit('sort', 'name')"
          >
            <div class="flex items-center gap-1">
              {{ t('common.name', 'Name') }}
              <UIcon
                v-if="fileManagerStore.sortOption.field === 'name'"
                :name="
                  fileManagerStore.sortOption.order === 'asc'
                    ? 'i-heroicons-bars-arrow-up'
                    : 'i-heroicons-bars-arrow-down'
                "
                class="w-3 h-3"
              />
            </div>
            <div
              class="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize hover:bg-primary-500/50 z-10 flex items-center justify-center group"
              @mousedown.stop="emit('resizeStart', $event, 'name')"
            >
              <div class="w-[2px] h-3 bg-ui-border group-hover:bg-primary-400 transition-colors" />
            </div>
          </th>

          <th
            class="py-1 px-3 font-medium cursor-pointer hover:text-ui-text transition-colors select-none relative"
            :style="{ width: `${fileManagerStore.columnWidths.type}px`, minWidth: '60px' }"
            @click="emit('sort', 'type')"
          >
            <div class="flex items-center gap-1">
              {{ t('common.type', 'Type') }}
              <UIcon
                v-if="fileManagerStore.sortOption.field === 'type'"
                :name="
                  fileManagerStore.sortOption.order === 'asc'
                    ? 'i-heroicons-bars-arrow-up'
                    : 'i-heroicons-bars-arrow-down'
                "
                class="w-3 h-3"
              />
            </div>
            <div
              class="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize hover:bg-primary-500/50 z-10 flex items-center justify-center group"
              @mousedown.stop="emit('resizeStart', $event, 'type')"
            >
              <div class="w-[2px] h-3 bg-ui-border group-hover:bg-primary-400 transition-colors" />
            </div>
          </th>

          <th
            class="py-1 px-3 font-medium text-right cursor-pointer hover:text-ui-text transition-colors select-none relative"
            :style="{ width: `${fileManagerStore.columnWidths.size}px`, minWidth: '60px' }"
            @click="emit('sort', 'size')"
          >
            <div class="flex items-center justify-end gap-1">
              {{ t('common.size', 'Size') }}
              <UIcon
                v-if="fileManagerStore.sortOption.field === 'size'"
                :name="
                  fileManagerStore.sortOption.order === 'asc'
                    ? 'i-heroicons-bars-arrow-up'
                    : 'i-heroicons-bars-arrow-down'
                "
                class="w-3 h-3"
              />
            </div>
            <div
              class="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize hover:bg-primary-500/50 z-10 flex items-center justify-center group"
              @mousedown.stop="emit('resizeStart', $event, 'size')"
            >
              <div class="w-[2px] h-3 bg-ui-border group-hover:bg-primary-400 transition-colors" />
            </div>
          </th>

          <th
            class="py-1 px-3 font-medium cursor-pointer hover:text-ui-text transition-colors select-none relative"
            :style="{ width: `${fileManagerStore.columnWidths.created}px`, minWidth: '60px' }"
            @click="emit('sort', 'created')"
          >
            <div class="flex items-center gap-1">
              {{ t('common.created', 'Created') }}
              <UIcon
                v-if="fileManagerStore.sortOption.field === 'created'"
                :name="
                  fileManagerStore.sortOption.order === 'asc'
                    ? 'i-heroicons-bars-arrow-up'
                    : 'i-heroicons-bars-arrow-down'
                "
                class="w-3 h-3"
              />
            </div>
            <div
              class="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize hover:bg-primary-500/50 z-10 flex items-center justify-center group"
              @mousedown.stop="emit('resizeStart', $event, 'created')"
            >
              <div class="w-[2px] h-3 bg-ui-border group-hover:bg-primary-400 transition-colors" />
            </div>
          </th>

          <th
            class="py-1 px-3 font-medium cursor-pointer hover:text-ui-text transition-colors select-none relative"
            :style="{
              width: `${fileManagerStore.columnWidths.modified}px`,
              minWidth: '60px',
            }"
            @click="emit('sort', 'modified')"
          >
            <div class="flex items-center gap-1">
              {{ t('common.modified', 'Modified') }}
              <UIcon
                v-if="fileManagerStore.sortOption.field === 'modified'"
                :name="
                  fileManagerStore.sortOption.order === 'asc'
                    ? 'i-heroicons-bars-arrow-up'
                    : 'i-heroicons-bars-arrow-down'
                "
                class="w-3 h-3"
              />
            </div>
            <div
              class="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize hover:bg-primary-500/50 z-10 flex items-center justify-center group"
              @mousedown.stop="emit('resizeStart', $event, 'modified')"
            >
              <div class="w-[2px] h-3 bg-ui-border group-hover:bg-primary-400 transition-colors" />
            </div>
          </th>
        </tr>
      </thead>

      <tbody>
        <template v-for="entry in entries" :key="entry.path">
          <UContextMenu :items="getContextMenuItems(entry)">
            <tr
              :data-entry-path="entry.path ?? null"
              class="hover:bg-ui-bg-elevated cursor-pointer group border-b border-ui-border/30 transition-colors focus:outline-none"
              :class="{
                'ring-1 ring-(--selection-ring) ring-inset z-10 relative bg-(--selection-range-bg)':
                  isSelected(entry) && editingEntryPath !== entry.path,
                'opacity-30': entry.name.startsWith('.'),
                'opacity-50': isCutEntry(entry),
                'text-(--color-success)!':
                  fileManager.mediaCache?.hasProxy?.(entry.path || '') &&
                  !proxyStore.generatingProxies.has(entry.path || ''),
                'text-amber-400!':
                  proxyStore.generatingProxies.has(entry.path || '') ||
                  isGeneratingProxyInDirectory(entry),
                'outline-2 outline-primary-500 -outline-offset-2 bg-primary-500/10!':
                  dragOverEntryPath === (entry.path ?? null) &&
                  props.currentDragOperation !== 'copy',
                'outline-2 outline-emerald-500 -outline-offset-2 bg-emerald-500/10!':
                  dragOverEntryPath === (entry.path ?? null) &&
                  props.currentDragOperation === 'copy',
              }"
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
            >
              <td class="py-0.5 px-3 flex items-center gap-2 h-8">
                <div
                  class="h-4 flex items-center justify-center shrink-0"
                  :class="[
                    entry.path && timelineMediaUsageStore.mediaPathToTimelines[entry.path]?.length
                      ? 'border-b-2 border-red-500'
                      : '',
                  ]"
                >
                  <UiProgressSpinner
                    v-if="proxyStore.generatingProxies.has(entry.path || '')"
                    :progress="proxyStore.proxyProgress.get(entry.path || '') ?? 0"
                    size="sm"
                  />
                  <img
                    v-else-if="
                      (entry.kind === 'file' || getBdType(entry) === 'content-item') &&
                      ((videoThumbnails && entry.path && videoThumbnails[entry.path]) ||
                        getBdThumbnail(entry)) &&
                      getCompatibilityStatus(entry) === 'ok'
                    "
                    :src="
                      (videoThumbnails && entry.path && videoThumbnails[entry.path]) ||
                      getBdThumbnail(entry)
                    "
                    :alt="entry.name"
                    class="w-4 h-4 object-cover rounded-sm"
                    @error="handleImageError(entry)"
                  />
                  <UIcon
                    v-else
                    :name="fileManager.getFileIcon(entry)"
                    class="w-4 h-4 transition-colors"
                    :class="[
                      isWorkspaceCommonRoot(entry)
                        ? 'text-violet-400'
                        : entry.kind === 'directory'
                          ? 'text-ui-text-muted/80'
                          : 'text-ui-text-muted',
                      entry.name.startsWith('.') ? 'opacity-30' : '',
                      fileManager.mediaCache?.hasProxy?.(entry.path || '') &&
                      !proxyStore.generatingProxies.has(entry.path || '')
                        ? 'text-(--color-success)!'
                        : '',
                      proxyStore.generatingProxies.has(entry.path || '') ||
                      isGeneratingProxyInDirectory(entry)
                        ? 'text-amber-400/90'
                        : '',
                      getCompatibilityStatus(entry) !== 'ok' ? 'text-red-400!' : '',
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
                  class="truncate max-w-50 transition-colors border border-transparent rounded-sm px-1 -mx-1"
                  :class="[
                    isWorkspaceCommonRoot(entry) ? 'text-violet-300' : '',
                    entry.name.startsWith('.') ? 'opacity-30' : '',
                    fileManager.mediaCache?.hasProxy?.(entry.path || '') &&
                    !proxyStore.generatingProxies.has(entry.path || '')
                      ? 'text-(--color-success)!'
                      : '',
                    proxyStore.generatingProxies.has(entry.path || '') ||
                    isGeneratingProxyInDirectory(entry)
                      ? 'text-amber-400!'
                      : '',
                    getCompatibilityStatus(entry) !== 'ok' ? 'text-red-400!' : '',
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
              </td>
              <td class="py-0.5 px-3 text-ui-text-muted">
                {{
                  entry.kind === 'directory'
                    ? t('common.folder', 'Folder')
                    : entry.mimeType === 'application/octet-stream'
                      ? ''
                      : entry.mimeType
                }}
              </td>
              <td class="py-0.5 px-3 text-right text-ui-text-muted">
                <template v-if="entry.kind === 'file'">
                  {{ formatBytes(entry.size || 0) }}
                </template>
                <template v-else-if="entry.kind === 'directory'">
                  <div v-if="folderSizesLoading[entry.path || '']" class="flex justify-end">
                    <UIcon
                      name="i-heroicons-arrow-path"
                      class="w-4 h-4 animate-spin text-ui-text-muted"
                    />
                  </div>
                  <template v-else-if="folderSizes[entry.path || ''] !== undefined">
                    {{ formatBytes(folderSizes[entry.path || ''] ?? 0) }}
                  </template>
                  <template v-else> - </template>
                </template>
                <template v-else> - </template>
              </td>
              <td class="py-0.5 px-3 text-ui-text-muted">
                {{ formatDate(entry.created) }}
              </td>
              <td class="py-0.5 px-3 text-ui-text-muted">
                {{ formatDate(entry.lastModified) }}
              </td>
            </tr>
          </UContextMenu>
        </template>

        <!-- Root drop zone row for list view -->
        <tr
          class="transition-colors"
          :class="{
            'bg-primary-500/10': isRootDropOver && props.currentDragOperation !== 'copy',
            'bg-emerald-500/10': isRootDropOver && props.currentDragOperation === 'copy',
          }"
          @dragenter.prevent.stop="emit('rootDragEnter', $event)"
          @dragover.prevent="emit('rootDragOver', $event)"
          @dragleave.prevent="emit('rootDragLeave', $event)"
          @drop.prevent="emit('rootDrop', $event)"
        >
          <td colspan="5" class="py-3 px-3 text-center">
            <span v-if="isRootDropOver" class="font-medium text-primary-400">
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
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
