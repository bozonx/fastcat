<script setup lang="ts">
import UiModal from '~/components/ui/UiModal.vue';
import TimelineSnapSettings from './TimelineSnapSettings.vue';

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
}>();

const { t } = useI18n();

const isOpen = computed({
  get: () => props.open,
  set: (v) => emit('update:open', v),
});
</script>

<template>
  <UiModal
    v-model:open="isOpen"
    :title="t('videoEditor.settings.snappingTitle', 'Snapping')"
    :ui="{
      content: 'sm:max-w-lg',
    }"
  >
    <div class="px-6 py-4">
      <TimelineSnapSettings />
    </div>
  </UiModal>
</template>
