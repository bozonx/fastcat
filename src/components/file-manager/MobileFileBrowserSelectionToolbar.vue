<script setup lang="ts">
import type { FsEntry } from '~/types/fs';
import type { FileAction } from '~/composables/file-manager/useFileManagerActions';

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
  <div class="border-t border-slate-800 bg-slate-900 px-4 py-4 flex flex-col gap-4 z-40 shrink-0">
    <div v-if="canAddToTimeline" class="flex justify-center px-2">
      <UButton
        size="xl"
        variant="solid"
        icon="lucide:plus"
        class="w-full rounded-2xl shadow-xl font-bold active:scale-95 transition-all text-white border-none bg-ui-action hover:bg-ui-action-hover shadow-ui-action/20"
        @click="emit('add-to-timeline')"
      >
        {{ t('common.addToTimeline', 'Add to timeline') }}
      </UButton>
    </div>

    <div class="flex items-center justify-around">
      <div class="flex flex-col items-center gap-1">
        <UButton
          icon="lucide:trash-2"
          size="xl"
          variant="soft"
          color="red"
          class="rounded-2xl w-14 h-14"
          @click="emit('action', 'delete', props.selectedEntries)"
        />
        <span class="text-xs font-medium text-red-400">{{ t('common.delete', 'Delete') }}</span>
      </div>

      <div v-if="selectedEntries.length === 1" class="flex flex-col items-center gap-1">
        <UButton
          icon="lucide:pen-line"
          size="xl"
          variant="soft"
          color="neutral"
          class="rounded-2xl w-14 h-14"
          @click="emit('action', 'rename', props.selectedEntries[0]!)"
        />
        <span class="text-xs font-medium text-slate-400">{{ t('common.rename', 'Rename') }}</span>
      </div>

      <div class="flex flex-col items-center gap-1">
        <UButton
          icon="lucide:copy"
          size="xl"
          variant="soft"
          color="neutral"
          class="rounded-2xl w-14 h-14"
          @click="emit('action', 'copy', props.selectedEntries)"
        />
        <span class="text-xs font-medium text-slate-400">{{ t('common.copy', 'Copy') }}</span>
      </div>

      <div class="flex flex-col items-center gap-1">
        <UButton
          icon="lucide:scissors"
          size="xl"
          variant="soft"
          color="neutral"
          class="rounded-2xl w-14 h-14"
          @click="emit('action', 'cut', props.selectedEntries)"
        />
        <span class="text-xs font-medium text-slate-400">{{ t('common.cut', 'Cut') }}</span>
      </div>
    </div>
  </div>
</template>
