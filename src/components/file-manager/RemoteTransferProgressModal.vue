<script setup lang="ts">
import UiModal from '~/components/ui/UiModal.vue';

const props = defineProps<{
  open: boolean;
  title: string;
  description?: string;
  progress: number;
  phase?: string;
  fileName?: string;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  cancel: [];
}>();

const { t } = useI18n();

const isOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value),
});

const progressPercent = computed(() =>
  Math.max(0, Math.min(100, Math.round(props.progress * 100))),
);
</script>

<template>
  <UiModal
    v-model:open="isOpen"
    :title="title"
    :description="description"
    :prevent-close="true"
    :close-button="false"
    :ui="{ content: 'sm:max-w-lg' }"
  >
    <div class="flex flex-col gap-4">
      <div v-if="fileName" class="text-sm font-medium text-ui-text break-all">
        {{ fileName }}
      </div>
      <div v-if="phase" class="text-xs text-ui-text-muted">
        {{ phase }}
      </div>
      <div class="w-full h-2 rounded-full bg-ui-bg overflow-hidden">
        <div
          class="h-full bg-primary-500 transition-all duration-150"
          :style="{ width: `${progressPercent}%` }"
        />
      </div>
      <div class="text-xs text-ui-text-muted">{{ progressPercent }}%</div>
    </div>

    <template #footer>
      <UButton color="error" variant="soft" @click="emit('cancel')">
        {{ t('common.cancel') }}
      </UButton>
    </template>
  </UiModal>
</template>
