<script setup lang="ts">
import { useFilesPageStore } from '~/stores/files-page.store';

defineProps<{
  stats: {
    totalSize: string;
    fileCount: number;
  };
}>();

const { t } = useI18n();
const filesPageStore = useFilesPageStore();
</script>

<template>
  <div
    class="px-4 py-2 border-t border-ui-border shrink-0 bg-ui-bg-elevated/50 flex items-center justify-end text-[10px] uppercase font-bold tracking-wider text-ui-text-muted"
  >
    <div v-if="filesPageStore.selectedFolder" class="flex items-center gap-4">
      <span>
        {{ t('common.totalSize', 'Total Size') }}:
        <span class="text-ui-text">{{ stats.totalSize }}</span>
      </span>
      <span>
        {{ t('common.filesCount', 'Files') }}:
        <span class="text-ui-text">{{ stats.fileCount }}</span>
      </span>
    </div>
  </div>
</template>
