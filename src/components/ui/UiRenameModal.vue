<script setup lang="ts">
import UiEntityCreationModal from '~/components/ui/UiEntityCreationModal.vue';

const props = defineProps<{
  title?: string;
  initialName?: string;
  currentName?: string;
  loading?: boolean;
}>();

const emit = defineEmits<{
  (e: 'rename', newName: string): void;
}>();

const isOpen = defineModel<boolean>('open', { required: true });

const { t } = useI18n();
</script>

<template>
  <UiEntityCreationModal
    v-model:open="isOpen"
    :title="title || t('common.rename', 'Rename')"
    :default-value="props.initialName ?? props.currentName"
    :loading="props.loading"
    @confirm="emit('rename', $event)"
  />
</template>
