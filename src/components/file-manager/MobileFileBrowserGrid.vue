<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue';
import type { FsEntry } from '~/types/fs';
import { formatBytes } from '~/utils/format';
import { getMediaTypeFromFilename, getMimeTypeFromFilename } from '~/utils/media-types';
import { useFileManager } from '~/composables/fileManager/useFileManager';

interface ExtendedFsEntry extends FsEntry {
  objectUrl?: string;
  size?: number;
}

const props = defineProps<{
  entries: ExtendedFsEntry[];
  thumbnails: Record<string, string>;
  selectedEntryPath: string | null;
  selectedEntries: FsEntry[];
  isSelectionMode: boolean;
  isLoading?: boolean;
  folderSizes: Record<string, number>;
}>();

const emit = defineEmits<{
  (e: 'entryClick', entry: FsEntry): void;
  (e: 'entryPrimaryAction', entry: FsEntry): void;
  (e: 'longPress', entry: FsEntry): void;
  (e: 'toggleSelection', entry: FsEntry): void;
}>();

const { t } = useI18n();
const { getFileIcon } = useFileManager();

const longPressTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const isLongPressActive = ref(false);

function startLongPress(entry: FsEntry) {
  isLongPressActive.value = false;
  longPressTimer.value = setTimeout(() => {
    isLongPressActive.value = true;
    emit('longPress', entry);
  }, 600); // 600ms для лонг-пресса
}

function clearLongPress() {
  if (longPressTimer.value) {
    clearTimeout(longPressTimer.value);
    longPressTimer.value = null;
  }
}

function handleTouchStart(entry: FsEntry) {
  startLongPress(entry);
}

function handleTouchEnd(entry: FsEntry, event: TouchEvent) {
  if (isLongPressActive.value) {
    event.preventDefault();
  }
  clearLongPress();
}

function handleClick(entry: FsEntry) {
  if (isLongPressActive.value) {
    isLongPressActive.value = false;
    return;
  }

  if (props.isSelectionMode) {
    emit('toggleSelection', entry);
  } else {
    emit('entryClick', entry);
  }
}

function getIcon(entry: FsEntry) {
  return getFileIcon(entry);
}

function getFileTypeLabel(entry: FsEntry) {
  if (entry.name.toLowerCase().endsWith('.otio')) return 'timeline/otio';
  return getMimeTypeFromFilename(entry.name);
}

function isSelected(entry: FsEntry) {
  if (props.isSelectionMode) {
    return props.selectedEntries.some((e) => e.path === entry.path);
  }
  return props.selectedEntryPath === entry.path;
}

function getThumbnail(entry: FsEntry) {
  if (entry.kind === 'directory') return null;
  return (entry as ExtendedFsEntry).objectUrl || (entry.path ? props.thumbnails[entry.path] : null);
}

onBeforeUnmount(clearLongPress);
</script>

<template>
  <div class="p-3">
    <div v-if="isLoading" class="flex h-32 items-center justify-center">
      <Icon name="lucide:loader-2" class="w-6 h-6 animate-spin text-blue-500" />
    </div>

    <div
      v-else-if="entries.length === 0"
      class="flex flex-col items-center justify-center h-64 opacity-30"
    >
      <Icon name="lucide:folder-open" class="w-12 h-12 mb-2" />
      <p class="text-sm">Empty folder</p>
    </div>

    <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      <div v-for="entry in entries" :key="entry.path" class="relative group">
        <button
          class="flex flex-col w-full aspect-square rounded-2xl overflow-hidden bg-slate-900 border-2 transition-all active:scale-95"
          :class="[
            isSelected(entry)
              ? 'border-blue-500 ring-2 ring-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.3)]'
              : 'border-transparent hover:border-slate-700',
          ]"
          @touchstart="handleTouchStart(entry)"
          @touchend="handleTouchEnd(entry, $event)"
          @mousedown="startLongPress(entry)"
          @mouseup="clearLongPress"
          @mouseleave="clearLongPress"
          @click="handleClick(entry)"
        >
          <!-- Thumbnail / Icon Area -->
          <div
            class="relative flex-1 w-full bg-slate-950 flex items-center justify-center overflow-hidden"
          >
            <template v-if="getThumbnail(entry)">
              <img
                :src="getThumbnail(entry)!"
                class="w-full h-full object-cover transition-transform duration-300"
                :class="{ 'scale-110 blur-[1px] opacity-70': isSelected(entry) && isSelectionMode }"
                loading="lazy"
              />
            </template>
            <template v-else>
              <UIcon
                :name="getIcon(entry)"
                class="opacity-40 transition-transform"
                :class="[
                  entry.kind === 'directory' ? 'w-32 h-32 text-blue-400' : 'w-10 h-10',
                  isSelected(entry) ? 'scale-110' : '',
                ]"
              />
            </template>

            <div
              v-if="isSelectionMode"
              class="absolute top-2 left-2 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all"
              :class="[
                isSelected(entry)
                  ? 'bg-blue-500 border-blue-500 shadow-lg'
                  : 'bg-black/20 border-white/40',
              ]"
            >
              <Icon v-if="isSelected(entry)" name="lucide:check" class="w-4 h-4 text-white" />
            </div>
          </div>

          <!-- Name & Size -->
          <div class="px-2.5 py-2 bg-slate-900/90 backdrop-blur-sm border-t border-slate-800/50">
            <div
              class="truncate text-[11px] font-medium leading-tight mb-0.5 transition-colors"
              :class="{ 'text-blue-400': isSelected(entry) }"
            >
              {{ entry.name }}
            </div>
            <div class="flex items-center justify-between opacity-80 text-[9px] tabular-nums mt-0.5 font-medium">
              <span class="truncate pr-2 text-slate-400">
                {{ entry.kind === 'directory' ? t('common.folder', 'Folder') : getFileTypeLabel(entry) }}
              </span>
              <span class="shrink-0 text-slate-500">
                {{
                  entry.kind === 'directory'
                    ? props.folderSizes[entry.path] !== undefined
                      ? formatBytes(props.folderSizes[entry.path]!)
                      : '...'
                    : formatBytes(entry.size || 0)
                }}
              </span>
            </div>
          </div>
        </button>

      </div>
    </div>
  </div>
</template>
