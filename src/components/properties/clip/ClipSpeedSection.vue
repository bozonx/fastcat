<script setup lang="ts">
import { computed } from 'vue';
import UiSliderInput from '~/components/ui/UiSliderInput.vue';
import PropertySection from '~/components/properties/PropertySection.vue';
import type { TimelineClipItem, TrackKind } from '~/timeline/types';

const props = defineProps<{
  clip: TimelineClipItem;
  canEditReversed: boolean;
  trackKind: TrackKind;
}>();

const emit = defineEmits<{
  updateSpeed: [speed: number];
}>();

const { t } = useI18n();

const isEnabled = defineModel<boolean>('enabled', { default: true });

const speedMultiplier = computed({
  get: () => {
    return Number((props.clip.speed ?? 1).toFixed(2));
  },
  set: (val: number) => {
    const num = Number(val);
    if (!Number.isFinite(num)) return;
    emit('updateSpeed', num);
  },
});

const isReversed = computed(() => speedMultiplier.value < 0);

const hasAudio = computed(() => {
  return (
    props.trackKind === 'audio' ||
    props.clip.clipType === 'media' ||
    props.clip.clipType === 'timeline'
  );
});

const showReverseAudioWarning = computed(() => isReversed.value && hasAudio.value);

function resetSpeed() {
  emit('updateSpeed', 1);
}
</script>

<template>
  <PropertySection
    v-if="props.canEditReversed"
    v-model:toggle-value="isEnabled"
    :title="t('fastcat.clip.speed.title')"
    has-toggle
  >
    <template #header-actions>
      <button
        class="flex items-center gap-1 text-2xs text-ui-text-muted hover:text-ui-text disabled:opacity-50"
        :title="t('common.actions.reset')"
        :disabled="!isEnabled"
        @click="resetSpeed"
      >
        <UIcon name="i-heroicons-arrow-path" class="w-3.5 h-3.5 block" />
      </button>
    </template>

    <div class="flex flex-col gap-4" :class="{ 'opacity-50 pointer-events-none': !isEnabled }">
      <div class="space-y-4">
        <UiSliderInput
          v-model="speedMultiplier"
          :label="t('fastcat.clip.speedMultiplier')"
          :min="-10"
          :max="10"
          :step="0.01"
          :wheel-step-multiplier="10"
          :default-value="1"
          :disabled="!isEnabled"
          unit="x"
        />
        <div
          v-if="showReverseAudioWarning"
          class="flex items-start gap-2 text-2xs text-warning"
        >
          <UIcon name="i-heroicons-exclamation-triangle" class="w-4 h-4 shrink-0 mt-0.5 block" />
          <span>{{ t('fastcat.clip.speed.reverseAudioWarning') }}</span>
        </div>
      </div>
    </div>
  </PropertySection>
</template>
