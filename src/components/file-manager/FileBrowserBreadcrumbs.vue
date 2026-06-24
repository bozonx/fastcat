<script setup lang="ts">
import type { FsEntry } from '~/types/fs';
import { useHotkeyLabel } from '~/composables/useHotkeyLabel';
import UiTooltip from '~/components/ui/UiTooltip.vue';

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
const { getHotkeyTitle } = useHotkeyLabel();
</script>

<template>
  <div
    class="file-browser-breadcrumbs flex items-center gap-1 px-4 py-2 border-b border-ui-border/50 bg-ui-bg-accent/30 shrink-0"
  >
    <UiTooltip
      :text="
        getHotkeyTitle(
          t('videoEditor.hotkeys.general.navigateBack'),
          'general.navigateBack',
        )
      "
    >
      <UButton
        variant="ghost"
        color="neutral"
        size="xs"
        icon="i-heroicons-arrow-left"
        :disabled="!canNavigateBack"
        @click="emit('navigateBack')"
      />
    </UiTooltip>
    <UiTooltip
      :text="
        getHotkeyTitle(
          t('videoEditor.hotkeys.general.navigateForward'),
          'general.navigateForward',
        )
      "
    >
      <UButton
        variant="ghost"
        color="neutral"
        size="xs"
        icon="i-heroicons-arrow-right"
        :disabled="!canNavigateForward"
        @click="emit('navigateForward')"
      />
    </UiTooltip>
    <UiTooltip
      :text="getHotkeyTitle(t('videoEditor.fileManager.actions.navigateUp'), 'general.navigateUp')"
    >
      <UButton
        variant="ghost"
        color="neutral"
        size="xs"
        icon="i-heroicons-arrow-up"
        :disabled="isAtRoot"
        @click="emit('navigateUp')"
      />
    </UiTooltip>

    <div class="flex items-center gap-1 ml-2 overflow-x-auto">
      <template v-for="(folder, index) in parentFolders" :key="folder.path">
        <button
          class="text-xs text-ui-text-muted hover:text-ui-text transition-colors shrink-0 truncate max-w-[120px]"
          :class="{ 'text-ui-text font-medium': index === parentFolders.length - 1 }"
          :title="folder.name"
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
