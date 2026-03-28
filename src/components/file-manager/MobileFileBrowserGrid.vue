<script setup lang="ts">
import type { FsEntry } from '~/types/fs';
import { formatBytes } from '~/utils/format';
import { getMediaTypeFromFilename } from '~/utils/media-types';

interface ExtendedFsEntry extends FsEntry {
  objectUrl?: string;
  size?: number;
}

const props = defineProps<{
  entries: ExtendedFsEntry[];
  thumbnails: Record<string, string>;
  selectedEntryPath: string | null;
  isLoading?: boolean;
}>();

const emit = defineEmits<{
  (e: 'entryClick', entry: FsEntry): void;
  (e: 'entryPrimaryAction', entry: FsEntry): void;
}>();

const { t } = useI18n();

function getIcon(entry: FsEntry) {
  if (entry.kind === 'directory') return 'lucide:folder';
  const type = getMediaTypeFromFilename(entry.name);
  switch (type) {
    case 'video': return 'lucide:video';
    case 'audio': return 'lucide:music';
    case 'image': return 'lucide:image';
    case 'text': return 'lucide:file-text';
    default: return 'lucide:file';
  }
}

function isSelected(entry: FsEntry) {
  return props.selectedEntryPath === entry.path;
}

function getThumbnail(entry: FsEntry) {
  if (entry.kind === 'directory') return null;
  // Сначала проверяем objectUrl (для картинок), потом глобальные миниатюры (для видео)
  return (entry as ExtendedFsEntry).objectUrl || (entry.path ? props.thumbnails[entry.path] : null);
}
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
      <div
        v-for="entry in entries"
        :key="entry.path"
        class="relative group"
      >
        <button
          class="flex flex-col w-full aspect-square rounded-2xl overflow-hidden bg-slate-900 border-2 transition-all active:scale-95"
          :class="[
            isSelected(entry) 
              ? 'border-blue-500 ring-2 ring-blue-500/20' 
              : 'border-transparent hover:border-slate-700'
          ]"
          @click="emit('entryClick', entry)"
        >
          <!-- Thumbnail / Icon Area -->
          <div class="relative flex-1 w-full bg-slate-950 flex items-center justify-center overflow-hidden">
            <template v-if="getThumbnail(entry)">
              <img 
                :src="getThumbnail(entry)!" 
                class="w-full h-full object-cover"
                loading="lazy"
              />
            </template>
            <template v-else>
              <Icon 
                :name="getIcon(entry)" 
                class="w-10 h-10 opacity-40"
                :class="{ 'text-blue-400': entry.kind === 'directory' }"
              />
            </template>

            <!-- Folder Overlay -->
            <div v-if="entry.kind === 'directory'" class="absolute inset-0 bg-blue-500/5 flex items-end p-2">
               <Icon name="lucide:folder" class="w-4 h-4 text-blue-400" />
            </div>

            <!-- Media Type Badge -->
            <div 
              v-if="entry.kind === 'file'"
              class="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-black/60 backdrop-blur-md text-[10px] font-medium text-white/80"
            >
              {{ getMediaTypeFromFilename(entry.name) }}
            </div>
          </div>

          <!-- Name & Size -->
          <div class="px-2.5 py-2 bg-slate-900/90 backdrop-blur-sm border-t border-slate-800/50">
            <div class="truncate text-[11px] font-medium leading-tight mb-0.5">
              {{ entry.name }}
            </div>
            <div class="flex items-center justify-between opacity-50 text-[9px] tabular-nums">
              <span>{{ entry.kind === 'directory' ? 'Folder' : formatBytes(entry.size || 0) }}</span>
            </div>
          </div>
        </button>

        <!-- Quick Add Action (Floating button) -->
        <UButton
          v-if="entry.kind === 'file'"
          icon="lucide:plus"
          size="xs"
          color="primary"
          class="absolute -top-1 -right-1 rounded-full shadow-lg opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity"
          @click.stop="emit('entryPrimaryAction', entry)"
        />
      </div>
    </div>
  </div>
</template>
