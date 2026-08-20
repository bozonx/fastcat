<script setup lang="ts">
import UiEntityCreationModal from '~/components/ui/UiEntityCreationModal.vue';

const props = withDefaults(
  defineProps<{
    title?: string;
    initialName?: string;
    currentName?: string;
    loading?: boolean;
    selectWithoutExtension?: boolean;
    validate?: (name: string) => string | boolean | null | undefined;
  }>(),
  {
    title: '',
    initialName: '',
    currentName: '',
    selectWithoutExtension: false,
    validate: undefined,
  },
);

const emit = defineEmits<{
  (e: 'rename', newName: string): void;
}>();

const isOpen = defineModel<boolean>('open', { required: true });

const { t } = useI18n();
</script>

<template>
  <UiEntityCreationModal
    v-model:open="isOpen"
    :title="title || t('common.rename')"
    :default-value="props.initialName || props.currentName"
    :loading="props.loading"
    :select-without-extension="props.selectWithoutExtension"
    :validate="props.validate"
    @confirm="
      emit('rename', $event);
      isOpen = false;
    "
  />
</template>
