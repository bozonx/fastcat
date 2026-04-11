<script setup lang="ts">
import { computed } from 'vue';
import UiSliderInput from '~/components/ui/UiSliderInput.vue';
import PropertySection from '~/components/properties/PropertySection.vue';
import type { TimelineClipItem } from '~/timeline/types';

const props = defineProps<{
  clip: TimelineClipItem;
  canEditReversed: boolean;
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
          :min="-50"
          :max="50"
          :step="0.01"
          :wheel-step-multiplier="10"
          :default-value="1"
          :disabled="!isEnabled"
          unit="x"
        />
      </div>
    </div>
  </PropertySection>
</template>
