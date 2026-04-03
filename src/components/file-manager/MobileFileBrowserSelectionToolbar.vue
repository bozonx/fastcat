<script setup lang="ts">
import type { FsEntry } from '~/types/fs';
import type { FileAction } from '~/composables/file-manager/useFileManagerActions';
import MobileDrawerToolbar from '~/components/timeline/MobileDrawerToolbar.vue';
import MobileDrawerToolbarButton from '~/components/timeline/MobileDrawerToolbarButton.vue';

const props = defineProps<{
  selectedEntries: FsEntry[];
  canAddToTimeline: boolean;
}>();

const emit = defineEmits<{
  (e: 'action', action: FileAction, entries: FsEntry[] | FsEntry): void;
  (e: 'add-to-timeline'): void;
}>();

const { t } = useI18n();
</script>

<template>
  <div class="border-t border-zinc-800 bg-zinc-900 flex flex-col z-40 shrink-0 pb-safe container-safe">
    <MobileDrawerToolbar>
      <MobileDrawerToolbarButton
        v-if="canAddToTimeline"
        success
        icon="lucide:plus"
        :label="t('common.toTimeline', 'To timeline')"
        @click="emit('add-to-timeline')"
      />

      <MobileDrawerToolbarButton
        icon="i-heroicons-trash"
        :label="t('common.delete', 'Delete')"
        @click="emit('action', 'delete', props.selectedEntries)"
      />

      <MobileDrawerToolbarButton
        v-if="selectedEntries.length === 1"
        icon="i-heroicons-pencil-square"
        :label="t('common.rename', 'Rename')"
        @click="emit('action', 'rename', props.selectedEntries[0]!)"
      />

      <MobileDrawerToolbarButton
        icon="i-heroicons-document-duplicate"
        :label="t('common.copy', 'Copy')"
        @click="emit('action', 'copy', props.selectedEntries)"
      />

      <MobileDrawerToolbarButton
        icon="i-heroicons-scissors"
        :label="t('common.cut', 'Cut')"
        @click="emit('action', 'cut', props.selectedEntries)"
      />
    </MobileDrawerToolbar>
  </div>
</template>

<style scoped>
.pb-safe {
  padding-bottom: env(safe-area-inset-bottom, 0);
}
</style>
