<script setup lang="ts">
import UiSelect from '~/components/ui/UiSelect.vue';
import UiSliderInput from '~/components/ui/UiSliderInput.vue';
import type { TimelineBlendMode } from '~/timeline/types';

defineProps<{
  blendModeOptions: Array<{ value: TimelineBlendMode; label: string }>;
}>();

const opacity = defineModel<number>('opacity', { required: true });
const blendMode = defineModel<TimelineBlendMode>('blendMode', { required: true });

const { t } = useI18n();
</script>

<template>
  <div class="space-y-1.5 bg-ui-bg-elevated p-2 rounded border border-ui-border">
    <div class="flex flex-col gap-0.5">
      <span class="text-xs text-ui-text-muted">{{ t('fastcat.clip.blendMode.title') }}</span>
      <UiSelect
        v-model="blendMode"
        :items="blendModeOptions"
        value-key="value"
        label-key="label"
        size="sm"
      />
    </div>

    <UiSliderInput
      :label="t('fastcat.clip.opacity')"
      unit="%"
      :model-value="opacity"
      :min="0"
      :max="1"
      :step="0.01"
      :default-value="1"
      :wheel-step-multiplier="10"
      @update:model-value="opacity = $event"
    />
  </div>
</template>
