<script setup lang="ts">
import type { FsEntry } from '~/types/fs';
import GlobalDropOverlayTree from '~/components/file-manager/GlobalDropOverlayTree.vue';

const props = defineProps<{
  entries: FsEntry[];
  depth: number;
  dropOverPath: string | null;
  getFolderIcon: (name: string) => string;
}>();

const emit = defineEmits<{
  (e: 'folderDragOver', event: DragEvent, path: string): void;
  (e: 'folderDragLeave', event: DragEvent, path: string): void;
  (e: 'folderDrop', event: DragEvent, path: string): void;
}>();
</script>

<template>
  <ul class="select-none">
    <li v-for="entry in entries" :key="entry.path ?? entry.name">
      <div
        class="flex items-center gap-2 py-1.5 px-3 rounded-lg cursor-default transition-all duration-150"
        :style="{ paddingLeft: `${12 + depth * 16}px` }"
        :class="
          dropOverPath === entry.path
            ? 'bg-primary-500/20 ring-2 ring-inset ring-primary-500/50'
            : 'hover:bg-ui-bg-hover/50'
        "
        @dragover="emit('folderDragOver', $event, entry.path ?? '')"
        @dragleave="emit('folderDragLeave', $event, entry.path ?? '')"
        @drop="emit('folderDrop', $event, entry.path ?? '')"
      >
        <UIcon :name="getFolderIcon(entry.name)" class="w-4 h-4 text-ui-text-muted/80 shrink-0" />
        <span class="text-sm text-ui-text truncate">
          {{ entry.name }}
        </span>
      </div>

      <!-- Recurse into children -->
      <GlobalDropOverlayTree
        v-if="entry.children && entry.children.length > 0"
        :entries="entry.children"
        :depth="depth + 1"
        :drop-over-path="dropOverPath"
        :get-folder-icon="getFolderIcon"
        @folder-drag-over="(e, p) => emit('folderDragOver', e, p)"
        @folder-drag-leave="(e, p) => emit('folderDragLeave', e, p)"
        @folder-drop="(e, p) => emit('folderDrop', e, p)"
      />
    </li>
  </ul>
</template>
