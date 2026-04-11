<script setup lang="ts">
import type { FsEntry } from '~/types/fs';

defineProps<{
  parentFolders: FsEntry[];
  isAtRoot?: boolean;
  canNavigateBack?: boolean;
  canNavigateForward?: boolean;
}>();

const emit = defineEmits<{
  (e: 'navigateBack' | 'navigateForward' | 'navigateUp'): void;
  (e: 'navigateToFolder', index: number): void;
}>();

const { t } = useI18n();
</script>

<template>
  <div
    class="flex items-center gap-1 px-4 py-2 border-b border-ui-border/50 bg-ui-bg-accent/30 shrink-0"
  >
    <UButton
      variant="ghost"
      color="neutral"
      size="xs"
      icon="i-heroicons-arrow-left"
      :disabled="!canNavigateBack"
      @click="emit('navigateBack')"
    />
    <UButton
      variant="ghost"
      color="neutral"
      size="xs"
      icon="i-heroicons-arrow-right"
      :disabled="!canNavigateForward"
      @click="emit('navigateForward')"
    />
    <UButton
      variant="ghost"
      color="neutral"
      size="xs"
      icon="i-heroicons-arrow-up"
      :disabled="isAtRoot"
      :title="t('videoEditor.fileManager.actions.navigateUp')"
      @click="emit('navigateUp')"
    />

    <div class="flex items-center gap-1 ml-2 overflow-x-auto">
      <template v-for="(folder, index) in parentFolders" :key="folder.path">
        <button
          class="text-xs text-ui-text-muted hover:text-ui-text transition-colors shrink-0 truncate max-w-[120px]"
          :class="{ 'text-ui-text font-medium': index === parentFolders.length - 1 }"
          @click="emit('navigateToFolder', index)"
        >
          {{ folder.name }}
        </button>
        <UIcon
          v-if="index < parentFolders.length - 1"
          name="i-heroicons-chevron-right"
          class="w-3 h-3 text-ui-text-muted shrink-0"
        />
      </template>
    </div>
  </div>
</template>
