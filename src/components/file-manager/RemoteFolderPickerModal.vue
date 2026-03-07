<script setup lang="ts">
import AppModal from '~/components/ui/AppModal.vue';
import type { RemoteFsEntry } from '~/utils/remote-vfs';

const props = defineProps<{
  open: boolean;
  title: string;
  folders: RemoteFsEntry[];
  currentPath: string;
  loading: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  navigate: [entry: RemoteFsEntry | null];
  confirm: [entry: RemoteFsEntry | null];
}>();

const { t } = useI18n();

const isOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value),
});
</script>

<template>
  <AppModal
    v-model:open="isOpen"
    :title="title"
    :ui="{ content: 'sm:max-w-xl max-h-[80vh]' }"
  >
    <div class="flex flex-col gap-4 min-h-0">
      <div class="text-xs text-ui-text-muted break-all">
        {{ currentPath || '/' }}
      </div>

      <div class="flex gap-2">
        <UButton variant="ghost" color="neutral" size="xs" @click="emit('navigate', null)">
          {{ t('common.root', 'Root') }}
        </UButton>
      </div>

      <div class="min-h-0 max-h-[50vh] overflow-auto rounded-lg border border-ui-border">
        <div v-if="loading" class="flex items-center justify-center py-8 text-ui-text-muted text-sm">
          {{ t('common.loading', 'Loading...') }}
        </div>
        <div v-else-if="folders.length === 0" class="flex items-center justify-center py-8 text-ui-text-muted text-sm">
          {{ t('common.empty', 'Folder is empty') }}
        </div>
        <button
          v-for="folder in folders"
          :key="folder.remoteId"
          type="button"
          class="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-ui-bg-elevated border-b last:border-b-0 border-ui-border/60"
          @dblclick="emit('navigate', folder)"
          @click="emit('confirm', folder)"
        >
          <span class="flex items-center gap-2 min-w-0">
            <UIcon name="i-heroicons-folder" class="w-4 h-4 text-blue-400 shrink-0" />
            <span class="truncate text-sm text-ui-text">{{ folder.name }}</span>
          </span>
          <UIcon name="i-heroicons-chevron-right" class="w-4 h-4 text-ui-text-muted shrink-0" />
        </button>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton variant="ghost" color="neutral" @click="isOpen = false">
          {{ t('common.cancel', 'Cancel') }}
        </UButton>
      </div>
    </template>
  </AppModal>
</template>
