<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';

import type { TimelineClipItem } from '~/timeline/types';
import UiModal from '~/components/ui/UiModal.vue';
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
const showLowSpeedWarning = computed(
  () => Math.abs(props.speed) > 0 && Math.abs(props.speed) < 0.1,
);

const saveButtonRef = ref<any>(null);

function focusSaveButton() {
  const el = saveButtonRef.value?.$el || saveButtonRef.value;
  if (!(el instanceof HTMLElement)) {
    return;
  }

  nextTick(() => {
    setTimeout(() => {
      el.focus();
    }, 0);
  });
}

const handleAfterEnter = () => {
  focusSaveButton();
};

watch(() => props.open, (newValue) => {
  if (newValue) {
    focusSaveButton();
  }
});

</script>

<template>
  <UiModal
    v-model:open="isOpen"
    :title="t('fastcat.timeline.speedModalTitle')"
    :description="t('fastcat.timeline.speedModalDescription')"
    @after:enter="handleAfterEnter"
    :ui="{ content: 'sm:max-w-md' }"
  >
    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-between gap-3">
        <span class="text-sm text-ui-text">{{ t('fastcat.timeline.speedValue') }}</span>
        <span class="text-sm font-mono text-ui-text-muted">{{ speed.toFixed(2) }}</span>
      </div>

      <WheelNumberInput v-model="speedValue" :min="-10" :max="10" :step="0.05" />

      <UAlert
        v-if="showNegativeSpeedAudioWarning"
        color="warning"
        variant="subtle"
        :title="t('fastcat.timeline.negativeSpeedAudioUnsupportedTitle')"
        :description="t('fastcat.timeline.negativeSpeedAudioUnsupportedDescription')"
      />

      <UAlert
        v-if="showLowSpeedWarning"
        color="warning"
        variant="subtle"
        :title="t('fastcat.timeline.speedTooLowTitle')"
        :description="t('fastcat.timeline.speedTooLowDescription')"
      />
    </div>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton color="neutral" variant="ghost" @click="isOpen = false">
          {{ t('common.cancel') }}
        </UButton>
        <UButton ref="saveButtonRef" color="primary" autofocus
          @click="emit('save')">
          {{ t('common.save') }}
        </UButton>
      </div>
    </template>
  </UiModal>
</template>
