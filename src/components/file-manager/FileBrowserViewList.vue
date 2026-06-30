<script setup lang="ts">
import { useFileManagerStore } from '~/stores/file-manager.store';
import type { FsEntry } from '~/types/fs';
import { formatBytes } from '~/utils/format';
import type { FileCompatibility } from '~/composables/file-manager/useFileManagerCompatibility';
import type { ExtendedFsEntry, FileBrowserListViewEmits } from '~/types/file-browser';
import { inject } from 'vue';
import {
  useFileBrowserEntry,
  useRenameTimer,
  getBdType,
  getBdThumbnail,
} from '~/composables/file-manager/useFileBrowserEntry';
import InlineNameEditor from '~/components/file-manager/InlineNameEditor.vue';
import UiProgressSpinner from '~/components/ui/UiProgressSpinner.vue';
import FriendlyTime from '~/components/ui/FriendlyTime.vue';

const props = defineProps<{
  entries: ExtendedFsEntry[];
  dragOverEntryPath: string | null;
  currentDragOperation: 'copy' | 'move' | 'cancel' | null;
  folderSizesLoading: Record<string, boolean>;
  folderSizes: Record<string, number>;
  editingEntryPath: string | null;
  folderEntriesNames: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getContextMenuItems: (entry: FsEntry) => any[];
  isGeneratingProxyInDirectory: (entry: FsEntry) => boolean;
  videoThumbnails?: Record<string, string>;
  fileCompatibility?: Record<string, FileCompatibility>;
  instanceId?: string;
  selectedEntryPaths?: string[];
  hideUsageIndicators?: boolean;
}>();

const emit = defineEmits<FileBrowserListViewEmits>();

const { t } = useI18n();
const fileManagerStore =
  (inject('fileManagerStore', null) as ReturnType<typeof useFileManagerStore> | null) ||
  useFileManagerStore();

const {
  timelineMediaUsageStore,
  proxyStore,
  fileManager,
  getCompatibilityStatus,
  isCheckingCompatibility,
  isCutEntry,
  isSelected,
  isWorkspaceCommonRoot,
  handleImageError,
} = useFileBrowserEntry({
  fileCompatibility: () => props.fileCompatibility,
  instanceId: props.instanceId,
});

const { onNameClick, onNameDblClick } = useRenameTimer({
  onRename: (entry) => emit('fileAction', 'rename', entry),
});

function isEntrySelected(entry: FsEntry): boolean {
  if (props.selectedEntryPaths) {
    return Boolean(entry.path && props.selectedEntryPaths.includes(entry.path));
  }
  return isSelected(entry);
}

// formatDate removed in favor of FriendlyTime component
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
              {{ t('common.name') }}
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
              {{ t('common.type') }}
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
              {{ t('common.size') }}
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
              {{ t('common.created') }}
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
              {{ t('common.modified') }}
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
                  isEntrySelected(entry) && editingEntryPath !== entry.path,
                'opacity-30': entry.name.startsWith('.'),
                'opacity-50': isCutEntry(entry),
                'text-(--color-success)!':
                  fileManager.mediaCache?.hasProxy?.(entry.path || '') &&
                  !proxyStore.generatingProxies.has(entry.path || ''),
                'text-amber-400!':
                  proxyStore.generatingProxies.has(entry.path || '') ||
                  isGeneratingProxyInDirectory(entry),
                'outline-2 outline-red-500 -outline-offset-2 bg-red-500/10!':
                  dragOverEntryPath === (entry.path ?? null) &&
                  props.currentDragOperation === 'cancel',
                'outline-2 outline-primary-500 -outline-offset-2 bg-primary-500/10!':
                  dragOverEntryPath === (entry.path ?? null) &&
                  props.currentDragOperation === 'move',
                'outline-2 outline-emerald-500 -outline-offset-2 bg-emerald-500/10!':
                  dragOverEntryPath === (entry.path ?? null) &&
                  props.currentDragOperation === 'copy',
              }"
              tabindex="0"
              @pointerdown="
                !isCheckingCompatibility(entry) && emit('entryPointerDown', $event, entry)
              "
              @click="emit('entryClick', $event, entry)"
              @dblclick="emit('entryDoubleClick', entry)"
              @keydown.enter.prevent.stop="emit('entryEnter', entry)"
            >
              <td class="py-0.5 px-3 flex items-center gap-2 h-8">
                <div
                  class="h-4 flex items-center justify-center shrink-0"
                  :class="[
                    !props.hideUsageIndicators &&
                    entry.path &&
                    timelineMediaUsageStore.mediaPathToTimelines[entry.path]?.length
                      ? 'border-b-2 border-red-500'
                      : '',
                  ]"
                >
                  <UiProgressSpinner
                    v-if="proxyStore.generatingProxies.has(entry.path || '')"
                    :progress="proxyStore.proxyProgress.get(entry.path || '') ?? 0"
                    size="sm"
                  />
                  <UiProgressSpinner
                    v-else-if="isCheckingCompatibility(entry)"
                    :progress="25"
                    size="sm"
                    class="animate-spin"
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
                    class="w-4 h-4 object-contain rounded-sm"
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
                      getCompatibilityStatus(entry) !== 'ok' &&
                      getCompatibilityStatus(entry) !== 'checking'
                        ? 'text-red-400!'
                        : '',
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
                    getCompatibilityStatus(entry) !== 'ok' &&
                    getCompatibilityStatus(entry) !== 'checking'
                      ? 'text-red-400!'
                      : '',
                    isEntrySelected(entry)
                      ? 'hover:border-(--selection-accent-500)/50 border-(--selection-accent-500)/35 cursor-text'
                      : '',
                  ]"
                  :title="entry.name"
                  @click="onNameClick($event, entry)"
                  @dblclick="onNameDblClick()"
                >
                  {{ entry.name }}
                </span>
              </td>
              <td class="py-0.5 px-3 text-ui-text-muted">
                {{
                  entry.kind === 'directory'
                    ? t('common.folder')
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
                <FriendlyTime :date="entry.created" fallback="-" />
              </td>
              <td class="py-0.5 px-3 text-ui-text-muted">
                <FriendlyTime :date="entry.lastModified" fallback="-" />
              </td>
            </tr>
          </UContextMenu>
        </template>
      </tbody>
    </table>
  </div>
</template>
