<script setup lang="ts">
import type { FsEntry } from '~/types/fs';
import ProgressSpinner from '~/components/ui/ProgressSpinner.vue';
import InlineNameEditor from '~/components/file-manager/InlineNameEditor.vue';

interface EntryMeta {
  hasProxy: boolean;
  generatingProxy: boolean;
  proxyProgress?: number;
  isUsedInTimeline?: boolean;
}

const props = defineProps<{
  entry: FsEntry;
  depth: number;
  isDragOver: boolean;
  editingEntryPath?: string | null;
  existingNames: string[];
  fileIcon: string;
  selected: boolean;
  showChevron: boolean;
  iconClass: string;
  nameClass: string;
  meta: EntryMeta;
}>();

const emit = defineEmits<{
  (e: 'click', event: MouseEvent): void;
  (e: 'dblclick'): void;
  (e: 'keydown-enter', event: KeyboardEvent): void;
  (e: 'keydown-space', event: KeyboardEvent): void;
  (e: 'dragstart', event: DragEvent): void;
  (e: 'dragend'): void;
  (e: 'dragover', event: DragEvent): void;
  (e: 'dragleave', event: DragEvent): void;
  (e: 'drop', event: DragEvent): void;
  (e: 'caret-click', event: MouseEvent): void;
  (e: 'commit-rename', name: string): void;
  (e: 'stop-rename'): void;
}>();
</script>

<template>
  <div
    class="flex items-center gap-1.5 py-1 pr-2 rounded cursor-pointer hover:bg-ui-bg-hover transition-colors group min-w-fit"
    :data-entry-path="entry.path ?? undefined"
    :style="{ paddingLeft: `${8 + depth * 14}px` }"
    :class="[
      isDragOver ? 'bg-primary-500/20 outline outline-primary-500 -outline-offset-1' : '',
      selected ? 'bg-ui-bg-elevated outline-1 outline-(--selection-ring) -outline-offset-1' : '',
    ]"
    :draggable="true"
    :aria-selected="selected"
    :aria-expanded="entry.kind === 'directory' ? entry.expanded : undefined"
    :aria-level="depth + 1"
    role="treeitem"
    tabindex="0"
    @keydown.enter.prevent="emit('keydown-enter', $event)"
    @keydown.space.prevent="emit('keydown-space', $event)"
    @dragstart="emit('dragstart', $event)"
    @dragend="emit('dragend')"
    @dragover.prevent="emit('dragover', $event)"
    @dragleave.prevent="emit('dragleave', $event)"
    @drop.prevent="emit('drop', $event)"
    @click="emit('click', $event)"
    @dblclick.stop="emit('dblclick')"
  >
    <!-- Chevron -->
    <UIcon
      v-if="showChevron"
      name="i-heroicons-chevron-right"
      class="w-3.5 h-3.5 text-ui-text-muted shrink-0 transition-transform duration-150"
      :class="{ 'rotate-90': entry.expanded }"
      :aria-hidden="true"
      @click="emit('caret-click', $event)"
    />
    <span v-else class="w-3.5 shrink-0" />

    <!-- Icon -->
    <div class="w-4 shrink-0 flex items-center justify-center">
      <div
        class="h-4 flex items-center justify-center"
        :class="[meta.isUsedInTimeline ? 'border-b-2 border-red-500' : '']"
      >
        <div
          v-if="meta.generatingProxy"
          class="w-4 h-4 shrink-0 relative flex items-center justify-center"
          :title="`${meta.proxyProgress ?? 0}%`"
        >
          <ProgressSpinner :progress="meta.proxyProgress ?? 0" size="sm" />
        </div>
        <UIcon
          v-else
          :name="fileIcon"
          class="w-4 h-4 shrink-0 transition-colors"
          :class="iconClass"
        />
      </div>
    </div>

    <!-- Name -->
    <InlineNameEditor
      v-if="editingEntryPath === entry.path"
      :initial-name="entry.name"
      :is-folder="entry.kind === 'directory'"
      :existing-names="existingNames"
      @save="(name) => emit('commit-rename', name)"
      @cancel="emit('stop-rename')"
    />
    <span v-else class="text-sm truncate transition-colors" :class="nameClass">
      {{ entry.name }}
    </span>
  </div>
</template>
