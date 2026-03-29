<script setup lang="ts">
import type { FsEntry } from '~/types/fs';
import UiConfirmModal from '~/components/ui/UiConfirmModal.vue';

const isOpen = defineModel<boolean>('open', { required: true });

const props = defineProps<{
  deleteTargets: FsEntry[];
}>();

const emit = defineEmits<{
  (e: 'confirm'): void;
}>();

const { t } = useI18n();
</script>

<template>
  <UiConfirmModal
    v-model:open="isOpen"
    :title="t('videoEditor.fileManager.delete.confirmTitle', 'Delete Items')"
    :description="
      t(
        'common.confirmDelete',
        'Are you sure you want to delete this? This action cannot be undone.',
      )
    "
    color="error"
    icon="i-heroicons-exclamation-triangle"
    @confirm="emit('confirm')"
  >
    <div>
      <div v-if="props.deleteTargets.length === 1" class="mt-2 text-sm font-medium text-ui-text">
        {{ props.deleteTargets[0]?.name }}
      </div>
      <div v-else-if="props.deleteTargets.length > 1" class="mt-2 text-sm font-medium text-ui-text">
        {{ props.deleteTargets.length }} {{ t('common.itemsSelected', 'items selected') }}
      </div>
      <div
        v-if="props.deleteTargets.length === 1 && props.deleteTargets[0]?.path"
        class="mt-1 text-xs text-ui-text-muted break-all"
      >
        {{
          props.deleteTargets[0].kind === 'directory'
            ? t('common.folder', 'Folder')
            : t('common.file', 'File')
        }}:
        {{ props.deleteTargets[0].path }}
      </div>
    </div>
  </UiConfirmModal>
</template>
