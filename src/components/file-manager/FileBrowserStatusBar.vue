<script setup lang="ts">
import { inject } from 'vue';
import { useFileManagerStore } from '~/stores/file-manager.store';

defineProps<{
  stats: {
    totalSize: string;
    fileCount: number;
  };
}>();

const { t } = useI18n();
const fileManagerStore = inject('fileManagerStore') as ReturnType<typeof useFileManagerStore> || useFileManagerStore();
</script>

<template>
  <div
    class="px-4 py-2 border-t border-ui-border shrink-0 bg-ui-bg-elevated/50 flex items-center justify-end text-2xs uppercase font-bold tracking-wider text-ui-text-muted"
  >
    <div v-if="fileManagerStore.selectedFolder" class="flex items-center gap-4">
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
