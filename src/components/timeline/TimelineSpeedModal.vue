<script setup lang="ts">
import { computed } from 'vue';
import type { TimelineClipItem } from '~/timeline/types';
import AppModal from '~/components/ui/AppModal.vue';
import WheelNumberInput from '~/components/ui/WheelNumberInput.vue';

const { t } = useI18n();

const props = defineProps<{
  open: boolean;
  speed: number;
  hasAudio: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'update:speed', value: number): void;
  (e: 'save'): void;
}>();

const speedValue = computed({
  get: () => props.speed,
  set: (v) => emit('update:speed', v),
});

const isOpen = computed({
  get: () => props.open,
  set: (v) => emit('update:open', v),
});

const showNegativeSpeedAudioWarning = computed(() => props.speed < 0 && props.hasAudio);
const showLowSpeedWarning = computed(() => Math.abs(props.speed) > 0 && Math.abs(props.speed) < 0.1);
</script>

<template>
  <AppModal
    v-model:open="isOpen"
    :title="t('granVideoEditor.timeline.speedModalTitle')"
    :description="t('granVideoEditor.timeline.speedModalDescription')"
    :ui="{ content: 'sm:max-w-md' }"
  >
    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-between gap-3">
        <span class="text-sm text-ui-text">{{ t('granVideoEditor.timeline.speedValue') }}</span>
        <span class="text-sm font-mono text-ui-text-muted">{{ speed.toFixed(2) }}</span>
      </div>

      <WheelNumberInput v-model="speedValue" :min="-10" :max="10" :step="0.05" />

      <UAlert
        v-if="showNegativeSpeedAudioWarning"
        color="warning"
        variant="subtle"
        :title="t('granVideoEditor.timeline.negativeSpeedAudioUnsupportedTitle')"
        :description="t('granVideoEditor.timeline.negativeSpeedAudioUnsupportedDescription')"
      />

      <UAlert
        v-if="showLowSpeedWarning"
        color="warning"
        variant="subtle"
        :title="t('granVideoEditor.timeline.speedTooLowTitle')"
        :description="t('granVideoEditor.timeline.speedTooLowDescription')"
      />
    </div>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton color="neutral" variant="ghost" @click="isOpen = false">
          {{ t('common.cancel') }}
        </UButton>
        <UButton color="primary" @click="emit('save')">
          {{ t('common.save') }}
        </UButton>
      </div>
    </template>
  </AppModal>
</template>
