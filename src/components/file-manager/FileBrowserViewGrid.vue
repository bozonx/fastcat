<script setup lang="ts">
import { useProjectStore } from '~/stores/project.store';
import type { FsEntry } from '~/types/fs';
import type { FileCompatibility } from '~/composables/file-manager/useFileManagerCompatibility';
import type { ExtendedFsEntry, FileBrowserViewEmits } from '~/types/file-browser';
import {
  useFileBrowserEntry,
  useRenameTimer,
  getBdType,
  getBdThumbnail,
} from '~/composables/file-manager/useFileBrowserEntry';
import InlineNameEditor from '~/components/file-manager/InlineNameEditor.vue';
import UiProgressSpinner from '~/components/ui/UiProgressSpinner.vue';

const props = defineProps<{
  entries: ExtendedFsEntry[];
  dragOverEntryPath: string | null;
  currentDragOperation: 'copy' | 'move' | 'cancel' | null;
  currentGridSizeName: string;
  currentGridCardSize: number;
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

const emit = defineEmits<FileBrowserViewEmits>();

const { t } = useI18n();
const projectStore = useProjectStore();

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
  canRename: (entry) => isEntrySelected(entry),
});

function isEntrySelected(entry: FsEntry): boolean {
  if (props.selectedEntryPaths) {
    return Boolean(entry.path && props.selectedEntryPaths.includes(entry.path));
  }
  return isSelected(entry);
}
</script>

<template>
  <div class="flex flex-wrap gap-2 content-start">
    <UContextMenu v-for="entry in entries" :key="entry.path" :items="getContextMenuItems(entry)">
      <div
        :data-entry-path="entry.path ?? null"
        class="flex flex-col items-center p-2 rounded-lg border border-transparent hover:border-ui-border hover:bg-ui-bg-elevated cursor-pointer group transition-all shrink-0 focus:outline-none"
        :class="{
          'ring-1 ring-(--selection-ring) bg-(--selection-range-bg)':
            isEntrySelected(entry) && editingEntryPath !== entry.path,
          'text-(--color-success)!':
            fileManager.mediaCache?.hasProxy?.(entry.path || '') &&
            !proxyStore.generatingProxies.has(entry.path || ''),
          'text-amber-400!':
            proxyStore.generatingProxies.has(entry.path || '') ||
            isGeneratingProxyInDirectory(entry),
          'border-b-2 border-b-red-500':
            !props.hideUsageIndicators &&
            entry.path &&
            timelineMediaUsageStore.mediaPathToTimelines[entry.path]?.length,
          'opacity-30': entry.name.startsWith('.'),
          'opacity-50': isCutEntry(entry),
          'ring-2 ring-red-500 bg-red-500/10':
            dragOverEntryPath === (entry.path ?? null) && props.currentDragOperation === 'cancel',
          'ring-2 ring-primary-500 bg-primary-500/20':
            dragOverEntryPath === (entry.path ?? null) && props.currentDragOperation === 'move',
          'ring-2 ring-emerald-500 bg-emerald-500/15':
            dragOverEntryPath === (entry.path ?? null) && props.currentDragOperation === 'copy',
        }"
        :style="{ width: `${props.currentGridCardSize}px` }"
        tabindex="0"
        @pointerdown="!isCheckingCompatibility(entry) && emit('entryPointerDown', $event, entry)"
        @click="emit('entryClick', $event, entry)"
        @dblclick="emit('entryDoubleClick', entry)"
        @keydown.enter.prevent.stop="emit('entryEnter', entry)"
      >
        <div
          class="relative mb-2 w-full aspect-square flex items-center justify-center bg-ui-bg rounded overflow-hidden"
          :class="{
            'bg-ui-bg!': entry.path && entry.path === projectStore.currentTimelinePath,
          }"
        >
          <div
            v-if="entry.kind === 'file' && isCheckingCompatibility(entry)"
            class="w-full h-full flex items-center justify-center text-ui-text-muted"
            :title="t('videoEditor.fileManager.compatibility.checking')"
          >
            <UiProgressSpinner :progress="25" size="md" class="animate-spin" />
          </div>
          <!-- Fully unsupported / Corrupt: red placeholder instead of thumbnail -->
          <div
            v-else-if="
              entry.kind === 'file' &&
              (getCompatibilityStatus(entry) === 'fully_unsupported' ||
                getCompatibilityStatus(entry) === 'corrupt')
            "
            class="w-full h-full flex flex-col items-center justify-center bg-red-950/60 text-red-400 gap-1 p-1"
          >
            <UIcon name="i-heroicons-exclamation-triangle" class="w-6 h-6 shrink-0" />
            <span class="text-xs text-center font-bold leading-tight uppercase">{{
              getCompatibilityStatus(entry) === 'corrupt'
                ? t('videoEditor.fileManager.compatibility.corrupt')
                : t('videoEditor.fileManager.compatibility.unsupported')
            }}</span>
          </div>
          <img
            v-else-if="
              ((entry.kind === 'file' || getBdType(entry) === 'content-item') && entry.objectUrl) ||
              getBdThumbnail(entry)
            "
            :src="entry.objectUrl || getBdThumbnail(entry)"
            :alt="entry.name"
            class="max-w-full max-h-full object-contain checkerboard-bg"
            draggable="false"
            @error="handleImageError(entry)"
          />
          <img
            v-else-if="
              entry.kind === 'file' && videoThumbnails && entry.path && videoThumbnails[entry.path]
            "
            :src="videoThumbnails[entry.path]"
            :alt="entry.name"
            class="max-w-full max-h-full object-contain checkerboard-bg"
            draggable="false"
            @error="handleImageError(entry)"
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
              fileManager.mediaCache?.hasProxy?.(entry.path || '') &&
              !proxyStore.generatingProxies.has(entry.path || '')
                ? 'text-(--color-success)!'
                : '',
              proxyStore.generatingProxies.has(entry.path || '') ||
              isGeneratingProxyInDirectory(entry)
                ? 'text-amber-400/90'
                : '',
              {
                'w-10 h-10': currentGridSizeName.toLowerCase() === 'xs',
                'w-12 h-12': currentGridSizeName.toLowerCase() === 's',
                'w-16 h-16': currentGridSizeName.toLowerCase() === 'm',
                'w-24 h-24': currentGridSizeName.toLowerCase() === 'l',
                'w-32 h-32': currentGridSizeName.toLowerCase() === 'xl',
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
            fileManager.mediaCache?.hasProxy?.(entry.path || '') &&
            !proxyStore.generatingProxies.has(entry.path || '')
              ? 'text-(--color-success)!'
              : '',
            proxyStore.generatingProxies.has(entry.path || '') ||
            isGeneratingProxyInDirectory(entry)
              ? 'text-amber-400!'
              : '',
            getCompatibilityStatus(entry) !== 'ok' && getCompatibilityStatus(entry) !== 'checking'
              ? 'text-red-400!'
              : '',
            {
              'text-xs':
                currentGridSizeName.toLowerCase() === 'xs' ||
                currentGridSizeName.toLowerCase() === 's' ||
                currentGridSizeName.toLowerCase() === 'm',
              'text-sm':
                currentGridSizeName.toLowerCase() === 'l' ||
                currentGridSizeName.toLowerCase() === 'xl',
            },
            isEntrySelected(entry)
              ? 'hover:border-(--selection-accent-500)/50 border-(--selection-accent-500)/35 cursor-text'
              : '',
          ]"
          :style="{
            color:
              entry.path && entry.path === projectStore.currentTimelinePath
                ? 'var(--selection-accent-400)'
                : undefined,
          }"
          :title="entry.name"
          @click="onNameClick($event, entry)"
          @dblclick="onNameDblClick()"
        >
          {{ entry.name }}
        </span>
      </div>
    </UContextMenu>
  </div>
</template>
