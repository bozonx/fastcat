<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';

import UiModal from '~/components/ui/UiModal.vue';
import UiSliderInput from '~/components/ui/UiSliderInput.vue';
import UiAlert from '~/components/ui/UiAlert.vue';
import { useModalOpenModel } from '~/composables/ui/useModalOpenModel';

const { t } = useI18n();

const props = defineProps<{
  open: boolean;
  speed: number;
  hasAudio: boolean;
  isAudioTrack?: boolean;
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

const isOpen = useModalOpenModel(props, emit);

const minSpeed = computed(() => props.isAudioTrack ? 0.1 : -10);

const isSaveDisabled = computed(() => {
  if (props.isAudioTrack) {
    return props.speed < 0.1;
  }
  return Math.abs(props.speed) < 0.1;
});

const showNegativeSpeedAudioWarning = computed(() => props.speed < 0 && props.hasAudio);
const showLowSpeedWarning = computed(
  () => !props.isAudioTrack && Math.abs(props.speed) > 0 && Math.abs(props.speed) < 0.1,
);

const saveButtonRef = ref<import('vue').ComponentPublicInstance | null>(null);

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

watch(
  () => props.open,
  (newValue) => {
    if (newValue) {
      focusSaveButton();
    }
  },
);
</script>

<template>
  <UiModal
    v-model:open="isOpen"
    :title="t('fastcat.timeline.speedModalTitle')"
    :description="t('fastcat.timeline.speedModalDescription')"
    :ui="{ content: 'sm:max-w-md' }"
    @after:enter="handleAfterEnter"
  >
    <div class="flex flex-col gap-3">
      <UiSliderInput
        v-model="speedValue"
        :label="t('fastcat.timeline.speedValue')"
        :min="minSpeed"
        :max="10"
        :step="0.05"
        :unit="'x'"
        show-input
      />

      <UiAlert
        v-if="showNegativeSpeedAudioWarning"
        variant="warning"
        icon="i-heroicons-exclamation-triangle"
      >
        <p class="font-medium text-ui-text">
          {{ t('fastcat.timeline.negativeSpeedAudioUnsupportedTitle') }}
        </p>
        <p>{{ t('fastcat.timeline.negativeSpeedAudioUnsupportedDescription') }}</p>
      </UiAlert>

      <UiAlert v-if="showLowSpeedWarning" variant="warning" icon="i-heroicons-exclamation-triangle">
        <p class="font-medium text-ui-text">{{ t('fastcat.timeline.speedTooLowTitle') }}</p>
        <p>{{ t('fastcat.timeline.speedTooLowDescription') }}</p>
      </UiAlert>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton color="neutral" variant="ghost" @click="void (isOpen = false)">
          {{ t('common.cancel') }}
        </UButton>
        <UButton ref="saveButtonRef" color="primary" autofocus :disabled="isSaveDisabled" @click="emit('save')">
          {{ t('common.save') }}
        </UButton>
      </div>
    </template>
  </UiModal>
</template>
